/**
 * 3c — runs you can walk away from (docs/next-level-plan.md §3c).
 * Pure helpers for the server-side slice chain: the internal-route secret
 * and the heartbeat freshness rule. Exported pure for the offline tests.
 */

import { createHmac } from "node:crypto";

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
 *  650s leaves 150s of kill headroom. Env-overridable for dev tests. */
export const SLICE_BUDGET_MS = 650_000;

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
