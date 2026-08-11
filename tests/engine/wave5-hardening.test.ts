/**
 * Wave 5a — engine hardening + silent-failure telemetry (audit E-G/E-C/E-D).
 * Every fix here turns a silent degradation into a visible, testable signal.
 */

import { describe, expect, it } from "vitest";
import { chamberAngleOffset, chamberAngles, runMode, textSimilarity } from "@/lib/engine";
import { makeCrowd, makeHarness, makeLeads } from "../helpers/fake-anthropic";

describe("textSimilarity (E-D2) — Jaccard, not containment", () => {
  it("identical posts still score 1.0", () => {
    const t = "the interconnection queue clears in thirty-six months at signal butte";
    expect(textSimilarity(t, t)).toBe(1);
  });

  it("a short post contained in a long one no longer scores 1.0", () => {
    const short = "interconnection queue clears thirty-six months";
    const long =
      "interconnection queue clears thirty-six months but only because the utility " +
      "reprioritized industrial load after the commission ruling and the substation " +
      "expansion budget doubled under the revised capital plan for the eastern corridor";
    // min-denominator scored this 1.0 (every short token appears in long)
    expect(textSimilarity(short, long)).toBeLessThan(0.8);
    expect(textSimilarity(short, long)).toBeGreaterThan(0);
  });
});

describe("chamberAngles (E-D4) — 12 molds, seeded offset", () => {
  it("carries 12 distinct angles", () => {
    expect(chamberAngles.length).toBe(12);
    expect(new Set(chamberAngles).size).toBe(12);
  });

  it("the offset is deterministic per problem and within range", () => {
    const a = chamberAngleOffset("Is the Mesa parcel worth $9.2M?");
    expect(a).toBe(chamberAngleOffset("Is the Mesa parcel worth $9.2M?"));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(chamberAngles.length);
    // different briefs generally land different molds (hash property)
    const others = ["Convert the mall anchor?", "STR cap policy read", "Office-to-resi feasibility"];
    expect(others.some((o) => chamberAngleOffset(o) !== a)).toBe(true);
  });
});

describe("ballot integrity (E-C5/C6) — the roster is the electorate", () => {
  it("phantom names and duplicate answers are dropped; coerced stances are counted on the event", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(3),
      cfg: { rounds: 1, convergence: "fixed" },
      fake: {
        pollText: () => JSON.stringify([
          { name: "Crowd 1 Z.", stance: "support", quote: "yes" },
          { name: "Crowd 1 Z.", stance: "oppose", quote: "changed my mind" },   // duplicate — dropped
          { name: "Totally Invented Q.", stance: "oppose", quote: "phantom" },  // not on the roster — dropped
          { name: "Crowd 2 Z.", stance: "banana", quote: "unparseable" },       // coerced to disengaged
          { name: "Crowd 3 Z.", stance: "oppose", quote: "no" },
        ]),
      },
    });
    await runMode(h.ctx);
    const s = h.events.filter((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment")[0];
    expect(s.polled).toBe(3);                       // 3 real members, once each
    expect(s.dist).toEqual({ support: 1, conditional: 0, oppose: 1, disengaged: 1 });
    expect(s.coerced).toBe(1);                      // the banana stance, visible on the event
    expect(s.dropped).toBe(2);                      // dupe + phantom, visible on the event
    expect(s.ballots!.map((b) => b.name).sort()).toEqual(["Crowd 1 Z.", "Crowd 2 Z.", "Crowd 3 Z."]);
  });

  it("a clean poll carries no integrity fields", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(4), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    const s = h.events.filter((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment")[0];
    expect(s.coerced).toBeUndefined();
    expect(s.dropped).toBeUndefined();
    expect(s.polled).toBe(4);
  });
});

describe("skip markers (E-G1) — a dead turn leaves a trace", () => {
  it("a turn that strips to nothing emits a skip event and records no post", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), cfg: { rounds: 1, convergence: "fixed" },
      // Al's draft AND his ghost-retry are pure leaked reasoning — strip to ""
      fake: { turnText: (call) => (call.system.includes("You are Al") ? "<thinking> internal reasoning only" : undefined) },
    });
    await runMode(h.ctx);
    const skips = h.events.filter((e): e is Extract<typeof e, { type: "skip" }> => e.type === "skip");
    expect(skips).toHaveLength(1);
    expect(skips[0].name).toBe("Al B.");
    expect(skips[0].round).toBe(1);
    const posts = h.postRecs();
    expect(posts.some((p) => p.name === "Al B.")).toBe(false);
    expect(posts.every((p) => p.content.trim().length > 0)).toBe(true); // no ghost rows
  });
});

describe("record guards (E-G5) — empty output never becomes choreography state", () => {
  it("Chamber with zero surviving takes skips the review phase instead of reviewing an empty string", async () => {
    const h = makeHarness({
      mode: "Chamber", leads: makeLeads(3), cfg: { rounds: 1, convergence: "fixed" },
      fake: { turnText: () => "<thinking> nothing but reasoning" },
    });
    const result = await runMode(h.ctx);
    expect(result.stopReason).toBe("choreography");
    const posts = h.postRecs();
    expect(posts.filter((p) => p.tag === "BLIND REVIEW")).toHaveLength(0);
    expect(posts.every((p) => p.content.trim().length > 0)).toBe(true);
  });
});

