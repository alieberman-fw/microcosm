/**
 * 6-PR3 integration matrix — rounds that walk the brief (§6c/§6d).
 * The contract's sub-asks put agendas in opener instructions and a coverage
 * event at every round close; the poll plan swaps the crowd's question per
 * round (or removes the poll entirely). Contract-less runs are byte-identical
 * to before: no agendas, no tracker, the legacy single instrument.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { runMode } from "@/lib/engine";
import { PollAngle } from "@/lib/agenda";
import { makeHarness, makeLeads, makeCrowd } from "../helpers/fake-anthropic";

afterEach(() => vi.restoreAllMocks());

const ASKS = [
  { id: "a1", ask: "Does the real estate exist to buy today?" },
  { id: "a2", ask: "Who are the players?" },
];

const PLAN: PollAngle[] = [
  { angle: "Gut read", question: "Is the thesis credible?", instrument: "proposition", phase: "early" },
  { angle: "Category pick", question: "Which category deserves pursuit?", instrument: "choice", options: ["kitchens", "charging"], phase: "late" },
];

describe("agendas ride the opener instruction", () => {
  it("Agora: round 1 opens the full brief; the final round commits; agenda events emit once per round", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), cfg: { rounds: 2, convergence: "fixed" }, subAsks: ASKS });
    await runMode(h.ctx);
    const openers = h.calls.filter((c) => c.kind === "turn" && c.user.includes("THIS ROUND'S AGENDA"));
    expect(openers.length).toBe(2);
    expect(openers[0].user).toContain("open positions across the FULL brief");
    expect(openers[0].user).toContain(ASKS[0].ask);
    expect(openers[1].user).toContain("Final round agenda — COMMIT");
    const agendaEvents = h.events.filter((e) => e.type === "agenda");
    expect(agendaEvents.map((e) => (e as { round: number }).round)).toEqual([1, 2]);
  });

  it("Roundtable: every voice in the circuit walks the agenda", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(3), cfg: { rounds: 1, convergence: "fixed" }, subAsks: ASKS });
    await runMode(h.ctx);
    const circuit = h.calls.filter((c) => c.kind === "turn" && c.user.includes("Round 1 of 1"));
    expect(circuit.length).toBe(3);
    for (const c of circuit) expect(c.user).toContain("THIS ROUND'S AGENDA");
  });

  it("no contract → no agenda text anywhere, no agenda/coverage events (back-compat)", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), cfg: { rounds: 2, convergence: "fixed" } });
    await runMode(h.ctx);
    expect(h.calls.some((c) => c.user.includes("THIS ROUND'S AGENDA"))).toBe(false);
    expect(h.events.some((e) => e.type === "agenda" || e.type === "coverage")).toBe(false);
    expect(h.calls.some((c) => c.kind === "tracker")).toBe(false);
  });
});

describe("the resolution tracker", () => {
  it("scores land as a coverage event each round and feed the NEXT round's agenda", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), cfg: { rounds: 3, convergence: "fixed" }, subAsks: ASKS,
      fake: {
        trackerText: () => JSON.stringify([
          { id: "a1", score: 88, missing: "" },
          { id: "a2", score: 15, missing: "nobody named a single player" },
        ]),
      },
    });
    await runMode(h.ctx);
    const cov = h.events.filter((e): e is Extract<typeof h.events[number], { type: "coverage" }> => e.type === "coverage");
    expect(cov.length).toBe(3);
    expect(cov[0].scores.map((s) => s.id)).toEqual(["a1", "a2"]);
    // round 2's agenda chases the least-resolved ask by name, quoting the gap
    const r2opener = h.calls.find((c) => c.kind === "turn" && c.user.includes("Open round 2"));
    expect(r2opener!.user).toContain(ASKS[1].ask);
    expect(r2opener!.user).toContain("nobody named a single player");
  });

  it("a garbage tracker reply keeps the previous coverage and never crashes the round", async () => {
    let n = 0;
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), cfg: { rounds: 2, convergence: "fixed" }, subAsks: ASKS,
      fake: { trackerText: () => (++n === 1 ? JSON.stringify([{ id: "a1", score: 60, missing: "needs comps" }]) : "not json {{{") },
    });
    const result = await runMode(h.ctx);
    expect(result.stopReason).toBe("rounds");
    const cov = h.events.filter((e) => e.type === "coverage");
    expect(cov.length).toBe(1); // round 2's failed pass ships nothing new
  });

  it("resume never re-tracks a completed round", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), cfg: { rounds: 2, convergence: "fixed" }, subAsks: ASKS,
      trackedRounds: new Set([1]),
      coverage: [{ id: "a1", ask: ASKS[0].ask, score: 70, missing: "" }, { id: "a2", ask: ASKS[1].ask, score: 30, missing: "gap" }],
      polledRounds: new Set([1]), votedRounds: new Set([1]),
    });
    await runMode(h.ctx);
    const cov = h.events.filter((e) => e.type === "coverage");
    expect(cov.map((e) => (e as { round: number }).round)).toEqual([2]); // round 1 already tracked pre-suspension
  });
});

describe("the adaptive poll plan", () => {
  it("each round polls its scheduled angle — question and instrument swap mid-run", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(8), cfg: { rounds: 4, convergence: "fixed" },
      subAsks: ASKS, pollPlan: PLAN,
    });
    await runMode(h.ctx);
    const sents = h.events.filter((e): e is Extract<typeof h.events[number], { type: "sentiment" }> => e.type === "sentiment");
    expect(sents.map((s) => s.round)).toEqual([1, 2, 3, 4]);
    expect(sents[0].question).toBe("Is the thesis credible?");
    expect(sents[0].angle).toBe("Gut read");
    expect(sents[0].options).toBeUndefined();                     // proposition
    expect(sents[3].question).toBe("Which category deserves pursuit?");
    expect(sents[3].angle).toBe("Category pick");
    expect(sents[3].options).toEqual(["kitchens", "charging"]);   // choice
    expect(Object.keys(sents[3].dist)).toEqual(expect.arrayContaining(["kitchens", "charging"]));
  });

  it("an EMPTY plan polls not at all — votes and interjections still run", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(8), cfg: { rounds: 2, convergence: "fixed", density: "lively" },
      subAsks: ASKS, pollPlan: [],
    });
    await runMode(h.ctx);
    expect(h.events.some((e) => e.type === "sentiment")).toBe(false);
    expect(h.events.some((e) => e.type === "votes")).toBe(true);
  });

  it("no plan (legacy contract or none) → the single launch-derived instrument, every round", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(6), cfg: { rounds: 2, convergence: "fixed" } });
    await runMode(h.ctx);
    const sents = h.events.filter((e): e is Extract<typeof h.events[number], { type: "sentiment" }> => e.type === "sentiment");
    expect(sents.length).toBe(2);
    for (const s of sents) expect(s.question).toBe("Should the builder spend the leftover budget on the pool?");
  });
});
