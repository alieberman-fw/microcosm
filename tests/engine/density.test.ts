/**
 * Phase-2a/2b matrix: interaction density (replies, crossfire, counters,
 * interjection bursts), reply-chain threading invariants, and the per-round
 * vote pass. The focused tier stays pinned by modes.test.ts — this file pins
 * what lively/bustling ADD.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { runMode, pickReplyTarget } from "@/lib/engine";
import { agoraReplies, crossfireSlots, counterSlots, burstSize, waveWidth } from "@/lib/run";
import { makeHarness, makeLeads, makeCrowd } from "../helpers/fake-anthropic";

afterEach(() => vi.restoreAllMocks());

/* every reply must resolve to an EARLIER post; no cycles by construction */
const assertThreadingInvariants = (h: ReturnType<typeof makeHarness>) => {
  const recs = h.postRecs();
  const seqs = new Set(recs.map((p) => p.seq));
  for (const p of recs) {
    if (p.replyTo == null) continue;
    expect(seqs.has(p.replyTo), `post ${p.seq} replies to missing ${p.replyTo}`).toBe(true);
    expect(p.replyTo, `post ${p.seq} must reply to an earlier post`).toBeLessThan(p.seq);
  }
};

const depthOf = (recs: { seq: number; replyTo?: number | null }[], seq: number): number => {
  const bySeq = new Map(recs.map((p) => [p.seq, p]));
  let d = 0, cur = bySeq.get(seq);
  while (cur?.replyTo != null && d < 20) { d += 1; cur = bySeq.get(cur.replyTo); }
  return d;
};

describe("waveWidth — reply-generation concurrency (field tune, 2026-08-05)", () => {
  it("lively 3 / bustling 4; economy buys +1; focused stays the serial v1 rhythm outside economy", () => {
    expect(waveWidth("focused", "standard")).toBe(1);
    expect(waveWidth("lively", "standard")).toBe(3);
    expect(waveWidth("bustling", "standard")).toBe(4);
    expect(waveWidth("focused", "economy")).toBe(2);
    expect(waveWidth("lively", "economy")).toBe(4);
    expect(waveWidth("bustling", "economy")).toBe(5);
    expect(waveWidth("bustling", "frontier")).toBe(4);
  });
});

describe("density math (single source of truth)", () => {
  it("pins the §4.2 table", () => {
    expect(agoraReplies(4, "focused")).toBe(3);
    expect(agoraReplies(15, "focused")).toBe(6);   // the v1 cap
    expect(agoraReplies(4, "lively")).toBe(6);     // 1.5×
    expect(agoraReplies(15, "lively")).toBe(23);
    expect(agoraReplies(15, "bustling")).toBe(30); // 2×
    expect(agoraReplies(30, "bustling")).toBe(40); // sanity ceiling
    expect(crossfireSlots(4, "focused")).toBe(0);
    expect(crossfireSlots(4, "lively")).toBe(2);
    expect(crossfireSlots(4, "bustling")).toBe(4);
    expect(counterSlots("focused")).toBe(0);
    expect(counterSlots("lively")).toBe(2);
    expect(counterSlots("bustling")).toBe(4);
    expect(burstSize("lively", 100)).toBe(3);
    expect(burstSize("bustling", 100)).toBe(6);
    expect(burstSize("bustling", 4)).toBe(4);      // never more than the crowd
  });
});

describe("Agora density + threading", () => {
  it("lively: replies scale to 1.5× leads and real chains form (depth ≥ 2)", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(4), cfg: { rounds: 1, density: "lively", speaker: "round-robin" } });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(1 + 6); // opener + ceil(4 × 1.5)
    const recs = h.postRecs();
    expect(recs.filter((p) => p.tag === "REPLY")).toHaveLength(6);
    assertThreadingInvariants(h);
    const maxDepth = Math.max(...recs.map((p) => depthOf(recs, p.seq)));
    expect(maxDepth).toBeGreaterThanOrEqual(2); // John → Sarah → Bob, not a relay
  });

  it("bustling: 2× replies, still within threading invariants", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), cfg: { rounds: 2, density: "bustling", speaker: "round-robin" } });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(2 * (1 + 6)); // opener + 3×2 per round
    assertThreadingInvariants(h);
  });
});

