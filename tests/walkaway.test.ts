/**
 * 3c — walk-away runs: the slice chain's trust primitives. The secret gates
 * the internal continue route; the heartbeat rule decides who may drive a
 * run (fresh = someone is; stale = orphaned, a RESUME may claim it; null =
 * between-slice handoff, the chain child claims immediately).
 */

import { describe, expect, it } from "vitest";
import { SLICE_BUDGET_MS, chainSecret, heartbeatFresh, reaperAction } from "@/lib/walkaway";

describe("chainSecret", () => {
  it("is deterministic for the same key + sim", () => {
    expect(chainSecret("service-key", "sim-a")).toBe(chainSecret("service-key", "sim-a"));
  });

  it("differs per sim and per key — a leaked secret opens exactly one run", () => {
    expect(chainSecret("service-key", "sim-a")).not.toBe(chainSecret("service-key", "sim-b"));
    expect(chainSecret("service-key", "sim-a")).not.toBe(chainSecret("other-key", "sim-a"));
  });

  it("is hex and never echoes the key", () => {
    const s = chainSecret("super-secret-service-key", "sim-a");
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).not.toContain("super-secret");
  });
});

describe("heartbeatFresh", () => {
  const now = Date.parse("2026-08-01T12:00:00Z");

  it("fresh within the window — a live worker is driving, never double-drive", () => {
    expect(heartbeatFresh({ heartbeat_at: new Date(now - 30_000).toISOString() }, now)).toBe(true);
  });

  it("stale beyond the window — the run is orphaned and may be claimed", () => {
    expect(heartbeatFresh({ heartbeat_at: new Date(now - 91_000).toISOString() }, now)).toBe(false);
  });

  it("null heartbeat is a between-slice handoff — claimable immediately", () => {
    expect(heartbeatFresh({ heartbeat_at: null }, now)).toBe(false);
    expect(heartbeatFresh({}, now)).toBe(false);
    expect(heartbeatFresh(null, now)).toBe(false);
  });

  it("a FUTURE heartbeat (clock skew, corrupt state) never counts as fresh", () => {
    expect(heartbeatFresh({ heartbeat_at: new Date(now + 60_000).toISOString() }, now)).toBe(false);
  });

  it("garbage timestamps are stale, not crashes", () => {
    expect(heartbeatFresh({ heartbeat_at: "not-a-date" }, now)).toBe(false);
  });

  it("the continue route's tighter window (45s) rejects a mid-slice beat", () => {
    expect(heartbeatFresh({ heartbeat_at: new Date(now - 50_000).toISOString() }, now, 45_000)).toBe(false);
    expect(heartbeatFresh({ heartbeat_at: new Date(now - 10_000).toISOString() }, now, 45_000)).toBe(true);
  });
});

describe("slice budget — kill headroom inside the 800s serverless window", () => {
  it("leaves at least 120s: the deadline gates the START of a model call, so the headroom must outlast the longest single call (field-observed 137s web-search turn)", () => {
    expect(800_000 - SLICE_BUDGET_MS).toBeGreaterThanOrEqual(120_000);
    expect(SLICE_BUDGET_MS).toBeGreaterThanOrEqual(600_000); // still real slices, not thrash
  });
});

describe("reaperAction — the cron sweep's per-sim decision", () => {
  const now = Date.parse("2026-08-01T12:00:00Z");
  const fresh = { heartbeat_at: new Date(now - 30_000).toISOString() };
  const stale = { heartbeat_at: new Date(now - 6 * 60_000).toISOString() };

  it("never touches a non-running sim", () => {
    expect(reaperAction("complete", stale, now)).toBe("skip");
    expect(reaperAction("draft", null, now)).toBe("skip");
  });

  it("never touches a live worker — fresh heartbeat means someone is driving", () => {
    expect(reaperAction("running", fresh, now)).toBe("skip");
    expect(reaperAction("running", { ...fresh, stop_requested: true }, now)).toBe("skip"); // the worker's own truth loop handles it
  });

  it("a zombie with a pending stop finalizes — no worker exists to run a farewell slice", () => {
    expect(reaperAction("running", { ...stale, stop_requested: true }, now)).toBe("finalize-stopped");
  });

  it("a zombie without a stop gets its chain re-fired", () => {
    expect(reaperAction("running", stale, now)).toBe("continue");
    expect(reaperAction("running", null, now)).toBe("continue");      // no state at all = orphaned
    expect(reaperAction("running", { heartbeat_at: null }, now)).toBe("continue"); // a handoff the child never claimed
  });
});
