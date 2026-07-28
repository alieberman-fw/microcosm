/**
 * Take the Floor (§2 Stage 4) — the user posts into the forum and mentioned
 * agents answer with full context. The route persists the user post; the
 * engine generates replies as ordinary posts (tag REPLY → the floor post).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { takeTheFloor, PostRec } from "@/lib/engine";
import { makeHarness, makeLeads } from "../helpers/fake-anthropic";

afterEach(() => vi.restoreAllMocks());

const transcript = (): PostRec[] => [
  { name: "Al B.", role: "Al B. role", content: "Opening read.", tag: "ROUND 1", seq: 1, agentKey: "al-b", round: 1, replyTo: null },
  { name: "Bea C.", role: "Bea C. role", content: "Counterpoint.", tag: "ROUND 1", seq: 2, agentKey: "bea-c", round: 1, replyTo: 1 },
  { name: "You", role: "Taking the floor", content: "What about the queue?", tag: "FLOOR", seq: 3, agentKey: "__user", round: 1, replyTo: null },
];

describe("takeTheFloor", () => {
  it("@mentioned agents reply to the floor post, in order", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), cfg: {} });
    const [, bea, cy] = h.ctx.leads;
    const n = await takeTheFloor(h.ctx, { posts: transcript(), floorSeq: 3, content: "What about the queue?", mentionKeys: [bea.key, cy.key] });
    expect(n).toBe(2);
    const recs = h.postRecs();
    expect(recs.map((p) => p.agentKey)).toEqual([bea.key, cy.key]);
    for (const p of recs) {
      expect(p.tag).toBe("REPLY");
      expect(p.replyTo).toBe(3);
      expect(p.seq).toBeGreaterThan(3);
    }
  });

  it("no mention: a first-name in the message picks the responder", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), cfg: {} });
    const n = await takeTheFloor(h.ctx, { posts: transcript(), floorSeq: 3, content: "Cy — does the timeline hold?", mentionKeys: [] });
    expect(n).toBe(1);
    expect(h.postRecs()[0].agentKey).toBe(h.ctx.leads[2].key);
  });

  it("no mention, no name: the router picks someone and the panel still answers", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), cfg: {} });
    const n = await takeTheFloor(h.ctx, { posts: transcript(), floorSeq: 3, content: "Does the timeline hold?", mentionKeys: [] });
    expect(n).toBe(1);
    expect(h.calls.filter((c) => c.kind === "router")).toHaveLength(1);
    expect(h.postRecs()).toHaveLength(1);
  });

  it("a router failure still yields an answer (falls back to the first lead)", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), cfg: {},
      fake: { failure: (kind) => (kind === "router" ? "throw" : undefined) },
    });
    const n = await takeTheFloor(h.ctx, { posts: transcript(), floorSeq: 3, content: "Does the timeline hold?", mentionKeys: [] });
    expect(n).toBe(1);
    expect(h.postRecs()[0].agentKey).toBe(h.ctx.leads[0].key);
  });
});
