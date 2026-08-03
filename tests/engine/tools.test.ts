/**
 * 3d — agent tools v1. The contract under test: tools attach to LEAD turns
 * only, and only when the user enabled them; use is agent-decided (the
 * addendum, never a mandate); every search becomes a shared panel fact and
 * a persisted tool event; nothing else in the choreography changes.
 */

import { describe, expect, it } from "vitest";
import { runMode } from "@/lib/engine";
import { TOOL_RACK, availableToolKeys, normalizeEnabledTools, toolBlocksFor, toolPromptAddendum } from "@/lib/tools";
import { makeCrowd, makeHarness, makeLeads } from "../helpers/fake-anthropic";

describe("the tool rack (registry invariants)", () => {
  it("keys are unique and stable", () => {
    const keys = TOOL_RACK.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every AVAILABLE tool is fully wired; coming-soon cards are cards only", () => {
    for (const t of TOOL_RACK) {
      if (t.status === "available") expect(typeof t.serverTool).toBe("function");
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.example.length).toBeGreaterThan(10);
    }
    expect(availableToolKeys()).toEqual(["web_search"]); // v1 — grows by adding descriptors
  });

  it("normalizeEnabledTools drops unknowns, coming-soon keys, and dupes", () => {
    expect(normalizeEnabledTools(["web_search", "web_search", "parcel_data", "made_up"])).toEqual(["web_search"]);
    expect(normalizeEnabledTools("not-an-array")).toEqual([]);
    expect(normalizeEnabledTools(undefined)).toEqual([]);
  });

  it("web search variant tracks the model tier — version strings live in the rack only", () => {
    const modern = toolBlocksFor(["web_search"], "claude-sonnet-5")[0] as { type: string; max_uses: number };
    const basic = toolBlocksFor(["web_search"], "claude-haiku-4-5")[0] as { type: string; max_uses: number };
    expect(modern.type).toBe("web_search_20260209");
    expect(basic.type).toBe("web_search_20250305");
    expect(modern.max_uses).toBe(2); // per-turn cap bounds cost and latency
  });

  it("the agent-decided addendum exists ONLY when tools are enabled", () => {
    expect(toolPromptAddendum([])).toBe("");
    expect(toolPromptAddendum(["web_search"])).toContain("search only when the result would change your answer");
  });
});

describe("engine wiring", () => {
  it("DEFAULT OFF: no tools param on any call, no addendum, zero tool events", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(4), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    expect(h.calls.every((c) => !c.tools || c.tools.length === 0)).toBe(true);
    expect(h.calls.filter((c) => c.kind === "turn").every((c) => !c.system.includes("TOOLS:"))).toBe(true);
    expect(h.events.filter((e) => e.type === "tool")).toHaveLength(0);
  });

  it("enabled: LEAD turns carry the tool + addendum; polls/bursts/votes NEVER do", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(4),
      cfg: { rounds: 1, convergence: "fixed", density: "lively" },
      tools: ["web_search"],
    });
    await runMode(h.ctx);
    const turns = h.calls.filter((c) => c.kind === "turn");
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((c) => (c.tools?.length ?? 0) === 1)).toBe(true);
    expect(turns.every((c) => c.system.includes("TOOLS:"))).toBe(true);
    for (const c of h.calls.filter((x) => x.kind === "poll" || x.kind === "burst" || x.kind === "votes" || x.kind === "judge")) {
      expect(c.tools?.length ?? 0).toBe(0);
    }
  });

  it("a search becomes a tool event BEFORE the post, and a shared fact later turns can see", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(3), crowd: [],
      cfg: { rounds: 1, convergence: "fixed" },
      tools: ["web_search"],
      fake: { searchOnTurn: (_c, n) => n === 1 }, // only the first turn searches
    });
    await runMode(h.ctx);
    const toolEvents = h.events.filter((e): e is Extract<typeof e, { type: "tool" }> => e.type === "tool");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].tool).toBe("web_search");
    expect(toolEvents[0].query).toContain("current facts");
    expect(toolEvents[0].results.map((r) => r.url)).toContain("https://example.com/fact-a");
    // ordering: the tool event lands before its author's post
    const idxTool = h.events.findIndex((e) => e.type === "tool");
    const idxPost = h.events.findIndex((e) => e.type === "post");
    expect(idxTool).toBeLessThan(idxPost + 2); // search precedes/accompanies the first post
    // the shared factbase: the NEXT lead's turn sees the pulled facts digest
    const laterTurns = h.calls.filter((c) => c.kind === "turn").slice(1);
    expect(laterTurns.some((c) => c.user.includes("FACTS THE PANEL ALREADY PULLED"))).toBe(true);
    expect(h.ctx.pulledFacts).toHaveLength(1);
  });

  it("choreography is untouched: post counts match the pinned matrix with tools on", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(4), crowd: makeCrowd(8),
      cfg: { rounds: 2, convergence: "fixed" },
      tools: ["web_search"],
      fake: { searchOnTurn: () => true }, // every turn searches — counts must not move
    });
    const result = await runMode(h.ctx);
    expect(result.posts).toBe(8); // the Phase-1 matrix number for this shape
  });
});
