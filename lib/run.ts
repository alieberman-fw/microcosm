/**
 * Run configuration (CLAUDE.md §4.1) — parameter ranges, defaults, the
 * pre-launch cost estimator, and mode-fit checks. All model rates live HERE
 * (never in components); update alongside Anthropic pricing changes, same
 * rule as the Monitoring spend table.
 */

import { SIM_MODES } from "@/lib/casting";

export type SimMode = (typeof SIM_MODES)[number];

export interface RunConfig {
  rounds: number;              // max discussion rounds, 1-100
  max_posts: number;           // hard budget cap, 50-10000
  speaker: "priority" | "round-robin" | "random" | "mention-driven"; // Agora only
  convergence: "stability" | "fixed" | "budget";
  temperature: "conservative" | "balanced" | "exploratory";
  tier: "economy" | "standard" | "frontier";
  verifier: boolean;
  /** how deep the synthesized report goes — auto lets the engine match the transcript */
  report_length: "auto" | "brief" | "standard" | "dense";
  /** §4.2 interaction density — how busy each round gets (replies, crossfire,
   *  counter-rebuttals, crowd interjections). Structural counts live in the
   *  DENSITY helpers below — the engine AND the estimator read the same math. */
  density: "focused" | "lively" | "bustling";
}

export const RUN_DEFAULTS: RunConfig = {
  rounds: 3,
  max_posts: 600,
  speaker: "priority",
  convergence: "stability",
  temperature: "balanced",
  tier: "standard",
  verifier: true,
  report_length: "auto",
  density: "lively",
};

/* ---- density math (single source of truth: engine + estimator + docs) ---- */

export type Density = RunConfig["density"];

/** Agora replies per round (after the opener). focused = the v1 shape. */
export function agoraReplies(leads: number, density: Density): number {
  if (density === "focused") return Math.min(Math.max(leads - 1, 2), 6);
  const n = density === "lively" ? Math.ceil(leads * 1.5) : leads * 2;
  return Math.min(Math.max(n, 2), 40);
}

/** Roundtable crossfire replies after the circuit. */
export function crossfireSlots(leads: number, density: Density): number {
  return density === "focused" ? 0 : density === "lively" ? Math.ceil(leads / 2) : leads;
}

/** Tribunal counter-volley slots after the rebuttals (alternating benches). */
export function counterSlots(density: Density): number {
  return density === "focused" ? 0 : density === "lively" ? 2 : 4;
}

/** crowd members sampled into an interjection burst after each poll. */
export function burstSize(density: Density, crowd: number): number {
  const k = density === "focused" ? 0 : density === "lively" ? 3 : 6;
  return Math.min(k, crowd);
}

/** 3e parallel reply waves — how many replies GENERATE concurrently (sharing
 *  one transcript snapshot). Field feedback (2026-08-05): runs read as "only
 *  a couple agents talking at a time" — widened lively 2→3 and bustling 3→4,
 *  and the ECONOMY tier adds +1 everywhere (speed is what that tier buys;
 *  focused keeps its pinned serial v1 rhythm outside economy). Concurrency
 *  only: post counts, budgets, seq order, and dedupe are untouched. */
export function waveWidth(density: Density, tier: RunConfig["tier"]): number {
  const base = density === "bustling" ? 4 : density === "lively" ? 3 : 1;
  return Math.min(base + (tier === "economy" ? 1 : 0), 5);
}

export const RUN_RANGES = {
  rounds: { min: 1, max: 100 },
  max_posts: { min: 50, max: 10_000 },
} as const;

/** $ per MTok — pull from the Anthropic pricing page when it changes */
const RATES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
};

/** §6.4 tier map: which model speaks for each population role */
export const TIER_MODELS: Record<RunConfig["tier"], { leads: string; crowd: string; verifier: string; synth: string; plain: string; judge: string }> = {
  // `plain` = the Plain-English report translation — a faithful rewrite, not
  // analysis, so the balanced tier serves every run tier consistently.
  // `judge` = the answer-completeness judge (6-PR4): reads the CONTRACT and
  // the draft's answers — never below Sonnet, a Haiku judge waves gaps through
  economy: { leads: "claude-haiku-4-5", crowd: "claude-haiku-4-5", verifier: "claude-haiku-4-5", synth: "claude-sonnet-5", plain: "claude-sonnet-5", judge: "claude-sonnet-5" },
  standard: { leads: "claude-sonnet-5", crowd: "claude-haiku-4-5", verifier: "claude-sonnet-5", synth: "claude-opus-4-8", plain: "claude-sonnet-5", judge: "claude-sonnet-5" },
  frontier: { leads: "claude-opus-4-8", crowd: "claude-sonnet-5", verifier: "claude-opus-4-8", synth: "claude-opus-4-8", plain: "claude-sonnet-5", judge: "claude-opus-4-8" },
};

/** rough per-call token shapes; prompt caching makes input ~0.15× effective */
const SHAPE = {
  post: { in: 6_000, out: 320 },        // lead turn: persona + transcript window + corpus refs
  poll: { in: 900, out: 90 },           // crowd sentiment poll per member per round
  verify: { in: 2_500, out: 150 },      // per numeric-claim check
  synthPerPost: { in: 350, out: 60 },   // report synthesis amortized per transcript post
  cacheFactor: 0.18,                    // effective input multiplier with a hot corpus prefix
};

export interface CostEstimate {
  posts: number;
  polls: number;
  votes: number; // vote-pass model calls
  low: number;   // dollars
  high: number;  // dollars
}

