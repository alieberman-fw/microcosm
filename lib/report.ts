/**
 * Report engine (CLAUDE.md §8) — the Desk stage that turns a persisted
 * transcript into the demo Stage 04 report grammar. Structure always comes
 * from the brief's questions-to-resolve + success criteria, never a fixed
 * template. Every number must trace to a post, a document, or a poll —
 * the verifier pass (§4.1) audits numeric claims against the corpus.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { parseLooseObject } from "@/lib/llm-json";

export const REPORT_VERSION = 1;

export interface ReportCite { seq: number }

/** 3b — the report lead matches the ASK. `decision` keeps today's verdict
 *  chip; `key_finding` is the universal catch-all (any brief that isn't a
 *  decision/valuation/hearing gets a committed most-important-conclusion
 *  headline — nothing falls outside the system); `price_range` leads
 *  valuations with a defended band + walk-away marker; `approval_odds`
 *  leads hearings. Commitment is mandatory in every kind. */
export type ReportLeadKind = "decision" | "key_finding" | "price_range" | "approval_odds";

export interface ReportLead {
  kind: ReportLeadKind;
  /* key_finding */
  finding?: string;                                   // the committed conclusion — a claim someone could disagree with
  so_what?: string;                                   // one line: what to do with it
  magnitude?: { label: string; value: string }[];     // up to 3 numbers that carry the finding
  /** Wave 4b fact gate: the posts the lead figure(s) come from */
  cites?: number[];
  /* price_range */
  currency?: string;                                  // assembly-set ("$")
  low?: number; high?: number; point?: number;        // plain numbers; point = central estimate
  walk_away?: { value: number; label: string };       // assembled from the draft's flat walk_away_value/label
  basis?: string;                                     // the methods triangulated
  /* approval_odds */
  odds?: number;                                      // 0–100
  band?: "likely" | "toss-up" | "unlikely";
  drivers?: string[];                                 // 2–3 things that move the odds
}

/** 6-PR4 (§6e) — contract-driven answer ARTIFACTS, kept FLAT (the 3b
 *  schema-budget lesson): one generic table-ish shape renders three ways.
 *  ranked_list: rows in rank order, label = "#n · entity", cells[0] = the
 *  verdict clause, note = rationale. matrix: columns = the brief's criteria,
 *  one row per entity, cells aligned to columns (short verdicts). comparison:
 *  columns = ["PROS","CONS","BOTTOM LINE"], one row per option. */
export interface ReportBlock {
  kind: "ranked_list" | "matrix" | "comparison";
  title: string;
  columns: string[];
  rows: { label: string; cells: string[]; note?: string; cites?: number[] }[];
}

