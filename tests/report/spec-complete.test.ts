/**
 * The report completeness gate — a truncated synthesis once passed bracket
 * salvage and shipped a report with NO findings, NO criteria receipt, NO
 * risks. The gate makes a partial spec unshippable: it must retry instead.
 */

import { describe, it, expect } from "vitest";
import { reportSpecIncomplete, synthBudgetFor } from "@/lib/report";

const complete = (): Record<string, unknown> => ({
  verdict: { label: "GO — WAIVER REQUIRED", tone: "conditional", headline: "Proceed at $34M with three conditions." },
  executive_summary: "The panel converged on a conditional GO anchored to the co-tenancy waiver and right-sized retail across four rounds of deliberation.",
  dimension_scores: [
    { name: "DEMAND", score: 7, note: "absorption supported" },
    { name: "ENTITLEMENT", score: 6, note: "rezone path is real" },
    { name: "CAPITAL", score: 5, note: "carry is tight" },
  ],
  sections: [
    { question: "ANCHOR RECAPTURE", finding: "The REA parking consent is absolute.", cites: [3, 7] },
    { question: "RESIDENTIAL DEMAND", finding: "20-24 units/month is evidenced.", cites: [12] },
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
  });

  it("no criteria expected → no criteria required; question expectation caps at 8", () => {
    const spec = complete(); delete spec.criteria;
    expect(reportSpecIncomplete(spec, { questions: 2, criteria: 0 })).toBeNull();
    const eight = complete();
    eight.sections = Array.from({ length: 8 }, (_, i) => ({ question: `Q${i}`, finding: "f", cites: [] }));
    expect(reportSpecIncomplete(eight, { questions: 12, criteria: 0 })).toBeNull();
  });
});

describe("synthBudgetFor", () => {
  it("starting ceilings leave thinking headroom and scale with depth", () => {
    expect(synthBudgetFor("brief")).toBe(8000);
    expect(synthBudgetFor("standard")).toBe(16_000);
    expect(synthBudgetFor("dense")).toBe(24_000);
  });
});
