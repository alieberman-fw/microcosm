/**
 * The report completeness gate — a truncated synthesis once passed bracket
 * salvage and shipped a report with NO findings, NO criteria receipt, NO
 * risks. The gate makes a partial spec unshippable: it must retry instead.
 */

import { describe, it, expect } from "vitest";
import { plainSpecIncomplete, reportSpecIncomplete, synthBudgetFor } from "@/lib/report";

const complete = (): Record<string, unknown> => ({
  verdict: { label: "GO — WAIVER REQUIRED", tone: "conditional", headline: "Proceed at $34M with three conditions." },
  bottom_line: {
    answer: "Buy the mall at $34M, but only with the grocery store's lease terms fixed first.",
    changes_it: "If the grocer will not sign the waiver before closing, walk away.",
    next_step: "Open the waiver negotiation with the grocer's real estate team this week.",
  },
  executive_summary: "The panel converged on a conditional GO anchored to the co-tenancy waiver and right-sized retail across four rounds of deliberation.",
  dimension_scores: [
    { name: "DEMAND", score: 7, note: "absorption supported" },
    { name: "ENTITLEMENT", score: 6, note: "rezone path is real" },
    { name: "CAPITAL", score: 5, note: "carry is tight" },
  ],
  sections: [
    { question: "Can the dark anchor boxes be recaptured?", answer: "Yes — for $1.6-2.1M, if demolition waits for Phase 2.", finding: "The REA parking consent is absolute.", numbers: [{ label: "RECAPTURE COST", value: "$1.6-2.1M" }], cites: [3, 7] },
    { question: "Will 900 apartments absorb?", answer: "Yes, at 20-24 units/month — but at $1.95-2.05/SF, below the underwriting.", finding: "20-24 units/month is evidenced.", numbers: [], cites: [12] },
  ],
  criteria: [{ criterion: "A definitive GO or NO-GO", where: "Verdict + section 1" }],
  risks: [{ risk: "GreenLeaf termination", severity: "high", mitigation: "waiver pre-close", watch_signal: "election notice" }],
  dissents: [],
  tripwires: ["Demo bids above $19/SF kill Phase 1 economics"],
});

describe("reportSpecIncomplete", () => {
  it("accepts a complete spec (empty dissents are legitimate — never gated)", () => {
    expect(reportSpecIncomplete(complete(), { questions: 2, criteria: 1 })).toBeNull();
  });

  it("rejects the gutted-report shape from the field (findings/criteria/risks cut off)", () => {
    const gutted = complete();
    gutted.sections = [];
    delete gutted.criteria;
    gutted.risks = [];
    gutted.tripwires = [];
    expect(reportSpecIncomplete(gutted, { questions: 5, criteria: 5 })).toMatch(/findings cover 0\/5/);
  });

  it("rejects each missing pillar with a named reason", () => {
    const noVerdict = complete(); (noVerdict.verdict as { label: string }).label = "";
    expect(reportSpecIncomplete(noVerdict, { questions: 2, criteria: 1 })).toBe("missing verdict");

    const noSummary = complete(); noSummary.executive_summary = "too short";
    expect(reportSpecIncomplete(noSummary, { questions: 2, criteria: 1 })).toBe("missing executive summary");

    const noScores = complete(); noScores.dimension_scores = [{ name: "X", score: 5, note: "" }];
    expect(reportSpecIncomplete(noScores, { questions: 2, criteria: 1 })).toBe("missing dimension scores");

    const fewSections = complete(); // 2 sections vs 5 questions
    expect(reportSpecIncomplete(fewSections, { questions: 5, criteria: 1 })).toMatch(/findings cover 2\/5/);

    const noCriteria = complete(); delete noCriteria.criteria;
    expect(reportSpecIncomplete(noCriteria, { questions: 2, criteria: 3 })).toBe("missing success-criteria receipt");

    const noRisks = complete(); noRisks.risks = [];
    expect(reportSpecIncomplete(noRisks, { questions: 2, criteria: 1 })).toBe("missing risk register");

    const noTrips = complete(); noTrips.tripwires = [];
    expect(reportSpecIncomplete(noTrips, { questions: 2, criteria: 1 })).toBe("missing tripwires");

    const noBottom = complete(); delete noBottom.bottom_line;
    expect(reportSpecIncomplete(noBottom, { questions: 2, criteria: 1 })).toBe("missing bottom line");

    const noAnswers = complete();
    (noAnswers.sections as { answer?: string }[])[1].answer = "";
    expect(reportSpecIncomplete(noAnswers, { questions: 2, criteria: 1 })).toBe("sections missing direct answers");
  });

  it("no criteria expected → no criteria required; question expectation caps at 8", () => {
    const spec = complete(); delete spec.criteria;
    expect(reportSpecIncomplete(spec, { questions: 2, criteria: 0 })).toBeNull();
    const eight = complete();
    eight.sections = Array.from({ length: 8 }, (_, i) => ({ question: `Q${i}`, answer: `Direct answer ${i}.`, finding: "f", numbers: [], cites: [] }));
    expect(reportSpecIncomplete(eight, { questions: 12, criteria: 0 })).toBeNull();
  });
});

describe("plainSpecIncomplete (the translation gate)", () => {
  const plain = (): Record<string, unknown> => ({
    bottom_line: { answer: "Buy it with the lease fixed first.", changes_it: "No waiver, no deal.", next_step: "Call the grocer this week." },
    executive_summary: "The panel says buy the mall at $34M, but only after the grocery store agrees to stay under its current lease terms.",
    sections: [
      { question: "Can the empty stores be dealt with?", answer: "Yes, for about $2M.", explanation: "The old leases let us take them back if we time it right." },
      { question: "Will the apartments fill up?", answer: "Yes, over about two years.", explanation: "Similar buildings nearby filled at the same pace." },
    ],
    risks: [{ risk: "The grocer leaves", mitigation: "Get their agreement before buying", watch_signal: "They start paying reduced rent" }],
    tripwires: ["If demolition bids come in high, the first phase stops making money"],
    glossary: [{ term: "co-tenancy clause", meaning: "A lease term that lets a store pay less or leave if the mall's big stores close" }],
  });
  it("accepts a faithful translation", () => {
    expect(plainSpecIncomplete(plain(), 2)).toBeNull();
  });
  it("rejects a translation that drops sections or the bottom line", () => {
    const short = plain(); short.sections = [(short.sections as unknown[])[0]];
    expect(plainSpecIncomplete(short, 2)).toBe("covers 1/2 sections");
    const noBl = plain(); delete noBl.bottom_line;
    expect(plainSpecIncomplete(noBl, 2)).toBe("missing bottom line");
  });
});

describe("synthBudgetFor", () => {
  it("starting ceilings leave thinking headroom and scale with depth", () => {
    expect(synthBudgetFor("brief")).toBe(8000);
    expect(synthBudgetFor("standard")).toBe(16_000);
    expect(synthBudgetFor("dense")).toBe(24_000);
  });
});