/** modes with a fixed choreography — the ROUNDS loop and stop rule don't apply */
export const FIXED_SHAPE_MODES = ["Chamber", "Desk", "Expedition"] as const;
export const isFixedShape = (mode: string) => (FIXED_SHAPE_MODES as readonly string[]).includes(mode);
/** modes that poll the crowd for sentiment (Desk/Expedition are research choreographies) */
export const POLLING_MODES = ["Agora", "Roundtable", "Tribunal", "Jury", "Chamber"] as const;

/** rounds that poll (and burst/vote) for a mode: round modes = cfg.rounds; Chamber = 2 */
export function pollingRoundsOf(mode: string, rounds: number): number {
  if (mode === "Chamber") return 2;
  return isFixedShape(mode) ? 0 : rounds;
}

/** EXACT per-round lead-post shape per mode — mirrors lib/engine.ts; the offline
 *  matrix (tests/engine) pins the engine to these same numbers. */
export function postsPerRound(mode: string, leads: number, density: Density): number {
  const L = Math.max(leads, 1);
  if (mode === "Roundtable") return L + crossfireSlots(L, density);
  if (mode === "Tribunal") {
    const bench = Math.min(3, Math.max(Math.floor(L / 2), 1));
    return bench * 2 + counterSlots(density) + 1; // args + rebuttals + counters + judge
  }
  if (mode === "Jury") return L + 1; // verdicts + tally (density never dilutes verdict integrity)
  return 1 + agoraReplies(L, density); // Agora: opener + routed replies
}

export function estimateRunCost(args: {
  leads: number;
  crowd: number;
  cfg: RunConfig;
  mode?: string;
}): CostEstimate {
  const { leads, crowd, cfg } = args;
  const mode = args.mode ?? "Agora";
  const m = TIER_MODELS[cfg.tier];
  const L = leads > 0 ? leads : 1;
  const pollRounds = pollingRoundsOf(mode, cfg.rounds);
  const interjections = pollRounds * burstSize(cfg.density, crowd);
  // fixed choreographies have their own post shapes; round modes use the shared per-round math
  const posts = Math.min(cfg.max_posts,
    (mode === "Chamber" ? L * 2 + 1
    : mode === "Desk" ? L + 1
    : mode === "Expedition" ? 5 * Math.min(3, L)
    : postsPerRound(mode, L, cfg.density) * cfg.rounds) + interjections);
  const polls = crowd > 0 ? pollRounds * crowd : 0;
  // one vote pass per polled round: leads + a crowd sample, batched ~20 voters/call
  const votersPerRound = Math.min(L + Math.min(crowd, 12), 32);
  const votes = pollRounds > 0 ? pollRounds * Math.ceil(votersPerRound / 20) : 0;
  const dollars = (model: string, calls: number, shape: { in: number; out: number }, cached = true) => {
    const r = RATES[model] ?? RATES["claude-sonnet-5"];
    const inTok = calls * shape.in * (cached ? SHAPE.cacheFactor : 1);
    const outTok = calls * shape.out;
    return (inTok / 1_000_000) * r.in + (outTok / 1_000_000) * r.out;
  };
  let mid =
    dollars(m.leads, posts, SHAPE.post) +
    dollars(m.crowd, polls, SHAPE.poll) +
    dollars(m.crowd, votes + (interjections > 0 ? pollRounds : 0), SHAPE.verify) + // vote + burst passes (Haiku-class batched)
    (cfg.verifier ? dollars(m.verifier, Math.round(posts * 0.5), SHAPE.verify) : 0) +
    dollars(m.synth, posts, SHAPE.synthPerPost);
  mid = Math.max(mid, 0.05);
  return { posts, polls, votes, low: mid * 0.7, high: mid * 1.6 };
}

export interface FitFlag { level: "warn" | "info"; text: string }

/** pre-launch sanity checks: does the cast fit the chosen choreography? */
export function modeFitFlags(args: { mode: string; leads: number; expertSide: number; residentSide: number; crowd: number }): FitFlag[] {
  const { mode, leads, expertSide, residentSide, crowd } = args;
  const flags: FitFlag[] = [];
  if (mode === "Roundtable" && leads > 12) {
    flags.push({ level: "warn", text: `ROUNDTABLE WORKS BEST AT 6–12 VOICES — ${leads} leads means long rounds. Consider trimming or switching to Agora.` });
  }
  if (mode === "Tribunal") {
    if (expertSide < 2 || residentSide < 2) {
      flags.push({ level: "warn", text: `TRIBUNAL SIDES SPLIT ${expertSide} vs ${residentSide} — the engine auto-balances the benches at launch, but adding leads to the thin side makes the opposition genuine rather than assigned.` });
    }
  }
  if (mode === "Chamber" && leads > 16) {
    flags.push({ level: "warn", text: `CHAMBER PEER-REVIEW GROWS AS N² — ${leads} leads is slow and expensive. 8–12 is the sweet spot.` });
  }
  if (mode === "Jury" && leads < 5) {
    flags.push({ level: "info", text: `JURY AGGREGATES INDEPENDENT VERDICTS — more jurors, better signal. ${leads} works; 8+ is stronger.` });
  }
  if (mode !== "Desk" && mode !== "Expedition" && crowd === 0) {
    flags.push({ level: "info", text: "NO CROWD SET — the run will be leads-only; sentiment polling needs a crowd in the totals." });
  }
  if ((mode === "Desk" || mode === "Expedition") && crowd > 0) {
    flags.push({ level: "info", text: `${mode.toUpperCase()} IS A RESEARCH CHOREOGRAPHY — the crowd isn't polled in this mode. Pick Agora, Roundtable, Tribunal, Jury, or Chamber for sentiment.` });
  }
  return flags;
}