export interface ReportSpec {
  version: number;
  /** LEGACY fallback only — renames now write the SIM's config.name (one
   *  name everywhere); display resolves sim name → contract title → this */
  name?: string;
  verdict: { label: string; tone: "go" | "conditional" | "no-go" | "split"; headline: string };
  /** the typed lead visual (3b) — absent on pre-3b reports, which render as `decision` */
  lead?: ReportLead;
  /** three plain sentences a non-specialist reads first: the answer, the one
   *  thing that would change it, and what to do next (3a report overhaul) */
  bottom_line?: { answer: string; changes_it: string; next_step: string };
  executive_summary: string;
  dimension_scores: { name: string; score: number; note: string; cites?: number[] }[];
  /** answer-first sections: `answer` directly answers the question AS ASKED;
   *  `finding` is the supporting argument; `numbers` are the key figures */
  sections: { question: string; answer?: string; finding: string; numbers?: { label: string; value: string; cites?: number[] }[]; cites: number[] }[];
  /** 6-PR4 — the answer's shape as artifacts (ranked list / matrix /
   *  comparison), required by the contract's output_contracts */
  blocks?: ReportBlock[];
  /** 6-PR4 (§6f) — which voice LEADS the report (from the contract); the
   *  executive register opens in the plain view, technical opens expert */
  audience?: "executive" | "technical";
  /** 6-PR4 (§6e) — the answer-completeness judge's receipt: did the draft
   *  answer every contract line, and what did the repair pass fix */
  judge?: { pass: boolean; fixed: number; notes?: string[]; rejudged?: boolean };
  /** Wave 4b fact gate: how many figures carry citations */
  fact_gate?: { figures: number; cited: number };
  /** success-criteria delivery map — the brief's bar, checked off explicitly */
  criteria?: { criterion: string; where: string }[];
  risks: { risk: string; severity: "high" | "medium" | "low"; mitigation: string; watch_signal: string }[];
  dissents: { name: string; role: string; position: string; quote: string; seq: number }[];
  tripwires: string[];
  /** 6-PR3: each poll carries its own question/options/angle — adaptive
   *  plans vary the instrument across the run, and the trend slider groups
   *  by angle so percentages always share a referent */
  sentiment?: { round: number; polled: number; dist: Record<string, number>; ballots?: { name: string; stance: string }[]; question?: string; options?: string[]; labels?: Record<string, string>; angle?: string }[];
  poll_question?: string; // what the LAST crowd poll asked (engine-derived from the brief or the plan's closing angle)
  poll_options?: string[]; // choice instrument (PR-B): the alternatives the LAST poll chose among; absent = proposition
  /** question-matched answer labels for the last poll's stance buckets
   *  ("Yes — would consider selling" instead of SUPPORT); absent = classic */
  poll_labels?: Record<string, string>;
  /** 3d — tool usage frozen with the report: how many calls, and the deduped
   *  web sources the panel actually used (the traceability appendix) */
  tool_calls?: number;
  web_sources?: { title: string; url: string; uses: number }[];
  /** PR-A — uploaded files the DECISION turned on (the winning listing photo,
   *  the key plan page): picked by the synthesizer by filename, resolved to
   *  storage paths at assembly, signed for display at view time */
  media?: { name: string; caption: string; kind: "image" | "document"; path: string }[];
  /** frozen at synthesis — the report survives re-runs and re-casts intact */
  transcript?: { seq: number; name: string; role: string; initials: string; adversarial: boolean; tag: string; content: string; round: number }[];
  cast?: { name: string; role: string; kind: string; provenance: string; adversarial: boolean }[];
  run_config?: { mode: string; rounds: number; max_posts: number; speaker: string; convergence: string; temperature: string; tier: string; verifier: boolean };
  verification?: { checks: number; supported: number; contradicted: number; unverifiable: number; contradictions: { claim: string; seq: number; note: string }[]; report_checks?: number; report_contradicted?: number };
  /** cached PLAIN-ENGLISH translation of this frozen spec (generated on first
   *  toggle; same answers and numbers, jargon-free — never a re-synthesis) */
  plain?: ReportPlain;
  methodology: {
    mode: string; rounds: number; leads: number; crowd: number; polls: number;
    posts: number; tier: string; models: string[]; converged: boolean;
    /** 3d — which tools this run was allowed to use (config.tools, frozen) */
    tools?: string[];
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
  sections: { question: string; answer: string; explanation: string; cites?: number[] }[];
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
  // 3b lead: when present, the kind-appropriate fields must be COMMITTED —
  // a price_range without a range or odds without a number is a hedge
  const lead = raw.lead as { kind?: unknown; finding?: unknown; low?: unknown; high?: unknown; basis?: unknown; odds?: unknown } | undefined;
  if (lead) {
    const kind = String(lead.kind ?? "");
    if (!["decision", "key_finding", "price_range", "approval_odds"].includes(kind)) return "invalid lead kind";
    if (kind === "key_finding" && (typeof lead.finding !== "string" || lead.finding.trim().length < 10)) return "lead missing its key finding";
    if (kind === "price_range") {
      const lo = Number(lead.low), hi = Number(lead.high);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) return "lead price range incomplete";
      if (typeof lead.basis !== "string" || lead.basis.trim().length === 0) return "lead price range missing its basis";
    }
    if (kind === "approval_odds") {
      const odds = Number(lead.odds);
      if (!Number.isFinite(odds) || odds < 0 || odds > 100) return "lead odds incomplete";
    }
  }
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
/** cap text at a WORD boundary with an honest ellipsis — raw .slice() shipped
 *  "thermal/interconnection risk beyond batch workl" to a live report */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

export function synthBudgetFor(length: ReportLength): number {
  // starting ceilings sized so pass 1 normally lands: adaptive thinking
  // bills against the same cap, and truncation costs a FULL retry pass —
  // a 22K dense draft truncated at 24K (~250s wasted), then a standard
  // draft needed 16,431 against 16K (~177s wasted). Ceilings are free.
  return length === "brief" ? 10_000 : length === "dense" ? 32_000 : 24_000;
}

/** structured-outputs schema for the synthesis — the API constrains the reply
 *  to this shape, so "unparseable synthesis" is structurally impossible
 *  (assistant prefill is NOT supported on Opus 4.8/Sonnet 5 — this is the way) */
export const REPORT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "lead", "bottom_line", "executive_summary", "dimension_scores", "sections", "criteria", "risks", "dissents", "tripwires", "media"],
  properties: {
    verdict: {
      type: "object", additionalProperties: false, required: ["label", "tone", "headline"],
      properties: {
        label: { type: "string" },
        tone: { type: "string", enum: ["go", "conditional", "no-go", "split"] },
        headline: { type: "string" },
      },
    },
    // FLAT by necessity: the structured-outputs API has a schema complexity
    // budget and a nested lead blew it ("Schema is too complex"). band /
    // currency / magnitude are COMPUTED at assembly, never asked of the model.
    lead: {
      type: "object", additionalProperties: false, required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["decision", "key_finding", "price_range", "approval_odds"] },
        finding: { type: "string" },
        so_what: { type: "string" },
        low: { type: "number" },
        high: { type: "number" },
        point: { type: "number" },
        walk_away_value: { type: "number" },
        walk_away_label: { type: "string" },
        basis: { type: "string" },
        odds: { type: "number" },
        drivers: { type: "array", items: { type: "string" } },
        cites: { type: "array", items: { type: "integer" } },
      },
    },
    bottom_line: {
      type: "object", additionalProperties: false, required: ["answer", "changes_it", "next_step"],
      properties: { answer: { type: "string" }, changes_it: { type: "string" }, next_step: { type: "string" } },
    },
    executive_summary: { type: "string" },
    dimension_scores: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "score", "note"], properties: { name: { type: "string" }, score: { type: "number" }, note: { type: "string" }, cites: { type: "array", items: { type: "integer" } } } },
    },
    sections: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["question", "answer", "finding", "numbers", "cites"],
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          finding: { type: "string" },
          numbers: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" }, cites: { type: "array", items: { type: "integer" } } } } },
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
    // PR-A: uploaded files the decision turned on — exact filenames only;
    // kept FLAT (two string props) per the structured-outputs complexity budget
    media: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["file", "caption"], properties: { file: { type: "string" }, caption: { type: "string" } } },
    },
  },
};

