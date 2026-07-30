/**
 * The poll instrument (3a follow-up): every crowd poll asks ONE explicit
 * brief-derived question, defines the four stances so "disengaged" stops
 * absorbing neutral answers, and hears a digest of the round it just
 * watched — movement between rounds is reaction, not sampling noise.
 */

import { describe, expect, it } from "vitest";
import { derivePollQuestion, normalizeStance, runMode } from "@/lib/engine";
import { FakeClock, makeCrowd, makeFakeAnthropic, makeHarness, makeLeads } from "../helpers/fake-anthropic";

describe("normalizeStance", () => {
  it("maps canonical stances through unchanged", () => {
    for (const s of ["support", "conditional", "oppose", "disengaged"]) {
      expect(normalizeStance(s)).toBe(s);
    }
  });

  it("maps common variants to their real stance instead of dumping into disengaged", () => {
    expect(normalizeStance("Supportive")).toBe("support");
    expect(normalizeStance("yes")).toBe("support");
    expect(normalizeStance("against")).toBe("oppose");
    expect(normalizeStance("Opposed")).toBe("oppose");
    expect(normalizeStance("depends")).toBe("conditional");
    expect(normalizeStance("conditional support")).toBe("conditional");
  });

  it("neutral/undecided reads as conditional, NOT disengaged", () => {
    expect(normalizeStance("neutral")).toBe("conditional");
    expect(normalizeStance("undecided")).toBe("conditional");
    expect(normalizeStance("unsure")).toBe("conditional");
    expect(normalizeStance("on the fence")).toBe("conditional");
  });

  it("genuine indifference still lands in disengaged", () => {
    expect(normalizeStance("indifferent")).toBe("disengaged");
    expect(normalizeStance("doesn't care")).toBe("disengaged");
  });

  it("unknowns return null so the caller can count the coercion", () => {
    expect(normalizeStance("banana")).toBeNull();
    expect(normalizeStance("")).toBeNull();
    expect(normalizeStance(undefined)).toBeNull();
  });
});

describe("poll prompt", () => {
  it("asks the explicit poll question, defines all four stances, and carries the round digest", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(8), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    const polls = h.calls.filter((c) => c.kind === "poll");
    expect(polls.length).toBeGreaterThan(0);
    for (const p of polls) {
      expect(p.system).toContain('THE POLL QUESTION: "Should the builder spend the leftover budget on the pool?"');
      expect(p.system).toContain('"support": they would say yes');
      expect(p.system).toContain('"conditional": yes, but only if');
      expect(p.system).toContain('"oppose": they would say no');
      expect(p.system).toContain("NEVER as a stand-in for neutral");
      // the poll hears the round it just watched
      expect(p.user).toContain("WHAT THE PANEL ARGUED THIS ROUND:");
      expect(p.user).toContain("MEMBERS TO POLL:");
    }
  });

  it("sentiment events carry the question for the run screen and the report", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(4), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    const sents = h.events.filter((e) => e.type === "sentiment");
    expect(sents.length).toBeGreaterThan(0);
    for (const s of sents) {
      expect((s as { question?: string }).question).toBe("Should the builder spend the leftover budget on the pool?");
    }
  });
});

describe("derivePollQuestion", () => {
  it("returns the model's one-line proposition and prompts for a supportable question", async () => {
    const clock = new FakeClock();
    const { client, calls } = makeFakeAnthropic(clock);
    const q = await derivePollQuestion(client, "claude-haiku-4-5", "Should we rezone the mall site?", async () => {});
    expect(q).toBe("Should the town let the project go ahead?");
    expect(calls[0].kind).toBe("pollq");
    expect(calls[0].system).toContain("SUPPORT or OPPOSE");
  });

  it("falls back to the raw problem on API failure — the poll never blocks a run", async () => {
    const clock = new FakeClock();
    const { client } = makeFakeAnthropic(clock, { failure: () => "throw" });
    const q = await derivePollQuestion(client, "claude-haiku-4-5", "Should we rezone the mall site?", async () => {});
    expect(q).toBe("Should we rezone the mall site?");
  });

  it("falls back to the raw problem on an empty response", async () => {
    const clock = new FakeClock();
    const { client } = makeFakeAnthropic(clock, { failure: (k) => (k === "pollq" ? "empty" : undefined) });
    const q = await derivePollQuestion(client, "claude-haiku-4-5", "Should we rezone the mall site?", async () => {});
    expect(q).toBe("Should we rezone the mall site?");
  });
});
