/**
 * Jury arithmetic — the pure helpers behind the TALLY post and the
 * scores-stopped-moving convergence rule. Every number the run screen and
 * report show for Jury mode is pinned here.
 */

import { describe, it, expect } from "vitest";
import { juryScoreOf, juryScoresAt, juryMovement, juryTallyLine } from "@/lib/engine";

describe("juryScoreOf", () => {
  it("parses the mandated verdict prefix", () => {
    expect(juryScoreOf("SCORE: 7/10 — solid fundamentals.")).toBe(7);
    expect(juryScoreOf("score: 7.5 / 10 — case-insensitive, spaced.")).toBe(7.5);
    expect(juryScoreOf("Leading prose then SCORE: 4/10 — buried works too.")).toBe(4);
  });
  it("clamps out-of-range and rejects non-verdicts", () => {
    expect(juryScoreOf("SCORE: 12/10 — over-enthusiastic juror")).toBe(10);
    expect(juryScoreOf("I'd give it a 7 out of 10")).toBeNull();
    expect(juryScoreOf("")).toBeNull();
  });
});

describe("juryScoresAt", () => {
  const post = (agentKey: string, round: number, score: number | null, tag = "VERDICT") =>
    ({ tag, round, agentKey, content: score === null ? "no score here" : `SCORE: ${score}/10 — x` });
  it("collects only that round's VERDICT posts with parseable scores", () => {
    const posts = [
      post("a", 1, 3), post("b", 1, 7),
      post("a", 2, 5), post("b", 2, null),     // b's round-2 verdict unparseable
      post("c", 2, 9, "TALLY"),                 // wrong tag ignored
    ];
    expect([...juryScoresAt(posts, 1).entries()]).toEqual([["a", 3], ["b", 7]]);
    expect([...juryScoresAt(posts, 2).entries()]).toEqual([["a", 5]]);
  });
  it("a re-emitted verdict in the same round: last one wins", () => {
    expect(juryScoresAt([post("a", 1, 3), post("a", 1, 6)], 1).get("a")).toBe(6);
  });
});

describe("juryMovement", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  it("a full point is the movement threshold", () => {
    expect(juryMovement(m({ a: 5 }), m({ a: 6 }))).toEqual({ returningMoved: 1, movedOrNew: 1 });
    expect(juryMovement(m({ a: 5 }), m({ a: 5.9 }))).toEqual({ returningMoved: 0, movedOrNew: 0 });
  });
  it("a juror missing from the previous round counts as movement for the stop rule, not the tally", () => {
    expect(juryMovement(m({ a: 5 }), m({ a: 5, b: 7 }))).toEqual({ returningMoved: 0, movedOrNew: 1 });
  });
  it("mixed hold/move/new", () => {
    expect(juryMovement(m({ a: 5, b: 7 }), m({ a: 6.2, b: 7.4, c: 5 })))
      .toEqual({ returningMoved: 1, movedOrNew: 2 });
  });
});

describe("juryTallyLine", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  it("round 1: mean, FOR/AGAINST/fence buckets, range — no movement suffix", () => {
    expect(juryTallyLine(m({ a: 7, b: 3, c: 5 }), new Map(), 1)).toBe(
      "ROUND 1 TALLY — mean 5.0/10 · 1 FOR (≥6) · 1 AGAINST (≤4) · 1 ON THE FENCE · range 3–7"
    );
  });
  it("later rounds report juror movement — including none", () => {
    expect(juryTallyLine(m({ a: 7, b: 3 }), m({ a: 7, b: 3 }), 2)).toContain("NO JUROR MOVED ≥1 POINT");
    expect(juryTallyLine(m({ a: 8, b: 3 }), m({ a: 7, b: 3 }), 2)).toContain("1 JUROR MOVED ≥1 POINT");
    expect(juryTallyLine(m({ a: 8, b: 5 }), m({ a: 7, b: 3 }), 2)).toContain("2 JURORS MOVED ≥1 POINT");
  });
  it("no scores → no tally post", () => {
    expect(juryTallyLine(new Map(), new Map(), 1)).toBeNull();
  });
});