/** PR-A — map the synthesizer's media picks (filenames) onto real uploaded
 *  documents. Unknown names are DROPPED, matches are case-insensitive, and
 *  the list is capped — the report can never point at a file that isn't in
 *  the corpus. Exported pure for tests. */
export function resolveReportMedia(
  raw: unknown,
  docs: { name: string; mime?: string | null; storage_path?: string | null }[],
): NonNullable<ReportSpec["media"]> {
  if (!Array.isArray(raw)) return [];
  const out: NonNullable<ReportSpec["media"]> = [];
  for (const m of raw as { file?: unknown; caption?: unknown }[]) {
    const file = String(m?.file ?? "").trim();
    if (!file) continue;
    const doc = docs.find((d) => d.name.toLowerCase() === file.toLowerCase());
    if (!doc?.storage_path) continue;
    if (out.some((x) => x.name === doc.name)) continue;
    out.push({
      name: doc.name,
      caption: String(m?.caption ?? "").slice(0, 240),
      kind: (doc.mime ?? "").startsWith("image/") ? "image" : "document",
      path: doc.storage_path,
    });
    if (out.length >= 4) break;
  }
  return out;
}

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

/** 6-PR4b (§8) — the DIRECTOR variant writes everything EXCEPT sections
 *  (drafted in parallel by section workers and provided as input); the
 *  full variant is the single-call path, unchanged. */
