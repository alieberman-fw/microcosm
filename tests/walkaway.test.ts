/**
 * 3c — walk-away runs: the slice chain's trust primitives. The secret gates
 * the internal continue route; the heartbeat rule decides who may drive a
 * run (fresh = someone is; stale = orphaned, a RESUME may claim it; null =
 * between-slice handoff, the chain child claims immediately).
 */

import { describe, expect, it } from "vitest";
import { chainSecret, heartbeatFresh } from "@/lib/walkaway";

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
