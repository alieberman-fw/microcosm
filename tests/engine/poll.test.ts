/**
 * The poll instrument (3a follow-up): every crowd poll asks ONE explicit
 * brief-derived question, defines the four stances so "disengaged" stops
 * absorbing neutral answers, and hears a digest of the round it just
 * watched — movement between rounds is reaction, not sampling noise.
 */

import { describe, expect, it } from "vitest";
import { derivePollInstrument, normalizeChoice, normalizeStance, parsePollInstrument, runMode } from "@/lib/engine";
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

  it("C2: every individual answer survives as a ballot — count matches polled, names echo the crowd", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(8), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    const s = h.events.find((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment")!;
    expect(s.ballots).toHaveLength(s.polled);
    const crowdNames = new Set(h.ctx.crowd.map((m) => m.spec.name));
    for (const b of s.ballots!) {
      expect(crowdNames.has(b.name)).toBe(true);
      expect(["support", "conditional", "oppose", "disengaged"]).toContain(b.stance);
    }
    // the tally IS the ballots, aggregated — they can never disagree
    for (const k of Object.keys(s.dist)) {
      expect(s.ballots!.filter((b) => b.stance === k).length).toBe(s.dist[k]);
    }
  });
});

describe("derivePollInstrument", () => {
  it("returns the model's question, prompts for both instrument shapes", async () => {
    const clock = new FakeClock();
    const { client, calls } = makeFakeAnthropic(clock);
    const inst = await derivePollInstrument(client, "claude-haiku-4-5", "Should we rezone the mall site?", async () => {});
    expect(inst).toEqual({ question: "Should the town let the project go ahead?", options: [] });
    expect(calls[0].kind).toBe("pollq");
    expect(calls[0].system).toContain("SUPPORT or OPPOSE");
    expect(calls[0].system).toContain("CHOOSE AMONG named alternatives");
  });

  it("falls back to the raw problem + classic stances on API failure — the poll never blocks a run", async () => {
    const clock = new FakeClock();
    const { client } = makeFakeAnthropic(clock, { failure: () => "throw" });
    const inst = await derivePollInstrument(client, "claude-haiku-4-5", "Should we rezone the mall site?", async () => {});
    expect(inst).toEqual({ question: "Should we rezone the mall site?", options: [] });
  });

  it("falls back to the raw problem on an empty response", async () => {
    const clock = new FakeClock();
    const { client } = makeFakeAnthropic(clock, { failure: (k) => (k === "pollq" ? "empty" : undefined) });
    const inst = await derivePollInstrument(client, "claude-haiku-4-5", "Should we rezone the mall site?", async () => {});
    expect(inst.question).toBe("Should we rezone the mall site?");
  });
});

describe("parsePollInstrument (PR-B — the choice instrument)", () => {
  const FB = "the raw problem statement goes here";

  it("parses a choice instrument, preserving option order", () => {
    const out = parsePollInstrument(`{"question": "Which photo should lead the listing?", "options": ["green.png", "red.png", "blue.png"]}`, FB);
    expect(out).toEqual({ question: "Which photo should lead the listing?", options: ["green.png", "red.png", "blue.png"] });
  });

  it("salvages prose-wrapped and fenced JSON", () => {
    const out = parsePollInstrument("Here you go:\n```json\n{\"question\": \"Which floor plan fits best?\", \"options\": [\"Plan A\", \"Plan B\"]}\n```", FB);
    expect(out.options).toEqual(["Plan A", "Plan B"]);
  });

  it("caps at 5 options, dedupes case-insensitively, truncates long labels", () => {
    const out = parsePollInstrument(JSON.stringify({
      question: "Which of the seven sites should the campus take?",
      options: ["Site 1", "site 1", "Site 2", "Site 3", "Site 4", "Site 5", "Site 6", "x".repeat(80)],
    }), FB);
    expect(out.options).toEqual(["Site 1", "Site 2", "Site 3", "Site 4", "Site 5"]);
  });

  it("a lone option degrades to the classic stance poll — one choice is a proposition", () => {
    const out = parsePollInstrument(`{"question": "Should the tower go ahead as proposed?", "options": ["the tower"]}`, FB);
    expect(out.options).toEqual([]);
  });

  it("garbage and out-of-bounds questions fall back to the problem", () => {
    expect(parsePollInstrument("not json at all", FB)).toEqual({ question: FB, options: [] });
    expect(parsePollInstrument(`{"question": "short", "options": []}`, FB).question).toBe(FB);
  });
});

describe("normalizeChoice", () => {
  const OPTS = ["green.png", "red.png", "blue.png"];

  it("matches exactly, case-insensitively", () => {
    expect(normalizeChoice("green.png", OPTS)).toBe("green.png");
    expect(normalizeChoice("RED.PNG", OPTS)).toBe("red.png");
  });

  it("matches a UNIQUE containment ('the green one — green.png')", () => {
    expect(normalizeChoice("the green one — green.png", OPTS)).toBe("green.png");
    expect(normalizeChoice("blue", OPTS)).toBe("blue.png");
  });

  it("undecided variants get their own bucket; ambiguity and unknowns return null", () => {
    expect(normalizeChoice("undecided", OPTS)).toBe("undecided");
    expect(normalizeChoice("none", OPTS)).toBe("undecided");
    expect(normalizeChoice("green.png or red.png", OPTS)).toBeNull(); // two matches — never guess
    expect(normalizeChoice("banana", OPTS)).toBeNull();
    expect(normalizeChoice("", OPTS)).toBeNull();
  });
});

describe("choice-instrument polls (PR-B)", () => {
  const OPTS = ["green.png", "red.png", "blue.png"];

  it("polls the brief's actual alternatives, verbatim, and tallies by option", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(8), cfg: { rounds: 1, convergence: "fixed" }, pollOptions: OPTS });
    await runMode(h.ctx);
    const polls = h.calls.filter((c) => c.kind === "pollx");
    expect(polls.length).toBeGreaterThan(0);
    for (const p of polls) {
      expect(p.system).toContain("preference poll");
      for (const o of OPTS) expect(p.system).toContain(`- "${o}"`);
      expect(p.system).toContain("pick EXACTLY ONE");
    }
    // no classic stance poll ran
    expect(h.calls.filter((c) => c.kind === "poll").length).toBe(0);
    const s = h.events.find((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment");
    expect(s).toBeDefined();
    expect(s!.options).toEqual(OPTS);
    expect(s!.polled).toBe(8);
    // fake picks round-robin: 8 members over 3 options
    expect(s!.dist).toEqual({ "green.png": 3, "red.png": 3, "blue.png": 2 });
  });

  it("classic runs stay exactly as they were — no options field on the event", async () => {
    const h = makeHarness({ mode: "Agora", leads: makeLeads(3), crowd: makeCrowd(4), cfg: { rounds: 1, convergence: "fixed" } });
    await runMode(h.ctx);
    const s = h.events.find((e): e is Extract<typeof e, { type: "sentiment" }> => e.type === "sentiment");
    expect(s!.options).toBeUndefined();
    expect(Object.keys(s!.dist).sort()).toEqual(["conditional", "disengaged", "oppose", "support"]);
  });
});
