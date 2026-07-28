/**
 * Suspend/resume correctness — the chunked-continuation contract. A run that
 * hits its slice deadline must suspend at a safe boundary, and the resumed
 * slice must (1) never duplicate a (name, tag, round) post, (2) run every
 * poll the first slice couldn't — including the Tribunal judge-skip
 * regression where `continue` used to jump the round's crowd poll.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { runMode } from "@/lib/engine";
import { makeHarness, makeLeads, makeCrowd } from "../helpers/fake-anthropic";

afterEach(() => vi.restoreAllMocks());

const postKeys = (h: ReturnType<typeof makeHarness>) =>
  h.postRecs().map((p) => `${p.name}|${p.tag}|${p.round}`);

describe("suspend/resume", () => {
  it("Roundtable: suspends mid-round at the deadline, resumes with zero duplicate turns", async () => {
    // 4 leads × 1000ms/turn, deadline 2500ms in → 3 turns land, 4th suspends
    const h1 = makeHarness({ mode: "Roundtable", leads: makeLeads(4), cfg: { rounds: 2, convergence: "fixed" }, deadlineInMs: 2500 });
    const r1 = await runMode(h1.ctx);
    expect(r1.suspendedAtRound).toBe(1);
    expect(h1.postRecs()).toHaveLength(3);

    // resume exactly the way the launch route does: rebuilt posts + round
    const h2 = makeHarness({ mode: "Roundtable", leads: makeLeads(4), cfg: { rounds: 2, convergence: "fixed" } });
    const r2 = await runMode(h2.ctx, h1.resume(r1.suspendedAtRound!));
    expect(r2).toMatchObject({ posts: 8, stopReason: "rounds", converged: false });
    expect(r2.suspendedAtRound).toBeUndefined();

    // the resumed slice only emitted the 5 missing turns — never a repeat
    const all = [...postKeys(h1), ...postKeys(h2)];
    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
  });

  it("Tribunal judge-skip regression: suspending right after the judge's note still polls that round on resume", async () => {
    // round 1 = 5 turns (2 ARG + 2 REBUT + judge) ending at t=5000; deadline
    // 4500 → the suspend fires at the poll boundary, AFTER the judge spoke
    const h1 = makeHarness({ mode: "Tribunal", leads: makeLeads(4), crowd: makeCrowd(30), cfg: { rounds: 2, convergence: "fixed" }, deadlineInMs: 4500 });
    const r1 = await runMode(h1.ctx);
    expect(r1.suspendedAtRound).toBe(1);
    expect(h1.postRecs().filter((p) => p.tag === "JUDGE'S NOTE")).toHaveLength(1);
    expect(h1.sentimentRounds()).toEqual([]); // poll never started

    const h2 = makeHarness({ mode: "Tribunal", leads: makeLeads(4), crowd: makeCrowd(30), cfg: { rounds: 2, convergence: "fixed" } });
    const r2 = await runMode(h2.ctx, h1.resume(1));
    expect(r2).toMatchObject({ posts: 10, stopReason: "rounds" });

    // round 1's poll ran on resume (the old `continue` skipped it) + round 2's
    expect(h2.sentimentRounds()).toEqual([1, 2]);
    // exactly one judge note per round across both slices
    const judgeNotes = [...postKeys(h1), ...postKeys(h2)].filter((k) => k.includes("JUDGE'S NOTE"));
    expect(judgeNotes).toEqual(["The Judge|JUDGE'S NOTE|1", "The Judge|JUDGE'S NOTE|2"]);
    const all = [...postKeys(h1), ...postKeys(h2)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("mid-poll deadline: emits the partial tally honestly and marks the round polled", async () => {
    // 120 crowd = 6 batches; deadline lets ~2 batches through before workers stop
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(120), cfg: { rounds: 1, convergence: "fixed" }, deadlineInMs: 3500 });
    await runMode(h.ctx);
    const sentiments = h.events.filter((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment");
    expect(sentiments).toHaveLength(1);
    expect(sentiments[0].polled).toBeGreaterThan(0);
    expect(sentiments[0].polled).toBeLessThan(120); // partial, not fabricated-full
    expect(h.ctx.polledRounds.has(1)).toBe(true);   // won't re-poll on resume
  });

  it("polledRounds: an already-polled round is never re-polled on resume", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(20),
      cfg: { rounds: 1, convergence: "fixed" }, polledRounds: new Set([1]),
    });
    await runMode(h.ctx);
    expect(h.sentimentRounds()).toEqual([]);
    expect(h.calls.filter((c) => c.kind === "poll")).toHaveLength(0);
  });
});
