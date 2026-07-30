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
  /** three plain sentences a non-specialist reads first: the answer, the one
   *  thing that would change it, and what to do next (3a report overhaul) */
  bottom_line?: { answer: string; changes_it: string; next_step: string };
  executive_summary: string;
  dimension_scores: { name: string; score: number; note: string }[];
  /** answer-first sections: `answer` directly answers the question AS ASKED;
   *  `finding` is the supporting argument; `numbers` are the key figures */
  sections: { question: string; answer?: string; finding: string; numbers?: { label: string; value: string }[]; cites: number[] }[];
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
  /** cached PLAIN-ENGLISH translation of this frozen spec (generated on first
   *  toggle; same answers and numbers, jargon-free — never a re-synthesis) */
  plain?: ReportPlain;
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

/** the Plain English view — a TRANSLATION of the frozen spec for a
 *  non-technical reader: identical answers and numbers, simpler prose */
export interface ReportPlain {
  bottom_line: { answer: string; changes_it: string; next_step: string };
  executive_summary: string;
  sections: { question: string; answer: string; explanation: string }[];
  risks: { risk: string; mitigation: string; watch_signal: string }[];
  tripwires: string[];
  glossary: { term: string; meaning: string }[];
}

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
  const bl = raw.bottom_line as { answer?: unknown; changes_it?: unknown; next_step?: unknown } | undefined;
  if (!bl || [bl.answer, bl.changes_it, bl.next_step].some((x) => typeof x !== "string" || (x as string).trim().length === 0)) return "missing bottom line";
  if (typeof raw.executive_summary !== "string" || raw.executive_summary.trim().length < 40) return "missing executive summary";
  const scores = raw.dimension_scores;
  if (!Array.isArray(scores) || scores.length < 3) return "missing dimension scores";
  const sections = raw.sections;
  const wantSections = Math.min(Math.max(expected.questions, 1), 8);
  if (!Array.isArray(sections) || sections.length < wantSections) {
    return `findings cover ${Array.isArray(sections) ? sections.length : 0}/${wantSections} questions`;
  }
  // answer-first is the contract: every section must answer its question directly
  if ((sections as { answer?: unknown }[]).some((s) => typeof s.answer !== "string" || s.answer.trim().length === 0)) {
    return "sections missing direct answers";
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
  required: ["verdict", "bottom_line", "executive_summary", "dimension_scores", "sections", "criteria", "risks", "dissents", "tripwires"],
  properties: {
    verdict: {
      type: "object", additionalProperties: false, required: ["label", "tone", "headline"],
      properties: {
        label: { type: "string" },
        tone: { type: "string", enum: ["go", "conditional", "no-go", "split"] },
        headline: { type: "string" },
      },
    },
    bottom_line: {
      type: "object", additionalProperties: false, required: ["answer", "changes_it", "next_step"],
      properties: { answer: { type: "string" }, changes_it: { type: "string" }, next_step: { type: "string" } },
    },
    executive_summary: { type: "string" },
    dimension_scores: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "score", "note"], properties: { name: { type: "string" }, score: { type: "number" }, note: { type: "string" } } },
    },
    sections: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["question", "answer", "finding", "numbers", "cites"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          finding: { type: "string" },
          numbers: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } } },
          cites: { type: "array", items: { type: "integer" } },
        },
      },
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
    ` "bottom_line": {"answer": "ONE plain sentence answering the brief — no jargon, a CEO reads only this", "changes_it": "ONE plain sentence: the single thing most likely to change this answer", "next_step": "ONE plain sentence: what to do in the next two weeks"},\n` +
    ` "executive_summary": "4-6 sentences a decision-maker reads first — concrete, numbers included",\n` +
    ` "dimension_scores": [{"name": "...", "score": 0-10, "note": "one line"}],   // 4-6 dimensions THIS brief actually turns on\n` +
    ` "sections": [{"question": "the user's question AS THEY ASKED IT (shorten but keep their words — never replace with an analyst label)", "answer": "1-2 sentences that DIRECTLY answer the question as asked — verdict first, then the number ('Yes — 900 units absorb, but at $1.95-2.05/SF, not the underwritten $2.05+')", "finding": "3-5 sentences of supporting argument", "numbers": [{"label": "ABSORPTION", "value": "20-24 units/mo"}], "cites": [seq, ...]}],  // one per question-to-resolve IN ORDER, THEN one per success criterion the question sections don't already fully deliver; 2-4 numbers per section ([] only if truly qualitative)\n` +
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
    `CLARITY RULES (both audiences read this report — an analyst AND their CEO):\n` +
    `- ANSWER FIRST, everywhere: the verdict before the qualification, the conclusion before the mechanism. Never open a finding with a formula or a clause name.\n` +
    `- Short sentences: one idea per sentence, aim under 25 words. The executive summary is 2-3 SHORT sentences per thought — never one long chained sentence with nested parentheticals.\n` +
    `- Expand every acronym or term of art at first use ("REA (the reciprocal easement agreement between the mall and its anchors)"); after that, use it freely.\n` +
    `- The bottom_line is sacred plain English: no acronyms at all, no real-estate jargon — words a smart person outside the industry uses.\n` +
    `- ${reportDepthRule(length)}`
  );
}

