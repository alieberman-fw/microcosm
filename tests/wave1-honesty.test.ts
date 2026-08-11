import { describe, expect, it } from "vitest";
import { neutralJudgeSpec, parseStabilityVerdict } from "@/lib/engine";
import { filterCites } from "@/lib/report";
import { modeFitFlags } from "@/lib/run";
import { FrozenSpec } from "@/lib/casting";

/** Audit Wave 1 — the honesty instruments. */

describe("parseStabilityVerdict (E-B1) — 'unstable' can never read as stable", () => {
  it("accepts only a verdict that IS the word", () => {
    expect(parseStabilityVerdict("stable")).toBe(true);
    expect(parseStabilityVerdict("Stable.")).toBe(true);
    expect(parseStabilityVerdict("  STABLE  ")).toBe(true);
  });
  it("rejects the failure cases the substring match let through", () => {
    expect(parseStabilityVerdict("unstable")).toBe(false);
    expect(parseStabilityVerdict("not yet stable")).toBe(false);
    expect(parseStabilityVerdict("the panel is stable in tone but moving on substance — moving")).toBe(false);
  });
  it("uses the LAST line (thinking preambles stripped)", () => {
    expect(parseStabilityVerdict("<thinking>positions repeat verbatim</thinking>\nstable")).toBe(true);
    expect(parseStabilityVerdict("Considering whether things are stable...\nmoving")).toBe(false);
  });
});

describe("neutralJudgeSpec (E-F7) — the judge inherits nothing from the pro bench", () => {
  const proLead: FrozenSpec = {
    name: "Charlotte Reinholt", initials: "CR", role: "Capital markets advisor",
    tagline: "Convert now — the market setup isolates your risk",
    backstory: "Twenty years arguing that conversions beat holds.",
    stances: ["Convert now", "Distrusts wait-and-see strategies"],
    skills: ["underwriting"], traits: { risk_tolerance: 0.8, agreeableness: 0.2, verbosity: 0.7 },
    kind: "expert",
    seat: { role: "Capital", why: "owns the capital question", discipline: "CAPITAL", adversarial: false, provenance: "library", side: "pro" },
  } as FrozenSpec;

  it("strips backstory, stances, tagline, and side; installs the judicial mandate", () => {
    const judge = neutralJudgeSpec(proLead);
    expect(judge.name).toBe("The Judge");
    expect(judge.backstory).not.toContain("conversions beat holds");
    expect(judge.stances.join(" ")).not.toContain("Convert now");
    expect(judge.stances.join(" ")).toContain("JUDICIAL MANDATE");
    expect(judge.tagline).not.toContain("Convert now");
    expect(judge.seat.side).toBeUndefined();
    expect(judge.seat.adversarial).toBe(false);
  });
});

describe("filterCites (R-H2) — citations must point at real posts", () => {
  const valid = new Set([1, 2, 3, 14]);
  it("drops hallucinated and junk seqs, keeps real ones, caps at 8", () => {
    expect(filterCites([1, 47, 2, 0, -3, "14", "nope"], valid)).toEqual([1, 2, 14]);
    expect(filterCites(undefined, valid)).toEqual([]);
    expect(filterCites([1, 1, 2, 3, 14, 1, 2, 3, 14, 1], valid)).toHaveLength(8);
  });
});

describe("modeFitFlags (E-B4) — Tribunal states its stop-rule honestly", () => {
  const base = { mode: "Tribunal", leads: 6, expertSide: 3, residentSide: 3, crowd: 40, benchPro: 3, benchCon: 3 };
  it("stability selection surfaces the never-stops-on-stability note", () => {
    const flags = modeFitFlags({ ...base, convergence: "stability" as const });
    expect(flags.some((f) => f.level === "info" && f.text.includes("NEVER STOPS ON STABILITY"))).toBe(true);
  });
  it("fixed/budget selections stay quiet", () => {
    expect(modeFitFlags({ ...base, convergence: "fixed" as const })).toEqual([]);
  });
});
