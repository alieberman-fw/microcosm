import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { FrozenSpec } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig } from "@/lib/run";
import { normalizeQuestions } from "@/lib/corpus";
import { EngineEvent, EngineLead, PostRec, RunResume, runMode } from "@/lib/engine";

export const maxDuration = 800; // Vercel Pro ceiling; chunked continuation covers anything longer

const FILES_BETA = "files-api-2025-04-14";

/**
 * Launch a real run (engine v1, CLAUDE.md §5/§6). Streams §6.2 events as
 * ND-JSON while persisting every post to `posts` and every non-post event
 * to `events` — the run is replayable from the database afterwards.
 * Re-launching clears the previous transcript.
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
  if (sim.status === "running" && !isContinue) return NextResponse.json({ error: "A run is already in progress" }, { status: 409 });
  const brief = (sim.brief ?? {}) as { problem?: string; questions?: unknown };
  if (!brief.problem) return NextResponse.json({ error: "Write the brief first" }, { status: 400 });

  const config = (sim.config as Record<string, unknown>) ?? {};
  const cfg: RunConfig = { ...RUN_DEFAULTS, ...((config.run as Partial<RunConfig>) ?? {}) };
  const mode = String((config.casting as { mode?: string } | undefined)?.mode ?? "Agora");

  const { data: agents } = await supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id);
  const leads: EngineLead[] = (agents ?? [])
    .filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd")
    .map((a) => ({ key: a.agent_key as string, spec: a.spec_frozen as FrozenSpec }));
  const crowd = (agents ?? [])
    .filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier === "crowd")
    .map((a) => ({ key: a.agent_key as string, spec: a.spec_frozen as FrozenSpec }));
  if (leads.length < 2) return NextResponse.json({ error: "Cast at least 2 leads first" }, { status: 400 });

  // ---- corpus prefix: same grounding path as Test-the-corpus (§2 Stage 2) ----
  const { data: docs } = await supabase.from("documents")
    .select("id, name, mime, anthropic_file_id").eq("sim_id", id).eq("parse_status", "parsed");
  const corpusBlocks: (Anthropic.Beta.BetaContentBlockParam & { cache_control?: { type: "ephemeral" } })[] = [];
  for (const d of docs ?? []) {
    if (d.anthropic_file_id) {
      if ((d.mime ?? "").startsWith("image/")) corpusBlocks.push({ type: "image", source: { type: "file", file_id: d.anthropic_file_id } });
      else corpusBlocks.push({ type: "document", source: { type: "file", file_id: d.anthropic_file_id }, title: d.name, citations: { enabled: true } });
    } else {
      const { data: chunks } = await supabase.from("doc_chunks")
        .select("content").eq("document_id", d.id).order("seq", { ascending: true }).limit(120);
      const text = (chunks ?? []).map((c) => c.content).join("\n\n");
      if (text) corpusBlocks.push({ type: "document", source: { type: "text", media_type: "text/plain", data: text.slice(0, 300_000) }, title: d.name, citations: { enabled: true } });
    }
  }
  if (corpusBlocks.length) corpusBlocks[corpusBlocks.length - 1].cache_control = { type: "ephemeral" };

  // fresh transcript on relaunch; a CONTINUE resumes the suspended run
  let resume: RunResume | undefined;
  const polledRounds = new Set<number>();
  if (isContinue) {
    const runState = (config.run_state as { round?: number } | undefined) ?? {};
    const { data: prevPosts } = await supabase.from("posts")
      .select("seq, agent_key, tag, content, cites").eq("sim_id", id).order("seq", { ascending: true });
    const recs: PostRec[] = (prevPosts ?? []).map((r) => {
      const meta = (r.cites as { name?: string; role?: string; round?: number } | null) ?? {};
      return { name: meta.name ?? "Agent", role: meta.role ?? "", content: r.content as string, tag: r.tag as string, seq: r.seq as number, agentKey: r.agent_key as string, round: meta.round ?? 1 };
    });
    const { data: prevEvents } = await supabase.from("events").select("type, payload").eq("sim_id", id).eq("type", "sentiment");
    for (const e of prevEvents ?? []) polledRounds.add(Number((e.payload as { round?: number }).round ?? 0));
    resume = { posts: recs, seq: recs.reduce((m, r) => Math.max(m, r.seq), 0), round: runState.round ?? Math.max(1, ...recs.map((r) => r.round)) };
  } else {
    await supabase.from("posts").delete().eq("sim_id", id);
    await supabase.from("events").delete().eq("sim_id", id);
  }
  await supabase.from("simulations").update({ status: "running" }).eq("id", id);

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();
  let cancelled = false;
  let evSeq = isContinue ? 1000 * (resume?.round ?? 1) : 0; // coarse but monotonic across chunks

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`)); } catch { cancelled = true; }
      };
      const emit = async (e: EngineEvent) => {
        send(e);
        if (e.type === "post") {
          await supabase.from("posts").insert({
            sim_id: id, seq: e.seq, author: "agent", agent_key: e.agent_key,
            thread: e.thread, reply_to: e.reply_to, tag: e.tag, content: e.content,
            cites: { cites: e.cites, name: e.name, role: e.role, initials: e.initials, adversarial: e.adversarial ?? false, round: e.round, phase: e.phase ?? null, side: e.side ?? null },
          });
        } else if (e.type !== "presence" && e.type !== "polling") {
          // presence is transient UI state — streamed, never persisted
          evSeq += 1;
          await supabase.from("events").insert({ sim_id: id, seq: evSeq, type: e.type, payload: e });
        }
      };
      const logCall = async (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => {
        await supabase.from("agent_interactions").insert({
          org_id: orgId, user_id: user.id, surface, model, sim_id: id,
          input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
          latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null, detail: detail ?? null,
        });
      };
      try {
        // the engine's ACTUAL parameters, first thing on the wire — the run
        // header trusts this over whatever it server-rendered with
        send({ type: "config", rounds: cfg.rounds, max_posts: cfg.max_posts, mode });
        await emit({ type: "stage", value: "running" });
        // unlimited total length via chunked continuation: each request runs a
        // ~4-minute slice, suspends at a safe boundary, and the run screen
        // reconnects for the next slice (the Python worker later makes this
        // one unbroken process)
        const result = await runMode({
          anthropic, cfg, mode,
          problem: brief.problem!,
          questions: normalizeQuestions(brief.questions).map((x) => x.label),
          leads, crowd, corpusBlocks,
          temperature: 0.7,
          deadline: Date.now() + (Number(process.env.ENGINE_CHUNK_MS) || 770_000), // ~13-min slices on Pro; env override for dev tests
          polledRounds,
          emit, logCall,
          isCancelled: () => cancelled,
        }, resume);
        if (result.suspendedAtRound) {
          await supabase.from("simulations").update({
            config: { ...config, run_state: { round: result.suspendedAtRound } },
          }).eq("id", id);
          send({ type: "continue", round: result.suspendedAtRound, posts: result.posts });
        } else {
          // "converged" is reserved for the stability rule actually firing —
          // fixed choreographies and exhausted rounds report themselves honestly
          await emit({ type: "stage", value: result.stopReason === "stability" ? "converged" : "done", detail: result.stopReason });
          await supabase.from("simulations").update({
            status: "complete",
            config: { ...config, run_state: null, run_result: { posts: result.posts, converged: result.converged, stop: result.stopReason, mode, at: new Date().toISOString() } },
          }).eq("id", id);
          send({ type: "finished", posts: result.posts });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Run failed";
        await emit({ type: "stage", value: "error", detail: msg });
        await supabase.from("simulations").update({ status: "draft" }).eq("id", id);
        send({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
    cancel() { cancelled = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
