/**
 * 3c — runs you can walk away from (docs/next-level-plan.md §3c).
 * Helpers for the server-side slice chain: the internal-route secret, the
 * heartbeat freshness rule, the round-close dedupe keys, and the atomic
 * worker claim. The decision rules are pure for the offline tests; claimRun
 * is the one thin DB call every run_state write goes through.
 */

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** the truth about a live run, kept in simulations.config.run_state */
export interface RunState {
  round?: number | null;        // last suspended round (resume marker)
  heartbeat_at?: string | null; // ISO — a live worker beats every ~12s; null between slices (handoff)
  worker?: string | null;       // nonce of the worker currently driving
  stop_requested?: boolean;     // set by /run/stop; the worker suspends at the next safe boundary
  started_at?: string;
}

/** a suspending slice that has FIRED the chain marks the handoff with this
 *  worker id and a FRESH heartbeat: resumes/launches see "being driven" (409 →
 *  observe), while the chain child recognizes its own handoff and claims it.
 *  If the child never arrives, the heartbeat goes stale and RESUME reopens. */
export const CHAIN_PENDING = "chain-pending";

/** engine slice budget inside the 800s serverless window. The headroom must
 *  cover the LONGEST single operation the engine can be inside when the
 *  deadline passes — a Sonnet turn with two web searches has been observed at
 *  137s in the field, and 770s left only 30s: the function was hard-killed
 *  mid-call, no suspend fired, and the run zombied at a frozen heartbeat.
 *  620s leaves 180s of kill headroom. Env-overridable for dev tests. */
export const SLICE_BUDGET_MS = 620_000;

/** hard per-request cap on every engine model call (the run-worker's client).
 *  The deadline gates the START of a call, so the wall-clock invariant is
 *  SLICE_BUDGET_MS + ENGINE_CALL_TIMEOUT_MS + margin ≤ 800s — no single turn,
 *  search, or poll can ride past the serverless kill line, no matter how many
 *  web searches it strings together. The engine client runs maxRetries 0:
 *  SDK-level retries of a timed-out call would double the in-flight time and
 *  bust the invariant; the ENGINE's own failure ladder retries at safe
 *  boundaries where the deadline is re-checked. Longest field-observed call:
 *  137s — 170s allows it with margin while still fencing runaways. */
export const ENGINE_CALL_TIMEOUT_MS = 170_000;

/** what the reaper (cron sweep) should do with a running sim — pure so the
 *  offline matrix pins it. A fresh heartbeat is a live worker: never touch.
 *  A stale one is a zombie: honor a pending stop by finalizing (no worker
 *  exists to run a farewell slice), otherwise re-fire the chain. */
export function reaperAction(
  status: string,
  runState: RunState | null | undefined,
  nowMs: number,
): "skip" | "finalize-stopped" | "continue" {
  if (status !== "running") return "skip";
  if (heartbeatFresh(runState, nowMs)) return "skip";
  return runState?.stop_requested ? "finalize-stopped" : "continue";
}

/** auth for the internal continue route — derived from the service key, so
 *  no new secret to provision; only the server can mint it */
export function chainSecret(serviceKey: string, simId: string): string {
  return createHmac("sha256", serviceKey).update(`microcosm-run-chain:${simId}`).digest("hex");
}

/** is a worker actively driving this run right now? Fresh heartbeat = yes —
 *  launch/continue must NOT double-drive; stale = the run is orphaned (deploy,
 *  crash) and a RESUME may claim it. */
export function heartbeatFresh(runState: RunState | null | undefined, nowMs: number, staleMs = 90_000): boolean {
  const at = runState?.heartbeat_at ? Date.parse(runState.heartbeat_at) : NaN;
  return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at < staleMs;
}

/** round-close artifacts are singletons per (sim, round[, angle]) — the key
 *  lands in events.dedupe_key under a UNIQUE index (migration 0018), so a
 *  second engine chain re-emitting the same round's artifact is dropped by
 *  the DATABASE, not by per-chain memory (polledRounds is per-process; the
 *  field incident was two chains each trusting their own set). Votes events
 *  stay unkeyed on purpose: micro-passes legitimately repeat within a round
 *  and the vote data itself dedupes in post_votes (sim, seq, voter). */
export function eventDedupeKey(e: { type: string; round?: unknown; angle?: unknown }): string | null {
  const round = typeof e.round === "number" && Number.isFinite(e.round) ? e.round : null;
  if (round === null) return null;
  if (e.type === "sentiment") return `sentiment:${round}:${typeof e.angle === "string" ? e.angle : ""}`;
  if (e.type === "coverage") return `coverage:${round}`;
  if (e.type === "agenda") return `agenda:${round}`;
  return null;
}

/** result of an atomic claim: "lost" means another entrance holds the run
 *  (stand down / observe); "error" means the write itself failed (transient
 *  DB error or migration 0018 not applied) — callers must NOT treat an error
 *  as a lost race: a beating worker rides out an error, an entrance surfaces it. */
export type ClaimResult = "ok" | "lost" | "error";

/** the ONE way run_state/status is written — an atomic compare-and-swap on
 *  run_state.worker (claim_run RPC, migration 0018). Merge semantics: pass
 *  exactly the run_state keys you own (a heartbeat passes {worker,
 *  heartbeat_at} and can never clobber a concurrent stop_requested); pass
 *  runState null to clear it (finalize). */
export async function claimRun(
  db: SupabaseClient,
  args: {
    simId: string;
    expectedWorker: string | null;                 // exact current worker (null = unclaimed)
    runState: Partial<RunState> | null;            // keys to merge, or null to clear
    status?: string;                               // default "running"
    configPatch?: Record<string, unknown>;         // extra top-level config keys (poll instrument, run_result)
  },
): Promise<ClaimResult> {
  const { data, error } = await db.rpc("claim_run", {
    p_sim_id: args.simId,
    p_expected_worker: args.expectedWorker,
    p_run_state: args.runState,
    p_status: args.status ?? "running",
    p_config_patch: args.configPatch ?? {},
  });
  if (error) return "error";
  return data === true ? "ok" : "lost";
}
