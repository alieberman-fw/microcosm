/**
 * 3e — the forum acts like a real forum. Pins:
 * - necro gate: focused NEVER crosses rounds (the Phase-1 matrix stays intact
 *   by construction); lively/bustling revive old threads within their share
 * - cross-round replies carry the "update, don't reopen" instruction
 * - parallel reply waves keep seq order, adjacency, and counts intact
 * - Jury round 1 is fully parallel and still lands in juror order
 * - selective voting: per-voter budgets (endorse ≤2 / reject ≤1) are ENFORCED
 *   even against a greedy voter, and the retro slice makes revived old posts
 *   votable at the close
 */

import { describe, expect, it } from "vitest";
import { necroFrac, pickReplyTarget, runMode } from "@/lib/engine";
import { makeCrowd, makeHarness, makeLeads } from "../helpers/fake-anthropic";

const P = (seq: number, round: number, opts: Partial<{ tag: string; agentKey: string; replyTo: number | null }> = {}) => ({
  seq, round, tag: opts.tag ?? "REPLY", agentKey: opts.agentKey ?? `a${seq}`, name: `N${seq}`, content: `c${seq}`, replyTo: opts.replyTo ?? null,
});

describe("necro gate (pickReplyTarget across rounds)", () => {
  const history = [
    P(1, 1, { tag: "POST 1", replyTo: null }),
    P(2, 1, { replyTo: 1 }), P(3, 1, { replyTo: 1 }), P(4, 1, { replyTo: 2 }), // seq 1 is contested
    P(5, 2, { tag: "POST 2", replyTo: null }),
  ];

  it("focused never leaves the current round — the pinned v1 rhythm", () => {
    expect(necroFrac("focused")).toBe(0);
    for (let salt = 0; salt < 12; salt++) {
      const t = pickReplyTarget(history, 2, salt, undefined, "focused");
      expect(t?.round).toBe(2);
    }
  });

  it("lively can revive an old contested thread (the first reply of a round may cross)", () => {
    const targets = new Set<number>();
    for (let salt = 0; salt < 3; salt++) {
      targets.add(pickReplyTarget(history, 2, salt, undefined, "lively")!.seq);
    }
    expect([...targets].some((s) => history.find((p) => p.seq === s)!.round === 1)).toBe(true);
  });

  it("the gate holds: once this round's revivals hit the density share, only current-round targets remain", () => {
    // round 2 already made 3 replies, ALL revivals — 3 > ceil(0.25 * 4) = 1,
    // so the next lively pick must stay in round 2
    const saturated = [
      ...history,
      P(6, 2, { replyTo: 1 }), P(7, 2, { replyTo: 2 }), P(8, 2, { replyTo: 3 }),
    ];
    for (let salt = 0; salt < 12; salt++) {
      expect(pickReplyTarget(saturated, 2, salt, undefined, "lively")!.round).toBe(2);
    }
  });

  it("bustling allows a bigger share than lively", () => {
    expect(necroFrac("bustling")).toBeGreaterThan(necroFrac("lively"));
  });
});

describe("cross-round replies (living threads end-to-end)", () => {
  it("a lively 2-round Agora run revives at least one old thread, with the update-don't-reopen order", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(4), cfg: { rounds: 2, convergence: "fixed", density: "lively" } });
    await runMode(h.ctx);
    const recs = h.postRecs();
    const roundOf = new Map(recs.map((p) => [p.seq, p.round]));
    const revivals = recs.filter((p) => p.tag === "REPLY" && p.replyTo != null && (roundOf.get(p.replyTo) ?? p.round) < p.round);
    expect(revivals.length).toBeGreaterThan(0);
    // the engine told the revivalist to update, not reopen
    const turnCalls = h.calls.filter((c) => c.kind === "turn" && c.user.includes("UPDATE the thread with where the debate has moved"));
    expect(turnCalls.length).toBeGreaterThanOrEqual(revivals.length);
  });
});

