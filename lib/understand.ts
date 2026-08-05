/**
 * The Understanding pass (CLAUDE.md §2 Stage 1 upgrade, next-level-plan §6b) —
 * one CASTING_MODEL-tier call over the free-form brief + document inventory
 * that produces the BRIEF CONTRACT: the structured truth of what the user
 * wants answered, plus a human-readable mirror restatement. The contract is
 * persisted at brief.contract and consumed downstream (casting today; round
 * agendas, poll plans, and report shape in 6-PR3/4). Back-compat: a brief
 * with no contract behaves exactly as before.
 *
 * Parsing and normalization are pure functions (offline-tested); the pass is
 * probabilistic by design — the WHAT I UNDERSTOOD card exists so a bad parse
 * is caught by the user in seconds, and `flags` carry the pass's OWN doubt
 * as one-tap clarifiers.
 */

import { parseLooseObject } from "@/lib/llm-json";

/** matches the casting plan budget discipline — mirror + ~8 sub-asks fits */
export const UNDERSTAND_MAX_TOKENS = 3500;

export const SUB_ASK_KINDS = ["feasibility", "demand", "pricing", "ranking", "comparison", "policy", "research", "other"] as const;
export const OUTPUT_TYPES = ["ranked_list", "matrix", "comparison", "verdict", "range", "odds", "timeline", "narrative"] as const;
export const DOC_ROLES = ["evidence", "framework", "question-source", "reference"] as const;

export interface SubAsk {
  id: string;                                   // a1, a2… stable within the contract
  ask: string;                                  // one specific thing to answer
  kind: (typeof SUB_ASK_KINDS)[number];
  evidence: string;                             // the standard the answer must meet
}

export interface OutputContract {
  type: (typeof OUTPUT_TYPES)[number];
  spec?: Record<string, unknown>;
}

export interface PopulationHints {
  /** true when the PROMPT itself describes who to simulate ("homebuyers aged
   * 35-45 in Beverly Hills") — casting honors it; false = director decides */
  described: boolean;
  cohorts: { desc: string; geography?: string }[];
  composition?: "experts" | "consumers" | "mixed";
}

export interface DocRole {
  name: string;                                 // exact filename
  role: (typeof DOC_ROLES)[number];
  note?: string;
}

export interface ClarifierFlag {
  question: string;
  options: string[];
  default: string;
  /** the user's one-tap answer; unanswered resolves to `default` */
  answer?: string;
}

export interface BriefContract {
  version: 1;
  intent: string;                               // verb-first, 3-6 words
  audience: "executive" | "technical";
  mirror: string;                               // 3-6 sentence second-person restatement
  sub_asks: SubAsk[];
  output_contracts: OutputContract[];
  entities: string[];
  constraints: string[];
  success_criteria: string[];
  population_hints: PopulationHints;
  doc_roles: DocRole[];
  flags: ClarifierFlag[];                       // 0-2, only genuine ambiguities
  derived_at: string;
  /** brief edited after derivation — card offers RE-DERIVE */
  stale?: boolean;
}

