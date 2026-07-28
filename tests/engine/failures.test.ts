/**
 * Failure injection — the engine's error contract: turns fail LOUD after one
 * retry (never silent skipped posts), polls and the stability judge fail
 * SOFT (partial tallies, "moving" verdicts), the router falls back to
 * round-robin.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { runMode } from "@/lib/engine";
import { makeHarness, makeLeads, makeCrowd } from "../helpers/fake-anthropic";

afterEach(() => vi.restoreAllMocks());

describe("failure injection", () => {
  it("empty responses retry with ESCALATING output budgets — the thinking-drain fix", async () => {
    // the "Angela F." production failure: Sonnet 5 spent the whole 1200-token
    // budget thinking, returned zero prose, and the same-budget retry failed
    // identically. Two empties must escalate; the third attempt succeeds.
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), cfg: { rounds: 1, convergence: "fixed" },
      fake: { failure: (kind, n) => (kind === "turn" && n <= 2 ? "empty" : undefined) },
    });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(2);
    const turns = h.calls.filter((c) => c.kind === "turn");
    expect(turns).toHaveLength(4); // 2 empties + escalated success + second lead
    expect(turns[1].maxTokens).toBeGreaterThan(turns[0].maxTokens);
    expect(turns[2].maxTokens).toBeGreaterThan(turns[1].maxTokens);
  });

  it("a turn empty through the whole escalation ladder stops the run loudly, naming the agent", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), cfg: { rounds: 1, convergence: "fixed" },
      fake: { failure: (kind) => (kind === "turn" ? "empty" : undefined) },
    });
    await expect(runMode(h.ctx)).rejects.toThrow(/Al B\.'s turn failed 3 times/);
  });

  it("a single empty response is retried and the run completes", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), cfg: { rounds: 1, convergence: "fixed" },
      fake: { failure: (kind, n) => (kind === "turn" && n === 1 ? "empty" : undefined) },
    });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(2);
    // first call empty + retry + second lead = 3 turn calls
    expect(h.calls.filter((c) => c.kind === "turn")).toHaveLength(3);
  });

  it("a poll batch returning garbage JSON is dropped; the other batches still tally", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(40), cfg: { rounds: 1, convergence: "fixed" },
      fake: { failure: (kind, n) => (kind === "poll" && n === 3 ? "garbage" : undefined) }, // n=1,2 are the turns
    });
    await runMode(h.ctx);
    const s = h.events.find((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment");
    expect(s?.polled).toBe(20); // one of two 20-member batches survived
  });

  it("a poll batch that throws is caught; the worker moves on", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(2), crowd: makeCrowd(40), cfg: { rounds: 1, convergence: "fixed" },
      fake: { failure: (kind, n) => (kind === "poll" && n === 3 ? "throw" : undefined) },
    });
    await runMode(h.ctx);
    const s = h.events.find((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment");
    expect(s?.polled).toBe(20);
  });

  it("a stability judge that throws reads as 'moving' — the run continues to its rounds cap", async () => {
    const h = makeHarness({
      mode: "Roundtable", leads: makeLeads(3), cfg: { rounds: 4, convergence: "stability" },
      fake: { failure: (kind) => (kind === "judge" ? "throw" : undefined) },
    });
    const r = await runMode(h.ctx);
    expect(r).toMatchObject({ posts: 12, converged: false, stopReason: "rounds" });
  });

  it("a router that throws falls back to round-robin — Agora still fills the round", async () => {
    const h = makeHarness({
      mode: "Agora", leads: makeLeads(3), cfg: { rounds: 1, convergence: "fixed", speaker: "priority" },
      fake: { failure: (kind) => (kind === "router" ? "throw" : undefined) },
    });
    const r = await runMode(h.ctx);
    expect(r.posts).toBe(3); // opener + 2 replies, no crash
  });
});