export function reportSynthSystem(length: ReportLength = "standard", opts?: { director?: boolean }): string {
  const director = opts?.director === true;
  return (
    `You are the report director for Microcosm, an agent-swarm simulation platform for real-estate decisions. ` +
    `You are given a research brief and the full transcript of a panel deliberation (posts numbered by [seq]). ` +
    `Compile the decision-grade report. Reply with ONLY a JSON object:\n` +
    `{"verdict": {"label": "THE ANSWER IN <=5 WORDS — 'GO'/'NO-GO' for feasibility briefs; NAME THE WINNING OPTION for choose-between briefs (e.g. 'INTERIOR FINISHES — NOT THE POOL')", "tone": "go|conditional|no-go|split", "headline": "one sentence — the answer, committed"},\n` +
    ` "lead": {"kind": "decision|key_finding|price_range|approval_odds", ...},  // the report's LEAD VISUAL — pick the kind that matches what the brief ASKS (rules below)\n` +
    ` "bottom_line": {"answer": "ONE plain sentence answering the brief — no jargon, a CEO reads only this", "changes_it": "ONE plain sentence: the single thing most likely to change this answer", "next_step": "ONE plain sentence: what to do in the next two weeks"},\n` +
    ` "executive_summary": "4-6 sentences a decision-maker reads first — concrete, numbers included",\n` +
    ` "dimension_scores": [{"name": "...", "score": 0-10, "note": "one line", "cites": [seq]}],   // 4-6 dimensions THIS brief actually turns on\n` +
    `FACT GATE (non-negotiable): every numbers entry, every dimension score, and the lead figures carry "cites" — the post seq(s) the figure actually comes from. A figure with no post source gets "cites": [] and ships marked UNSOURCED, so prefer figures the panel actually argued.\n` +
    (director
      ? `SECTION DRAFTS ARE PROVIDED in the user message — they were written in parallel by section workers and are FINAL. Do NOT emit a "sections" field; write every other field CONSISTENT with those drafts (same verdict direction, same numbers, cite the same posts where relevant).\n`
      : ` "sections": [{"question": "the user's question AS THEY ASKED IT (shorten but keep their words — never replace with an analyst label)", "answer": "1-2 sentences that DIRECTLY answer the question as asked — verdict first, then the number ('Yes — 900 units absorb, but at $1.95-2.05/SF, not the underwritten $2.05+')", "finding": "3-5 sentences of supporting argument", "numbers": [{"label": "ABSORPTION", "value": "20-24 units/mo", "cites": [seq]}], "cites": [seq, ...]}],  // one per question-to-resolve IN ORDER, THEN one per success criterion the question sections don't already fully deliver; 2-4 numbers per section ([] only if truly qualitative)\n` +
        `RANKING RULE (non-negotiable): when the brief ENUMERATES a set of items to rank, order, or compare (categories, options, sites, plans), the section answering it must place the COMPLETE ordered list in "numbers" — one entry per enumerated item, {"label": "#1", "value": "item name — one-clause reason"}, EVERY item from the brief present with an explicit position, even the ones the panel barely discussed (say so in the reason: "never debated — ranked on thesis fit alone"). A ranking that covers a subset and narrates the rest in prose FAILS the user's ask.\n`) +
    ` "criteria": [{"criterion": "the success criterion verbatim (shortened ok)", "where": "one line: which section/part of this report delivers it"}],  // one entry per success criterion — this is the delivery receipt\n` +
    ` "risks": [{"risk": "...", "severity": "high|medium|low", "mitigation": "...", "watch_signal": "the observable that says it's happening"}],\n` +
    ` "dissents": [{"name": "...", "role": "...", "position": "one line", "quote": "VERBATIM sentence from their post", "seq": N}],\n` +
    ` "tripwires": ["what would change this answer", ...],\n` +
    ` "media": [{"file": "EXACT uploaded filename", "caption": "one line: why this file carried the decision"}]}  // ONLY files the decision genuinely turned on (the winning listing photo, the plan page the panel argued over) — [] when none; max 4; never invent filenames\n\n` +
    `FILE NAMING (non-negotiable): refer to uploaded files by their EXACT filename ("1.jpg", "survey.pdf") in every headline, finding, and caption. NEVER invent your own "Image 1/2/3" numbering — when filenames contain digits, a made-up ordinal points at the WRONG file.\n` +
    `THE LEAD (the report's opening visual — its kind must match what the brief ASKS; a DECISION SHAPE HINT may be provided, but re-read the brief and trust the brief):\n` +
    `- "decision" — go/no-go, choose-between, "should we": the verdict chip carries it; emit {"kind": "decision"} with no other fields.\n` +
    `- "price_range" — "what is it worth", fair price, valuation briefs: {"kind": "price_range", "low": N, "high": N, "point": N, "walk_away_value": N, "walk_away_label": "WALK AWAY ABOVE $X", "basis": "the methods triangulated (sales comparison, residual land value, income cap)"}. Numbers are PLAIN NUMBERS in dollars (4200000, never "4.2M"). Commit to the range the transcript defends.\n` +
    `- "approval_odds" — rezonings, entitlements, hearings, "will the council/neighbors allow it": {"kind": "approval_odds", "odds": 0-100, "drivers": ["the 2-3 things that move the odds"]}. Commit to a number — 50 is a finding only when the transcript is genuinely split.\n` +
    `- "key_finding" — EVERYTHING ELSE (market simulations, "what happens if", diagnostics, open research): {"kind": "key_finding", "finding": "the single most important conclusion, committed — a claim someone could disagree with", "so_what": "one line: what to do with it"}. Never generic ("the market is complex" is a failure).\n` +
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

/* ---- 6-PR4 (§6e) — blocks + the answer-completeness judge --------------- */

/** what blocks the contract demands, rendered for the synth prompt. Only
 *  artifact-shaped contracts (ranked_list/matrix/comparison) become blocks —
 *  verdict/range/odds are already the lead's job. */
export function blocksSpecFor(
  outputContracts: { type: string }[] | undefined,
  entities: string[],
  criteria: string[],
): string | null {
  if (!outputContracts?.length) return null;
  const lines: string[] = [];
  for (const c of outputContracts) {
    if (c.type === "ranked_list" && entities.length) {
      lines.push(`- ranked_list: rank ALL of these, every one placed: ${entities.join(" · ")}`);
    } else if (c.type === "matrix" && entities.length) {
      lines.push(`- matrix: entities (${entities.join(" · ")}) × the brief's criteria${criteria.length ? ` (${criteria.slice(0, 6).join(" · ")})` : " (derive 3-5 from the brief)"} — verdict per cell`);
    } else if (c.type === "comparison" && entities.length >= 2) {
      lines.push(`- comparison: ${entities.join(" vs ")} side by side`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

/** normalize + clip the synthesizer's blocks (word-boundary, never mid-word) */
export function normalizeBlocks(raw: unknown, validSeqs?: Set<number>): ReportBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportBlock[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const kind = (["ranked_list", "matrix", "comparison"] as const).find((k) => k === o.kind);
    if (!kind) continue;
    const rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, 16).flatMap((r) => {
      if (!r || typeof r !== "object") return [];
      const ro = r as Record<string, unknown>;
      const label = clipText(String(ro.label ?? "").trim(), 90);
      if (!label) return [];
      return [{
        label,
        cells: (Array.isArray(ro.cells) ? ro.cells : []).slice(0, 8).map((c) => clipText(String(c ?? ""), 240)),
        ...(ro.note ? { note: clipText(String(ro.note), 400) } : {}),
        ...(Array.isArray(ro.cites) ? { cites: (validSeqs ? filterCites(ro.cites, validSeqs) : ro.cites.map((c) => Number(c) || 0).filter(Boolean)).slice(0, 6) } : {}),
      }];
    });
    if (!rows.length) continue;
    let columns = (Array.isArray(o.columns) ? o.columns : []).slice(0, 8).map((c) => clipText(String(c ?? ""), 60));
    // field fix: never render a column of dashes — if the synthesizer left an
    // entire column empty across every row, the column carries no information;
    // prune it (and the matching cell slot) instead of printing "—" down the page.
    const blank = (s: string | undefined) => !s || /^[-—–]+$/.test(s.trim()) || /^n\/?a$/i.test(s.trim());
    const width = Math.max(columns.length, ...rows.map((r) => r.cells.length));
    const keep: number[] = [];
    for (let ci = 0; ci < width; ci++) if (rows.some((r) => !blank(r.cells[ci]))) keep.push(ci);
    if (keep.length < width) {
      columns = keep.map((ci) => columns[ci] ?? "");
      for (const r of rows) r.cells = keep.map((ci) => r.cells[ci] ?? "");
    }
    if (!keep.length) continue; // a block with zero data columns isn't a block
    out.push({
      kind,
      title: clipText(String(o.title ?? kind.replace("_", " ")).trim() || kind, 120),
      columns,
      rows,
    });
    if (out.length >= 4) break;
  }
  return out;
}

/** 6-PR4b (§8) — the director's structured-output schema: the full report
 *  schema MINUS sections (drafted by parallel workers, merged at assembly).
 *  Derived, never hand-copied — the two schemas cannot drift. */
export const REPORT_DIRECTOR_SCHEMA: Record<string, unknown> = (() => {
  const base = REPORT_JSON_SCHEMA as { required: string[]; properties: Record<string, unknown> };
  const { sections: _sections, ...properties } = base.properties;
  return { ...REPORT_JSON_SCHEMA, required: base.required.filter((k) => k !== "sections"), properties };
})();

/** 6-PR4b — one section worker: drafts ONE question's section, in parallel
 *  with its siblings. Same section rules as the single-call path. */
export function sectionWorkerSystem(length: ReportLength = "standard"): string {
  return (
    `You are a section worker on a decision-report desk. You get the research brief, the deliberation transcript (posts numbered ` +
    `by [seq]), and ONE ASSIGNED QUESTION. Write that question's report section — and nothing else. Reply with ONLY a JSON object:\n` +
    `{"question": "the assigned question AS THE USER ASKED IT (shorten but keep their words)", ` +
    `"answer": "1-2 sentences that DIRECTLY answer it — verdict first, then the number", ` +
    `"finding": "the supporting argument from the transcript", ` +
    `"numbers": [{"label": "ABSORPTION", "value": "20-24 units/mo", "cites": [seq]}], "cites": [seq, ...]}\n` +
    `RANKING RULE (non-negotiable): if the assigned question enumerates items to rank or compare, "numbers" carries the COMPLETE ` +
    `ordered list — {"label": "#1", "value": "item — one-clause reason"}, EVERY item placed, barely-debated ones honestly noted.\n` +
    `Rules: ANSWER FIRST; every number from the transcript or the brief; cites are real post seqs that support the finding; ` +
    `commit — hedging is a product failure. ${reportDepthRule(length)}`
  );
}

/** 6-PR4: blocks synthesize in their OWN structured call — folding them into
 *  REPORT_JSON_SCHEMA blew the structured-outputs grammar budget live
 *  ("The compiled grammar is too large"), the exact failure 3b hit with the
 *  nested lead. A dedicated small schema keeps the guarantee per artifact,
 *  and this call is the beachhead for 6-PR4b's parallel-section synthesis. */
export const REPORT_BLOCKS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["kind", "title", "columns", "rows"],
        properties: {
          kind: { type: "string", enum: ["ranked_list", "matrix", "comparison"] },
          title: { type: "string" },
          columns: { type: "array", items: { type: "string" } },
          rows: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["label", "cells"],
              properties: {
                label: { type: "string" },
                cells: { type: "array", items: { type: "string" } },
                note: { type: "string" },
                cites: { type: "array", items: { type: "integer" } },
              },
            },
          },
        },
      },
    },
  },
};