export function understandSystem(docNames: string[]): string {
  const docRule = docNames.length
    ? `- doc_roles: classify EVERY document by how it should be used — "evidence" (argue from it), "framework" (it contains instructions/standards the panel and report must FOLLOW), "question-source" (the brief itself lives in the doc), "reference" (background). Use the EXACT filenames: ${docNames.join(" · ")}. Mis-roled docs are a silent failure — when a doc contains evaluation criteria or instructions, it is "framework".\n`
    : `- doc_roles: [] (no documents uploaded).\n`;
  return (
    `You are the Understanding pass for Microcosm, an agent-swarm simulation platform for the built world. ` +
    `A user wrote a research brief — possibly multi-part, messy, or embedded in their documents. Your job is to capture EXACTLY what they want ` +
    `answered so the simulation can be held to it. Nothing the user asked for may fall out. Reply with ONLY a JSON object:\n` +
    `{"intent": "verb-first 3-6 word job summary (EVALUATE ASSET CATEGORIES / VALUE A PARCEL / STRESS-TEST DEMAND...)", ` +
    `"audience": "executive|technical", ` +
    `"mirror": "3-6 sentences, SECOND PERSON, restating what they want as a smart colleague would — concrete, no hedging, no meta-talk", ` +
    `"sub_asks": [{"ask": "one specific question the user wants answered", "kind": "feasibility|demand|pricing|ranking|comparison|policy|research|other", "evidence": "the standard the answer must meet (named sources / doc citations / defended range / plain judgment)"}], ` +
    `"output_contracts": [{"type": "ranked_list|matrix|comparison|verdict|range|odds|timeline|narrative", "spec": {}}], ` +
    `"entities": ["the nouns the brief is ABOUT — asset categories, options, places, products"], ` +
    `"constraints": ["hard limits the user stated — budget, timeline, geography, exclusions"], ` +
    `"success_criteria": ["what a decision-grade answer must deliver, from the user's own words"], ` +
    `"population_hints": {"described": true|false, "cohorts": [{"desc": "homebuyers aged 35-45", "geography": "Beverly Hills, CA"}], "composition": "experts|consumers|mixed"|null}, ` +
    `"doc_roles": [{"name": "<exact filename>", "role": "evidence|framework|question-source|reference", "note": "one short clause"}], ` +
    `"flags": [{"question": "...", "options": ["...", "..."], "default": "..."}]}\n` +
    `Rules:\n` +
    `- sub_asks: 1-8, each ONE answerable question. A multi-part brief decomposes fully — every distinct ask gets its own line. Never merge two asks.\n` +
    `- output_contracts: what SHAPE the answer takes. "which of these deserves pursuit" → ranked_list; "for each X tell me Y and Z" → matrix; a go/no-go → verdict; "what is it worth" → range. 1-3 entries, lead artifact first.\n` +
    `- population_hints: described=true ONLY when the prompt names who to simulate (a cohort, demographic, or place-bound group). Extract each cohort verbatim-faithful with its geography. described=false → cohorts [] and composition null (the Casting Director decides).\n` +
    docRule +
    `- flags: 0-2, ONLY genuine ambiguities where the wrong guess would change the answer. Each has 2-3 tap-able options and a sensible default. No flags for things you can infer.\n` +
    `- audience: "executive" unless the brief reads like it was written BY a technical specialist FOR technical specialists.\n` +
    `- mirror: user-facing prose. Everything else: tight, concrete, no filler. No prose outside the JSON.`
  );
}

const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, maxItems: number, maxLen = 200): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

/** Validate + normalize a raw parsed object into a BriefContract.
 * Gate: null when intent or sub_asks are unusable — the caller retries. */
