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
import { CoverageScore, PollAngle, SubAskLite, normalizeStanceLabels } from "@/lib/agenda";
import { FrozenSpec } from "@/lib/casting";
import { BriefContract } from "@/lib/understand";
import { RUN_DEFAULTS, RunConfig } from "@/lib/run";
import { CorpusDocInput, buildCorpusBlocks, normalizeQuestions } from "@/lib/corpus";
import { EngineContext, EngineEvent, EngineLead, PostRec, RunResume, runMode } from "@/lib/engine";
import { CHAIN_PENDING, ENGINE_CALL_TIMEOUT_MS, RunState, SLICE_BUDGET_MS, chainSecret, claimRun, eventDedupeKey } from "@/lib/walkaway";
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
  // set when another chain CAS-claims the run out from under us (we were
  // frozen past staleness and a reclaim/reaper won): this worker goes SILENT —
  // no posts, no events, no handoff, no finalize. The field incident was two
  // chains driving one run because neither ever re-checked ownership.
  let usurped = false;
  let stopRequested = false;
  /** every run_state/status write is a fenced CAS on run_state.worker
   *  (claim_run RPC, migration 0018) — expected defaults to OUR nonce */
  const fenced = (state: Partial<RunState> | null, status = "running", configPatch: Record<string, unknown> = {}, expected: string = workerNonce) =>
    claimRun(db, { simId, expectedWorker: expected, runState: state, status, configPatch });
  try {
    const { data: sim } = await db.from("simulations").select("id, brief, config, status").eq("id", simId).maybeSingle();
    if (!sim || sim.status !== "running") { send({ type: "error", error: "Run is no longer active" }); return; }

    // ---- ownership check FIRST: the entrance (launch/continue) CAS-claimed
    // run_state.worker = our nonce before spawning us; this fenced beat
    // re-verifies before anything lands. A lost CAS means a racing entrance
    // won the run — this chain must never drive. ----
    const confirm = await fenced({ heartbeat_at: new Date().toISOString(), worker: workerNonce });
    if (confirm === "lost") return;
    if (confirm === "error") throw new Error("run chain lock unavailable — is migration 0018 applied?");
    const brief = (sim.brief ?? {}) as { problem?: string; questions?: unknown; contract?: BriefContract };
    // 6-PR3 (§6c/§6d): the contract drives round agendas, the resolution
    // tracker, and the adaptive poll plan; no contract → all three off
    const subAsks: SubAskLite[] = (brief.contract?.sub_asks ?? []).map((s) => ({ id: s.id, ask: s.ask }));
    const pollPlan: PollAngle[] | null = Array.isArray(brief.contract?.poll_plan) ? brief.contract!.poll_plan! : null;
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
    const trackedRounds = new Set<number>();
    let coverage: CoverageScore[] = [];
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
      const { data: prevEvents } = await db.from("events").select("type, payload").eq("sim_id", simId).in("type", ["sentiment", "votes", "tool", "coverage"]);
      let latestCoverageRound = 0;
      for (const e of prevEvents ?? []) {
        if (e.type === "tool") {
          const p = e.payload as { query?: string; results?: { title: string; url: string }[] };
          if (p.query) pulledFacts.push({ query: String(p.query), results: Array.isArray(p.results) ? p.results : [] });
          continue;
        }
        const round = Number((e.payload as { round?: number }).round ?? 0);
        if (e.type === "sentiment") polledRounds.add(round);
        else if (e.type === "coverage") {
          // 6-PR3 resume: the latest persisted scores seed the next agenda
          trackedRounds.add(round);
          if (round >= latestCoverageRound) {
            latestCoverageRound = round;
            const scores = (e.payload as { scores?: CoverageScore[] }).scores;
            if (Array.isArray(scores)) coverage = scores;
          }
        }
        else votedRounds.add(round);
      }
      resume = { posts: recs, seq: recs.reduce((m, r) => Math.max(m, r.seq), 0), round: runState.round ?? Math.max(1, ...recs.map((r) => r.round)) };
    }

    let evSeq = resume ? 1000 * (resume.round ?? 1) : 0; // coarse but monotonic across slices
    // migration 0018: round-close artifacts (sentiment/coverage/agenda) carry
    // a per-round dedupe key — a duplicate from a twin chain or a replayed
    // round lands ON CONFLICT DO NOTHING instead of persisting twice; unkeyed
    // events insert exactly as before (NULL keys are distinct)
    const persistEvent = async (e: EngineEvent) => {
      await db.from("events").upsert(
        [{ sim_id: simId, seq: evSeq, type: e.type, payload: e, dedupe_key: eventDedupeKey(e) }],
        { onConflict: "sim_id,dedupe_key", ignoreDuplicates: true },
      );
    };
    const emit = async (e: EngineEvent) => {
      if (usurped) return; // another chain owns the run — nothing may land or stream from this one
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
        await persistEvent(e);
      } else if (e.type === "tool") {
        // 3d — searches land in tool_runs (the audit trail + report input)
        // AND in events (feed replay + observer tail + factbase resume)
        await db.from("tool_runs").insert({
          sim_id: simId, agent_key: e.agent_key, tool: e.tool,
          input: { query: e.query }, output: { results: e.results },
        });
        evSeq += 1;
        await persistEvent(e);
      } else if (e.type !== "presence" && e.type !== "polling") {
        // presence is transient UI state — streamed, never persisted
        evSeq += 1;
        await persistEvent(e);
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
      // per-call timeout + no SDK retries: the walkaway invariant is
      // SLICE_BUDGET + CALL_TIMEOUT + margin ≤ 800s (see lib/walkaway.ts) —
      // a runaway multi-search turn gets cut, and the engine's own ladder
      // retries at a safe boundary where the deadline is re-checked
      anthropic: new Anthropic({ timeout: ENGINE_CALL_TIMEOUT_MS, maxRetries: 0 }), cfg, mode,
      problem: brief.problem ?? "",
      questions: normalizeQuestions(brief.questions).map((x) => x.label),
      leads, crowd, corpusBlocks,
      pollQuestion: String(config.poll_question ?? brief.problem ?? ""),
      pollOptions: Array.isArray(config.poll_options) ? (config.poll_options as unknown[]).map(String) : [],
      pollLabels: normalizeStanceLabels(config.poll_labels),
      tools: normalizeEnabledTools(config.tools),
      pulledFacts,
      temperature: 0.7,
      // SLICE_BUDGET_MS leaves 150s of kill headroom inside the 800s window —
      // a deadline check happens BEFORE each model call, so the headroom must
      // outlast the longest single call (field-observed: 137s web-search turn)
      deadline: Date.now() + (Number(process.env.ENGINE_CHUNK_MS) || SLICE_BUDGET_MS),
      polledRounds, votedRounds,
      subAsks, pollPlan, coverage, trackedRounds,
      emit, logCall,
      // client disconnects NEVER cancel a run (3c); stop is graceful, below.
      // The ONE cancellation is usurpation: another chain CAS-claimed the run,
      // so this one must stop cold at the next safe boundary
      isCancelled: () => usurped,
    };

    // ---- the truth loop: every 12s, confirm ownership, beat the heartbeat,
    // and pick up a STOP. The beat is a fenced CAS (expected = our own nonce)
    // with MERGE semantics — {worker, heartbeat_at} only, so it can never
    // clobber a concurrent stop_requested. A missed CAS means a reclaim or
    // the reaper took the run while we were frozen: STAND DOWN, don't
    // double-drive. A stop zeroes the deadline so the engine suspends at its
    // next safe boundary — the same proven path the serverless window uses. ----
    const standDown = () => {
      usurped = true;
      ctx.deadline = 0; // the engine exits at its next safe boundary; emit is already gated
      if (beat) { clearInterval(beat); beat = null; }
    };
    beat = setInterval(() => {
      void (async () => {
        try {
          const { data: fresh, error: readErr } = await db.from("simulations").select("config").eq("id", simId).maybeSingle();
          if (readErr || !fresh) return; // a transient READ failure is a missed beat, never a lost race
          const rs = ((fresh.config as Record<string, unknown>)?.run_state as RunState | undefined) ?? {};
          if (rs.worker !== workerNonce) { standDown(); return; } // reclaimed or finalized — the run is no longer ours
          if (rs.stop_requested && !stopRequested) {
            stopRequested = true;
            ctx.deadline = 0; // suspend at the next safe boundary
            send({ type: "stage", value: "running", detail: "STOP REQUESTED — FINISHING THE CURRENT TURN, THEN CLOSING THE RUN" });
          }
          const claim = await fenced({ heartbeat_at: new Date().toISOString(), worker: workerNonce });
          if (claim === "lost") standDown();
          // "error" is a missed beat (transient), NOT a lost race — the next one lands
        } catch { /* a missed beat is fine — the next one lands */ }
      })();
    }, 12_000);

    const result = await runMode(ctx, resume);
    if (beat) { clearInterval(beat); beat = null; }
    if (usurped) return; // another chain owns the run — no handoff, no finalize, no announcements

    if (result.suspendedAtRound && !stopRequested) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      let chained = false;
      if (canChain && serviceKey) {
        // chained handoff: PRE-CLAIM for the child (fresh heartbeat + the
        // CHAIN_PENDING worker id) so a racing client resume sees "being
        // driven" and observes instead of starting a second driver; the child
        // CAS-claims CHAIN_PENDING and takes over. A missed CAS here means we
        // were usurped at the boundary — the other chain drives, we go quiet.
        // If the chain fetch never lands, the heartbeat goes stale and RESUME
        // reopens honestly.
        if (await fenced({ round: result.suspendedAtRound, heartbeat_at: new Date().toISOString(), worker: CHAIN_PENDING }) !== "ok") return;
        try {
          const r = await fetch(`${origin}/api/simulations/${simId}/run/continue`, {
            method: "POST",
            headers: { "x-engine-key": chainSecret(serviceKey, simId) },
          });
          chained = r.ok;
        } catch { chained = false; }
        if (!chained) {
          // the chain didn't take — reopen the handoff for a client resume.
          // Expected is CHAIN_PENDING (we just set it); if a racing continue
          // already claimed it, IT drives and this write correctly no-ops.
          await fenced({ round: result.suspendedAtRound, heartbeat_at: null, worker: null }, "running", {}, CHAIN_PENDING);
        }
      } else {
        // legacy handoff (no service key): null heartbeat so the client's
        // immediate reconnect can claim without waiting out staleness
        if (await fenced({ round: result.suspendedAtRound, heartbeat_at: null, worker: null }) !== "ok") return;
      }
      send({ type: "continue", round: result.suspendedAtRound, posts: result.posts, chained });
    } else if (stopRequested) {
      // a user stop is a COMPLETE run with an honest reason — the transcript
      // is preserved and the report synthesizes whatever the panel produced.
      // Finalize is the fenced CAS FIRST: a miss means another chain owns the
      // run and no terminal artifacts may land from this one; an "error"
      // leaves the run running with a stale heartbeat — the reaper re-fires
      // the chain and the resumed slice finalizes (self-healing, never clobber).
      if (await fenced(null, "complete", { run_result: { posts: result.posts, converged: false, stop: "stopped", mode, at: new Date().toISOString() } }) !== "ok") return;
      await emit({ type: "stage", value: "done", detail: "stopped" });
      send({ type: "finished", posts: result.posts });
    } else {
      // "converged" is reserved for the stability rule actually firing —
      // fixed choreographies and exhausted rounds report themselves honestly
      if (await fenced(null, "complete", { run_result: { posts: result.posts, converged: result.converged, stop: result.stopReason, mode, at: new Date().toISOString() } }) !== "ok") return;
      await emit({ type: "stage", value: result.stopReason === "stability" ? "converged" : "done", detail: result.stopReason });
      send({ type: "finished", posts: result.posts });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Run failed";
    if (!usurped) {
      try {
        await db.from("events").insert({ sim_id: simId, seq: 999_999, type: "stage", payload: { type: "stage", value: "error", detail: msg } });
        // fenced: a usurped straggler's crash must not clobber the live chain's
        // status. If the RPC itself is unavailable, fall back to the legacy
        // write — better a plain draft than a run stranded at "running".
        const drafted = await fenced(null, "draft");
        if (drafted === "error") await db.from("simulations").update({ status: "draft" }).eq("id", simId);
      } catch { /* the error event is best-effort */ }
      send({ type: "error", error: msg });
    }
  } finally {
    if (beat) clearInterval(beat);
    try { bus?.end(); } catch { /* window already closed */ }
  }
}
