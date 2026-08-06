/**
 * Report-synthesis state (PR D) — the ONE shared shape + freshness rule for
 * "is a synthesis running right now?". `config.report_state` is the truth
 * (3c's heartbeat pattern); the run screen, the workspace, Home, and the
 * report route's attach check must all agree on what "running" means, so the
 * rule lives here and is pinned by the offline matrix. The field incident:
 * three surfaces each hand-rolled the check, one raced the QUEUED write, and
 * the user saw "generate a report" over a synthesis already in flight.
 */

export interface ReportState {
  stage: string;                 // compile | verify | … | done | error
  note?: string;
  heartbeat_at?: string;
  report_id?: string;
  version?: number;
  error?: string;
  started_at?: string;
}

/** the synthesis worker beats on every state write (throttled ~1.2s, pulsed
 *  every ≤15s while the model thinks); silence past this is a crashed worker
 *  and the SYNTHESIZE button becomes the retry */
export const REPORT_HEARTBEAT_STALE_MS = 90_000;

/** is a synthesis LIVE right now? done/error are terminal states, a missing
 *  or unparsable heartbeat is stale, and a stale heartbeat is a crash. */
export function reportSynthFresh(st: ReportState | null | undefined, nowMs: number): boolean {
  if (!st || st.stage === "done" || st.stage === "error") return false;
  const at = st.heartbeat_at ? Date.parse(st.heartbeat_at) : NaN;
  return Number.isFinite(at) && nowMs - at < REPORT_HEARTBEAT_STALE_MS;
}

/** the in-tab signal that the unread-reports badge should refetch NOW —
 *  dispatched when a surface observes a synthesis finishing */
export const REPORTS_REFRESH_EVENT = "mc-reports-refresh";