export function blocksSynthSystem(blocksSpec: string): string {
  return (
    `You are the report director building the ANSWER'S ARTIFACTS for a decision report — the exact structures the brief demanded. ` +
    `You get the brief, the report's drafted answers (align with them — never contradict the report), and the transcript (posts numbered by [seq]). ` +
    `Reply with ONLY a JSON object: {"blocks": [{"kind": "ranked_list|matrix|comparison", "title": "...", "columns": ["..."], "rows": [{"label": "...", "cells": ["..."], "note": "...", "cites": [seq]}]}]}\n` +
    `BLOCKS REQUIRED (from the brief's contract — every one, complete):\n${blocksSpec}\n` +
    `Block shapes: ranked_list — rows IN RANK ORDER, label "#<rank> · <item>", cells = [one decisive verdict clause stating the judgment ITSELF, e.g. "the central mechanism — verdict hinges on the drafting" or "HOLDS — cliff confirmed at $2.1M"], note = 1-2 sentence rationale, cites = supporting post seqs; EVERY enumerated item present ("never debated — ranked on thesis fit alone" is an honest note). ` +
    `matrix — columns = the criteria; ONE row per entity; each cell a SHORT decisive verdict aligned to its column ("YES — 480V in place" / "WEAK — no comps"), never a paragraph. ` +
    `comparison — columns ["PROS", "CONS", "BOTTOM LINE"], one row per option, cells aligned (compact "·"-separated clauses).\n` +
    `NEVER open a cell with a meta-label about the answer's own quality — "COMMITTED", "ANSWERED", "DECIDED", "DEFINITIVE" are process words for YOU, not content; a cell that starts with one is a failure (field report: every ranked cell shipped as "COMMITTED — …"). State the substance directly.\n` +
    `NO EMPTY CELLS (non-negotiable): every row carries EXACTLY one cell per column and every cell is filled — never blank, never "—", never "N/A". ` +
    `Where the panel produced no direct signal for an entity × criterion, the cell still takes a position from what IS known ("UNTESTED — panel never priced it; thesis fit says marginal"). A table with holes is a product failure.\n` +
    `Every number from the transcript or the brief; cites are real post seqs. Take a position in every cell — hedges are a failure.`
  );
}

