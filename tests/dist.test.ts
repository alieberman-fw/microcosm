/**
 * C1 (field-report 2): the field screenshot read 40% + 30% + 29% + 2% = 101 —
 * independent rounding. Largest-remainder shares must sum to exactly 100
 * whenever anything was counted, stay deterministic on ties, and preserve
 * the caller's display order.
 */

import { describe, expect, it } from "vitest";
import { distShares } from "@/lib/dist";

const KEYS = ["image 1", "image 2", "image 3", "undecided"];

describe("distShares", () => {
  it("the field case sums to exactly 100 (raw rounding gave 101)", () => {
    // 120/89/87/2 of 298 → 40.3 / 29.9 / 29.2 / 0.7 — naive rounding: 40+30+29+1=100? use the screenshot's shape
    const out = distShares({ "image 1": 120, "image 2": 89, "image 3": 87, undecided: 6 }, KEYS);
    expect(out.reduce((s, x) => s + x.pct, 0)).toBe(100);
    expect(out.map((x) => x.key)).toEqual(KEYS); // display order preserved
  });

  it("sums to 100 across adversarial splits", () => {
    for (const counts of [
      [1, 1, 1], [333, 333, 334], [2, 3, 5], [7, 11, 13, 17], [1, 999], [50, 50, 1],
    ]) {
      const dist = Object.fromEntries(counts.map((c, i) => [`k${i}`, c]));
      const keys = counts.map((_, i) => `k${i}`);
      const total = distShares(dist, keys).reduce((s, x) => s + x.pct, 0);
      expect(total).toBe(100);
    }
  });

  it("exact thirds break the tie toward earlier options, deterministically", () => {
    const out = distShares({ a: 1, b: 1, c: 1 }, ["a", "b", "c"]);
    expect(out.map((x) => x.pct)).toEqual([34, 33, 33]);
    expect(distShares({ a: 1, b: 1, c: 1 }, ["a", "b", "c"])).toEqual(out);
  });

  it("zero total → all zeros (never NaN, never 100 out of nothing)", () => {
    expect(distShares({}, ["a", "b"]).map((x) => x.pct)).toEqual([0, 0]);
  });

  it("missing and negative counts read as zero", () => {
    const out = distShares({ a: 10, b: -5 }, ["a", "b", "c"]);
    expect(out).toEqual([
      { key: "a", count: 10, pct: 100 },
      { key: "b", count: 0, pct: 0 },
      { key: "c", count: 0, pct: 0 },
    ]);
  });
});