describe("parallel reply waves", () => {
  it("lively waves: seqs stay strictly increasing in emit order, adjacency holds, counts unchanged", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(5), cfg: { rounds: 1, convergence: "fixed", density: "lively" } });
    const r = await runMode(h.ctx);
    const postEvents = h.events.filter((e): e is Extract<typeof e, { type: "post" }> => e.type === "post");
    for (let i = 1; i < postEvents.length; i++) {
      expect(postEvents[i].seq).toBeGreaterThan(postEvents[i - 1].seq); // waves emit in slot order
    }
    // same shape the serial engine produced: opener + agoraReplies(5, lively)
    expect(r.posts).toBe(h.postRecs().length);
  });

  it("bustling waves never put the same voice twice in a row and never self-reply", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(6), cfg: { rounds: 1, convergence: "fixed", density: "bustling" } });
    await runMode(h.ctx);
    const recs = h.postRecs().filter((p) => p.tag.startsWith("POST") || p.tag === "REPLY");
    const bySeq = new Map(recs.map((p) => [p.seq, p]));
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].agentKey).not.toBe(recs[i - 1].agentKey);
    }
    for (const p of recs) {
      if (p.replyTo == null) continue;
      expect(bySeq.get(p.replyTo)?.agentKey).not.toBe(p.agentKey);
    }
  });

  it("Jury round 1 is parallel and still lands one blind verdict per juror, in juror order", async () => {
    const h = makeHarness({ mode: "Jury", leads: makeLeads(5), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    const verdicts = h.postRecs().filter((p) => p.tag === "VERDICT" && p.round === 1);
    expect(verdicts.length).toBe(5);
    expect(verdicts.map((v) => v.agentKey)).toEqual(h.ctx.leads.map((l) => l.key)); // juror order preserved
    for (let i = 1; i < verdicts.length; i++) expect(verdicts[i].seq).toBeGreaterThan(verdicts[i - 1].seq);
  });
});

describe("selective voting (3e budgets)", () => {
  it("a greedy voter is clamped to 2 endorsements + 1 rejection per round", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(3), crowd: makeCrowd(6),
      cfg: { rounds: 1, convergence: "fixed", density: "lively" },
      fake: {
        votesScript: (names, seqs) => names.map((voter) => ({
          voter,
          votes: seqs.slice(0, 6).map((seq, i) => ({ seq, vote: i < 4 ? "up" : "down" })), // way over budget
        })),
      },
    });
    await runMode(h.ctx);
    const byVoter = new Map<string, { up: number; down: number }>();
    for (const e of h.voteEvents()) {
      for (const v of e.votes) {
        const b = byVoter.get(v.voter_key) ?? { up: 0, down: 0 };
        if (v.vote === 1) b.up += 1; else b.down += 1;
        byVoter.set(v.voter_key, b);
      }
    }
    expect(byVoter.size).toBeGreaterThan(0);
    for (const [, b] of byVoter) {
      expect(b.up).toBeLessThanOrEqual(2);
      expect(b.down).toBeLessThanOrEqual(1);
    }
  });

  it("the close's retro slice makes a revived old post votable in the new round", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(4), crowd: makeCrowd(6), cfg: { rounds: 2, convergence: "fixed", density: "lively" } });
    await runMode(h.ctx);
    const recs = h.postRecs();
    const roundOf = new Map(recs.map((p) => [p.seq, p.round]));
    const revived = new Set(recs.filter((p) => p.round === 2 && p.replyTo != null && (roundOf.get(p.replyTo) ?? 2) < 2).map((p) => p.replyTo!));
    expect(revived.size).toBeGreaterThan(0); // precondition — a thread was revived
    // the revived old post is ON THE BALLOT of round 2's closing sweep (the
    // fake voter only ever votes the first two listed posts, so pin the offer)
    const voteCalls = h.calls.filter((c) => c.kind === "votes");
    const ballots = voteCalls.map((c) => new Set([...c.user.matchAll(/^(\d+) · /gm)].map((m) => Number(m[1]))));
    expect(ballots.some((b) => [...revived].some((s) => b.has(s)))).toBe(true);
  });
});