describe("Roundtable crossfire", () => {
  it("lively: the circuit gains ceil(L/2) crossfire replies targeting round posts", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(4), cfg: { rounds: 1, density: "lively" } });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(4 + 2);
    const xf = h.postRecs().filter((p) => p.tag === "CROSSFIRE");
    expect(xf).toHaveLength(2);
    expect(new Set(xf.map((p) => p.name)).size).toBe(2); // distinct speakers
    for (const p of xf) expect(p.replyTo).not.toBeNull();
    assertThreadingInvariants(h);
  });

  it("focused keeps the pure circuit — zero crossfire", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(4), cfg: { rounds: 1, density: "focused" } });
    await runMode(h.ctx);
    expect(h.postRecs().filter((p) => p.tag === "CROSSFIRE")).toHaveLength(0);
  });
});

describe("Tribunal counter-volley", () => {
  it("lively: 2 COUNTER slots alternate benches and answer the other side", async () => {
    const h = makeHarness({ mode: "Tribunal", leads: makeLeads(4), cfg: { rounds: 1, density: "lively" } });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(2 + 2 + 2 + 1); // args + rebuttals + counters + judge
    const counters = h.postRecs().filter((p) => p.tag === "COUNTER");
    expect(counters).toHaveLength(2);
    assertThreadingInvariants(h);
    // pro counters first (answering a rebuttal), then con answers back
    const sides = h.events
      .filter((e): e is Extract<typeof e, { type: "post" }> => e.type === "post")
      .filter((e) => e.tag === "COUNTER").map((e) => e.side);
    expect(sides).toEqual(["pro", "con"]);
  });
});

describe("crowd interjection bursts", () => {
  it("lively: 3 crowd voices thread under the round's posts after the poll", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(30), cfg: { rounds: 2, density: "lively" } });
    await runMode(h.ctx);
    const recs = h.postRecs();
    const inter = recs.filter((p) => p.tag === "INTERJECTION");
    expect(inter.filter((p) => p.round === 1)).toHaveLength(3);
    expect(inter.filter((p) => p.round === 2)).toHaveLength(3);
    for (const p of inter) {
      expect(p.agentKey.startsWith("crowd-")).toBe(true);
      expect(p.replyTo).not.toBeNull();
    }
    assertThreadingInvariants(h);
    expect(h.calls.filter((c) => c.kind === "burst")).toHaveLength(2); // ONE call per burst
  });

  it("a resumed slice never re-bursts a round that already has interjections", async () => {
    const h1 = makeHarness({ mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(20), cfg: { rounds: 1, density: "lively" } });
    await runMode(h1.ctx);
    const h2 = makeHarness({ mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(20), cfg: { rounds: 2, density: "lively" }, polledRounds: new Set([1]), votedRounds: new Set([1]) });
    await runMode(h2.ctx, h1.resume(1));
    const round1Inter = h2.postRecs().filter((p) => p.tag === "INTERJECTION" && p.round === 1);
    expect(round1Inter.filter((p) => !h1.postRecs().some((q) => q.seq === p.seq))).toHaveLength(0); // nothing new for round 1
  });

  it("Jury density never dilutes verdict integrity — bursts yes, extra deliberation posts no", async () => {
    const h = makeHarness({ mode: "Jury", leads: makeLeads(3), crowd: makeCrowd(20), cfg: { rounds: 2, density: "bustling" }, fake: { juryScore: () => 5 } });
    await runMode(h.ctx);
    const recs = h.postRecs();
    expect(recs.filter((p) => p.tag === "VERDICT")).toHaveLength(6);
    expect(recs.filter((p) => p.tag === "TALLY")).toHaveLength(2);
    expect(recs.filter((p) => p.tag === "REPLY" || p.tag === "CROSSFIRE" || p.tag === "COUNTER")).toHaveLength(0);
    expect(recs.filter((p) => p.tag === "INTERJECTION" && p.round === 1)).toHaveLength(6);
  });

  it("Desk and Expedition never burst or vote, at any density", async () => {
    for (const mode of ["Desk", "Expedition"]) {
      const h = makeHarness({ mode, leads: makeLeads(4), crowd: makeCrowd(20), cfg: { rounds: 3, density: "bustling" } });
      await runMode(h.ctx);
      expect(h.postRecs().filter((p) => p.tag === "INTERJECTION")).toHaveLength(0);
      expect(h.voteEvents()).toHaveLength(0);
    }
  });
});

