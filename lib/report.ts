/**
 * Report engine (CLAUDE.md §8) — the Desk stage that turns a persisted
 * transcript into the demo Stage 04 report grammar. Structure always comes
 * from the brief's questions-to-resolve + success criteria, never a fixed
 * template. Every number must trace to a post, a document, or a poll —
 * the verifier pass (§4.1) audits numeric claims against the corpus.
 */

export const REPORT_VERSION = 1;

export interface ReportCite { seq: number }

export interface ReportSpec {
  version: number;
  verdict: { label: string; tone: "go" | "conditional" | "no-go" | "split"; headline: string };
  executive_summary: string;
  dimension_scores: { name: string; score: number; note: string }[];
  sections: { question: string; finding: string; cites: number[] }[];
  /** success-criteria delivery map — the brief's bar, checked off explicitly */
  criteria?: { criterion: string; where: string }[];
  risks: { risk: string; severity: "high" | "medium" | "low"; mitigation: string; watch_signal: string }[];
  dissents: { name: string; role: string; position: string; quote: string; seq: number }[];
  tripwires: string[];
  sentiment?: { round: number; polled: number; dist: Record<string, number> }[];
  /** frozen at synthesis — the report survives re-runs and re-casts intact */
  transcript?: { seq: number; name: string; role: string; initials: string; adversarial: boolean; tag: string; content: string; round: number }[];
  cast?: { name: string; role: string; kind: string; provenance: string; adversarial: boolean }[];
  run_config?: { mode: string; rounds: number; max_posts: number; speaker: string; convergence: string; temperature: string; tier: string; verifier: boolean };
  verification?: { checks: number; supported: number; contradicted: number; unverifiable: number; contradictions: { claim: string; seq: number; note: string }[] };
  methodology: {
    mode: string; rounds: number; leads: number; crowd: number; polls: number;
    posts: number; tier: string; models: string[]; converged: boolean;
    /** why the run stopped: stability | rounds | budget | choreography */
    stop?: string;
    docs: string[]; generated_at: string;
  };
  limitations: string;
}

export type ReportLength = "brief" | "standard" | "dense";

/** Completeness gate for a synthesized spec. Truncation salvage can close the
 *  brackets on a PARTIAL JSON (a max_tokens draft once shipped a report with
 *  no findings, no criteria, no risks) — a spec that fails this gate must be
 *  RETRIED at a bigger budget, never accepted. Returns the failure reason, or
 *  null when the spec is decision-grade complete. Exported PURE for tests. */
export function reportSpecIncomplete(
  raw: Record<string, unknown>,
  expected: { questions: number; criteria: number },
): string | null {
  const verdict = raw.verdict as { label?: unknown; headline?: unknown } | undefined;
  if (!verdict || typeof verdict.label !== "string" || verdict.label.trim().length === 0) return "missing verdict";
  if (typeof raw.executive_summary !== "string" || raw.executive_summary.trim().length < 40) return "missing executive summary";
  const scores = raw.dimension_scores;
  if (!Array.isArray(scores) || scores.length < 3) return "missing dimension scores";
  const sections = raw.sections;
  const wantSections = Math.min(Math.max(expected.questions, 1), 8);
  if (!Array.isArray(sections) || sections.length < wantSections) {
    return `findings cover ${Array.isArray(sections) ? sections.length : 0}/${wantSections} questions`;
  }
  if (expected.criteria > 0) {
    const criteria = raw.criteria;
    if (!Array.isArray(criteria) || criteria.length === 0) return "missing success-criteria receipt";
  }
  if (!Array.isArray(raw.risks) || raw.risks.length === 0) return "missing risk register";
  if (!Array.isArray(raw.tripwires) || raw.tripwires.length === 0) return "missing tripwires";
  return null;
}

/** synthesis output ceiling per depth — a STARTING budget; the route escalates
 *  on max_tokens because adaptive thinking bills against the same ceiling */
export function synthBudgetFor(length: ReportLength): number {
  return length === "brief" ? 8_000 : length === "dense" ? 24_000 : 16_000;
}

/** structured-outputs schema for the synthesis — the API constrains the reply
 *  to this shape, so "unparseable synthesis" is structurally impossible
 *  (assistant prefill is NOT supported on Opus 4.8/Sonnet 5 — this is the way) */
export const REPORT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "executive_summary", "dimension_scores", "sections", "criteria", "risks", "dissents", "tripwires"],
  properties: {
    verdict: {
      type: "object", additionalProperties: false, required: ["label", "tone", "headline"],
      properties: {
        label: { type: "string" },
        tone: { type: "string", enum: ["go", "conditional", "no-go", "split"] },
        headline: { type: "string" },
      },
    },
    executive_summary: { type: "string" },
    dimension_scores: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "score", "note"], properties: { name: { type: "string" }, score: { type: "number" }, note: { type: "string" } } },
    },
    sections: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["question", "finding", "cites"], properties: { question: { type: "string" }, finding: { type: "string" }, cites: { type: "array", items: { type: "integer" } } } },
    },
    criteria: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["criterion", "where"], properties: { criterion: { type: "string" }, where: { type: "string" } } },
    },
    risks: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["risk", "severity", "mitigation", "watch_signal"], properties: { risk: { type: "string" }, severity: { type: "string", enum: ["high", "medium", "low"] }, mitigation: { type: "string" }, watch_signal: { type: "string" } } },
    },
    dissents: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "role", "position", "quote", "seq"], properties: { name: { type: "string" }, role: { type: "string" }, position: { type: "string" }, quote: { type: "string" }, seq: { type: "integer" } } },
    },
    tripwires: { type: "array", items: { type: "string" } },
  },
};

