/**
 * Forum-quality regressions (Adam's post-Phase-2 field report):
 * 1. the SAME voice posted near-identical replies back-to-back → speaker
 *    guardrails + the anti-repeat retry;
 * 2. some leads never spoke in a round → coverage beats relevance;
 * 3. votes only landed at the round close → realtime micro-passes.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { runMode, textSimilarity } from "@/lib/engine";
import { makeHarness, makeLeads, makeCrowd } from "../helpers/fake-anthropic";

afterEach(() => vi.restoreAllMocks());

describe("textSimilarity", () => {
  it("near-identical prose scores high; different arguments score low", () => {
    const a = "Grid capacity and permitting timelines are both real constraints, and the review cycles will eat six months easy.";
    expect(textSimilarity(a, a)).toBe(1);
    expect(textSimilarity(a, a + " Show me the denial rate.")).toBeGreaterThanOrEqual(0.8);
    expect(textSimilarity(a, "The pool contributes nothing to appraisal value; kitchens carry the comps.")).toBeLessThan(0.3);
    expect(textSimilarity("", a)).toBe(0);
  });
});

describe("anti-repeat (the Benjamin K. duplicate)", () => {
  it("a draft that restates the speaker's earlier post triggers ONE do-not-restate retry and emits fresh text", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), cfg: { rounds: 1, density: "lively", speaker: "round-robin" },
      fake: {
        turnText: (call, n) => {
          if (!call.system.startsWith("You are Bea C.")) return undefined;
          if (!call.user.includes("Reply to it directly")) return undefined;
          if (call.user.includes("Do NOT restate")) return `Bea concedes the queue point but raises transformer lead times — a genuinely new angle (${n}).`;
          return "Bea makes the exact same identical argument about grid capacity permitting timelines eating six months easy every single time.";
        },
      },
    });
    await runMode(h.ctx);
    const beaPosts = h.postRecs().filter((p) => p.name === "Bea C." && p.tag === "REPLY");
    expect(beaPosts.length).toBeGreaterThanOrEqual(2); // she got the mic more than once
    for (let i = 0; i < beaPosts.length; i++) {
      for (let j = i + 1; j < beaPosts.length; j++) {
        expect(textSimilarity(beaPosts[i].content, beaPosts[j].content)).toBeLessThan(0.8);
      }
    }
    expect(h.calls.some((c) => c.user.includes("Do NOT restate"))).toBe(true);
  });

  it("a retry that fails keeps the original draft rather than killing the run", async () => {
    let retried = false;
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), cfg: { rounds: 1, density: "lively", speaker: "round-robin" },
      fake: {
        turnText: (call) => {
          if (!call.system.startsWith("You are Bea C.") || !call.user.includes("Reply to it directly")) return undefined;
          return "Bea makes the exact same identical argument about grid capacity permitting timelines every single time again.";
        },
        failure: (kind, n) => {
          // throw ONLY on the dedupe-retry call
          void n;
          return undefined;
        },
      },
    });
    // make the retry throw by failing any call whose user carries the marker
    const orig = h.ctx.anthropic.beta.messages.create.bind(h.ctx.anthropic.beta.messages);
    (h.ctx.anthropic.beta.messages as { create: unknown }).create = async (p: { messages: { content: unknown }[] }) => {
      const user = JSON.stringify(p.messages);
      if (user.includes("Do NOT restate")) { retried = true; throw new Error("retry down"); }
      return orig(p as never);
    };
    const r = await runMode(h.ctx);
    expect(retried).toBe(true);
    expect(r.posts).toBe(1 + 5); // full structure — no holes
  });
});

describe("speaker guardrails + coverage", () => {
  it("never the same voice twice in a row, never a self-reply — even when the router is obsessed with one lead", async () => {
    // the fake priority router ALWAYS returns the second panelist
    const h = makeHarness({ mode: "Agora", leads: makeLeads(5), cfg: { rounds: 1, density: "lively", speaker: "priority" } });
    await runMode(h.ctx);
    const recs = h.postRecs().filter((p) => p.tag.startsWith("POST") || p.tag === "REPLY");
    const bySeq = new Map(recs.map((p) => [p.seq, p]));
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].agentKey, `posts ${recs[i - 1].seq}→${recs[i].seq} same author`).not.toBe(recs[i - 1].agentKey);
    }
    for (const p of recs) {
      if (p.replyTo == null) continue;
      expect(bySeq.get(p.replyTo)?.agentKey, `post ${p.seq} replies to itself`).not.toBe(p.agentKey);
    }
  });

  it("every lead speaks in a lively round — coverage beats relevance", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(5), cfg: { rounds: 1, density: "lively", speaker: "priority" } });
    await runMode(h.ctx);
    const authors = new Set(h.postRecs().filter((p) => p.tag.startsWith("POST") || p.tag === "REPLY").map((p) => p.agentKey));
    expect(authors.size).toBe(5);
  });
});

describe("realtime micro-votes", () => {
  it("lively: votes land every 3rd post AND at the round close, with no duplicate (post, voter) pairs", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(3), crowd: makeCrowd(20), cfg: { rounds: 1, density: "lively" } });
    await runMode(h.ctx);
    // 3 circuit + 2 crossfire = 5 substantive posts → one micro pass (at 3) + the close
    const ve = h.voteEvents();
    expect(ve.length).toBe(2);
    const pairs = new Set<string>();
    for (const e of ve) {
      for (const v of e.votes) {
        const k = `${v.seq}:${v.voter_key}`;
        expect(pairs.has(k), `duplicate vote pair ${k}`).toBe(false);
        pairs.add(k);
      }
    }
    expect(h.ctx.votedRounds.has(1)).toBe(true);
  });

  it("focused stays quiet mid-round: exactly one vote pass at the close", async () => {
    const h = makeHarness({ mode: "Roundtable", leads: makeLeads(3), crowd: makeCrowd(20), cfg: { rounds: 1, density: "focused" } });
    await runMode(h.ctx);
    expect(h.voteEvents()).toHaveLength(1);
  });

  it("research choreographies never micro-vote at any density", async () => {
    const h = makeHarness({ mode: "Desk", leads: makeLeads(4), crowd: makeCrowd(20), cfg: { density: "bustling" } });
    await runMode(h.ctx);
    expect(h.voteEvents()).toHaveLength(0);
  });
});
