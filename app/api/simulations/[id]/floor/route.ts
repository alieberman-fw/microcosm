import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { FrozenSpec } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig } from "@/lib/run";
import { EngineContext, EngineEvent, PostRec, takeTheFloor } from "@/lib/engine";
import { normalizeEnabledTools } from "@/lib/tools";

export const maxDuration = 300;

/**
 * Take the Floor (CLAUDE.md §2 Stage 4): the user posts directly into the
 * forum and @mentioned agents reply with full context of the transcript,
 * corpus, and their personas. The user's post and the replies are ordinary
 * transcript rows — rendered distinctly in the feed, citable by the report.
 * Available whenever a run is NOT actively streaming (paused, converged,
 * complete, or post-report follow-ups).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body: { content?: string; mentions?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const content = (body.content ?? "").trim().slice(0, 2000);
  if (!content) return NextResponse.json({ error: "Write something first" }, { status: 400 });
  const mentions = (body.mentions ?? []).filter((m) => typeof m === "string").slice(0, 4);

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const { data: sim } = await supabase.from("simulations").select("id, brief, config, status").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  if (sim.status === "running") return NextResponse.json({ error: "The run is still streaming — take the floor at the next pause" }, { status: 409 });
  const brief = (sim.brief ?? {}) as { problem?: string };

  const { data: agents } = await supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id);
  const leads = (agents ?? [])
    .filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd")
    .map((a) => ({ key: a.agent_key as string, spec: a.spec_frozen as FrozenSpec }));
  if (leads.length === 0) return NextResponse.json({ error: "No panel cast yet" }, { status: 400 });

  const { data: postRows } = await supabase.from("posts")
    .select("seq, agent_key, tag, content, cites, reply_to").eq("sim_id", id).order("seq", { ascending: true });
  if (!postRows?.length) return NextResponse.json({ error: "Run the simulation first — the floor opens once there is a transcript" }, { status: 400 });
  const posts: PostRec[] = postRows.map((r) => {
    const meta = (r.cites as { name?: string; role?: string; round?: number } | null) ?? {};
    return { name: meta.name ?? "Agent", role: meta.role ?? "", content: r.content as string, tag: r.tag as string, seq: r.seq as number, agentKey: r.agent_key as string, round: meta.round ?? 1, replyTo: r.reply_to as number | null };
  });

  // corpus prefix — same grounding path as the run itself
  const { data: docs } = await supabase.from("documents")
    .select("id, name, mime, anthropic_file_id").eq("sim_id", id).eq("parse_status", "parsed");
  const corpusBlocks: (Anthropic.Beta.BetaContentBlockParam & { cache_control?: { type: "ephemeral" } })[] = [];
  for (const d of docs ?? []) {
    if (!d.anthropic_file_id) continue;
    if ((d.mime ?? "").startsWith("image/")) corpusBlocks.push({ type: "image", source: { type: "file", file_id: d.anthropic_file_id } });
    else corpusBlocks.push({ type: "document", source: { type: "file", file_id: d.anthropic_file_id }, title: d.name, citations: { enabled: true } });
  }
  if (corpusBlocks.length) corpusBlocks[corpusBlocks.length - 1].cache_control = { type: "ephemeral" };

  const config = (sim.config as Record<string, unknown>) ?? {};
  const cfg: RunConfig = { ...RUN_DEFAULTS, ...((config.run as Partial<RunConfig>) ?? {}) };
  const mode = String((config.run_result as { mode?: string } | undefined)?.mode
    ?? (config.casting as { mode?: string } | undefined)?.mode ?? "Agora");
  const round = posts.reduce((m, p) => Math.max(m, p.round), 1);

  // persist the user's floor post first — it exists even if every reply fails
  const floorSeq = posts.reduce((m, p) => Math.max(m, p.seq), 0) + 1;
  const { error: insErr } = await supabase.from("posts").insert({
    sim_id: id, seq: floorSeq, author: "user", agent_key: "__user",
    thread: "FLOOR", reply_to: null, tag: "FLOOR", content,
    cites: { cites: [], name: "You", role: "Taking the floor", initials: "YOU", adversarial: false, round },
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  posts.push({ name: "You", role: "Taking the floor", content, tag: "FLOOR", seq: floorSeq, agentKey: "__user", round, replyTo: null });

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();
  let cancelled = false;

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
        }
      };
      const ctx: EngineContext = {
        anthropic, cfg, mode,
        problem: brief.problem ?? "",
        questions: [],
        leads, crowd: [], corpusBlocks,
        pollQuestion: brief.problem ?? "", // floor replies never poll — placeholder only
        // 3d — mentioned agents get the same tools the run was allowed
        tools: normalizeEnabledTools(config.tools),
        pulledFacts: [],
        temperature: 0.7,
        deadline: Date.now() + 240_000,
        polledRounds: new Set(), votedRounds: new Set(),
        emit,
        logCall: async (surface, model, usage, t0, error, detail) => {
          await supabase.from("agent_interactions").insert({
            org_id: orgId, user_id: user.id, surface: surface === "engine.turn" ? "engine.floor" : surface, model, sim_id: id,
            input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
            latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null, detail: detail ?? null,
          });
        },
        isCancelled: () => cancelled,
      };
      try {
        send({ type: "floor", seq: floorSeq });
        const replied = await takeTheFloor(ctx, { posts, floorSeq, content, mentionKeys: mentions });
        send({ type: "finished", replies: replied });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "The panel could not answer" });
      } finally {
        controller.close();
      }
    },
    cancel() { cancelled = true; },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