describe("votes (§2b)", () => {
  it("each polled round gets ONE vote pass: leads + crowd sample, no self-votes, valid targets", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(30), cfg: { rounds: 2, density: "focused" } });
    await runMode(h.ctx);
    const ve = h.voteEvents();
    expect(ve.map((e) => e.round)).toEqual([1, 2]);
    const recs = h.postRecs();
    for (const e of ve) {
      expect(e.votes.length).toBeGreaterThan(0);
      for (const v of e.votes) {
        const target = recs.find((p) => p.seq === v.seq);
        expect(target).toBeDefined();
        expect(target!.round).toBe(e.round);
        expect(target!.agentKey).not.toBe(v.voter_key); // never on their own post
        expect([1, -1]).toContain(v.vote);
      }
    }
    expect(h.ctx.votedRounds).toEqual(new Set([1, 2]));
  });

  it("Chamber votes after takes and after the synthesis (rounds 1 and 3)", async () => {
    const h = makeHarness({ mode: "Chamber", leads: makeLeads(3), crowd: makeCrowd(20), cfg: { density: "focused" } });
    await runMode(h.ctx);
    expect(h.voteEvents().map((e) => e.round)).toEqual([1, 3]);
  });

  it("an already-voted round is never re-voted on resume", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(20),
      cfg: { rounds: 1, density: "focused" }, votedRounds: new Set([1]),
    });
    await runMode(h.ctx);
    expect(h.voteEvents()).toHaveLength(0);
    expect(h.calls.filter((c) => c.kind === "votes")).toHaveLength(0);
  });

  it("a vote pass that returns garbage is skipped without touching the run", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(20), cfg: { rounds: 1, density: "focused" },
      fake: { failure: (kind) => (kind === "votes" ? "garbage" : undefined) },
    });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(2);
    expect(h.voteEvents()).toHaveLength(0);
    expect(h.ctx.votedRounds.size).toBe(0); // will retry on a resume
  });
});

describe("pickReplyTarget", () => {
  const post = (seq: number, round: number, agentKey: string, replyTo: number | null = null) =>
    ({ seq, round, tag: "REPLY", agentKey, name: agentKey, content: "x", replyTo });
  it("returns null with no candidates; never targets the excluded author", () => {
    expect(pickReplyTarget([], 1, 0)).toBeNull();
    const only = [post(1, 1, "al")];
    expect(pickReplyTarget(only, 1, 0, "al")).toBeNull();
  });
  it("weights contested posts (most-replied) to the top at salt 0", () => {
    const posts = [post(1, 1, "al"), post(2, 1, "bea", 1), post(3, 1, "cy", 1), post(4, 1, "dee")];
    expect(pickReplyTarget(posts, 1, 0)!.seq).toBe(1); // two replies → top-weighted
  });
  it("salt rotates among the top three so chains fork", () => {
    const posts = [post(1, 1, "al"), post(2, 1, "bea", 1), post(3, 1, "cy", 1), post(4, 1, "dee")];
    const picks = new Set([0, 1, 2].map((s) => pickReplyTarget(posts, 1, s)!.seq));
    expect(picks.size).toBeGreaterThan(1);
  });
  it("never targets TALLY or INTERJECTION posts", () => {
    const posts = [
      { seq: 1, round: 1, tag: "TALLY", agentKey: "__tally", name: "T", content: "x", replyTo: null },
      { seq: 2, round: 1, tag: "INTERJECTION", agentKey: "crowd-1", name: "C", content: "x", replyTo: null },
    ];
    expect(pickReplyTarget(posts, 1, 0)).toBeNull();
  });
});
