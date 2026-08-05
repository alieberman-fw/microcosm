import { describe, expect, it } from "vitest";
import {
  BriefContract, normalizeContract, normalizeContractEdits, parseContract, populationHintLines, understandSystem,
} from "@/lib/understand";

const NOW = () => "2026-08-05T00:00:00.000Z";
const DOCS = ["query.md", "market-brief.pdf"];

const full = () => ({
  intent: "Evaluate asset categories",
  audience: "technical",
  mirror: "You're deciding which categories deserve pursuit.",
  sub_asks: [
    { ask: "Does the real estate exist to buy today?", kind: "feasibility", evidence: "named sources" },
    { ask: "Who are the players in each category?", kind: "research", evidence: "doc citations" },
  ],
  output_contracts: [{ type: "ranked_list" }, { type: "matrix", spec: { items_from: "entities" } }],
  entities: ["micro-fulfillment", "edge compute"],
  constraints: ["US only"],
  success_criteria: ["a ranked list with named sources"],
  population_hints: { described: true, cohorts: [{ desc: "homebuyers aged 35-45", geography: "Beverly Hills, CA" }], composition: "mixed" },
  doc_roles: [
    { name: "query.md", role: "framework", note: "evaluation standards" },
    { name: "market-brief.pdf", role: "evidence" },
  ],
  flags: [{ question: "Include non-RE expressions?", options: ["Include them", "Real estate only"], default: "Real estate only" }],
});

describe("understandSystem", () => {
  it("names the exact files and the framework rule when docs exist", () => {
    const s = understandSystem(DOCS);
    expect(s).toContain("query.md · market-brief.pdf");
    expect(s).toContain('"framework"');
    expect(s).toContain("population_hints");
  });
  it("empties doc_roles when there are no docs", () => {
    expect(understandSystem([])).toContain("doc_roles: [] (no documents uploaded)");
  });
});