/* ---- Plain English translation (the report toggle) ----------------------
 * A TRANSLATION of the frozen spec — never a re-synthesis. Same verdict,
 * same numbers, same section list; the prose is rewritten for a smart
 * non-specialist, with a micro-glossary for unavoidable terms. */

export const REPORT_PLAIN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["bottom_line", "executive_summary", "sections", "risks", "tripwires", "glossary"],
  properties: {
    bottom_line: {
      type: "object", additionalProperties: false, required: ["answer", "changes_it", "next_step"],
      properties: { answer: { type: "string" }, changes_it: { type: "string" }, next_step: { type: "string" } },
    },
    executive_summary: { type: "string" },
    sections: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["question", "answer", "explanation"], properties: { question: { type: "string" }, answer: { type: "string" }, explanation: { type: "string" } } },
    },
    risks: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["risk", "mitigation", "watch_signal"], properties: { risk: { type: "string" }, mitigation: { type: "string" }, watch_signal: { type: "string" } } },
    },
    tripwires: { type: "array", items: { type: "string" } },
    glossary: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["term", "meaning"], properties: { term: { type: "string" }, meaning: { type: "string" } } },
    },
  },
};

export function reportPlainSystem(): string {
  return (
    `You translate a technical real-estate simulation report into PLAIN ENGLISH for a smart reader with no real-estate background. ` +
    `You are a translator, NOT an analyst: never change an answer, a recommendation, or a number — every figure in your output must appear in the input.\n` +
    `Rules:\n` +
    `- Keep the SAME sections in the SAME order, one output section per input section, keyed to the same question.\n` +
    `- Each section: "answer" = 1-2 plain sentences that directly answer the question; "explanation" = 2-4 plain sentences of why, keeping the load-bearing numbers.\n` +
    `- No jargon, no acronyms. Where a technical term is unavoidable, use it once and add it to the glossary with a one-line everyday meaning.\n` +
    `- Risks become "what could go wrong / what we'd do about it / what to watch for" in everyday words.\n` +
    `- Tripwires become "if you see this happen, revisit the decision" sentences.\n` +
    `- Sentences under 20 words. Active voice. A busy executive should understand every line on first read.`
  );
}

/** gate for the plain translation — must mirror the expert spec's coverage */
export function plainSpecIncomplete(raw: Record<string, unknown>, expertSections: number): string | null {
  const bl = raw.bottom_line as { answer?: unknown; changes_it?: unknown; next_step?: unknown } | undefined;
  if (!bl || [bl.answer, bl.changes_it, bl.next_step].some((x) => typeof x !== "string" || (x as string).trim().length === 0)) return "missing bottom line";
  if (typeof raw.executive_summary !== "string" || raw.executive_summary.trim().length < 40) return "missing summary";
  const sections = raw.sections;
  if (!Array.isArray(sections) || sections.length < expertSections) {
    return `covers ${Array.isArray(sections) ? sections.length : 0}/${expertSections} sections`;
  }
  return null;
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
