/**
 * 3c — the walk-away slice worker (docs/next-level-plan.md §3c).
 *
 * One invocation = one engine slice. The engine no longer lives inside a
 * response stream: the launch route validates and kicks the first slice off
 * under waitUntil (streaming it opportunistically while the tab is open),
 * and each slice that suspends at the serverless window fires the NEXT slice
 * itself via the secret-authed /run/continue route. Close the tab and the
 * run keeps going; `config.run_state` + the heartbeat are the truth.
 *
 * STOP is graceful by construction: /run/stop sets run_state.stop_requested,
 * the worker's config poll picks it up and ZEROES ctx.deadline — the engine
 * suspends at its next safe boundary through the same proven paths the
 * serverless window uses, and the worker finalizes the run as "stopped".
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FrozenSpec } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig } from "@/lib/run";
import { CorpusDocInput, buildCorpusBlocks, normalizeQuestions } from "@/lib/corpus";
import { EngineContext, EngineEvent, EngineLead, PostRec, RunResume, runMode } from "@/lib/engine";
import { CHAIN_PENDING, RunState, SLICE_BUDGET_MS, chainSecret } from "@/lib/walkaway";
import { normalizeEnabledTools } from "@/lib/tools";

/** best-effort window into the run — a dropped client NEVER touches the engine */
export interface SliceBus {
  send: (e: unknown) => void;
  end: () => void;
}

export interface SliceArgs {
  db: SupabaseClient;           // admin client (chain) or the launcher's RLS client (fallback)
  simId: string;
  orgId: string;
  userId: string;
  origin: string;               // where to POST the next slice
  canChain: boolean;            // service key present → slices schedule their own successors
  workerNonce: string;
  bus?: SliceBus;
}

