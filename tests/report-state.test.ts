/**
 * PR D / field fix (2026-08-06): "is a report synthesis running right now?"
 * is answered by ONE rule (lib/report-state) shared by the run screen, the
 * workspace, Home, and the report route's attach check. Three hand-rolled
 * copies once disagreed with each other and with the QUEUED-write timing —
 * the user saw "generate a report" over a synthesis already in flight.
 */

import { describe, expect, it } from "vitest";
import { REPORT_HEARTBEAT_STALE_MS, reportSynthFresh } from "@/lib/report-state";

describe("reportSynthFresh — the one shared 'synthesis is live' rule", () => {
  const now = Date.parse("2026-08-06T12:00:00Z");
  const beat = (agoMs: number) => new Date(now - agoMs).toISOString();

  it("a compiling state with a fresh heartbeat is LIVE — every surface shows the ticker", () => {
    expect(reportSynthFresh({ stage: "compile", heartbeat_at: beat(3_000) }, now)).toBe(true);
    expect(reportSynthFresh({ stage: "verify", heartbeat_at: beat(60_000) }, now)).toBe(true);
  });

  it("done and error are TERMINAL regardless of heartbeat — the button, not the ticker", () => {
    expect(reportSynthFresh({ stage: "done", report_id: "r1", heartbeat_at: beat(1_000) }, now)).toBe(false);
    expect(reportSynthFresh({ stage: "error", error: "boom", heartbeat_at: beat(1_000) }, now)).toBe(false);
  });

  it("a stale heartbeat is a crashed worker — SYNTHESIZE becomes the retry", () => {
    expect(reportSynthFresh({ stage: "compile", heartbeat_at: beat(REPORT_HEARTBEAT_STALE_MS + 1_000) }, now)).toBe(false);
  });

  it("missing state, missing heartbeat, and garbage timestamps read NOT running — never a crash", () => {
    expect(reportSynthFresh(null, now)).toBe(false);
    expect(reportSynthFresh(undefined, now)).toBe(false);
    expect(reportSynthFresh({ stage: "compile" }, now)).toBe(false);
    expect(reportSynthFresh({ stage: "compile", heartbeat_at: "not-a-date" }, now)).toBe(false);
  });

  it("the boundary is exactly the stale window", () => {
    expect(reportSynthFresh({ stage: "compile", heartbeat_at: beat(REPORT_HEARTBEAT_STALE_MS - 1) }, now)).toBe(true);
    expect(reportSynthFresh({ stage: "compile", heartbeat_at: beat(REPORT_HEARTBEAT_STALE_MS) }, now)).toBe(false);
  });
});
