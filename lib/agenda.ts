/**
 * 6-PR3 — rounds that walk the brief (docs/next-level-plan.md §6c/§6d).
 *
 * Pure math for three mechanisms, all offline-pinned:
 *  - ROUND AGENDAS: round 1 opens the full brief, middle rounds target the
 *    least-resolved sub-asks BY NAME, the final round forces synthesis. The
 *    agenda rides in the opener instruction — mode choreographies untouched.
 *  - THE RESOLUTION TRACKER: after each round a Haiku pass scores every
 *    sub-ask 0–100 ("how settled, what's missing"); parsed here, merged by
 *    the engine, surfaced as the run screen's COVERAGE strip.
 *  - THE POLL PLAN: the Understanding pass emits ≤3 poll ANGLES (each with
 *    its own instrument — proposition, choice, or none at all); rounds are
 *    assigned to angles in contiguous blocks so an angle persists ≥2 rounds
 *    before its trend renders. An EMPTY plan means the brief has no genuine
 *    sentiment surface — the crowd still interjects and votes, but no poll
 *    card exists (a missing poll reads as a decision, not a bug).
 *
 * Back-compat: no contract (or a contract without poll_plan) → the legacy
 * single launch-derived instrument, no agendas, no coverage — unchanged.
 */

export interface SubAskLite {
  id: string;
  ask: string;
}

export interface CoverageScore {
  id: string;
  ask: string;
  /** 0–100 "how settled is this sub-ask in the transcript so far" */
  score: number;
  /** what's still missing — the next agenda quotes this */
  missing: string;
}

/** question-matched ANSWER labels for the proposition buckets (poll-language
 *  fix: "SUPPORT/OPPOSE" reads wrong against "would this push you to sell?" —
 *  the labels say what each bucket MEANS as an answer to THAT question:
 *  "Yes — would consider selling" / "No — holding"). Keys never change —
 *  events, tallies, and old reports stay schema-identical. */
export interface StanceLabels {
  support: string;
  conditional: string;
  oppose: string;
  disengaged: string;
}

const STANCE_KEYS = ["support", "conditional", "oppose", "disengaged"] as const;

/** validate/clip a raw labels object — all four present and readable, or null */
export function normalizeStanceLabels(raw: unknown): StanceLabels | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<StanceLabels> = {};
  for (const k of STANCE_KEYS) {
    const v = String(o[k] ?? "").trim();
    if (v.length < 2) return null; // partial label sets read worse than none
    out[k] = v.slice(0, 44);
  }
  return out as StanceLabels;
}

export interface PollAngle {
  /** short display name for the angle — the report's trend slider groups by it */
  angle: string;
  question: string;
  instrument: "proposition" | "choice";
  /** choice instruments poll these named alternatives */
  options?: string[];
  /** proposition instruments carry answer labels matched to THIS question */
  labels?: StanceLabels;
  /** early = broad gut-read · middle = per-entity choice · late = the decision-shaped closer */
  phase: "early" | "middle" | "late";
}

const PHASE_ORDER: Record<PollAngle["phase"], number> = { early: 0, middle: 1, late: 2 };

/** which poll angle a round asks. Angles are ordered early→middle→late and
 *  assigned CONTIGUOUS blocks of rounds; every used angle gets ≥2 rounds
 *  (trend persistence) — plans richer than the run affords drop trailing
 *  angles rather than flickering. null = this run polls nothing. */
export function pollAngleForRound(plan: PollAngle[], round: number, totalRounds: number): PollAngle | null {
  if (!plan.length || round < 1) return null;
  const ordered = [...plan].sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);
  // a 1-round run still polls once; otherwise each used angle needs ≥2 rounds
  // Wave 3 (audit E-C1): floor(rounds/2) made the plan INERT at the default
  // 3 rounds (only the early gut-read ever fired) — ceil gives early+late
  const usable = Math.max(1, Math.min(ordered.length, Math.ceil(totalRounds / 2)));
  const angles = ordered.slice(0, usable);
  const base = Math.floor(totalRounds / angles.length);
  const extra = totalRounds % angles.length;
  // earlier angles absorb the remainder — the broad read gets the longer run-in
  let cursor = 0;
  for (let i = 0; i < angles.length; i++) {
    const size = base + (i < extra ? 1 : 0);
    cursor += size;
    if (round <= cursor) return angles[i];
  }
  return angles[angles.length - 1]; // rounds past the cap (budget overruns) keep the closer
}

