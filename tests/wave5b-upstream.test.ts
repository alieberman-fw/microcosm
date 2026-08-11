/**
 * Wave 5b — upstream hardening (audit U-H12…U-H35 remainder): the pure rules
 * the cast route now runs its plan through, plus the sanitizers and the
 * add-mode key math.
 */

import { describe, expect, it } from "vitest";
import { CastSeat, nextKeyOffset, reconcileSeats, sanitizeKind, sanitizeTraits } from "@/lib/casting";

const seat = (role: string, kind: CastSeat["kind"], side?: "pro" | "con"): CastSeat => ({
  key: role.toLowerCase().replace(/[^a-z0-9]+/g, "-"), role, kind,
  discipline: "TEST", why: "test", query: role.toLowerCase(),
  ...(side ? { side } : {}),
});

describe("reconcileSeats (U-H16) — exactly one adversarial, enforced not prompted", () => {
  it("zero adversarial → the last seat flips (the skeptic is non-negotiable)", () => {
    const { seats } = reconcileSeats([seat("A", "expert"), seat("B", "expert"), seat("C", "expert")], "Agora", "experts");
    expect(seats.filter((s) => s.kind === "adversarial")).toHaveLength(1);
    expect(seats[2].kind).toBe("adversarial");
  });

  it("two adversarial → the second demotes to expert", () => {
    const { seats } = reconcileSeats([seat("A", "adversarial"), seat("B", "expert"), seat("C", "adversarial")], "Agora", "experts");
    expect(seats.filter((s) => s.kind === "adversarial")).toHaveLength(1);
    expect(seats[0].kind).toBe("adversarial");
    expect(seats[2].kind).toBe("expert");
  });
});

describe("reconcileSeats (U-H18) — sides belong to Tribunals only", () => {
  it("a garbled mode that fell back to Agora strips orphaned sides", () => {
    const { seats } = reconcileSeats([seat("A", "expert", "pro"), seat("B", "expert", "con"), seat("C", "adversarial", "con")], "Agora", "experts");
    expect(seats.every((s) => s.side === undefined)).toBe(true);
  });

  it("Tribunal: missing sides fill toward balance, adversarial always argues con", () => {
    const { seats } = reconcileSeats(
      [seat("A", "expert", "pro"), seat("B", "expert"), seat("C", "expert"), seat("D", "adversarial")],
      "Tribunal", "experts",
    );
    expect(seats.every((s) => s.side === "pro" || s.side === "con")).toBe(true);
    expect(seats[3].side).toBe("con");
    const pro = seats.filter((s) => s.side === "pro").length;
    const con = seats.filter((s) => s.side === "con").length;
    expect(Math.abs(pro - con)).toBeLessThanOrEqual(1);
  });

  it("Tribunal: a lopsided plan (5 pro, 1 con) rebalances so both benches contest", () => {
    const { seats } = reconcileSeats(
      [seat("A", "expert", "pro"), seat("B", "expert", "pro"), seat("C", "expert", "pro"),
       seat("D", "expert", "pro"), seat("E", "expert", "pro"), seat("F", "adversarial", "con")],
      "Tribunal", "experts",
    );
    expect(seats.filter((s) => s.side === "con").length).toBeGreaterThanOrEqual(2);
    expect(seats.filter((s) => s.side === "pro").length).toBeGreaterThanOrEqual(2);
  });
});

describe("reconcileSeats (U-H17) — the composition label describes the seats", () => {
  it("a 'mixed' label over all-expert seats derives to 'experts'", () => {
    const { composition } = reconcileSeats([seat("A", "expert"), seat("B", "expert"), seat("C", "adversarial")], "Agora", "mixed");
    expect(composition).toBe("experts");
  });

  it("an 'experts' label over resident seats derives to 'mixed'", () => {
    const { composition } = reconcileSeats([seat("A", "expert"), seat("B", "resident"), seat("C", "adversarial")], "Agora", "experts");
    expect(composition).toBe("mixed");
  });

  it("all consumer/resident seats derive to 'consumers' (adversarial and stakeholder don't count)", () => {
    const { composition } = reconcileSeats(
      [seat("A", "consumer"), seat("B", "resident"), seat("C", "stakeholder"), seat("D", "adversarial")],
      "Agora", "mixed",
    );
    expect(composition).toBe("consumers");
  });
});

describe("sanitizeKind / sanitizeTraits (U-H21)", () => {
  it("whitelists the kind, falling back to the seat's", () => {
    expect(sanitizeKind("resident", "expert")).toBe("resident");
    expect(sanitizeKind("visionary thought-leader", "expert")).toBe("expert");
    expect(sanitizeKind(undefined, "consumer")).toBe("consumer");
  });

  it("keeps only numeric traits, clamped 0-1; all-junk collapses to undefined", () => {
    expect(sanitizeTraits({ risk_tolerance: 0.4, agreeableness: 1.7, verbosity: -2, mood: "high" }))
      .toEqual({ risk_tolerance: 0.4, agreeableness: 1, verbosity: 0 });
    expect(sanitizeTraits({ mood: "high", vibe: "curious" })).toBeUndefined();
    expect(sanitizeTraits("not an object")).toBeUndefined();
    expect(sanitizeTraits(["a"])).toBeUndefined();
  });
});

describe("nextKeyOffset (U-H35) — keys never collide after a deletion", () => {
  it("offsets from the MAX suffix, not the row count", () => {
    // three seats existed, seat-2 was deleted — count says 2, max says 3
    expect(nextKeyOffset(["grid-planner-1", "water-engineer-3"])).toBe(3);
  });

  it("crowd keys inflate the offset harmlessly (uniqueness is all that matters)", () => {
    expect(nextKeyOffset(["grid-planner-1", "crowd-e-14"])).toBe(14);
  });

  it("no numeric suffixes → the row count; empty → 0", () => {
    expect(nextKeyOffset(["alpha", "beta"])).toBe(2);
    expect(nextKeyOffset([])).toBe(0);
  });
});

describe("report schema grammar budget (smoke-caught 400)", () => {
  it("the lead keeps the fact-gate cites but NOT walk_away_label/drivers — the bisected fit", async () => {
    const { REPORT_JSON_SCHEMA } = await import("@/lib/report");
    const lead = (REPORT_JSON_SCHEMA as { properties: { lead: { properties: Record<string, unknown> } } }).properties.lead.properties;
    // the fact gate's cites stay
    expect(lead.cites).toBeDefined();
    // the two fields cut to fit the structured-outputs grammar ceiling —
    // re-adding EITHER requires re-running the live grammar bisect first
    expect(lead.walk_away_label).toBeUndefined();
    expect(lead.drivers).toBeUndefined();
  });

  it("oddsDriversFromBasis: drivers travel ' · '-joined inside basis", async () => {
    const { oddsDriversFromBasis } = await import("@/lib/report");
    expect(oddsDriversFromBasis("council calendar · organized opposition · staff report tone"))
      .toEqual(["council calendar", "organized opposition", "staff report tone"]);
    expect(oddsDriversFromBasis("single driver")).toEqual(["single driver"]);
    expect(oddsDriversFromBasis("a · b · c · d · e")).toHaveLength(4); // capped
    expect(oddsDriversFromBasis("")).toBeUndefined();
    expect(oddsDriversFromBasis(undefined)).toBeUndefined();
  });
});
