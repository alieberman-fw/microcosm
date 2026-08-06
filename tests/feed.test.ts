/**
 * Feed assembly — a web search always rides INSIDE the post it informed
 * (Adam's Chamber field report: the observer tail delivered searches AFTER
 * their posts and they stranded as standalone cards at the feed's bottom).
 */

import { describe, expect, it } from "vitest";
import { computeToolAttachment } from "@/lib/feed";

const post = (seq: number, agent: string, round = 1, author = "agent") =>
  ({ kind: "post", post: { seq, agent_key: agent, round, author } });
const tool = (agent: string, round = 1) => ({ kind: "tool", t: { agent_key: agent, round } });

describe("computeToolAttachment", () => {
  it("forward: a search before the agent's post attaches to it (the launch-stream ordering)", () => {
    const items = [tool("a"), post(10, "a"), post(11, "b")];
    const { toolsBySeq, attachedTools } = computeToolAttachment(items);
    expect(toolsBySeq.get(10)).toHaveLength(1);
    expect(attachedTools.has(0)).toBe(true);
  });

  it("BACKWARD: the observer inversion — a search AFTER the post it informed attaches to that post, not a card", () => {
    const items = [post(10, "a"), post(11, "b"), tool("a")];
    const { toolsBySeq, attachedTools } = computeToolAttachment(items);
    expect(toolsBySeq.get(10)).toHaveLength(1);
    expect(attachedTools.has(2)).toBe(true);
  });

  it("backward picks the agent's LATEST earlier post in the SAME round only", () => {
    const items = [post(5, "a", 1), post(9, "a", 2), tool("a", 2), tool("a", 1)];
    const { toolsBySeq } = computeToolAttachment(items);
    expect(toolsBySeq.get(9)).toHaveLength(1); // round-2 search → round-2 post
    expect(toolsBySeq.get(5)).toHaveLength(1); // round-1 search skips the round-2 post
  });

  it("forward wins over backward when both exist; user posts never absorb searches", () => {
    const items = [post(5, "a"), tool("a"), post(6, "a"), { kind: "post", post: { seq: 7, agent_key: "a", round: 1, author: "user" } }, tool("a")];
    const { toolsBySeq } = computeToolAttachment(items);
    expect(toolsBySeq.get(6)).toHaveLength(2); // forward attach + backward attach both land on seq 6
    expect(toolsBySeq.get(5)).toBeUndefined();
    expect(toolsBySeq.get(7)).toBeUndefined();
  });

  it("a truly orphaned search (its turn failed, no post ever) stays unattached — the honest fallback card", () => {
    const items = [post(10, "b"), tool("a")];
    const { toolsBySeq, attachedTools } = computeToolAttachment(items);
    expect(toolsBySeq.size).toBe(0);
    expect(attachedTools.size).toBe(0);
  });
});