describe("normalizeContract", () => {
  it("normalizes a full object — ids assigned, roles kept, flags kept", () => {
    const c = normalizeContract(full(), DOCS, NOW)!;
    expect(c.version).toBe(1);
    expect(c.sub_asks.map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(c.audience).toBe("technical");
    expect(c.output_contracts).toEqual([{ type: "ranked_list" }, { type: "matrix", spec: { items_from: "entities" } }]);
    expect(c.population_hints).toEqual({ described: true, cohorts: [{ desc: "homebuyers aged 35-45", geography: "Beverly Hills, CA" }], composition: "mixed" });
    expect(c.doc_roles).toEqual([
      { name: "query.md", role: "framework", note: "evaluation standards" },
      { name: "market-brief.pdf", role: "evidence" },
    ]);
    expect(c.flags).toHaveLength(1);
    expect(c.derived_at).toBe(NOW());
  });

  it("gates: no intent or no usable sub_asks → null", () => {
    expect(normalizeContract({ ...full(), intent: "" }, DOCS, NOW)).toBeNull();
    expect(normalizeContract({ ...full(), sub_asks: [] }, DOCS, NOW)).toBeNull();
    expect(normalizeContract({ ...full(), sub_asks: [{ kind: "demand" }] }, DOCS, NOW)).toBeNull();
    expect(normalizeContract(null, DOCS, NOW)).toBeNull();
  });

  it("defaults: audience executive, kind other, evidence plain judgment", () => {
    const c = normalizeContract(
      { intent: "Value a parcel", sub_asks: [{ ask: "What is it worth?" }], audience: "board" },
      [], NOW,
    )!;
    expect(c.audience).toBe("executive");
    expect(c.sub_asks[0]).toEqual({ id: "a1", ask: "What is it worth?", kind: "other", evidence: "plain judgment" });
  });

  it("filters unknown output types and dedupes", () => {
    const c = normalizeContract(
      { ...full(), output_contracts: [{ type: "ranked_list" }, { type: "ranked_list" }, { type: "pie_chart" }, { type: "verdict", spec: {} }] },
      DOCS, NOW,
    )!;
    expect(c.output_contracts).toEqual([{ type: "ranked_list" }, { type: "verdict" }]);
  });

  it("population described is EARNED by cohorts, never asserted bare", () => {
    const bare = normalizeContract({ ...full(), population_hints: { described: true, cohorts: [] } }, DOCS, NOW)!;
    expect(bare.population_hints.described).toBe(false);
    const off = normalizeContract(
      { ...full(), population_hints: { described: false, cohorts: [{ desc: "renters" }], composition: "banana" } },
      DOCS, NOW,
    )!;
    expect(off.population_hints).toEqual({ described: false, cohorts: [] });
  });

  it("doc roles: unknown filenames dropped, missing docs backfilled as evidence", () => {
    const c = normalizeContract(
      { ...full(), doc_roles: [{ name: "not-a-file.pdf", role: "framework" }, { name: "query.md", role: "reference" }] },
      DOCS, NOW,
    )!;
    expect(c.doc_roles).toEqual([
      { name: "query.md", role: "reference" },
      { name: "market-brief.pdf", role: "evidence" },
    ]);
  });

  it("flags: cap 2, default must be an option, <2 options dropped", () => {
    const c = normalizeContract(
      {
        ...full(),
        flags: [
          { question: "Q1?", options: ["A", "B"], default: "Z" },
          { question: "Q2?", options: ["only one"] },
          { question: "Q3?", options: ["C", "D"], default: "D" },
          { question: "Q4?", options: ["E", "F"], default: "E" },
        ],
      },
      DOCS, NOW,
    )!;
    expect(c.flags).toEqual([
      { question: "Q1?", options: ["A", "B"], default: "A" },
      { question: "Q3?", options: ["C", "D"], default: "D" },
    ]);
  });
});

describe("parseContract — loose-JSON salvage", () => {
  it("reads the object out of surrounding prose", () => {
    const c = parseContract(`Here is the contract:\n${JSON.stringify(full())}\nDone.`, DOCS, NOW);
    expect(c?.intent).toBe("Evaluate asset categories");
  });

  it("salvages a response truncated mid-array — completed sub-asks survive", () => {
    const whole = JSON.stringify(full());
    // cut inside the SECOND sub-ask: the first, already-closed one must survive
    const cut = whole.indexOf('"Who are the players') + 10;
    const c = parseContract(whole.slice(0, cut), DOCS, NOW);
    expect(c).not.toBeNull();
    expect(c!.sub_asks).toHaveLength(1);
    expect(c!.sub_asks[0].ask).toBe("Does the real estate exist to buy today?");
  });

  it("returns null on hopeless input", () => {
    expect(parseContract("no json here", DOCS, NOW)).toBeNull();
  });
});

describe("normalizeContractEdits", () => {
  const base = (): BriefContract => normalizeContract(full(), DOCS, NOW)!;

  it("preserves derived_at + stale and re-normalizes the edit", () => {
    const existing = { ...base(), stale: true };
    const edited = { ...existing, entities: ["micro-fulfillment"], sub_asks: existing.sub_asks.slice(0, 1) };
    const c = normalizeContractEdits(edited as unknown as Record<string, unknown>, existing, DOCS)!;
    expect(c.derived_at).toBe(NOW());
    expect(c.stale).toBe(true);
    expect(c.entities).toEqual(["micro-fulfillment"]);
    expect(c.sub_asks).toHaveLength(1);
  });

  it("keeps a valid one-tap flag answer, drops an off-menu one", () => {
    const existing = base();
    const withAnswer = {
      ...existing,
      flags: [{ ...existing.flags[0], answer: "Include them" }],
    };
    const c = normalizeContractEdits(withAnswer as unknown as Record<string, unknown>, existing, DOCS)!;
    expect(c.flags[0].answer).toBe("Include them");
    const offMenu = {
      ...existing,
      flags: [{ ...existing.flags[0], answer: "Something else" }],
    };
    const c2 = normalizeContractEdits(offMenu as unknown as Record<string, unknown>, existing, DOCS)!;
    expect(c2.flags[0].answer).toBeUndefined();
  });

  it("rejects an edit that deletes every sub-ask", () => {
    const existing = base();
    expect(normalizeContractEdits({ ...existing, sub_asks: [] } as unknown as Record<string, unknown>, existing, DOCS)).toBeNull();
  });
});

describe("populationHintLines", () => {
  it("is empty without described cohorts", () => {
    expect(populationHintLines(null)).toBe("");
    const c = normalizeContract({ ...full(), population_hints: { described: false, cohorts: [] } }, DOCS, NOW)!;
    expect(populationHintLines(c)).toBe("");
  });

  it("renders the casting-visible block when the prompt described the population", () => {
    const c = normalizeContract(full(), DOCS, NOW)!;
    const lines = populationHintLines(c);
    expect(lines).toContain("POPULATION DESCRIBED BY THE USER");
    expect(lines).toContain("- homebuyers aged 35-45 — Beverly Hills, CA");
    expect(lines).toContain("stated composition lean: mixed");
  });
});
