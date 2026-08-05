/**
 * The report completeness gate — a truncated synthesis once passed bracket
 * salvage and shipped a report with NO findings, NO criteria receipt, NO
 * risks. The gate makes a partial spec unshippable: it must retry instead.
 */

import { describe, it, expect } from "vitest";
import { clipText, fmtMoney, plainSpecIncomplete, reportSpecIncomplete, resolveReportMedia, synthBudgetFor } from "@/lib/report";

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

  it("3b lead: absent lead is fine (pre-3b back-compat); a bare decision lead is fine", () => {
    const withDecision = complete();
    withDecision.lead = { kind: "decision" };
    expect(reportSpecIncomplete(withDecision, { questions: 2, criteria: 1 })).toBeNull();
  });

  it("3b lead: every kind must COMMIT — uncommitted leads are named failures", () => {
    const badKind = complete(); badKind.lead = { kind: "vibes" };
    expect(reportSpecIncomplete(badKind, { questions: 2, criteria: 1 })).toBe("invalid lead kind");

    const noFinding = complete(); noFinding.lead = { kind: "key_finding", finding: "" };
    expect(reportSpecIncomplete(noFinding, { questions: 2, criteria: 1 })).toBe("lead missing its key finding");

    const invertedRange = complete(); invertedRange.lead = { kind: "price_range", low: 5_000_000, high: 4_000_000, basis: "comps" };
    expect(reportSpecIncomplete(invertedRange, { questions: 2, criteria: 1 })).toBe("lead price range incomplete");

    const noBasis = complete(); noBasis.lead = { kind: "price_range", low: 4_000_000, high: 5_000_000, basis: "" };
    expect(reportSpecIncomplete(noBasis, { questions: 2, criteria: 1 })).toBe("lead price range missing its basis");

    const wildOdds = complete(); wildOdds.lead = { kind: "approval_odds", odds: 140 };
    expect(reportSpecIncomplete(wildOdds, { questions: 2, criteria: 1 })).toBe("lead odds incomplete");
  });

  it("3b lead: committed kinds pass", () => {
    const range = complete();
    range.lead = { kind: "price_range", currency: "$", low: 4_200_000, high: 4_600_000, point: 4_400_000, walk_away: { value: 5_100_000, label: "Walk away above $5.1M" }, basis: "sales comparison + residual land value" };
    expect(reportSpecIncomplete(range, { questions: 2, criteria: 1 })).toBeNull();

    const odds = complete();
    odds.lead = { kind: "approval_odds", odds: 62, band: "likely", drivers: ["council math", "traffic study"] };
    expect(reportSpecIncomplete(odds, { questions: 2, criteria: 1 })).toBeNull();

    const finding = complete();
    finding.lead = { kind: "key_finding", finding: "Rents fall 8-12% within a year of the rate shock.", so_what: "Delay the refinance." };
    expect(reportSpecIncomplete(finding, { questions: 2, criteria: 1 })).toBeNull();
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

describe("resolveReportMedia (PR-A — files the decision turned on)", () => {
  const docs = [
    { name: "Photo-3.jpg", mime: "image/jpeg", storage_path: "org/sim/photo-3.jpg" },
    { name: "survey.pdf", mime: "application/pdf", storage_path: "org/sim/survey.pdf" },
    { name: "orphan.png", mime: "image/png", storage_path: null },
  ];

  it("matches filenames case-insensitively and resolves kind + path", () => {
    const out = resolveReportMedia([{ file: "photo-3.JPG", caption: "The twilight shot the panel picked" }], docs);
    expect(out).toEqual([{ name: "Photo-3.jpg", caption: "The twilight shot the panel picked", kind: "image", path: "org/sim/photo-3.jpg" }]);
  });

  it("drops invented filenames, unpathed docs, and duplicates; caps at 4", () => {
    const out = resolveReportMedia([
      { file: "made-up.png", caption: "x" },
      { file: "orphan.png", caption: "no storage path" },
      { file: "survey.pdf", caption: "a" },
      { file: "SURVEY.pdf", caption: "duplicate" },
    ], docs);
    expect(out.map((m) => m.name)).toEqual(["survey.pdf"]);
    expect(out[0].kind).toBe("document");
    expect(resolveReportMedia("garbage", docs)).toEqual([]);
  });
});

describe("fmtMoney (lead visuals)", () => {
  it("compacts to K/M/B with trimmed decimals", () => {
    expect(fmtMoney(4_200_000)).toBe("$4.2M");
    expect(fmtMoney(4_000_000)).toBe("$4M");
    expect(fmtMoney(410_000)).toBe("$410K");
    expect(fmtMoney(1_250_000_000)).toBe("$1.3B");
    expect(fmtMoney(950)).toBe("$950");
  });

  it("handles currency override and garbage", () => {
    expect(fmtMoney(2_500_000, "€")).toBe("€2.5M");
    expect(fmtMoney(NaN)).toBe("—");
  });
});

describe("clipText — word-boundary truncation", () => {
  it("short text passes through; long text cuts at a word with an ellipsis, never mid-word", () => {
    expect(clipText("short and sweet", 220)).toBe("short and sweet");
    const long = "thermal and interconnection risk beyond batch workloads remains the binding constraint for every operator underwriting this category today";
    const cut = clipText(long, 60);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(61);
    const lastWord = cut.slice(0, -1).split(" ").pop()!;
    expect(long).toContain(` ${lastWord} `); // the cut ends on a REAL word
  });
});

describe("synthBudgetFor", () => {
  it("starting ceilings leave thinking headroom and scale with depth", () => {
    expect(synthBudgetFor("brief")).toBe(8000);
    expect(synthBudgetFor("standard")).toBe(16_000);
    // dense starts high: a 22K-token field draft truncated at 24K and cost a
    // full second synthesis pass — ceilings are free, truncation is not
    expect(synthBudgetFor("dense")).toBe(32_000);
  });
});