export function normalizeContract(raw: Record<string, unknown> | null, docNames: string[], now: () => string = () => new Date().toISOString()): BriefContract | null {
  if (!raw) return null;
  const intent = str(raw.intent, 80);
  const subAsksRaw = Array.isArray(raw.sub_asks) ? raw.sub_asks : [];
  const sub_asks: SubAsk[] = [];
  for (const s of subAsksRaw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const ask = str(o.ask, 300);
    if (!ask) continue;
    const kind = SUB_ASK_KINDS.find((k) => k === o.kind) ?? "other";
    sub_asks.push({ id: `a${sub_asks.length + 1}`, ask, kind, evidence: str(o.evidence, 160) || "plain judgment" });
    if (sub_asks.length >= 8) break;
  }
  if (!intent || sub_asks.length === 0) return null;

  const output_contracts: OutputContract[] = [];
  for (const c of Array.isArray(raw.output_contracts) ? raw.output_contracts : []) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const type = OUTPUT_TYPES.find((t) => t === o.type);
    if (!type || output_contracts.some((x) => x.type === type)) continue;
    const spec = o.spec && typeof o.spec === "object" && !Array.isArray(o.spec) ? (o.spec as Record<string, unknown>) : undefined;
    output_contracts.push(spec && Object.keys(spec).length ? { type, spec } : { type });
    if (output_contracts.length >= 3) break;
  }

  const ph = raw.population_hints && typeof raw.population_hints === "object" ? (raw.population_hints as Record<string, unknown>) : {};
  const cohorts: PopulationHints["cohorts"] = [];
  for (const c of Array.isArray(ph.cohorts) ? ph.cohorts : []) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const desc = str(o.desc, 160);
    if (!desc) continue;
    const geography = str(o.geography, 120);
    cohorts.push(geography ? { desc, geography } : { desc });
    if (cohorts.length >= 4) break;
  }
  // described is EARNED by actual cohorts, never asserted bare — a true flag
  // with nothing extracted would silently constrain casting with nothing
  const composition = (["experts", "consumers", "mixed"] as const).find((x) => x === ph.composition);
  const population_hints: PopulationHints = {
    described: ph.described === true && cohorts.length > 0,
    cohorts: ph.described === true ? cohorts : [],
    ...(composition ? { composition } : {}),
  };

  const nameSet = new Set(docNames);
  const doc_roles: DocRole[] = [];
  for (const d of Array.isArray(raw.doc_roles) ? raw.doc_roles : []) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const name = str(o.name, 200);
    const role = DOC_ROLES.find((r) => r === o.role);
    if (!name || !role || !nameSet.has(name) || doc_roles.some((x) => x.name === name)) continue;
    const note = str(o.note, 140);
    doc_roles.push(note ? { name, role, note } : { name, role });
  }
  // any doc the pass skipped defaults to evidence — nothing silently unused
  for (const name of docNames) {
    if (!doc_roles.some((d) => d.name === name)) doc_roles.push({ name, role: "evidence" });
  }

  const flags: ClarifierFlag[] = [];
  for (const f of Array.isArray(raw.flags) ? raw.flags : []) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const question = str(o.question, 200);
    const options = strList(o.options, 3, 80);
    if (!question || options.length < 2) continue;
    const def = str(o.default, 80);
    flags.push({ question, options, default: options.includes(def) ? def : options[0] });
    if (flags.length >= 2) break;
  }

  return {
    version: 1,
    intent,
    audience: raw.audience === "technical" ? "technical" : "executive",
    mirror: str(raw.mirror, 1400),
    sub_asks,
    output_contracts,
    entities: strList(raw.entities, 12, 120),
    constraints: strList(raw.constraints, 8, 200),
    success_criteria: strList(raw.success_criteria, 8, 200),
    population_hints,
    doc_roles,
    flags,
    derived_at: now(),
  };
}

/** Model text → contract (loose-JSON salvage + gate). */
export function parseContract(raw: string, docNames: string[], now?: () => string): BriefContract | null {
  return normalizeContract(parseLooseObject(raw), docNames, now);
}

/** Re-validate a user-edited contract from the client (PATCH path). Edits
 * mutate the CONTRACT — the truth — so they pass the same normalizer; the
 * mirror is marked stale-by-edit implicitly (card shows edited chips). */
export function normalizeContractEdits(raw: Record<string, unknown> | null, existing: BriefContract, docNames: string[]): BriefContract | null {
  const merged = normalizeContract(raw, docNames, () => existing.derived_at);
  if (!merged) return null;
  // flag ANSWERS survive normalization: match by question text
  for (const f of merged.flags) {
    const src = Array.isArray(raw?.flags) ? (raw!.flags as Record<string, unknown>[]).find((x) => str(x?.question, 200) === f.question) : undefined;
    const answer = str(src?.answer, 80);
    if (answer && f.options.includes(answer)) f.answer = answer;
  }
  return { ...merged, stale: existing.stale };
}

/** The casting-visible line for population hints (cast route appends it). */
export function populationHintLines(contract: BriefContract | null | undefined): string {
  const ph = contract?.population_hints;
  if (!ph?.described || !ph.cohorts.length) return "";
  return (
    `POPULATION DESCRIBED BY THE USER (honor it — seat leads and shape the crowd around exactly these cohorts):\n` +
    ph.cohorts.map((c) => `- ${c.desc}${c.geography ? ` — ${c.geography}` : ""}`).join("\n") +
    (ph.composition ? `\n- stated composition lean: ${ph.composition}` : "") +
    "\n"
  );
}