describe("did-guards on fixed-shape resume (E-G6)", () => {
  it("a completed Desk run resumed re-runs NOTHING", async () => {
    const h1 = makeHarness({ mode: "Desk", leads: makeLeads(4), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h1.ctx);
    const tags1 = h1.postRecs().map((p) => p.tag);
    expect(tags1.filter((t) => t === "ASSIGNMENT")).toHaveLength(1);
    expect(tags1.filter((t) => t === "DIRECTOR'S MEMO")).toHaveLength(1);

    const h2 = makeHarness({ mode: "Desk", leads: makeLeads(4), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h2.ctx, h1.resume(3));
    // the resumed slice makes zero turn calls — assignment, drafts, and memo
    // all carry did-guards now (the assignment and memo used to re-run)
    expect(h2.calls.filter((c) => c.kind === "turn")).toHaveLength(0);
    expect(h2.postRecs()).toHaveLength(0);
  });

  it("a completed Chamber run resumed never re-synthesizes", async () => {
    const h1 = makeHarness({ mode: "Chamber", leads: makeLeads(3), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h1.ctx);
    expect(h1.postRecs().filter((p) => p.tag === "CHAIR SYNTHESIS")).toHaveLength(1);

    const h2 = makeHarness({ mode: "Chamber", leads: makeLeads(3), cfg: { rounds: 1, convergence: "fixed" }, polledRounds: new Set([1, 3]) });
    await runMode(h2.ctx, h1.resume(3));
    expect(h2.calls.filter((c) => c.kind === "turn")).toHaveLength(0);
  });
});

describe("vote-state rebuild (E-G7) — slice boundaries never double-count", () => {
  it("a pair cast in an earlier slice is skipped by this slice's sweep", async () => {
    const leads = makeLeads(2);
    const h = makeHarness({ mode: "Roundtable", leads, cfg: { rounds: 1, convergence: "fixed" } });
    // an earlier slice already recorded Al's up-vote on seq 1
    const al = leads[0].key;
    h.ctx.priorVoteEvents = [{ round: 1, votes: [{ seq: 1, voter_key: al, vote: 1 }] }];
    await runMode(h.ctx);
    const cast = h.voteEvents().flatMap((e) => e.votes);
    // the fake's default voter script tries up-seq1 + down-seq2 for everyone;
    // Al's up on seq 1 must be deduped against the prior slice
    expect(cast.some((v) => v.voter_key === al && v.seq === 1)).toBe(false);
    expect(cast.some((v) => v.voter_key === al && v.seq === 2 && v.vote === -1)).toBe(true);
  });
});

describe("monotone coverage (E-G8) — settled sub-asks stay settled", () => {
  it("a sub-ask at 85+ never drops when the tracker's window forgets it", async () => {
    let n = 0;
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), cfg: { rounds: 2, convergence: "fixed" },
      subAsks: [{ id: "a1", ask: "Does the deal pencil?" }],
      fake: {
        trackerText: () => (++n === 1
          ? JSON.stringify([{ id: "a1", score: 90, missing: "" }])
          : JSON.stringify([{ id: "a1", score: 40, missing: "window forgot the early rounds" }])),
      },
    });
    await runMode(h.ctx);
    const cov = h.events.filter((e): e is Extract<typeof e, { type: "coverage" }> => e.type === "coverage");
    expect(cov).toHaveLength(2);
    expect(cov[0].scores[0].score).toBe(90);
    expect(cov[1].scores[0].score).toBe(90); // settled — the regression is ignored
  });

  it("below the settled line, scores still move both ways", async () => {
    let n = 0;
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), cfg: { rounds: 2, convergence: "fixed" },
      subAsks: [{ id: "a1", ask: "Does the deal pencil?" }],
      fake: {
        trackerText: () => (++n === 1
          ? JSON.stringify([{ id: "a1", score: 60, missing: "no comps yet" }])
          : JSON.stringify([{ id: "a1", score: 35, missing: "the comps got challenged" }])),
      },
    });
    await runMode(h.ctx);
    const cov = h.events.filter((e): e is Extract<typeof e, { type: "coverage" }> => e.type === "coverage");
    expect(cov[1].scores[0].score).toBe(35); // unsettled asks track the debate honestly
  });
});

describe("panel-wide dedupe (E-D1) — cross-speaker restatement gets the retry", () => {
  it("a draft identical to a colleague's post triggers one do-not-restate retry", async () => {
    const twin = "The substation expansion budget doubled under the revised capital plan for the eastern corridor interconnection.";
    let beaFirstDraft = true;
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), cfg: { rounds: 1, convergence: "fixed" },
      fake: {
        turnText: (call) => {
          if (call.system.includes("You are Al")) return twin;
          if (call.system.includes("You are Bea") && beaFirstDraft) { beaFirstDraft = false; return twin; }
          return undefined; // Bea's retry falls back to the default varied text
        },
      },
    });
    await runMode(h.ctx);
    const retry = h.calls.find((c) => c.kind === "turn" && c.user.includes("Do NOT restate"));
    expect(retry).toBeDefined();
    // the retry's fresh draft landed — no twin post in the record
    const contents = h.postRecs().filter((p) => p.tag.startsWith("ROUND")).map((p) => p.content);
    expect(contents.filter((c) => c === twin)).toHaveLength(1);
  });
});