/** the judge: does the draft ANSWER every contract line? Compact input (the
 *  contract + the draft's answer-carrying parts), small verdict output. */
export function judgeSystem(): string {
  return (
    `You are the answer-completeness judge for a decision report. You get the BRIEF CONTRACT (what the user asked for) and the ` +
    `DRAFT REPORT'S ANSWERS. Judge whether the draft ANSWERS every contract line — answered means a committed verdict/number/position, ` +
    `not a mention. Checks, in order:\n` +
    `1. Every sub-ask has a section whose "answer" actually answers IT (not an adjacent question).\n` +
    `2. Every required block exists and is COMPLETE — a ranked_list must place EVERY enumerated entity; a matrix must cover every entity × criterion, ` +
    `and ANY blank, "—", or "N/A" cell is a FAILURE (the repair fills it with a committed judgment).\n` +
    `3. Where a sub-ask's evidence standard demands named sources or citations, the answering section/block carries cites.\n` +
    `4. Every success criterion's receipt points at content that genuinely delivers it.\n` +
    `Reply with ONLY a JSON object: {"pass": true|false, "failures": [{"target": "section:<the sub-ask, shortened>|block:ranked_list|block:matrix|block:comparison|criteria", ` +
    `"problem": "one line — what is missing or evasive", "must_fix": "one line — the specific repair"}]}\n` +
    `Judge strictly but honestly: a committed answer you'd personally disagree with still PASSES; an artful dodge FAILS. No prose outside the JSON.`
  );
}

export interface JudgeVerdict { pass: boolean; failures: { target: string; problem: string; must_fix: string }[] }

