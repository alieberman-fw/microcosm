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

describe("castingPlanSystem (Wave 2a) — an explicit mode is a design constraint", () => {
  it("forced mode overrides the mode guide and reaches the prompt", async () => {
    const { castingPlanSystem } = await import("@/lib/casting");
    const sys = castingPlanSystem(undefined, undefined, "Tribunal");
    expect(sys).toContain('THE USER REQUIRES interaction mode "Tribunal"');
    expect(sys).toContain("design the seats FOR this choreography");
    expect(sys).toContain("your recommendation OR the user requirement");
  });
  it("AUTO (no mode) keeps the prompt unconstrained", async () => {
    const { castingPlanSystem } = await import("@/lib/casting");
    expect(castingPlanSystem()).not.toContain("THE USER REQUIRES interaction mode");
  });
  it("generation prompt teaches genuine bench convictions", async () => {
    const { castingGenerateSystem } = await import("@/lib/casting");
    expect(castingGenerateSystem()).toContain('tribunal bench: CON');
    expect(castingGenerateSystem()).toContain("GENUINELY oppose the thesis");
  });
});

describe("compilePersonaPrompt (Wave 2b) — personas know their world", () => {
  it("roster, criteria, constraints, and the Tribunal bench mandate all land", async () => {
    const { compilePersonaPrompt } = await import("@/lib/engine");
    const spec = {
      name: "Ana Ruiz", initials: "AR", role: "Zoning attorney", kind: "expert",
      tagline: "", backstory: "", stances: [], skills: [], traits: {},
      seat: { role: "Zoning", why: "owns entitlement", discipline: "ZONING", adversarial: false, provenance: "generated", side: "con" },
    } as never;
    const sys = compilePersonaPrompt(spec, {
      mode: "Tribunal", problem: "Approve the rezoning?", temperature: "balanced",
      criteria: ["approval odds with a whip count"], constraints: ["council votes in 60 days"],
      roster: ["Ana Ruiz (Zoning)", "Bo Lee (Planner)"],
    });
    expect(sys).toContain("The panel: Ana Ruiz (Zoning) · Bo Lee (Planner).");
    expect(sys).toContain("CON bench");
    expect(sys).toContain("genuinely OPPOSES the thesis");
    expect(sys).toContain("approval odds with a whip count");
    expect(sys).toContain("Constraints in play: council votes in 60 days.");
  });
  it("omits every block when the context is absent (legacy prompts unchanged)", async () => {
    const { compilePersonaPrompt } = await import("@/lib/engine");
    const spec = { name: "Bo Lee", initials: "BL", role: "Planner", kind: "expert", tagline: "", backstory: "", stances: [], skills: [], traits: {}, seat: { role: "Planner", why: "", discipline: "PANEL", adversarial: false, provenance: "generated" } } as never;
    const sys = compilePersonaPrompt(spec, { mode: "Agora", problem: "q", temperature: "balanced" });
    expect(sys).not.toContain("The panel:");
    expect(sys).not.toContain("bench");
    expect(sys).not.toContain("Constraints in play");
  });
});

describe("Wave 3 — feedback loops", () => {
  it("windowOf overlays net votes on transcript lines", async () => {
    const { windowOf } = await import("@/lib/engine");
    const posts = [
      { name: "Ana R.", role: "Zoning", content: "The variance holds.", tag: "POST", seq: 1 },
      { name: "Bo L.", role: "Planner", content: "It does not.", tag: "REPLY", seq: 2 },
    ];
    const w = windowOf(posts, 16, new Map([[1, 3], [2, -1]]));
    expect(w).toContain("[▲3]");
    expect(w).toContain("[▼1]");
    expect(windowOf(posts)).not.toContain("▲"); // no votes → unchanged
  });
  it("pickReplyTarget weights endorsed posts up", async () => {
    const { pickReplyTarget } = await import("@/lib/engine");
    const posts = [
      { seq: 1, round: 1, tag: "POST", agentKey: "a", name: "A", content: "Argument one, quiet.", replyTo: null },
      { seq: 2, round: 1, tag: "POST", agentKey: "b", name: "B", content: "Argument two, heavily endorsed.", replyTo: null },
    ];
    // recency favors seq 2 already; flip it: votes on seq 1 must overcome
    const votes = new Map([[1, 3]]);
    const withVotes = pickReplyTarget(posts, 1, 0, undefined, "focused", votes);
    expect(withVotes?.seq).toBe(1);
  });
});