/** trim an ask to a chip-sized label (word boundary, uppercase) */
export function askLabel(ask: string, max = 44): string {
  const clean = ask.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean.toUpperCase();
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 24)).trimEnd().toUpperCase()}…`;
}

export interface RoundAgenda {
  /** short label — round dividers and the run header carry it */
  label: string;
  /** the sentence that rides in the opener instruction */
  instruction: string;
}

/** the round's agenda. Round 1 opens the whole brief; the final round forces
 *  synthesis; middle rounds chase the least-resolved sub-asks by name (from
 *  the tracker when it has spoken, else cycling the asks in order so every
 *  sub-ask gets a named round even before coverage exists). */
export function agendaForRound(
  subAsks: SubAskLite[],
  coverage: CoverageScore[] | null,
  round: number,
  totalRounds: number,
): RoundAgenda | null {
  if (!subAsks.length || round < 1) return null;
  if (round === 1) {
    const list = subAsks.slice(0, 6).map((s, i) => `${i + 1}) ${s.ask}`).join(" ");
    return {
      label: "OPEN THE FULL BRIEF",
      instruction: `Round 1 agenda — open positions across the FULL brief. The panel must resolve, before this run ends: ${list}${subAsks.length > 6 ? " (and more)" : ""}`,
    };
  }
  if (round >= totalRounds && totalRounds >= 2) {
    return {
      label: "COMMIT — SYNTHESIZE THE ANSWER",
      instruction: `Final round agenda — COMMIT. Force the answer the brief asked for (rank, decide, price — whichever it was), close the remaining splits by name, and state your final position plainly.`,
    };
  }
  // middle rounds: the least-resolved sub-asks, by name
  const byId = new Map((coverage ?? []).map((c) => [c.id, c]));
  const scored = subAsks.map((s) => ({ s, c: byId.get(s.id) }));
  let focus: { s: SubAskLite; c?: CoverageScore }[];
  if (coverage?.length) {
    focus = [...scored].sort((a, b) => (a.c?.score ?? 0) - (b.c?.score ?? 0)).slice(0, 2);
  } else {
    // no tracker signal yet — cycle the asks so every sub-ask gets a named round
    const idx = (round - 2) % subAsks.length;
    focus = [scored[idx]];
  }
  const names = focus.map((f) => `"${f.s.ask}"`).join(" and ");
  const missing = focus.map((f) => f.c?.missing).filter(Boolean).join("; ");
  return {
    label: `FOCUS: ${askLabel(focus[0].s.ask)}`,
    instruction: `Round ${round} focus — ${names} ${coverage?.length ? "is the least-resolved part of the brief" : "has not had its round yet"}.${missing ? ` Still missing: ${missing}.` : ""} Move THIS to resolution with specifics; do not re-litigate what the panel has already settled.`,
  };
}

/** the resolution tracker's system prompt (Haiku-tier, one call per round) */
export function coverageSystem(subAsks: SubAskLite[]): string {
  return (
    `You audit a deliberation transcript against the research brief's sub-questions. For EACH sub-question, judge how SETTLED it is ` +
    `in the transcript so far. Reply with ONLY a JSON array, one object per sub-question, same order:\n` +
    `[{"id": "<the id given>", "score": 0-100, "missing": "one short clause — what is still needed for a decision-grade answer ('' when settled)"}]\n` +
    `Scoring: 0 = never addressed · 40 = mentioned, not argued · 70 = argued with evidence, gaps remain · 90+ = answered with evidence and a committed position.\n` +
    `THE SUB-QUESTIONS:\n${subAsks.map((s) => `- id ${s.id}: ${s.ask}`).join("\n")}`
  );
}

/** parse the tracker's reply (loose array, clamped, matched to known ids).
 *  Returns matched scores in sub-ask order, or null when nothing usable —
 *  the engine keeps the previous coverage rather than shipping garbage. */
export function parseCoverage(raw: unknown[], subAsks: SubAskLite[]): CoverageScore[] | null {
  if (!Array.isArray(raw)) return null;
  const byId = new Map(subAsks.map((s) => [s.id, s]));
  const out: CoverageScore[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const ask = byId.get(String(o.id ?? ""));
    if (!ask || out.some((x) => x.id === ask.id)) continue;
    const n = Number(o.score);
    out.push({
      id: ask.id,
      ask: ask.ask,
      score: Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 100) : 0,
      missing: String(o.missing ?? "").trim().slice(0, 160),
    });
  }
  if (!out.length) return null;
  // preserve sub-ask order for the strip
  out.sort((a, b) => subAsks.findIndex((s) => s.id === a.id) - subAsks.findIndex((s) => s.id === b.id));
  return out;
}