export async function executeSlice({ db, simId, orgId, userId, origin, canChain, workerNonce, bus }: SliceArgs): Promise<void> {
  const send = (obj: unknown) => { try { bus?.send(obj); } catch { /* window closed — the run does not care */ } };
  let beat: ReturnType<typeof setInterval> | null = null;
  try {
    const { data: sim } = await db.from("simulations").select("id, brief, config, status").eq("id", simId).maybeSingle();
    if (!sim || sim.status !== "running") { send({ type: "error", error: "Run is no longer active" }); return; }
    const brief = (sim.brief ?? {}) as { problem?: string; questions?: unknown };
    const config = (sim.config as Record<string, unknown>) ?? {};
    const cfg: RunConfig = { ...RUN_DEFAULTS, ...((config.run as Partial<RunConfig>) ?? {}) };
    const mode = String((config.casting as { mode?: string } | undefined)?.mode ?? "Agora");
    const runState = (config.run_state as RunState | undefined) ?? {};

    const { data: agents } = await db.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", simId);
    const leads: EngineLead[] = (agents ?? [])
      .filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd")
      .map((a) => ({ key: a.agent_key as string, spec: a.spec_frozen as FrozenSpec }));
    const crowd = (agents ?? [])
      .filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier === "crowd")
      .map((a) => ({ key: a.agent_key as string, spec: a.spec_frozen as FrozenSpec }));

    // ---- corpus prefix: same grounding path as Test-the-corpus (§2 Stage 2) ----
    const { data: docs } = await db.from("documents")
      .select("id, name, mime, anthropic_file_id").eq("sim_id", simId).eq("parse_status", "parsed")
      .order("created_at", { ascending: true }); // upload order IS the corpus order — "IMAGE n" ordinals must agree across every surface
    const docInputs: CorpusDocInput[] = [];
    for (const d of docs ?? []) {
      if (d.anthropic_file_id) docInputs.push({ name: d.name as string, mime: d.mime as string | null, file_id: d.anthropic_file_id as string });
      else {
        const { data: chunks } = await db.from("doc_chunks")
          .select("content").eq("document_id", d.id).order("seq", { ascending: true }).limit(120);
        const text = (chunks ?? []).map((c) => c.content).join("\n\n");
        if (text) docInputs.push({ name: d.name as string, mime: d.mime as string | null, text });
      }
    }
    // shared builder: images carry NAME LABELS so agents can resolve "4.jpg"
    const corpusBlocks = buildCorpusBlocks(docInputs) as unknown as (Anthropic.Beta.BetaContentBlockParam & { cache_control?: { type: "ephemeral" } })[];
    if (corpusBlocks.length) corpusBlocks[corpusBlocks.length - 1].cache_control = { type: "ephemeral" };

    // ---- resume state ALWAYS reconstructs from the database — the transcript
    // is the source of truth, whichever worker ran the previous slice ----
    const polledRounds = new Set<number>();
    const votedRounds = new Set<number>();
    // 3d — the shared factbase survives slice handoffs: rebuild it from the
    // persisted tool events so slice 2's agents see slice 1's searches
    const pulledFacts: { query: string; results: { title: string; url: string }[] }[] = [];
    let resume: RunResume | undefined;
    const { data: prevPosts } = await db.from("posts")
      .select("seq, agent_key, tag, content, cites, reply_to").eq("sim_id", simId).order("seq", { ascending: true });
    if ((prevPosts ?? []).length > 0) {
      const recs: PostRec[] = (prevPosts ?? []).map((r) => {
        const meta = (r.cites as { name?: string; role?: string; round?: number } | null) ?? {};
        return { name: meta.name ?? "Agent", role: meta.role ?? "", content: r.content as string, tag: r.tag as string, seq: r.seq as number, agentKey: r.agent_key as string, round: meta.round ?? 1, replyTo: r.reply_to as number | null };
      });
      const { data: prevEvents } = await db.from("events").select("type, payload").eq("sim_id", simId).in("type", ["sentiment", "votes", "tool"]);
      for (const e of prevEvents ?? []) {
        if (e.type === "tool") {
          const p = e.payload as { query?: string; results?: { title: string; url: string }[] };
          if (p.query) pulledFacts.push({ query: String(p.query), results: Array.isArray(p.results) ? p.results : [] });
          continue;
        }
        const round = Number((e.payload as { round?: number }).round ?? 0);
        if (e.type === "sentiment") polledRounds.add(round);
        else votedRounds.add(round);
      }
      resume = { posts: recs, seq: recs.reduce((m, r) => Math.max(m, r.seq), 0), round: runState.round ?? Math.max(1, ...recs.map((r) => r.round)) };
    }

    let evSeq = resume ? 1000 * (resume.round ?? 1) : 0; // coarse but monotonic across slices
    const emit = async (e: EngineEvent) => {
      send(e);
      if (e.type === "post") {
        await db.from("posts").insert({
          sim_id: simId, seq: e.seq, author: "agent", agent_key: e.agent_key,
          thread: e.thread, reply_to: e.reply_to, tag: e.tag, content: e.content,
          cites: { cites: e.cites, name: e.name, role: e.role, initials: e.initials, adversarial: e.adversarial ?? false, round: e.round, phase: e.phase ?? null, side: e.side ?? null },
        });
      } else if (e.type === "votes") {
        // votes land in their own table (hover attribution + report queries)
        // AND in events (resume detection + replay)
        if (e.votes.length) {
          await db.from("post_votes").upsert(
            e.votes.map((v) => ({ sim_id: simId, seq: v.seq, voter_key: v.voter_key, voter_name: v.voter_name, voter_role: v.voter_role, vote: v.vote })),
            { onConflict: "sim_id,seq,voter_key" },
          );
        }
        evSeq += 1;
        await db.from("events").insert({ sim_id: simId, seq: evSeq, type: e.type, payload: e });
      } else if (e.type === "tool") {
        // 3d — searches land in tool_runs (the audit trail + report input)
        // AND in events (feed replay + observer tail + factbase resume)
        await db.from("tool_runs").insert({
          sim_id: simId, agent_key: e.agent_key, tool: e.tool,
          input: { query: e.query }, output: { results: e.results },
        });
        evSeq += 1;
        await db.from("events").insert({ sim_id: simId, seq: evSeq, type: e.type, payload: e });
      } else if (e.type !== "presence" && e.type !== "polling") {
        // presence is transient UI state — streamed, never persisted
        evSeq += 1;
        await db.from("events").insert({ sim_id: simId, seq: evSeq, type: e.type, payload: e });
      }
    };
    const logCall = async (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => {
      await db.from("agent_interactions").insert({
        org_id: orgId, user_id: userId, surface, model, sim_id: simId,
        input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
        latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null, detail: detail ?? null,
      });
    };

    send({ type: "config", rounds: cfg.rounds, max_posts: cfg.max_posts, mode });
    await emit({ type: "stage", value: "running" });

    const ctx: EngineContext = {
      anthropic: new Anthropic(), cfg, mode,
      problem: brief.problem ?? "",
      questions: normalizeQuestions(brief.questions).map((x) => x.label),
      leads, crowd, corpusBlocks,
      pollQuestion: String(config.poll_question ?? brief.problem ?? ""),
      pollOptions: Array.isArray(config.poll_options) ? (config.poll_options as unknown[]).map(String) : [],
      tools: normalizeEnabledTools(config.tools),
      pulledFacts,
      temperature: 0.7,
      // SLICE_BUDGET_MS leaves 150s of kill headroom inside the 800s window —
      // a deadline check happens BEFORE each model call, so the headroom must
      // outlast the longest single call (field-observed: 137s web-search turn)
      deadline: Date.now() + (Number(process.env.ENGINE_CHUNK_MS) || SLICE_BUDGET_MS),
      polledRounds, votedRounds,
      emit, logCall,
      isCancelled: () => false, // client disconnects NEVER cancel a run (3c); stop is graceful, below
    };

    // ---- the truth loop: every 12s, beat the heartbeat and pick up a STOP.
    // A stop zeroes the deadline so the engine suspends at its next safe
    // boundary — the same proven path the serverless window uses. ----
    let stopRequested = false;
    const writeState = async (state: RunState) => {
      const { data: fresh } = await db.from("simulations").select("config").eq("id", simId).maybeSingle();
      const freshConfig = (fresh?.config as Record<string, unknown>) ?? config;
      await db.from("simulations").update({ config: { ...freshConfig, run_state: state } }).eq("id", simId);
      return freshConfig;
    };
    await writeState({ ...runState, heartbeat_at: new Date().toISOString(), worker: workerNonce, stop_requested: runState.stop_requested ?? false });
    beat = setInterval(() => {
      void (async () => {
        try {
          const { data: fresh } = await db.from("simulations").select("config").eq("id", simId).maybeSingle();
          const rs = ((fresh?.config as Record<string, unknown>)?.run_state as RunState | undefined) ?? {};
          if (rs.stop_requested && !stopRequested) {
            stopRequested = true;
            ctx.deadline = 0; // suspend at the next safe boundary
            send({ type: "stage", value: "running", detail: "STOP REQUESTED — FINISHING THE CURRENT TURN, THEN CLOSING THE RUN" });
          }
          await db.from("simulations").update({
            config: { ...((fresh?.config as Record<string, unknown>) ?? {}), run_state: { ...rs, heartbeat_at: new Date().toISOString(), worker: workerNonce } },
          }).eq("id", simId);
        } catch { /* a missed beat is fine — the next one lands */ }
      })();
    }, 12_000);

    const result = await runMode(ctx, resume);
    clearInterval(beat); beat = null;

    if (result.suspendedAtRound && !stopRequested) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      let chained = false;
      if (canChain && serviceKey) {
        // chained handoff: PRE-CLAIM for the child (fresh heartbeat + the
        // CHAIN_PENDING worker id) so a racing client resume sees "being
        // driven" and observes instead of starting a second driver; the child
        // recognizes its own handoff and takes over. If the chain fetch never
        // lands, the heartbeat goes stale and RESUME reopens honestly.
        await writeState({ round: result.suspendedAtRound, heartbeat_at: new Date().toISOString(), worker: CHAIN_PENDING });
        try {
          const r = await fetch(`${origin}/api/simulations/${simId}/run/continue`, {
            method: "POST",
            headers: { "x-engine-key": chainSecret(serviceKey, simId) },
          });
          chained = r.ok;
        } catch { chained = false; }
        if (!chained) {
          // the chain didn't take — reopen the handoff for a client resume
          await writeState({ round: result.suspendedAtRound, heartbeat_at: null, worker: null });
        }
      } else {
        // legacy handoff (no service key): null heartbeat so the client's
        // immediate reconnect can claim without waiting out staleness
        await writeState({ round: result.suspendedAtRound, heartbeat_at: null, worker: null });
      }
      send({ type: "continue", round: result.suspendedAtRound, posts: result.posts, chained });
    } else if (stopRequested) {
      // a user stop is a COMPLETE run with an honest reason — the transcript
      // is preserved and the report synthesizes whatever the panel produced
      await emit({ type: "stage", value: "done", detail: "stopped" });
      const { data: fresh } = await db.from("simulations").select("config").eq("id", simId).maybeSingle();
      await db.from("simulations").update({
        status: "complete",
        config: { ...((fresh?.config as Record<string, unknown>) ?? {}), run_state: null, run_result: { posts: result.posts, converged: false, stop: "stopped", mode, at: new Date().toISOString() } },
      }).eq("id", simId);
      send({ type: "finished", posts: result.posts });
    } else {
      // "converged" is reserved for the stability rule actually firing —
      // fixed choreographies and exhausted rounds report themselves honestly
      await emit({ type: "stage", value: result.stopReason === "stability" ? "converged" : "done", detail: result.stopReason });
      const { data: fresh } = await db.from("simulations").select("config").eq("id", simId).maybeSingle();
      await db.from("simulations").update({
        status: "complete",
        config: { ...((fresh?.config as Record<string, unknown>) ?? {}), run_state: null, run_result: { posts: result.posts, converged: result.converged, stop: result.stopReason, mode, at: new Date().toISOString() } },
      }).eq("id", simId);
      send({ type: "finished", posts: result.posts });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Run failed";
    try {
      await db.from("events").insert({ sim_id: simId, seq: 999_999, type: "stage", payload: { type: "stage", value: "error", detail: msg } });
      await db.from("simulations").update({ status: "draft" }).eq("id", simId);
    } catch { /* the error event is best-effort */ }
    send({ type: "error", error: msg });
  } finally {
    if (beat) clearInterval(beat);
    try { bus?.end(); } catch { /* window already closed */ }
  }
}
