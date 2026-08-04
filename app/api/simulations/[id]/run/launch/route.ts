import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { FrozenSpec } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig, TIER_MODELS } from "@/lib/run";
import { derivePollInstrument } from "@/lib/engine";
import { executeSlice } from "@/lib/run-worker";
import { RunState, heartbeatFresh } from "@/lib/walkaway";

export const maxDuration = 800; // Vercel Pro ceiling; the slice chain covers anything longer

/**
 * Launch a run (engine v1, CLAUDE.md §5/§6) — 3c walk-away semantics.
 *
 * This route VALIDATES and KICKS OFF; the engine itself runs in the slice
 * worker under waitUntil, decoupled from this response. The stream returned
 * here is a live WINDOW into the first slice — closing the tab detaches the
 * window and the run keeps going. Suspended slices fire their own successors
 * through /run/continue (service key present) or fall back to client-driven
 * reconnection. Re-launching clears the previous transcript; a continue
 * resumes a suspended or orphaned run (409 while a worker's heartbeat is
 * fresh — watch it live instead).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body: { continue?: boolean } = {};
  try { body = await request.json(); } catch { body = {}; }
  const isContinue = body.continue === true;

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const { data: sim } = await supabase.from("simulations").select("id, brief, config, status").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const config = (sim.config as Record<string, unknown>) ?? {};
  const runState = (config.run_state as RunState | undefined) ?? null;
  if (sim.status === "running") {
    // a live worker is driving — never double-drive; the run screen observes.
    // A stale heartbeat means the run is orphaned (deploy/crash) and a
    // CONTINUE may claim it; a fresh launch over an orphan must still 409.
    if (heartbeatFresh(runState, Date.now())) {
      return NextResponse.json({ error: "This run is already going server-side — watch it live or come back for the report", live: true }, { status: 409 });
    }
    if (!isContinue) return NextResponse.json({ error: "A run is already in progress" }, { status: 409 });
  }
  const brief = (sim.brief ?? {}) as { problem?: string; questions?: unknown };
  if (!brief.problem) return NextResponse.json({ error: "Write the brief first" }, { status: 400 });

  const cfg: RunConfig = { ...RUN_DEFAULTS, ...((config.run as Partial<RunConfig>) ?? {}) };
  const { data: agents } = await supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id);
  const leadCount = (agents ?? []).filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd").length;
  const crowdCount = (agents ?? []).length - leadCount;
  if (leadCount < 2) return NextResponse.json({ error: "Cast at least 2 leads first" }, { status: 400 });

  // fresh transcript on relaunch; a CONTINUE resumes from the persisted one
  if (!isContinue) {
    await supabase.from("posts").delete().eq("sim_id", id);
    await supabase.from("events").delete().eq("sim_id", id);
    await supabase.from("post_votes").delete().eq("sim_id", id);
  }

  // ---- the poll instrument: derived ONCE per simulation (persisted in config
  // so every round, resume slice, and the report ask the crowd the same thing).
  // Choose-between briefs poll the brief's actual alternatives; everything
  // else gets the classic stance poll (options stays empty). ----
  // field report 3: Jury needs the instrument even with NO crowd — a choice
  // brief without options collapses to "score the proposition" and every
  // juror anchors the first uploaded file
  const castMode = String((config.casting as { mode?: string } | undefined)?.mode ?? "Agora");
  if (!config.poll_question && (crowdCount > 0 || castMode === "Jury")) {
    const instrument = await derivePollInstrument(
      new Anthropic(), TIER_MODELS[cfg.tier].crowd, brief.problem!,
      async (surface, model, usage, t0, error) => {
        await supabase.from("agent_interactions").insert({
          org_id: orgId, user_id: user.id, surface, model, sim_id: id,
          input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
          latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null,
        });
      },
    );
    config.poll_question = instrument.question;
    if (instrument.options.length) config.poll_options = instrument.options;
  }

  const workerNonce = Math.random().toString(36).slice(2, 10);
  await supabase.from("simulations").update({
    status: "running",
    config: {
      ...config,
      run_state: {
        round: isContinue ? (runState?.round ?? null) : null,
        heartbeat_at: new Date().toISOString(),
        worker: workerNonce,
        stop_requested: false,
        started_at: isContinue ? (runState?.started_at ?? new Date().toISOString()) : new Date().toISOString(),
      } satisfies RunState,
    },
  }).eq("id", id);

  // the worker gets the admin client when available (slices can then chain
  // server-side); otherwise the launcher's RLS client drives THIS slice and
  // the client reconnects for the next one (pre-3c behavior, still safe)
  const admin = createAdminSupabase();
  const origin = process.env.ENGINE_ORIGIN || new URL(request.url).origin;

  // ---- the response is a WINDOW, not the engine's home: the worker runs
  // under waitUntil and survives this stream being cancelled ----
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController | null = null;
  let clientGone = false;
  const stream = new ReadableStream({
    start(c) { controller = c; },
    cancel() { clientGone = true; }, // detach the window — the run does not care
  });
  const bus = {
    send: (obj: unknown) => {
      if (clientGone || !controller) return;
      try { controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`)); } catch { clientGone = true; }
    },
    end: () => { try { controller?.close(); } catch { /* already closed */ } },
  };

  waitUntil(executeSlice({
    db: admin ?? supabase,
    simId: id, orgId, userId: user.id,
    origin, canChain: Boolean(admin),
    workerNonce, bus,
  }));

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