export function parseJudgeVerdict(raw: Record<string, unknown> | null): JudgeVerdict | null {
  if (!raw || typeof raw.pass !== "boolean") return null;
  const failures = (Array.isArray(raw.failures) ? raw.failures : []).flatMap((f) => {
    if (!f || typeof f !== "object") return [];
    const o = f as Record<string, unknown>;
    const target = String(o.target ?? "").trim().slice(0, 120);
    const problem = String(o.problem ?? "").trim().slice(0, 220);
    if (!target || !problem) return [];
    return [{ target, problem, must_fix: String(o.must_fix ?? "").trim().slice(0, 220) }];
  }).slice(0, 6);
  // an inconsistent verdict (pass but failures listed) reads as a fail —
  // the judge's own doubt is the signal
  return { pass: raw.pass === true && failures.length === 0, failures };
}

/** the repair pass regenerates ONLY the failing pieces; merge them in place.
 *  Sections match by question (case/space-insensitive) — unmatched patches
 *  append (the judge may demand a MISSING section). */
export function mergePatchedSections<T extends { question: string }>(existing: T[], patched: T[]): T[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const out = [...existing];
  for (const p of patched) {
    const i = out.findIndex((s) => norm(s.question) === norm(p.question));
    if (i >= 0) out[i] = p;
    else out.push(p);
  }
  return out;
}

/** blocks match by kind (one block per kind in practice); unmatched append */
export function mergePatchedBlocks(existing: ReportBlock[], patched: ReportBlock[]): ReportBlock[] {
  const out = [...existing];
  for (const p of patched) {
    const i = out.findIndex((b) => b.kind === p.kind);
    if (i >= 0) out[i] = p;
    else out.push(p);
  }
  return out;
}

