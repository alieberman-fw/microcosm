/**
 * 6-PR3 — rounds that walk the brief (§6c/§6d): the pure math.
 * Agenda selection, poll-angle scheduling, tracker parsing.
 */

import { describe, expect, it } from "vitest";
import {
  CoverageScore, PollAngle, agendaForRound, askLabel, coverageSystem, parseCoverage, pollAngleForRound,
} from "@/lib/agenda";

const ASKS = [
  { id: "a1", ask: "Does the real estate exist to buy today?" },
  { id: "a2", ask: "Who are the players in each category?" },
  { id: "a3", ask: "Which categories deserve the team's 90 days?" },
];

const ANGLES: PollAngle[] = [
  { angle: "Gut read", question: "Is this thesis credible?", instrument: "proposition", phase: "early" },
  { angle: "Category pick", question: "Which category most deserves pursuit?", instrument: "choice", options: ["kitchens", "charging", "storage"], phase: "middle" },
  { angle: "Back the pick", question: "Back the panel's #1 with real money?", instrument: "proposition", phase: "late" },
];

describe("pollAngleForRound — the adaptive schedule", () => {
  it("empty plan = this run polls NOTHING", () => {
    expect(pollAngleForRound([], 1, 8)).toBeNull();
  });

  it("angles get contiguous blocks in phase order, each ≥2 rounds (8 rounds / 3 angles → 3+3+2)", () => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => pollAngleForRound(ANGLES, r, 8)!.angle);
    expect(seq).toEqual(["Gut read", "Gut read", "Gut read", "Category pick", "Category pick", "Category pick", "Back the pick", "Back the pick"]);
  });

  it("a short run drops trailing angles rather than flickering (3 rounds → only the early angle)", () => {
    const seq = [1, 2, 3].map((r) => pollAngleForRound(ANGLES, r, 3)!.angle);
    expect(seq).toEqual(["Gut read", "Gut read", "Gut read"]);
    // 4-5 rounds afford two angles
    expect([1, 2, 3, 4].map((r) => pollAngleForRound(ANGLES, r, 4)!.angle)).toEqual(["Gut read", "Gut read", "Category pick", "Category pick"]);
  });

  it("a 1-round run still polls once, with the earliest angle", () => {
    expect(pollAngleForRound(ANGLES, 1, 1)!.angle).toBe("Gut read");
  });

  it("phase order wins over array order", () => {
    const shuffled = [ANGLES[2], ANGLES[0], ANGLES[1]];
    expect(pollAngleForRound(shuffled, 1, 8)!.angle).toBe("Gut read");
    expect(pollAngleForRound(shuffled, 8, 8)!.angle).toBe("Back the pick");
  });

  it("budget-overrun rounds past the cap keep the closer", () => {
    expect(pollAngleForRound(ANGLES, 11, 8)!.angle).toBe("Back the pick");
  });
});

describe("agendaForRound — the round's marching orders", () => {
  it("no sub-asks (no contract) → no agenda, exactly today's behavior", () => {
    expect(agendaForRound([], null, 1, 8)).toBeNull();
  });

  it("round 1 opens the FULL brief, naming every sub-ask", () => {
    const a = agendaForRound(ASKS, null, 1, 8)!;
    expect(a.label).toBe("OPEN THE FULL BRIEF");
    for (const s of ASKS) expect(a.instruction).toContain(s.ask);
  });

  it("the final round forces synthesis", () => {
    const a = agendaForRound(ASKS, null, 8, 8)!;
    expect(a.label).toContain("COMMIT");
    expect(a.instruction).toContain("Final round");
  });

  it("middle rounds chase the LEAST-RESOLVED sub-asks by name, quoting what's missing", () => {
    const coverage: CoverageScore[] = [
      { id: "a1", ask: ASKS[0].ask, score: 85, missing: "" },
      { id: "a2", ask: ASKS[1].ask, score: 20, missing: "no named players yet" },
      { id: "a3", ask: ASKS[2].ask, score: 55, missing: "no ranking" },
    ];
    const a = agendaForRound(ASKS, coverage, 3, 8)!;
    expect(a.label).toContain(askLabel(ASKS[1].ask).slice(0, 20));
    expect(a.instruction).toContain(ASKS[1].ask);   // least resolved leads
    expect(a.instruction).toContain(ASKS[2].ask);   // second-least rides along
    expect(a.instruction).toContain("no named players yet");
    expect(a.instruction).not.toContain(ASKS[0].ask); // the settled ask is left alone
  });

  it("before the tracker has spoken, middle rounds cycle the asks so each gets a named round", () => {
    expect(agendaForRound(ASKS, null, 2, 8)!.instruction).toContain(ASKS[0].ask);
    expect(agendaForRound(ASKS, null, 3, 8)!.instruction).toContain(ASKS[1].ask);
    expect(agendaForRound(ASKS, null, 4, 8)!.instruction).toContain(ASKS[2].ask);
    expect(agendaForRound(ASKS, null, 5, 8)!.instruction).toContain(ASKS[0].ask); // wraps
  });
});

describe("parseCoverage — the tracker's reply", () => {
  it("clamps scores, trims missing, keeps sub-ask order, drops unknown ids and dupes", () => {
    const raw = [
      { id: "a3", score: 250, missing: "x" },
      { id: "a1", score: -5, missing: "" },
      { id: "a1", score: 90, missing: "dupe" },
      { id: "zz", score: 50, missing: "ghost" },
    ];
    const out = parseCoverage(raw, ASKS)!;
    expect(out.map((x) => x.id)).toEqual(["a1", "a3"]); // sub-ask order, no dupes/ghosts
    expect(out[0].score).toBe(0);
    expect(out[1].score).toBe(100);
  });

  it("nothing usable → null (the engine keeps the previous coverage)", () => {
    expect(parseCoverage([{ id: "nope", score: 50 }], ASKS)).toBeNull();
    expect(parseCoverage([], ASKS)).toBeNull();
  });

  it("coverageSystem names every sub-ask by id", () => {
    const s = coverageSystem(ASKS);
    for (const a of ASKS) expect(s).toContain(`id ${a.id}: ${a.ask}`);
    expect(s).toContain("0-100");
  });
});
