/**
 * Field report 3 — the Jury × choice-brief fix. A choose-between brief has no
 * single scoreable proposition: in the field, every juror anchored on the
 * first uploaded image and the whole panel read "SCORE: 2/10". With a choice
 * instrument, jurors PICK an option (+ confidence); the tally counts picks;
 * convergence = nobody switched.
 */

import { describe, expect, it } from "vitest";
import { juryChoiceTallyLine, juryPickOf, juryPicksAt, jurySwitches, runMode } from "@/lib/engine";
import { makeHarness, makeLeads } from "../helpers/fake-anthropic";

const OPTS = ["green.png", "red.png", "blue.png"];

describe("juryPickOf", () => {
  it("parses the canonical PICK line and resolves via normalizeChoice", () => {
    expect(juryPickOf("PICK: green.png · CONFIDENCE: 8/10 — clean lines.", OPTS)).toEqual({ pick: "green.png", confidence: 8 });
    expect(juryPickOf('PICK: "RED.PNG" - CONFIDENCE: 6.5/10 — warmth.', OPTS)).toEqual({ pick: "red.png", confidence: 6.5 });
    expect(juryPickOf("PICK: the blue one, blue.png | CONFIDENCE: 9/10 — light.", OPTS)).toEqual({ pick: "blue.png", confidence: 9 });
  });

  it("rejects garbage, unknown options, and classic SCORE lines", () => {
    expect(juryPickOf("SCORE: 2/10 — catastrophe.", OPTS)).toBeNull();
    expect(juryPickOf("PICK: purple.png · CONFIDENCE: 8/10 — nope.", OPTS)).toBeNull();
    expect(juryPickOf("no verdict here", OPTS)).toBeNull();
  });
});

describe("choice tally + switches", () => {
  const v = (pick: string, confidence = 7) => ({ pick, confidence });

  it("counts picks per option, names the leader, tracks switches", () => {
    const r1 = new Map([["a", v("green.png")], ["b", v("green.png", 9)], ["c", v("red.png")]]);
    const line1 = juryChoiceTallyLine(r1, new Map(), 1, OPTS)!;
    expect(line1).toContain("green.png 2 · red.png 1 · blue.png 0");
    expect(line1).toContain("LEADER green.png (2/3)");
    const r2 = new Map([["a", v("green.png")], ["b", v("red.png")], ["c", v("red.png")]]);
    expect(jurySwitches(r1, r2)).toBe(1);
    expect(juryChoiceTallyLine(r2, r1, 2, OPTS)).toContain("1 JUROR SWITCHED PICKS");
    expect(juryChoiceTallyLine(r2, r2, 3, OPTS)).toContain("NO JUROR SWITCHED PICKS");
  });
});

describe("choice-jury choreography", () => {
  it("verdicts PICK options (never bare scores), the tally counts them, and holds converge", async () => {
    const h = makeHarness({
      mode: "Jury", leads: makeLeads(4),
      cfg: { rounds: 3, convergence: "stability" },
      pollOptions: OPTS,
      fake: { juryPick: (name, round) => (round === 1 && name.startsWith("Al") ? "red.png" : "green.png") },
    });
    const r = await runMode(h.ctx);
    const verdicts = h.postRecs().filter((p) => p.tag === "VERDICT");
    expect(verdicts.length).toBeGreaterThan(0);
    for (const p of verdicts) expect(p.content.startsWith("PICK: ")).toBe(true);
    const tallies = h.postRecs().filter((p) => p.tag === "TALLY");
    expect(tallies[0].content).toContain("LEADER green.png");
    // round 2: Ada switches to green → round 3: everyone holds → stability
    const r2Picks = juryPicksAt(h.postRecs(), 2, OPTS);
    expect([...r2Picks.values()].every((x) => x.pick === "green.png")).toBe(true);
    expect(r.converged).toBe(true);
    expect(r.stopReason).toBe("stability");
  });

  it("classic juries (no options) still score — nothing changed for proposition briefs", async () => {
    const h = makeHarness({ mode: "Jury", leads: makeLeads(3), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    const verdicts = h.postRecs().filter((p) => p.tag === "VERDICT");
    for (const p of verdicts) expect(p.content.startsWith("SCORE: ")).toBe(true);
  });
});
