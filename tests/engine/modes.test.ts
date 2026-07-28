/**
 * The Phase-1 mode matrix: every choreography × every stop condition, with
 * exact post counts, exact stop reasons, and poll placement — offline.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { runMode } from "@/lib/engine";
import { makeHarness, makeLeads, makeCrowd } from "../helpers/fake-anthropic";

afterEach(() => vi.restoreAllMocks());

describe("Roundtable", () => {
  it("fixed: every lead speaks each round, stops at the rounds cap, polls every round", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(4), crowd: makeCrowd(30), cfg: { rounds: 3, convergence: "fixed" } });
    const r = await runMode(h.ctx);
    expect(r).toMatchObject({ posts: 12, converged: false, stopReason: "rounds" });
    expect(h.postRecs().filter((p) => p.round === 2)).toHaveLength(4);
    expect(h.sentimentRounds()).toEqual([1, 2, 3]);
  });

  it("stability: needs round ≥ 3 AND two consecutive stable verdicts", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(3), cfg: { rounds: 10, convergence: "stability" },
      fake: { judgeScript: () => "stable" }, // stable from the very first check
    });
    const r = await runMode(h.ctx);
    // checks start at round 3; two consecutive stables → stops after round 4
    expect(r).toMatchObject({ converged: true, stopReason: "stability" });
    expect(Math.max(...h.postRecs().map((p) => p.round))).toBe(4);
  });

  it("stability never fires when the judge keeps saying moving", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(3), cfg: { rounds: 4, convergence: "stability" },
      fake: { judgeScript: () => "moving" },
    });
    const r = await runMode(h.ctx);
    expect(r).toMatchObject({ converged: false, stopReason: "rounds", posts: 12 });
  });

  it("budget: the max-posts cap stops the run and is reported honestly", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(4), cfg: { rounds: 5, max_posts: 6, convergence: "fixed" } });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(6);
    expect(r.stopReason).toBe("budget");
  });
});

describe("Agora", () => {
  it("opener + routed replies per round; round-robin speaker needs no router calls", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(4), cfg: { rounds: 2, convergence: "fixed", speaker: "round-robin" } });
    const r = await runMode(h.ctx);
    // per round: 1 opener + min(max(4-1,2),6)=3 replies
    expect(r).toMatchObject({ posts: 8, stopReason: "rounds" });
    expect(h.calls.filter((c) => c.kind === "router")).toHaveLength(0);
    expect(h.postRecs().filter((p) => p.tag === "REPLY")).toHaveLength(6);
  });

  it("priority speaker consults the router", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), cfg: { rounds: 1, convergence: "fixed", speaker: "priority" } });
    await runMode(h.ctx);
    expect(h.calls.filter((c) => c.kind === "router").length).toBeGreaterThan(0);
  });
});

describe("Tribunal", () => {
  it("auto-balances an all-expert cast into two benches; args → rebuttals → judge; never claims convergence", async () => {
    const h = makeHarness({ mode: "Tribunal", leads: makeLeads(4), crowd: makeCrowd(20), cfg: { rounds: 2, convergence: "stability" } });
    const r = await runMode(h.ctx);
    const recs = h.postRecs();
    // 2v2 benches: 2 ARG + 2 REBUTTAL + 1 judge per round
    expect(recs.filter((p) => p.tag === "ARGUMENT" && p.round === 1)).toHaveLength(2);
    expect(recs.filter((p) => p.tag === "REBUTTAL" && p.round === 1)).toHaveLength(2);
    expect(recs.filter((p) => p.tag === "JUDGE'S NOTE")).toHaveLength(2);
    expect(r).toMatchObject({ converged: false, stopReason: "rounds" });
    expect(h.sentimentRounds()).toEqual([1, 2]);
  });
});

describe("Jury", () => {
  it("round 1 blind, tally posts each round, scores-stopped-moving convergence", async () => {
    const scores: Record<string, number[]> = {
      // round:      1  2  3
      "Al B.":      [3, 4, 4],
      "Bea C.":     [7, 7, 7],
      "Cy D.":      [5, 6, 6],
    };
    const h = makeHarness({
      mode: "Jury", leads: makeLeads(3), crowd: makeCrowd(20), cfg: { rounds: 6, convergence: "stability" },
      fake: { juryScore: (name, round) => scores[name]?.[round - 1] ?? 5 },
    });
    const r = await runMode(h.ctx);
    // rounds 1→2 moved (Al +1, Cy +1); round 3 identical → stability at round 3
    expect(r).toMatchObject({ converged: true, stopReason: "stability" });
    const recs = h.postRecs();
    expect(recs.filter((p) => p.tag === "TALLY")).toHaveLength(3);
    expect(recs.filter((p) => p.tag === "VERDICT")).toHaveLength(9);
    // round-1 verdicts are BLIND: the turn call carries no transcript
    const firstVerdictCall = h.calls.find((c) => c.user.includes('Start EXACTLY with "SCORE:'));
    expect(firstVerdictCall!.user).not.toContain("TRANSCRIPT SO FAR");
    expect(h.sentimentRounds()).toEqual([1, 2, 3]);
  });

  it("fixed: runs every layer even when scores never move", async () => {
    const h = makeHarness({
      mode: "Jury", leads: makeLeads(3), cfg: { rounds: 3, convergence: "fixed" },
      fake: { juryScore: () => 5 },
    });
    const r = await runMode(h.ctx);
    expect(r).toMatchObject({ converged: false, stopReason: "rounds" });
    expect(h.postRecs().filter((p) => p.tag === "VERDICT")).toHaveLength(9);
  });
});

describe("fixed choreographies report themselves honestly", () => {
  it("Chamber: takes → blind reviews → synthesis; polls after takes and synthesis; stop = choreography", async () => {
    const h = makeHarness({ mode: "Chamber", leads: makeLeads(4), crowd: makeCrowd(20), cfg: { rounds: 9, convergence: "stability" } });
    const r = await runMode(h.ctx);
    const recs = h.postRecs();
    expect(recs.filter((p) => p.tag === "INDEPENDENT TAKE")).toHaveLength(4);
    expect(recs.filter((p) => p.tag === "BLIND REVIEW")).toHaveLength(4);
    expect(recs.filter((p) => p.tag === "CHAIR SYNTHESIS")).toHaveLength(1);
    expect(r).toMatchObject({ posts: 9, converged: false, stopReason: "choreography" });
    expect(h.sentimentRounds()).toEqual([1, 3]);
  });

  it("Desk: assignment → drafts → memo; research mode never polls", async () => {
    const h = makeHarness({ mode: "Desk", leads: makeLeads(4), crowd: makeCrowd(20), cfg: { rounds: 9 } });
    const r = await runMode(h.ctx);
    expect(r).toMatchObject({ posts: 5, converged: false, stopReason: "choreography" });
    expect(h.sentimentRounds()).toEqual([]);
  });

  it("Expedition: five phases, three scouts each, no polls", async () => {
    const h = makeHarness({ mode: "Expedition", leads: makeLeads(5), crowd: makeCrowd(20), cfg: { rounds: 9 } });
    const r = await runMode(h.ctx);
    expect(r).toMatchObject({ posts: 15, converged: false, stopReason: "choreography" });
    expect(h.sentimentRounds()).toEqual([]);
    const phases = new Set(h.postRecs().map((p) => p.tag));
    expect(phases).toEqual(new Set(["QUESTIONS", "RESEARCH", "ANALYSIS", "ALTERNATIVES", "VERIFY & SYNTHESIZE"]));
  });
});