/** §4.1 REPORT LENGTH — depth instructions appended to the synth prompt */
export function reportDepthRule(length: ReportLength): string {
  if (length === "brief") {
    return `DEPTH: BRIEF — the reader wants the decision fast. Executive summary 2-3 sentences; findings 2-3 tight sentences each; 3-4 risks; 2-3 tripwires. Every word earns its place; cut anything a busy IC would skim.`;
  }
  if (length === "dense") {
    return `DEPTH: DENSE — the reader asked for the long-form memo. Executive summary 6-8 sentences; findings 6-10 sentences each carrying the full argument chain with every load-bearing number; 6-10 risks with real mitigations; 5-8 tripwires; 5-6 dimension scores with substantive notes. Use the whole transcript — quote more, compress less.`;
  }
  return `DEPTH: STANDARD — executive summary 4-6 sentences; findings 3-5 sentences each.`;
}

export function reportSynthSystem(length: ReportLength = "standard"): string {
  return (
    `You are the report director for Microcosm, an agent-swarm simulation platform for real-estate decisions. ` +
    `You are given a research brief and the full transcript of a panel deliberation (posts numbered by [seq]). ` +
    `Compile the decision-grade report. Reply with ONLY a JSON object:\n` +
    `{"verdict": {"label": "THE ANSWER IN <=5 WORDS — 'GO'/'NO-GO' for feasibility briefs; NAME THE WINNING OPTION for choose-between briefs (e.g. 'INTERIOR FINISHES — NOT THE POOL')", "tone": "go|conditional|no-go|split", "headline": "one sentence — the answer, committed"},\n` +
    ` "executive_summary": "4-6 sentences a decision-maker reads first — concrete, numbers included",\n` +
    ` "dimension_scores": [{"name": "...", "score": 0-10, "note": "one line"}],   // 4-6 dimensions THIS brief actually turns on\n` +
    ` "sections": [{"question": "...", "finding": "3-5 sentences answering it", "cites": [seq, ...]}],  // one per question-to-resolve IN ORDER, THEN one per success criterion the question sections don't already fully deliver (title it after the criterion, e.g. "PROS & CONS OF BOTH OPTIONS", "TIME ON MARKET")\n` +
    ` "criteria": [{"criterion": "the success criterion verbatim (shortened ok)", "where": "one line: which section/part of this report delivers it"}],  // one entry per success criterion — this is the delivery receipt\n` +
    ` "risks": [{"risk": "...", "severity": "high|medium|low", "mitigation": "...", "watch_signal": "the observable that says it's happening"}],\n` +
    ` "dissents": [{"name": "...", "role": "...", "position": "one line", "quote": "VERBATIM sentence from their post", "seq": N}],\n` +
    ` "tripwires": ["what would change this answer", ...]}\n\n` +
    `Non-negotiable rules:\n` +
    `- COMMIT TO AN ANSWER. The user ran this simulation to resolve a hard question, and hedging is a product failure. When the brief or success criteria ask for a definitive recommendation ("which option", "tell me whether", "a definitive answer"), the verdict label and headline MUST pick one — use tone "go" for the chosen path (or "no-go" when the answer is don't). Execution caveats belong in risks and tripwires, never in the verdict.\n` +
    `- "conditional" tone is reserved for a SPECIFIC, NAMED blocking unknown (a missing study, an unresolved approval) that genuinely prevents choosing — name the blocker in the headline and list what resolves it in tripwires. Never use conditional as a hedge on a resolvable question.\n` +
    `- "split" is rarer still: only when the transcript is irreconcilably divided — and even then the headline states which way the weight of argument leans and why.\n` +
    `- Dissent is a feature: preserve real disagreement verbatim — never average it away. A committed verdict WITH preserved dissents is the goal; dissent is not a reason to soften the verdict.\n` +
    `- Every "cites" seq must be a post that actually supports the finding. Every number in findings must appear in the transcript or the brief.\n` +
    `- The adversarial voice gets representation in dissents or risks — always.\n` +
    `- SUCCESS CRITERIA ARE THE CONTRACT: every criterion must be deliverably present — if the question sections don't cover one (pros/cons, value drivers, time-on-market, whatever the user listed), ADD a section for it. The "criteria" array is the receipt; never mark a criterion delivered by a section that doesn't actually contain it.\n` +
    `- Write like the panel's chief of staff: specific, quantified, zero filler.\n` +
    `- ${reportDepthRule(length)}`
  );
}

export function verifierSystem(): string {
  return (
    `You are the verifier for Microcosm simulation reports. You are given panel posts (numbered by [seq]) and the diligence documents. ` +
    `Extract every material NUMERIC or factual claim the panel made that the documents could confirm or refute, and check each. ` +
    `Reply with ONLY a JSON array:\n` +
    `[{"claim": "short restatement", "seq": N, "verdict": "supported|contradicted|unverifiable", "note": "one line — where the doc agrees/disagrees"}]\n` +
    `Rules: check against the DOCUMENTS only (not your own knowledge); "unverifiable" when the documents are silent; ` +
    `cap at the 25 most material claims; contradictions matter most — quote the document number that disagrees in the note.`
  );
}

export const VERDICT_STYLE: Record<ReportSpec["verdict"]["tone"], { color: string; bg: string }> = {
  go: { color: "var(--acc)", bg: "var(--acc-dim)" },
  conditional: { color: "var(--warn)", bg: "var(--warn-dim)" },
  "no-go": { color: "var(--warn)", bg: "var(--warn-dim)" },
  split: { color: "var(--t3)", bg: "var(--sf2)" },
};
