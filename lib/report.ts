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
    docs: string[]; generated_at: string;
  };
  limitations: string;
}

export function reportSynthSystem(): string {
  return (
    `You are the report director for Microcosm, an agent-swarm simulation platform for real-estate decisions. ` +
    `You are given a research brief and the full transcript of a panel deliberation (posts numbered by [seq]). ` +
    `Compile the decision-grade report. Reply with ONLY a JSON object:\n` +
    `{"verdict": {"label": "THE ANSWER IN <=5 WORDS — 'GO'/'NO-GO' for feasibility briefs; NAME THE WINNING OPTION for choose-between briefs (e.g. 'INTERIOR FINISHES — NOT THE POOL')", "tone": "go|conditional|no-go|split", "headline": "one sentence — the answer, committed"},\n` +
    ` "executive_summary": "4-6 sentences a decision-maker reads first — concrete, numbers included",\n` +
    ` "dimension_scores": [{"name": "...", "score": 0-10, "note": "one line"}],   // 4-6 dimensions THIS brief actually turns on\n` +
    ` "sections": [{"question": "...", "finding": "3-5 sentences answering it", "cites": [seq, ...]}],  // EXACTLY one per question-to-resolve, in order\n` +
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
    `- Address every success criterion somewhere in the report.\n` +
    `- Write like the panel's chief of staff: specific, quantified, zero filler.`
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