export function judgePatchSystem(): string {
  return (
    `You are the report director repairing a decision report the completeness judge rejected. You get the brief contract, the ` +
    `transcript, the current draft's answers, and the judge's failures. Regenerate ONLY the failing pieces — repaired, complete, ` +
    `committed. Reply with ONLY a JSON object (omit keys with nothing to repair):\n` +
    `{"sections": [{"question": "...", "answer": "...", "finding": "...", "numbers": [{"label": "...", "value": "..."}], "cites": [seq]}], ` +
    `"blocks": [{"kind": "ranked_list|matrix|comparison", "title": "...", "columns": ["..."], "rows": [{"label": "...", "cells": ["..."], "note": "...", "cites": [seq]}]}]}\n` +
    `Repaired sections keep their EXACT question text (they replace in place). A repaired block must be the COMPLETE artifact, not a delta. ` +
    `Same rules as the original synthesis: commit to answers, every number from the transcript, cites are real post seqs.`
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
    `- Uploaded files keep their EXACT filenames ("1.jpg", "survey.pdf") — never a paraphrase like "the finished house"; the reader must be able to find the file.\n` +
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

/** chip label per lead kind (decision uses the verdict's own label) */
export const LEAD_KIND_LABEL: Record<ReportLeadKind, string> = {
  decision: "DECISION",
  key_finding: "KEY FINDING",
  price_range: "PRICE RANGE",
  approval_odds: "APPROVAL ODDS",
};

/** compact money formatting for lead visuals — $4.2M / $410K / $950.
 *  Exported pure for tests; unit suffixes ("/SF") are the caller's job. */
export function fmtMoney(n: number, currency = "$"): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  // one decimal while the compact value is 1-2 digits ($4.2M), none at 3 ($410K)
  const compact = (div: number, suffix: string) => {
    const v = n / div;
    const s = Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
    return `${currency}${s}${suffix}`;
  };
  if (abs >= 1e9) return compact(1e9, "B");
  if (abs >= 1e6) return compact(1e6, "M");
  if (abs >= 1e3) return compact(1e3, "K");
  return `${currency}${Math.round(n).toLocaleString()}`;
}

/* ---- 6-PR4 (§6f) — shared plain-English synthesis ------------------------
 * One implementation serves the SIMPLIFY toggle (lazy, on first click) and
 * the executive register (eager, during detached synthesis, so an
 * executive-audience report opens instantly in the plain voice). */

export async function synthesizePlain(
  anthropic: Anthropic,
  spec: ReportSpec,
  model: string,
  log: (model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => Promise<void>,
): Promise<{ plain: ReportPlain | null; lastErr: string }> {
  // translation input: the decision content of the frozen spec — never the transcript
  const input = JSON.stringify({
    verdict: spec.verdict,
    bottom_line: spec.bottom_line,
    executive_summary: spec.executive_summary,
    sections: spec.sections.map((s) => ({ question: s.question, answer: s.answer, finding: s.finding, numbers: s.numbers })),
    risks: spec.risks,
    tripwires: spec.tripwires,
    dissents: spec.dissents?.map((d) => ({ role: d.role, position: d.position })),
  });
  let lastErr = "";
  // same ceiling policy as everywhere: escalate on truncation, never accept a partial
  for (const budget of [6_000, 12_000]) {
    const t0 = Date.now();
    try {
      const res = await anthropic.messages.create({
        model,
        max_tokens: budget,
        system: reportPlainSystem(),
        messages: [{ role: "user", content: `TECHNICAL REPORT (JSON):\n${input.slice(0, 60_000)}` }],
        output_config: { format: { type: "json_schema", schema: REPORT_PLAIN_SCHEMA } },
      });
      await log(model, res.usage as { input_tokens: number; output_tokens: number }, t0, undefined, { budget });
      if (res.stop_reason === "max_tokens") { lastErr = "translation outran the ceiling"; continue; }
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const parsed = parseLooseObject(text);
      if (!parsed) { lastErr = "unparseable translation"; continue; }
      const incomplete = plainSpecIncomplete(parsed, spec.sections.length);
      if (incomplete) { lastErr = `incomplete translation — ${incomplete}`; continue; }
      const plain = parsed as unknown as ReportPlain;
      // Wave 4b (audit R-H1): the plain view keeps the evidence trail — copy
      // each section's cites from the frozen spec (translation never adds or
      // invents citations; it inherits them by position)
      plain.sections = plain.sections.map((ps, i) => {
        const c = spec.sections[i]?.cites;
        return c?.length ? { ...ps, cites: c } : ps;
      });
      return { plain, lastErr: "" };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "translation failed";
      await log(model, null, t0, lastErr);
    }
  }
  return { plain: null, lastErr };
}

/** synthesizer meta-labels that leaked into block cells (field report:
 *  every ranked cell shipped "COMMITTED — …") — the prompt now bans them,
 *  and stripping at render heals reports generated before the fix */
export const stripCellMeta = (s: string | undefined | null): string =>
  (s ?? "").replace(/^\s*(COMMITTED|ANSWERED|DECIDED|DEFINITIVE)\s*[—:–-]\s*/, "");

/** audit R-H2: report citations were never checked against the run's real
 *  post seqs — a hallucinated seq rendered as a live chip whose click did
 *  nothing. One gate, applied to every cite the assembly accepts. */
export function filterCites(cites: unknown, valid: Set<number>): number[] {
  return (Array.isArray(cites) ? cites : [])
    .map((c) => Number(c) || 0)
    .filter((c) => c > 0 && valid.has(c))
    .slice(0, 8);
}


/** audit R-H9: transcript slices were HEAD-first — on long runs the FINAL
 *  rounds (convergence, flips, closing positions) were silently the first
 *  content dropped. Middle-clip keeps the opening AND the close, with the
 *  same honest marker the analyst uses. */
export function middleClip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.55);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n[… TRANSCRIPT CLIPPED FOR LENGTH — ${text.length - max} CHARACTERS FROM THE MIDDLE OMITTED; THE OPENING AND THE CLOSING ROUNDS ARE INTACT …]\n\n${text.slice(-tail)}`;
}


/** Wave 4b (audit R-H1): the fact gate ledger — how many figures the report
 *  asserts, and how many carry a post citation. Rendered in methodology;
 *  unsourced figures get marked in the view. */
export function factGate(spec: ReportSpec): { figures: number; cited: number } {
  let figures = 0, cited = 0;
  const count = (has: boolean, c?: number[]) => { if (!has) return; figures += 1; if ((c ?? []).length > 0) cited += 1; };
  const l = spec.lead;
  if (l && (l.kind === "price_range" || l.kind === "approval_odds")) count(true, l.cites);
  for (const d of spec.dimension_scores ?? []) count(true, d.cites);
  for (const s of spec.sections ?? []) for (const n of s.numbers ?? []) count(true, (n.cites ?? []).length ? n.cites : s.cites);
  return { figures, cited };
}

/** Wave 4b (audit R-H3): the verifier's SECOND pass — the assembled report's
 *  own claims, checked against the corpus and tool findings before insert. */
export function reportVerifierSystem(): string {
  return (
    `You audit a finished decision report against its evidence. You get the report's numeric claims and the ` +
    `underlying documents/tool findings. Check up to 15 claims: does each figure appear in, or follow arithmetically ` +
    `from, the evidence? Reply ONLY JSON: {"checked": N, "contradicted": N, "contradictions": [{"claim": "...", "note": "what the evidence actually says"}]}. ` +
    `A figure attributed to the panel's own reasoning is NOT a contradiction — flag only figures that conflict with the evidence.`
  );
}
