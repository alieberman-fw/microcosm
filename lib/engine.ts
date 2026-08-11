/**
 * Engine v1 (CLAUDE.md §5/§6) — the in-app run orchestrator.
 *
 * Implements the seven interaction modes over the frozen cast, persists
 * every post/event (§6.2 shapes), polls the crowd for sentiment between
 * rounds, and streams ND-JSON to the run screen. Persona → system prompt
 * compilation is a pure function (§6.1) — prompt changes are product
 * changes; PRs must show before/after examples.
 *
 * DEVIATION NOTE (§6.3): v1 runs in-process in the Next.js route (TS), not
 * the Python swarms service — same event contract, so the Python engine
 * swaps in when runs outgrow serverless limits. Deviation recorded in
 * CLAUDE.md alongside this batch.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CoverageScore, PollAngle, StanceLabels, SubAskLite, agendaForRound, coverageSystem, normalizeStanceLabels, parseCoverage, pollAngleForRound } from "@/lib/agenda";
import { FrozenSpec } from "@/lib/casting";
import { RunConfig, TIER_MODELS, agoraReplies, burstSize, counterSlots, crossfireSlots, dedupeCites, waveWidth as waveWidthOf } from "@/lib/run";
import { parseLooseArray, parseLooseObject } from "@/lib/llm-json";
import { toolBlocksFor, toolPromptAddendum } from "@/lib/tools";

export interface EngineLead {
  key: string;
  spec: FrozenSpec;
}

export interface EngineCrowdMember {
  key: string;
  spec: FrozenSpec;
}

/** §6.2 event payloads streamed to the client and persisted to `events` */
export type EngineEvent =
  | { type: "stage"; value: "running" | "converged" | "done" | "error"; detail?: string }
  | { type: "post"; seq: number; author: string; agent_key: string; name: string; role: string; initials: string; adversarial?: boolean; thread: string; reply_to: number | null; tag: string; content: string; cites: { title: string; quote: string; url?: string }[]; round: number; phase?: string; side?: string; score?: number }
  | { type: "tool"; agent_key: string; name: string; tool: string; query: string; results: { title: string; url: string }[]; round: number }
  | { type: "presence"; agent_key: string; name: string; state: "thinking" | "speaking" | "idle" }
  | { type: "polling"; round: number; count: number }
  | { type: "sentiment"; round: number; polled: number; dist: Record<string, number>; quotes: { name: string; stance: string; quote: string }[]; question?: string; options?: string[]; ballots?: { name: string; stance: string }[]; angle?: string; coerced?: number; dropped?: number; partial?: boolean }
  | { type: "votes"; round: number; votes: { seq: number; voter_key: string; voter_name: string; voter_role: string; vote: 1 | -1 }[] }
  | { type: "convergence"; aligned: number; total: number; dissents: number; dissenters?: string[]; measured?: boolean }
  // 6-PR3 — rounds that walk the brief (§6c): the round's agenda label and
  // the resolution tracker's per-sub-ask scores (the COVERAGE strip)
  | { type: "agenda"; round: number; label: string; detail: string }
  | { type: "coverage"; round: number; scores: CoverageScore[]; stale?: boolean }
  // Wave 5a (audit E-G1): a skipped turn leaves a TRACE — the feed and the
  // telemetry both see the hole instead of silently reflowing around it
  | { type: "skip"; agent_key: string; name: string; round: number; tag: string };

export interface EngineContext {
  /** Wave 2b (E-F1): the brief contract's success criteria + constraints —
   *  compiled into every persona prompt so the panel argues toward them */
  criteria?: string[];
  constraints?: string[];
  anthropic: Anthropic;
  cfg: RunConfig;
  mode: string;
  problem: string;
  questions: string[];
  leads: EngineLead[];
  crowd: EngineCrowdMember[];
  pollQuestion: string;                                 // the one proposition every crowd poll asks (brief-derived; falls back to the raw problem)
  /** choice instrument (PR-B): when the brief weighs NAMED alternatives, polls
   *  offer those choices instead of support/oppose. Empty = the classic
   *  stance poll. Derived once at launch (config.poll_options). */
  pollOptions: string[];
  /** question-matched answer labels for the launch-derived proposition
   *  (config.poll_labels); null = the classic support/oppose phrasing */
  pollLabels: StanceLabels | null;
  /** 3d — enabled tool keys (config.tools allowlist; empty = all off, the default).
   *  LEADS ONLY: crowd polls/interjections/votes never carry tools. */
  tools: string[];
  /** the shared factbase: searches the panel already ran (seeded from
   *  tool_runs on resume) — later turns see a digest so nobody re-searches */
  pulledFacts: { query: string; results: { title: string; url: string }[] }[];
  corpusBlocks: Anthropic.Beta.BetaContentBlockParam[]; // document blocks with citations enabled (may be empty)
  temperature: number;
  deadline: number;                                     // ms epoch — suspend at the next safe boundary after this
  polledRounds: Set<number>;                            // sentiment polls already run (resume safety)
  votedRounds: Set<number>;                             // vote passes already run (resume safety)
  /** 6-PR3 (§6c/§6d) — the contract's sub-asks drive round agendas + the
   *  resolution tracker; empty = no contract → no agendas, no coverage. */
  subAsks: SubAskLite[];
  /** the contract's poll plan: null = legacy single instrument; [] = this
   *  brief polls NOT AT ALL; entries = per-round angle scheduling. */
  pollPlan: PollAngle[] | null;
  /** latest tracker scores (merged per sub-ask; seeded from persisted
   *  coverage events on resume) */
  coverage: CoverageScore[];
  trackedRounds: Set<number>;                           // tracker passes already run (resume safety)
  /** Wave 5a (audit E-G7): votes cast in EARLIER slices — rebuilt from the
   *  persisted votes events so pair-dedupe, per-voter budgets, and the ▲/▼
   *  net overlay survive a slice boundary instead of double-counting */
  priorVoteEvents?: { round: number; votes: { seq: number; voter_key: string; vote: 1 | -1 }[] }[];
  emit: (e: EngineEvent) => Promise<void>;              // persists + streams
  logCall: (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => Promise<void>;
  isCancelled: () => boolean;
}

/** §6.1: pure persona → system prompt compilation. Versioned by content. */
export function compilePersonaPrompt(spec: FrozenSpec, args: { mode: string; problem: string; temperature: RunConfig["temperature"]; criteria?: string[]; constraints?: string[]; roster?: string[] }): string {
  const t = spec.traits ?? {};
  const styleBits: string[] = [];
  if ((t.verbosity ?? 0.5) < 0.4) styleBits.push("You are terse — two or three sentences, no throat-clearing.");
  else if ((t.verbosity ?? 0.5) > 0.7) styleBits.push("You think out loud a little, but never pad.");
  if ((t.risk_tolerance ?? 0.5) < 0.35) styleBits.push("You price risk conservatively and say so.");
  if ((t.agreeableness ?? 0.5) < 0.35) styleBits.push("You push back readily when you disagree.");
  const temp = args.temperature === "conservative"
    ? "Stay close to what the documents and your experience support."
    : args.temperature === "exploratory"
    ? "Chase tail risks and second-order effects others might miss."
    : "";
  const seatRole = spec.seat?.role;
  const seatDiffers = !!seatRole && seatRole.trim().toLowerCase() !== (spec.role ?? "").trim().toLowerCase();
  return [
    `You are ${spec.name}, ${seatRole ?? spec.role}.`,
    // the seat is the MANDATE: a matched persona speaks to the seat it holds,
    // with its own background as the source of authority — never disclaims it
    seatDiffers
      ? `The panel seated you as its ${seatRole}${spec.seat?.why ? ` — ${spec.seat.why}` : ""}. Speak with that seat's authority on every turn; your background below is how you earned the seat, not a reason to hedge or hand the question to someone else.`
      : "",
    spec.tagline ? `In one line: ${spec.tagline}.` : "",
    spec.backstory ? `Background: ${spec.backstory}` : "",
    spec.stances?.length ? `Standing positions you argue from:\n${spec.stances.map((x) => `- ${x}`).join("\n")}` : "",
    `You are one voice on a ${args.mode} panel deliberating: "${args.problem}"`,
    // Wave 2b (audit E-F3): "address colleagues by first name" finally has a
    // roster to address — every persona knows who is in the room
    args.roster?.length ? `The panel: ${args.roster.join(" · ")}.` : "",
    // E-F2: a Tribunal bench is a MANDATE the persona argues from, knowingly
    args.mode === "Tribunal" && spec.seat?.side
      ? `You sit on the ${spec.seat.side === "con" ? "CON" : "PRO"} bench: your professional read genuinely ${spec.seat.side === "con" ? "OPPOSES" : "SUPPORTS"} the thesis — argue it with evidence, concede only what the record forces, and remember a judge scores each round.`
      : "",
    // E-F1: the brief's contract binds the deliberation, not just the report
    args.criteria?.length ? `A decision-grade answer must deliver (argue toward these):\n${args.criteria.map((c) => `- ${c}`).join("\n")}` : "",
    args.constraints?.length ? `Constraints in play: ${args.constraints.join(" · ")}.` : "",
    `Forum rules: write ONE post in your own voice, 60–140 words, concrete and specific — numbers, names, mechanisms. ` +
    `Reference documents by name when you use them. Address colleagues by first name. ` +
    `Start directly with your point — never prefix your post with your own name, a greeting, or markdown headers. ` +
    `Never break character, never mention being an AI, never summarize the whole discussion — advance it. ` +
    `Never open with stock contrarian framing ("Everybody's chasing…", "Before anyone gets excited…", "Everyone's ` +
    `missing…", "Here's the thing…") — open with a specific number, name, place, or mechanism from YOUR domain. ` +
    `Do NOT rush to consensus: hold your position until the evidence genuinely moves you, surface what the panel ` +
    `has not addressed yet, and quantify disagreements instead of smoothing them over.`,
    styleBits.join(" "),
    temp,
  ].filter(Boolean).join("\n\n");
}

/** word cap that lands on a sentence boundary — the old hard cut published
 *  posts ending mid-clause ("stop flipping when the…", field report), which
 *  read as data bugs and derailed the panel. Exported pure for tests. */
export const clampWords = (s: string, max = 220) => {
  const t = s.trim();
  const w = t.split(/\s+/);
  if (w.length <= max) return t;
  const hard = w.slice(0, max).join(" ");
  // rewind to the last sentence end inside the budget; only hard-cut when
  // that would drop more than half the post (one giant run-on sentence)
  const m = hard.match(/^[\s\S]*[.!?]["')\]]?(?=\s|$)/);
  if (m && m[0].trim().split(/\s+/).length >= max / 2) return m[0].trim();
  return hard + "…";
};

/** cheap token-overlap similarity (0–1) — the duplicate-post detector.
 *  Wave 5a (audit E-D2): JACCARD, not min-denominator — a short post whose
 *  words all appear inside a long one used to score 1.0 (containment) and
 *  trigger false do-not-restate retries. Exported PURE so tests pin it. */
export function textSimilarity(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const A = tok(a), B = tok(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** models love opening with "**Their Name.**" — strip any self-prefix */
/** models occasionally leak reasoning as LITERAL text — field report: a
 *  Tribunal post opened "<thinking> This is a roleplay as Grigor Petrosyan…".
 *  Closed blocks are removed wherever they sit; an UNCLOSED opening tag means
 *  everything after it is reasoning, so it all goes. An empty result rides
 *  the existing empty-draft retry/skip machinery in speak(). */
export function stripThinking(text: string): string {
  let out = text.replace(/<\s*(thinking|think|reasoning|scratchpad|reflection)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ");
  const open = out.match(/<\s*(thinking|think|reasoning|scratchpad|reflection)\s*>/i);
  if (open) out = out.slice(0, open.index);
  return out.replace(/[ \t]{3,}/g, " ").trim();
}

export function stripSelfPrefix(text: string, name: string): string {
  const first = name.split(/\s+/)[0];
  return text
    .replace(new RegExp(`^\\s*\\*{0,2}\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.:,—-]*\\s*\\*{0,2}\\s*`, "i"), "")
    .replace(new RegExp(`^\\s*\\*{0,2}\\s*${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+[A-Z]\\.?\\s*[.:,—-]*\\s*\\*{0,2}\\s*`, ""), "")
    .trim();
}

/** one lead takes a turn: model call → post event (with citations when docs are attached) */
async function speak(ctx: EngineContext, lead: EngineLead, opts: {
  seq: number; round: number; thread: string; tag: string; reply_to?: number | null;
  instruction: string; transcript: string; phase?: string; side?: string; maxTokens?: number;
  /** posts the draft must not restate — the speaker's own recent posts
   *  (all rounds) plus the panel's latest (audit E-D1); a near-duplicate
   *  draft gets ONE do-not-restate retry (the "Benjamin K. twice" fix) */
  dedupeAgainst?: string[];
  /** 3e parallel waves: generate WITHOUT emitting the post — the caller emits
   *  the returned event in slot order so the feed stays seq-ordered even
   *  though generation overlapped. Presence + tool events still stream live. */
  deferEmit?: boolean;
}): Promise<{ seq: number; text: string; post?: EngineEvent }> {
  const model = TIER_MODELS[ctx.cfg.tier].leads;
  await ctx.emit({ type: "presence", agent_key: lead.key, name: lead.spec.name, state: "thinking" });
  // 3d — tools attach to LEAD turns only, and only when the user enabled them;
  // the addendum makes use agent-decided, never mandatory
  const toolBlocks = toolBlocksFor(ctx.tools, model);
  const system = compilePersonaPrompt(lead.spec, { mode: ctx.mode, problem: ctx.problem, temperature: ctx.cfg.temperature, criteria: ctx.criteria, constraints: ctx.constraints, roster: ctx.leads.map((l) => `${l.spec.name} (${l.spec.seat?.role ?? l.spec.role})`) })
    + toolPromptAddendum(ctx.tools);
  const factDigest = toolBlocks.length && ctx.pulledFacts.length
    ? `\n\nFACTS THE PANEL ALREADY PULLED (check before searching again):\n${ctx.pulledFacts.slice(-10).map((f) => `- "${f.query}" → ${f.results.slice(0, 2).map((r) => `${r.title} (${r.url})`).join(" · ") || "no results"}`).join("\n")}`
    : "";
  const turnSearches: { query: string; results: { title: string; url: string }[] }[] = [];
  // NOTE: no `temperature` param — deprecated on Sonnet 5+ (400s the call);
  // the §4.1 temperature band steers style through the prompt instead.
  // escalating output budgets: adaptive-thinking models (Sonnet 5+) can spend
  // the ENTIRE budget thinking on a hard turn and return zero prose with
  // stop_reason max_tokens — retrying at the same ceiling fails identically
  // (the "Angela F.'s turn failed twice" run). Each retry must raise the
  // ceiling; only actual output tokens are billed, so headroom is free.
  const attempt = async (extra?: string): Promise<{ text: string; cites: { title: string; quote: string; url?: string }[] }> => {
    const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
      ...ctx.corpusBlocks,
      { type: "text", text: `${opts.transcript ? `TRANSCRIPT SO FAR (most recent last):\n${opts.transcript}\n\n` : ""}${opts.instruction}${factDigest}${extra ? `\n\n${extra}` : ""}` },
    ];
    let text = "";
    const cites: { title: string; quote: string; url?: string }[] = [];
    let lastErr = "";
    const base = opts.maxTokens ?? 2000;
    const budgets = [base, Math.max(base * 3, 6_000), Math.max(base * 6, 12_000)];
    for (let i = 0; i < budgets.length && !text; i++) {
      const ta = Date.now();
      try {
        const res = await ctx.anthropic.beta.messages.create({
          model,
          max_tokens: budgets[i],
          system,
          messages: [{ role: "user", content: userContent }],
          betas: ["files-api-2025-04-14"],
          ...(toolBlocks.length ? { tools: toolBlocks as never } : {}),
        });
        // server-side search pairs: a server_tool_use block (the query) is
        // followed by its web_search_tool_result block (the results). Errors
        // come back as result content the model already handled — fail SOFT,
        // never let a bad search kill a turn.
        let pendingQuery: string | null = null;
        for (const b of res.content) {
          const blk = b as unknown as { type: string; name?: string; input?: { query?: string }; content?: unknown };
          if (blk.type === "server_tool_use" && blk.name === "web_search") {
            pendingQuery = String(blk.input?.query ?? "");
          } else if (blk.type === "web_search_tool_result") {
            const rows = Array.isArray(blk.content) ? (blk.content as { type?: string; url?: string; title?: string }[]) : [];
            const results = rows
              .filter((r) => r.type === "web_search_result" && r.url)
              .slice(0, 5)
              .map((r) => ({ title: String(r.title ?? r.url).slice(0, 120), url: String(r.url) }));
            if (pendingQuery !== null) {
              turnSearches.push({ query: pendingQuery.slice(0, 200), results });
              pendingQuery = null;
            }
          }
          if (b.type === "text") {
            text += b.text;
            const withCites = b as { citations?: { document_title?: string | null; cited_text?: string; url?: string; title?: string }[] };
            for (const c of withCites.citations ?? []) {
              if (c.document_title) cites.push({ title: c.document_title, quote: (c.cited_text ?? "").slice(0, 160) });
              else if (c.url) cites.push({ title: String(c.title ?? c.url).slice(0, 120), quote: (c.cited_text ?? "").slice(0, 160), url: c.url });
            }
          }
        }
        await ctx.logCall("engine.turn", model, res.usage as { input_tokens: number; output_tokens: number }, ta, undefined,
          { agent: lead.spec.name, seat: lead.spec.seat?.role ?? lead.spec.role, mode: ctx.mode, round: opts.round, tag: opts.tag });
        // a successful call with no prose = the model spent the budget thinking
        // (Sonnet 5 adaptive thinking) or refused — the next attempt runs with
        // the escalated budget above
        if (!text) lastErr = `empty response (stop_reason: ${res.stop_reason})`;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "turn failed";
        await ctx.logCall("engine.turn", model, null, ta, lastErr,
          { agent: lead.spec.name, seat: lead.spec.seat?.role ?? lead.spec.role, mode: ctx.mode, round: opts.round, tag: opts.tag });
        if (i === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    // fail LOUD: a dead turn after the full escalation ladder means the run is
    // broken — stop with the real API error instead of littering the feed with
    // skipped posts (the escalation makes thinking-drain effectively impossible)
    if (!text) throw new Error(`${lead.spec.name}'s turn failed ${budgets.length} times — ${lastErr}`);
    return { text: stripThinking(text), cites };
  };

  let { text, cites } = await attempt();
  // anti-repeat: a contested target can pull the same voice back in — if the
  // draft substantially restates one of this speaker's earlier posts this
  // round, retry ONCE with an explicit order; emit the retry either way
  // (a slightly-similar post beats a hole in the choreography)
  if (opts.dedupeAgainst?.some((prev) => textSimilarity(text, prev) >= 0.8)) {
    try {
      const redo = await attempt(
        "IMPORTANT: Your draft substantially repeats a point already on the record (yours or a colleague's). Do NOT restate it — " +
        "contribute a NEW argument, a NEW number, or engage a DIFFERENT colleague's point directly."
      );
      text = redo.text;
      cites = redo.cites;
    } catch { /* keep the first draft rather than kill the run */ }
  }
  text = clampWords(stripSelfPrefix(text, lead.spec.name));
  // GHOST-POST GUARD (field report: "[REPLY] Renata O. (): ''" derailed the
  // panel for rounds): a draft can survive the fail-loud check yet strip to
  // nothing (name-only output, whitespace + citations). Retry once with an
  // explicit order; if still empty, SKIP the post — a hole in the
  // choreography beats a ghost the panel argues about.
  if (!text) {
    try {
      const redo = await attempt(
        "IMPORTANT: your last draft had no post body. Write your post NOW — plain prose, in character, " +
        "no headers, no name prefix, 2-6 sentences minimum."
      );
      text = clampWords(stripSelfPrefix(redo.text, lead.spec.name));
      cites = redo.cites;
    } catch { /* fall through to the skip */ }
  }
  if (!text) {
    await ctx.logCall("engine.turn", model, null, Date.now(), "empty post after strip — skipped",
      { agent: lead.spec.name, mode: ctx.mode, round: opts.round, tag: opts.tag });
    await ctx.emit({ type: "presence", agent_key: lead.key, name: lead.spec.name, state: "idle" });
    // audit E-G1: the hole is VISIBLE — a persisted marker instead of a silent reflow
    await ctx.emit({ type: "skip", agent_key: lead.key, name: lead.spec.name, round: opts.round, tag: opts.tag });
    return { seq: opts.seq, text: "" };
  }
  // 3d — every search this turn ran becomes a shared panel fact and a feed
  // card, emitted BEFORE the post so the feed reads "searched, then argued"
  const seenQueries = new Set<string>();
  for (const s of turnSearches) {
    if (seenQueries.has(s.query)) continue;
    seenQueries.add(s.query);
    ctx.pulledFacts.push(s);
    await ctx.emit({ type: "tool", agent_key: lead.key, name: lead.spec.name, tool: "web_search", query: s.query, results: s.results, round: opts.round });
  }
  const postEvt: EngineEvent = {
    type: "post", seq: opts.seq, author: "agent", agent_key: lead.key,
    name: lead.spec.name, role: lead.spec.seat?.role ?? lead.spec.role, initials: lead.spec.initials,
    adversarial: lead.spec.seat?.adversarial || lead.spec.kind === "adversarial",
    thread: opts.thread, reply_to: opts.reply_to ?? null, tag: opts.tag, content: text,
    cites: dedupeCites(cites).slice(0, 4), round: opts.round, phase: opts.phase, side: opts.side,
  };
  // audit E-G2: the node stops pulsing when its turn lands — success used to
  // leave the speaker in "thinking" forever
  await ctx.emit({ type: "presence", agent_key: lead.key, name: lead.spec.name, state: "idle" });
  if (opts.deferEmit) return { seq: opts.seq, text, post: postEvt };
  await ctx.emit(postEvt);
  return { seq: opts.seq, text };
}

/** transcript window: the last N posts as compact attributed lines — empty
 *  posts (legacy ghost rows) never render, and a missing role never prints
 *  as bare "()" (both confused live panels into meta-arguing, field report) */
export function windowOf(posts: { name: string; role: string; content: string; tag: string; seq?: number }[], n = 16, votes?: Map<number, number>): string {
  return posts
    .filter((p) => p.content.trim())
    .slice(-n)
    .map((p) => `[${p.tag}] ${p.name}${p.role ? ` (${p.role})` : ""}: ${p.content}${votes && p.seq !== undefined && (votes.get(p.seq) ?? 0) !== 0 ? ` [${(votes.get(p.seq) ?? 0) > 0 ? "▲" : "▼"}${Math.abs(votes.get(p.seq) ?? 0)}]` : ""}`)
    .join("\n");
}

/** stance normalization: models answer with variants ("supportive", "against",
 *  "neutral") and the old blanket coercion dumped ALL of them into "disengaged",
 *  silently inflating that bucket. Map known variants to their real stance;
 *  neutral/undecided reads closest to "conditional" (a leaning that depends),
 *  NOT "disengaged" (which means genuinely unaffected). Exported pure for tests. */
export function normalizeStance(raw: unknown): "support" | "conditional" | "oppose" | "disengaged" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("support") || s === "yes" || s === "for" || s === "favor" || s === "in favor") return "support";
  if (s.startsWith("oppos") || s === "against" || s === "no" || s.startsWith("reject")) return "oppose";
  if (s.startsWith("condition") || s.startsWith("depend") || s === "maybe" || s === "if" || s === "neutral" || s.startsWith("undecid") || s === "unsure" || s === "mixed" || s === "on the fence") return "conditional";
  if (s.startsWith("disengag") || s.startsWith("indifferent") || s.startsWith("apath") || s.includes("care")) return "disengaged";
  return null; // unknown — caller decides (counted, not silently dumped)
}

/** match a free-text poll answer to one of the instrument's options. Exact
 *  case-insensitive first, then a UNIQUE containment match (models love to
 *  answer "the green one — green.png"); undecided variants get their own
 *  bucket. null = unrecognized (caller counts it, never silently drops). */
export function normalizeChoice(raw: unknown, options: string[]): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["undecided", "unsure", "none", "no preference", "abstain", "can't choose", "cannot choose", "neither", "torn"].includes(s)) return "undecided";
  const exact = options.find((o) => o.toLowerCase() === s);
  if (exact) return exact;
  const contained = options.filter((o) => s.includes(o.toLowerCase()) || o.toLowerCase().includes(s));
  return contained.length === 1 ? contained[0] : null;
}

/** parse the instrument-derivation reply. Pure so tests pin the salvage
 *  rules: fenced/prose-wrapped JSON, option cap at 5, dedupe, a lone option
 *  degrades to the classic stance poll (one choice is a proposition).
 *  Proposition instruments also carry question-matched ANSWER labels
 *  ("Yes — would consider selling" instead of "support"); a partial label
 *  set drops to null and the display falls back to the classic four. */
export function parsePollInstrument(text: string, fallback: string): { question: string; options: string[]; labels: StanceLabels | null } {
  const bail = { question: fallback, options: [] as string[], labels: null };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return bail;
  try {
    const obj = JSON.parse(m[0]) as { question?: unknown; options?: unknown; labels?: unknown };
    const question = String(obj.question ?? "").trim().replace(/^["“]|["”]$/g, "");
    const seen = new Set<string>();
    const options: string[] = [];
    for (const o of Array.isArray(obj.options) ? obj.options : []) {
      const label = String(o ?? "").trim().slice(0, 48);
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      options.push(label);
      if (options.length >= 5) break;
    }
    const isChoice = options.length >= 2;
    return {
      question: question.length >= 12 && question.length <= 240 ? question : fallback,
      options: isChoice ? options : [],
      labels: isChoice ? null : normalizeStanceLabels(obj.labels),
    };
  } catch {
    return bail;
  }
}

/** the poll instrument: derived from the brief ONCE per simulation (persisted
 *  in config so every round, resume slice, and the report ask the same thing).
 *  Two shapes: a proposition the crowd can support or oppose (the classic
 *  four-stance poll), or — when the brief weighs NAMED alternatives — the
 *  actual choices ("which photo leads the listing?" polls green.png vs
 *  red.png vs blue.png). Fail-soft: the raw problem, classic stances. */
export async function derivePollInstrument(
  anthropic: Anthropic, model: string, problem: string,
  logCall: EngineContext["logCall"],
): Promise<{ question: string; options: string[]; labels: StanceLabels | null }> {
  const t0 = Date.now();
  try {
    const res = await anthropic.messages.create({
      model, max_tokens: 900, // headroom for adaptive thinking on Sonnet-class crowd tiers
      system:
        `Turn a research brief into ONE neutral poll question for a crowd of ordinary people (residents, buyers, renters, neighbors), and decide the instrument:\n` +
        `- If the brief asks to CHOOSE AMONG named alternatives (photos, floor plans, sites, unit mixes, price points), the question asks which one — "options" lists those alternatives EXACTLY as the brief names them (2-5, each under 6 words, brief's order; never invent an alternative), and "labels" is null.\n` +
        `- Otherwise "options" is [] and the question is a single plain-language proposition — and "labels" gives the four answers AS A PERSON WOULD SAY THEM to that exact question, ≤5 words each: support = the yes ("Yes — would consider selling"), conditional = the yes-with-a-condition ("Only if costs stay flat"), oppose = the no ("No — holding"), disengaged = untouched ("Doesn't affect me"). Generic "support/oppose" labels are a FAILURE unless the question is literally a should-we proposition.\n` +
        `Question max 22 words, no jargon, no acronyms. Reply ONLY JSON: {"question": "...", "options": [], "labels": {"support": "...", "conditional": "...", "oppose": "...", "disengaged": "..."}}`,
      messages: [{ role: "user", content: problem.slice(0, 4000) }],
    });
    await logCall("engine.poll_question", model, res.usage, t0);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return parsePollInstrument(text, problem);
  } catch (e) {
    await logCall("engine.poll_question", model, null, t0, e instanceof Error ? e.message : "derive failed");
    return { question: problem, options: [], labels: null };
  }
}

/** crowd sentiment poll (§5 — our custom layer): batched Haiku calls between
 *  rounds. Batches run 3-CONCURRENT (a 169-member poll was ~9 serial calls —
 *  minutes of wall-clock that blew slices past the serverless window) and the
 *  poll is DEADLINE-AWARE: when time runs out mid-poll it emits the partial
 *  tally honestly instead of dragging the run into a hard kill. Each round's
 *  poll carries a digest of what the panel just argued, so movement between
 *  rounds is reaction, not sampling noise. */
async function pollCrowd(ctx: EngineContext, round: number, digest?: string): Promise<string | null> {
  if (ctx.crowd.length === 0) return null;
  if (ctx.polledRounds.has(round)) return null; // already polled before a suspension
  // 6-PR3 adaptive polling (§6d): the contract's poll PLAN supersedes the
  // single launch-derived instrument — each round asks the angle matched to
  // its place in the run's arc. An EMPTY plan is a decision ("this brief has
  // no sentiment surface") — but a MATERIALIZED CROWD is the newer, more
  // explicit decision (field report: 113 residents ringed the canvas and
  // were never asked anything). When the population includes a crowd, an
  // empty plan falls back to the launch-derived classic instrument instead
  // of silencing the crowd entirely; with no crowd the guard above already
  // returned. pollPlan null = legacy contract-less path, unchanged.
  const plan = ctx.pollPlan !== null && ctx.pollPlan.length === 0 ? null : ctx.pollPlan;
  const angle = plan === null ? null : pollAngleForRound(plan, round, ctx.cfg.rounds);
  if (plan !== null && !angle) return null;
  const pollQ = angle?.question ?? ctx.pollQuestion;
  const pollOpts = angle ? (angle.options ?? []) : ctx.pollOptions;
  // question-matched answer labels (poll-language fix): the members are polled
  // with, and the UI displays, answers that READ as answers to THIS question
  const labels = angle ? (angle.labels ?? null) : ctx.pollLabels;
  await ctx.emit({ type: "polling", round, count: ctx.crowd.length }); // canvas animates WHILE the poll runs
  const model = TIER_MODELS[ctx.cfg.tier].crowd;
  const BATCH = 20;
  const choice = pollOpts.length >= 2; // the brief named alternatives — poll the actual choices
  const dist: Record<string, number> = choice
    ? Object.fromEntries(pollOpts.map((o) => [o, 0])) // insertion order = display order
    : { support: 0, conditional: 0, oppose: 0, disengaged: 0 };
  const quotes: { name: string; stance: string; quote: string }[] = [];
  // C2 (field-report 2): every individual answer is kept, not just the tally —
  // "SEE EVERY VOTE" reads these off the persisted event (~40B/member)
  const ballots: { name: string; stance: string }[] = [];
  const batches: EngineCrowdMember[][] = [];
  for (let i = 0; i < ctx.crowd.length; i += BATCH) batches.push(ctx.crowd.slice(i, i + BATCH));
  // Wave 5a poll integrity (audit E-C5/C6/C7): ballots validate against the
  // roster (phantom names and duplicate answers are DROPPED, not counted),
  // coerced answers ride the event, and a deadline-truncated poll ships
  // flagged partial instead of passing as the round's sentiment
  const answered = new Set<string>();     // member keys that already cast a ballot
  let totalCoerced = 0;
  let totalDropped = 0;
  let batchesDone = 0;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      if (ctx.isCancelled() || Date.now() > ctx.deadline) return;
      const batch = batches[next++];
      const t0 = Date.now();
      try {
        const res = await ctx.anthropic.messages.create({
          model,
          // headroom over the strict per-row need: on frontier tier the crowd
          // model is Sonnet 5, whose adaptive thinking bills against this cap
          max_tokens: 200 * batch.length + 800,
          system: choice
            ? `You simulate a preference poll. THE POLL QUESTION: "${pollQ}". For EACH member listed, answer AS THEM${digest ? ", reacting to the question AND to what the panel just argued" : ""}. ` +
              `THE CHOICES — pick EXACTLY ONE per member, verbatim:\n` +
              pollOpts.map((o) => `- "${o}"`).join("\n") + "\n" +
              `A member who genuinely cannot pick may answer "undecided" — use it sparingly; most people lean somewhere.\n` +
              `Reply ONLY a JSON array in the same order: [{"name": "...", "choice": "one of the choices verbatim", "quote": "one short in-character sentence on why"}]`
            : `You simulate a sentiment poll. THE POLL QUESTION: "${pollQ}". For EACH member listed, answer AS THEM${digest ? ", reacting to the question AND to what the panel just argued" : ""}. ` +
              `Stances — exactly one per member:\n` +
              `- "support": ${labels ? `"${labels.support}" — ` : ""}they would say yes to the question.\n` +
              `- "conditional": ${labels ? `"${labels.conditional}" — ` : ""}yes, but only if a specific concern is handled — name it in the quote.\n` +
              `- "oppose": ${labels ? `"${labels.oppose}" — ` : ""}they would say no.\n` +
              `- "disengaged": ${labels ? `"${labels.disengaged}" — ` : ""}the outcome truly would not touch their life and they would pay no attention. Most people have SOME leaning — use this sparingly, and NEVER as a stand-in for neutral or undecided (that is "conditional").\n` +
              `Reply ONLY a JSON array in the same order: [{"name": "...", "stance": "support|conditional|oppose|disengaged", "quote": "one short in-character sentence"}]`,
          messages: [{
            role: "user",
            content:
              (digest ? `WHAT THE PANEL ARGUED THIS ROUND:\n${digest}\n\nMEMBERS TO POLL:\n` : "") +
              batch.map((m) => `- ${m.spec.name}: ${m.spec.seat?.role ?? m.spec.role}${m.spec.tagline ? ` — ${m.spec.tagline}` : ""}${m.spec.stances?.[0] ? ` — stance: ${m.spec.stances[0]}` : ""}`).join("\n"),
          }],
        });
        await ctx.logCall("engine.poll", model, res.usage, t0, undefined, { mode: ctx.mode, round, batch: batch.length, crowd: ctx.crowd.length });
        const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
        const rows = (parseLooseArray(text) ?? []) as { name?: string; stance?: string; choice?: string; quote?: string }[];
        let coerced = 0;
        let dropped = 0;
        for (const r of rows) {
          // audit E-C6: a ballot counts ONLY for a real roster member, once —
          // model-invented names and duplicate answers used to inflate the tally
          const member = batch.find((m) => m.spec.name === r.name)
            ?? batch.find((m) => r.name && m.spec.name.startsWith(String(r.name).split(" ")[0]));
          if (!member || answered.has(member.key)) { dropped += 1; continue; }
          answered.add(member.key);
          let stance: string;
          if (choice) {
            const norm = normalizeChoice(r.choice ?? r.stance, pollOpts);
            stance = norm ?? "undecided"; // unrecognized answers are counted honestly, never assigned a choice
            if (!norm) coerced += 1;
            if (!(stance in dist)) dist[stance] = 0;
          } else {
            const norm = normalizeStance(r.stance);
            stance = norm ?? "disengaged"; // truly unrecognized only — counted below, no longer the neutral dumping ground
            if (!norm) coerced += 1;
          }
          dist[stance] += 1;
          ballots.push({ name: member.spec.name.slice(0, 60), stance });
          if (r.quote && quotes.length < 6) quotes.push({ name: member.spec.name, stance, quote: String(r.quote).slice(0, 160) });
        }
        totalCoerced += coerced;
        totalDropped += dropped;
        batchesDone += 1;
        if (coerced > 0 || dropped > 0) await ctx.logCall("engine.poll", model, null, t0, undefined, { note: "ballot integrity", coerced, dropped, round });
      } catch (e) {
        await ctx.logCall("engine.poll", model, null, t0, e instanceof Error ? e.message : "poll failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  const polled = Object.values(dist).reduce((a, b) => a + b, 0);
  // audit E-C7: a deadline-truncated poll ships FLAGGED partial and the round
  // stays unmarked — the next slice re-polls in full and its complete event
  // supersedes this one (readers keep the last event per round)
  const partial = batchesDone < batches.length;
  if (polled > 0) {
    if (!partial) ctx.polledRounds.add(round);
    await ctx.emit({ type: "sentiment", round, polled, dist, quotes, question: pollQ, ballots, ...(choice ? { options: pollOpts } : {}), ...(!choice && labels ? { labels } : {}), ...(angle ? { angle: angle.angle } : {}), ...(totalCoerced > 0 ? { coerced: totalCoerced } : {}), ...(totalDropped > 0 ? { dropped: totalDropped } : {}), ...(partial ? { partial: true } : {}) });
    // Wave 3 (audit E-A1): the crowd's read RETURNS to the panel — the next
    // round's speakers see what the population they're arguing about thinks
    const share = (n: number) => `${Math.round((n / polled) * 100)}%`;
    const summary = Object.entries(dist)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${(labels as Record<string, string> | null)?.[k] ?? k} ${share(n)}`)
      .join(" · ");
    const topQuote = quotes[0] ? ` Top voice: "${quotes[0].quote}" — ${quotes[0].name}.` : "";
    return `CROWD READ AFTER ROUND ${round} (${polled} polled) — "${pollQ}": ${summary}.${topQuote}`;
  }
  return null;
}

/** convergence check (stability rule): cheap judge on whether positions still move */
async function stabilityCheck(ctx: EngineContext, transcript: string): Promise<boolean> {
  const model = TIER_MODELS[ctx.cfg.tier].crowd;
  const t0 = Date.now();
  try {
    const res = await ctx.anthropic.messages.create({
      model, max_tokens: 300, // room to think before the one-word verdict (adaptive-thinking models)
      system:
        `Read the deliberation. Reply ONLY "stable" or "moving". ` +
        `Reply "stable" ONLY IF the most recent round added NO new arguments, NO new evidence, NO position changes, ` +
        `and left NO open challenge or unanswered question on the table. Restating agreement politely still counts as "moving" ` +
        `if any thread is unresolved. When in ANY doubt, reply "moving".`,
      messages: [{ role: "user", content: transcript.slice(-12000) }],
    });
    await ctx.logCall("engine.converge", model, res.usage, t0, undefined, { mode: ctx.mode, check: "stability judge" });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return parseStabilityVerdict(text);
  } catch (e) {
    // a failing judge must be visible in monitoring — it is NOT "moving"
    await ctx.logCall("engine.converge", model, null, t0, e instanceof Error ? e.message : "stability judge failed", { mode: ctx.mode, check: "stability judge" });
    return false;
  }
}

/** audit E-F7: a neutral Presiding Judge spec — carries NONE of the base
 *  lead's backstory or standing stances; only an explicit impartiality
 *  mandate. The base spec supplies nothing but structural defaults. */
export function neutralJudgeSpec(base: FrozenSpec): FrozenSpec {
  return {
    ...base,
    name: "The Judge",
    initials: "JD",
    role: "Presiding judge",
    tagline: "Impartial adjudicator — no stake in the outcome",
    backstory: "A neutral presiding judge appointed for this tribunal. You have argued for neither side and hold no position on the thesis.",
    stances: [
      "JUDICIAL MANDATE: weigh ONLY the evidence and arguments made in this tribunal — you have no standing positions of your own.",
      "Rule each round for whichever bench carried it on the merits, and say exactly why.",
    ],
    skills: [],
    traits: { risk_tolerance: 0.5, agreeableness: 0.5, verbosity: 0.4 },
    seat: {
      role: "Presiding judge", why: "rules each round on the merits", discipline: "TRIBUNAL",
      adversarial: false, provenance: "generated",
    },
  };
}

/** audit E-B1: `includes("stable")` matched "unstable" / "not yet stable" and
 *  could end a run early stamped CONVERGED. The verdict must BE the word:
 *  the last non-empty line, exactly "stable" (punctuation tolerated). */
export function parseStabilityVerdict(text: string): boolean {
  const lines = stripThinking(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const last = (lines[lines.length - 1] ?? "").toLowerCase();
  return /^\W*stable\W*$/.test(last);
}

/** Wave 3 (audit E-A4): the rolling position ledger — one line per lead,
 *  refreshed at each round close, prepended to the next round's context so
 *  late-round speakers argue with memory instead of a 16-post window. */
async function positionsDigest(ctx: EngineContext, posts: PostRec[]): Promise<string | null> {
  if (ctx.leads.length < 3) return null;
  const model = TIER_MODELS[ctx.cfg.tier].crowd;
  const t0 = Date.now();
  try {
    const res = await ctx.anthropic.messages.create({
      model, max_tokens: 600,
      system:
        `You keep the position ledger of a deliberation panel. From the transcript, write ONE terse line per ` +
        `panelist: their CURRENT position and its load-bearing reason (10-18 words each). ` +
        `Format: "- Name: position". Only names from the roster; skip anyone who has not spoken.`,
      messages: [{ role: "user", content: `ROSTER: ${ctx.leads.map((l) => l.spec.name).join(" · ")}\n\n${windowOf(posts, 30).slice(-12000)}` }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    await ctx.logCall("engine.digest", model, res.usage, t0, undefined, { mode: ctx.mode, check: "position ledger" });
    const lines = stripThinking(text).split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-")).slice(0, ctx.leads.length);
    return lines.length ? `POSITIONS SO FAR:\n${lines.join("\n")}` : null;
  } catch (e) {
    await ctx.logCall("engine.digest", model, null, t0, e instanceof Error ? e.message : "digest failed", { mode: ctx.mode });
    return null;
  }
}

/** the closing position census (audit E-B6): who actually dissents at the
 *  end, by name — matched against the real roster so hallucinated names
 *  never count. Null = the call failed; caller falls back, marked unmeasured. */
async function positionCensus(ctx: EngineContext, posts: PostRec[]): Promise<{ aligned: number; dissenters: string[] } | null> {
  if (ctx.leads.length === 0) return null;
  const model = TIER_MODELS[ctx.cfg.tier].crowd;
  const t0 = Date.now();
  try {
    const res = await ctx.anthropic.messages.create({
      model, max_tokens: 500,
      system:
        `You take the closing position census of a deliberation panel. From the transcript's FINAL posts, ` +
        `identify which panelists still DISSENT from the panel's emerging conclusion (disagree with the majority ` +
        `direction, maintain an unresolved objection, or explicitly refuse the consensus). ` +
        `Reply ONLY JSON: {"dissenters": ["Exact Name", ...]} — empty array if the panel closed aligned. ` +
        `Use ONLY names from the roster. Do not include panelists who merely raised risks but accept the conclusion.`,
      messages: [{ role: "user", content: `ROSTER: ${ctx.leads.map((l) => l.spec.name).join(" · ")}\n\n${windowOf(posts, 30).slice(-12000)}` }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    await ctx.logCall("engine.converge", model, res.usage, t0, undefined, { mode: ctx.mode, check: "position census" });
    const parsed = parseLooseObject(text);
    if (!parsed || !Array.isArray(parsed.dissenters)) return null;
    const roster = new Set(ctx.leads.map((l) => l.spec.name));
    const dissenters = [...new Set(parsed.dissenters.map((d) => String(d)).filter((n) => roster.has(n)))];
    return { aligned: ctx.leads.length - dissenters.length, dissenters };
  } catch (e) {
    await ctx.logCall("engine.converge", model, null, t0, e instanceof Error ? e.message : "census failed", { mode: ctx.mode, check: "position census" });
    return null;
  }
}

export interface PostRec { name: string; role: string; content: string; tag: string; seq: number; agentKey: string; round: number; replyTo?: number | null }

/* ---- Jury arithmetic (§5 MoA layers) — exported PURE so the Phase-1 test
 * matrix pins every number the tally and the convergence rule produce ---- */

export function juryScoreOf(text: string): number | null {
  const m = text.match(/SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  return m ? Math.min(Math.max(parseFloat(m[1]), 0), 10) : null;
}

export function juryScoresAt(posts: Pick<PostRec, "tag" | "round" | "agentKey" | "content">[], round: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of posts) {
    if (p.tag !== "VERDICT" || p.round !== round) continue;
    const s = juryScoreOf(p.content);
    if (s !== null) out.set(p.agentKey, s);
  }
  return out;
}

/** movement between rounds: `returningMoved` feeds the tally line (jurors who
 *  scored both rounds and shifted ≥1); `movedOrNew` feeds the stability stop
 *  (a juror missing from the previous round counts as movement) */
export function juryMovement(prev: Map<string, number>, cur: Map<string, number>): { returningMoved: number; movedOrNew: number } {
  let returningMoved = 0;
  let movedOrNew = 0;
  for (const [k, v] of cur) {
    const pv = prev.get(k);
    if (pv === undefined) movedOrNew += 1;
    else if (Math.abs(v - pv) >= 1) { returningMoved += 1; movedOrNew += 1; }
  }
  return { returningMoved, movedOrNew };
}

export function juryTallyLine(cur: Map<string, number>, prev: Map<string, number>, round: number): string | null {
  if (cur.size === 0) return null;
  const vs = [...cur.values()];
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const forN = vs.filter((x) => x >= 6).length;
  const against = vs.filter((x) => x <= 4).length;
  const { returningMoved } = juryMovement(prev, cur);
  return (
    `ROUND ${round} TALLY — mean ${mean.toFixed(1)}/10 · ${forN} FOR (≥6) · ${against} AGAINST (≤4) · ${vs.length - forN - against} ON THE FENCE · range ${Math.min(...vs)}–${Math.max(...vs)}` +
    (round > 1 ? ` · ${returningMoved === 0 ? "NO JUROR MOVED ≥1 POINT" : `${returningMoved} JUROR${returningMoved === 1 ? "" : "S"} MOVED ≥1 POINT`}` : "")
  );
}

/* ---- Jury × choice briefs (field report 3) — a choose-between question has
 * no single scoreable proposition, so "SCORE: n/10" collapsed: every juror
 * anchored on the first uploaded image and the whole panel read 2/10. When
 * the poll instrument derived OPTIONS, the jury PICKS one (verbatim, resolved
 * through normalizeChoice) with a confidence score; the tally counts picks
 * and convergence = nobody switched. All pure, pinned by tests. ---- */

export function juryPickOf(text: string, options: string[]): { pick: string; confidence: number | null } | null {
  const m = text.match(/PICK:\s*"?([^"·|—–\n]+?)"?\s*[·|\-–—]\s*CONFIDENCE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  if (!m) return null;
  const pick = normalizeChoice(m[1], options);
  if (!pick || pick === "undecided") return null;
  return { pick, confidence: Math.min(Math.max(parseFloat(m[2]), 0), 10) };
}

export function juryPicksAt(
  posts: Pick<PostRec, "tag" | "round" | "agentKey" | "content">[],
  round: number,
  options: string[],
): Map<string, { pick: string; confidence: number | null }> {
  const out = new Map<string, { pick: string; confidence: number | null }>();
  for (const p of posts) {
    if (p.tag !== "VERDICT" || p.round !== round) continue;
    const v = juryPickOf(p.content, options);
    if (v) out.set(p.agentKey, v);
  }
  return out;
}

/** returning jurors whose pick CHANGED — the choice jury's movement metric */
export function jurySwitches(prev: Map<string, { pick: string }>, cur: Map<string, { pick: string }>): number {
  let switched = 0;
  for (const [k, v] of cur) {
    const pv = prev.get(k);
    if (pv && pv.pick !== v.pick) switched += 1;
  }
  return switched;
}

export function juryChoiceTallyLine(
  cur: Map<string, { pick: string; confidence: number | null }>,
  prev: Map<string, { pick: string; confidence: number | null }>,
  round: number,
  options: string[],
): string | null {
  if (cur.size === 0) return null;
  const counts = options.map((o) => ({ o, n: [...cur.values()].filter((v) => v.pick === o).length }));
  const confs = [...cur.values()].map((v) => v.confidence).filter((c): c is number => c !== null);
  const meanConf = confs.length ? (confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(1) : "—";
  const leader = [...counts].sort((a, b) => b.n - a.n)[0];
  const switched = jurySwitches(prev, cur);
  return (
    `ROUND ${round} TALLY — ${counts.map((c) => `${c.o} ${c.n}`).join(" · ")} · LEADER ${leader.o} (${leader.n}/${cur.size}) · mean confidence ${meanConf}/10` +
    (round > 1 ? ` · ${switched === 0 ? "NO JUROR SWITCHED PICKS" : `${switched} JUROR${switched === 1 ? "" : "S"} SWITCHED PICKS`}` : "")
  );
}

/* ---- reply targeting (§2a threading) — exported PURE so tests pin it ---- */

/** 3e — how much of a round's reply budget may reach BACK to earlier rounds.
 *  focused keeps the tight v1 rhythm (0% — the Phase-1 matrix stays pinned);
 *  lively/bustling let the forum revive old threads without necro takeover. */
export function necroFrac(density: RunConfig["density"]): number {
  return density === "bustling" ? 0.35 : density === "lively" ? 0.25 : 0;
}

/** Pick which post a reply should target: any substantive post — this round
 *  at full weight, earlier rounds decayed λ≈0.4 per round of age (3e) —
 *  weighted toward RECENT and CONTESTED (already drawing replies), so real
 *  chains form and old threads revive instead of dying at the round line.
 *  The NECRO GATE keeps revivals a minority: a cross-round target is only
 *  eligible while this round's revivals stay within the density's share of
 *  replies made so far. `salt` rotates among the top candidates so chains
 *  fork deterministically. Pure — recomputed from persisted posts on resume,
 *  so suspend/continue can never double-count the gate. */
export function pickReplyTarget(
  posts: Pick<PostRec, "seq" | "round" | "tag" | "agentKey" | "name" | "content" | "replyTo">[],
  round: number,
  salt: number,
  excludeAgentKey?: string,
  density: RunConfig["density"] = "focused",
  votes?: Map<number, number>,
): (typeof posts)[number] | null {
  const replyCount = new Map<number, number>();
  const roundOf = new Map<number, number>();
  for (const p of posts) roundOf.set(p.seq, p.round);
  for (const p of posts) {
    if (p.replyTo != null) replyCount.set(p.replyTo, (replyCount.get(p.replyTo) ?? 0) + 1);
  }
  const frac = necroFrac(density);
  // the gate, from persisted state alone: how many of this round's replies
  // already went to earlier rounds vs the share the density allows
  const repliesThisRound = posts.filter((p) => p.round === round && p.replyTo != null);
  const necroUsed = repliesThisRound.filter((p) => (roundOf.get(p.replyTo!) ?? round) < round).length;
  const necroAllowed = frac > 0 && necroUsed + 1 <= Math.ceil(frac * (repliesThisRound.length + 1));
  const substantive = (p: (typeof posts)[number]) =>
    p.tag !== "TALLY" && p.tag !== "INTERJECTION" && p.agentKey !== excludeAgentKey &&
    p.content.trim() !== ""; // a ghost row can never be a reply target
  const cands = posts.filter((p) =>
    substantive(p) && (p.round === round || (necroAllowed && p.round < round)));
  if (cands.length === 0) return null;
  const scored = cands.map((p, i) => ({
    p,
    w: Math.pow(0.4, round - p.round) * (1 / (1 + (cands.length - 1 - i))) + 0.7 * (replyCount.get(p.seq) ?? 0) + 0.35 * Math.min(3, Math.abs(votes?.get(p.seq) ?? 0)),
  }));
  scored.sort((a, b) => b.w - a.w || b.p.seq - a.p.seq);
  return scored[Math.abs(salt) % Math.min(3, scored.length)].p;
}

/** why the run stopped — the UI and the report must never claim convergence
 *  for a mode that simply finished its fixed choreography */
/** audit E-D4: Chamber's anti-mold opening angles — 12 deep so big panels
 *  don't recycle, offset per problem so runs don't share molds. Exported
 *  PURE so tests pin the count and the offset determinism. */
export const chamberAngles = [
  "Open with the single most decisive NUMBER from your domain and build from it.",
  "Open with a specific place, project, or deal you know first-hand and what it proves here.",
  "Open with the failure mode you'd bet on — what breaks first, and at what threshold.",
  "Open with the question the brief should have asked but didn't, then answer it.",
  "Open with the strongest point AGAINST your own instinct, then say why you still land where you land.",
  "Open with a timeline — what has to happen by when, and where the calendar kills the plan.",
  "Open with the one comparable everyone will cite and why it does (or does not) transfer here.",
  "Open with who bears the downside if this goes wrong, and what that does to the decision.",
  "Open with the cheapest test that would settle the biggest unknown before committing.",
  "Open with the regulatory or approval step most likely to move the calendar, and its real odds.",
  "Open with what the money has to believe — the underwriting assumption doing the most work.",
  "Open with the second-order effect nobody prices — what this decision sets in motion.",
] as const;

export function chamberAngleOffset(problem: string): number {
  let h = 0;
  for (let i = 0; i < problem.length; i++) h = (h * 31 + problem.charCodeAt(i)) >>> 0;
  return h % chamberAngles.length;
}

export type StopReason = "stability" | "rounds" | "budget" | "choreography";

/** the seven §5 choreographies over shared primitives */
export interface RunResume { posts: PostRec[]; seq: number; round: number; stableStreak?: number }

export async function runMode(ctx: EngineContext, resume?: RunResume): Promise<{ posts: number; converged: boolean; stopReason: StopReason; suspendedAtRound?: number; stableStreak?: number }> {
  const posts: PostRec[] = resume?.posts ? [...resume.posts] : [];
  let seq = resume?.seq ?? 0;
  let currentRound = 0;
  const outOfTime = () => Date.now() > ctx.deadline;
  // derive-skip: has this lead already produced this tagged post (this round)?
  const did = (name: string, tag: string, round?: number) =>
    posts.some((p) => p.name === name && p.tag === tag && (round === undefined || p.round === round));
  const record = (lead: EngineLead, tag: string, text: string, replyTo: number | null = null) => {
    posts.push({ name: lead.spec.name, role: lead.spec.seat?.role ?? lead.spec.role, content: text, tag, seq, agentKey: lead.key, round: currentRound, replyTo });
  };
  const budget = () => posts.length < ctx.cfg.max_posts && !ctx.isCancelled();
  const q = ctx.questions.length ? `Key questions: ${ctx.questions.join(" · ")}.` : "";
  let converged = false;
  let stopReason: StopReason = "rounds";
  // stop only after TWO consecutive stable rounds (round ≥ 3). Seeded from
  // the resume state (audit E-B5: a slice boundary between two stable rounds
  // used to reset the streak and keep the run going)
  let stableStreak = resume?.stableStreak ?? 0;

  const turn = async (lead: EngineLead, o: { round: number; thread: string; tag: string; reply_to?: number | null; instruction: string; phase?: string; side?: string; transcript?: string }) => {
    const { transcript, ...rest } = o;
    currentRound = o.round;
    seq += 1;
    // audit E-D1: the anti-repeat check sees the speaker's own posts across
    // ALL rounds (last 4) plus the panel's most recent 6 substantive posts —
    // a cross-round or cross-speaker restatement used to pass, then read as
    // "stable" to the convergence judge
    const dedupeAgainst = [
      ...posts.filter((p) => p.agentKey === lead.key).slice(-4).map((p) => p.content),
      ...posts.filter((p) => p.agentKey !== lead.key && p.tag !== "INTERJECTION" && p.tag !== "TALLY").slice(-6).map((p) => p.content),
    ];
    const r = await speak(ctx, lead, { seq, transcript: transcript ?? windowOf(posts, 16, voteNet), dedupeAgainst, ...rest });
    // ghost-post guard: a skipped (empty) turn records nothing — the seq gap
    // is harmless, an empty PostRec would poison every later transcript
    if (r.text) {
      record(lead, o.tag, r.text, o.reply_to ?? null);
      await microVotes(o.round);
    }
    return r;
  };
  const startRound = resume?.round ?? 1;
  /** quoted anchor for a reply instruction — the target may have scrolled out
   *  of the transcript window in dense rounds, so it travels with the ask */
  const anchor = (t: PostRec) => `You are replying DIRECTLY to [${t.tag}] ${t.name}${t.role ? ` (${t.role})` : ""}: "${t.content.slice(0, 260)}".`;

  /** §2a crowd interjection burst — ONE batched call turns a crowd sample into
   *  short in-character reactions threaded under this round's posts. Garnish:
   *  skipped (never suspended for) when the slice is out of time. */
  const burst = async (round: number) => {
    const k = burstSize(ctx.cfg.density, ctx.crowd.length);
    if (k === 0 || ctx.isCancelled() || Date.now() > ctx.deadline) return;
    if (posts.some((p) => p.tag === "INTERJECTION" && p.round === round)) return; // resumed past it
    const roundPosts = posts.filter((p) => p.round === round && p.tag !== "TALLY" && p.tag !== "INTERJECTION");
    if (roundPosts.length === 0) return;
    const start = ((round - 1) * k) % ctx.crowd.length;
    const members = [...ctx.crowd.slice(start), ...ctx.crowd.slice(0, start)].slice(0, k);
    const model = TIER_MODELS[ctx.cfg.tier].crowd;
    const t0 = Date.now();
    try {
      const res = await ctx.anthropic.messages.create({
        model,
        max_tokens: 220 * k + 800,
        system:
          `You simulate crowd members interjecting in a public forum thread about: "${ctx.problem}". ` +
          `For EACH member listed, write ONE short in-character reaction (1-2 sentences, plain talk, no jargon) to a SPECIFIC post. ` +
          `Reply ONLY a JSON array: [{"name": "...", "seq": <the post number they react to>, "reaction": "..."}]`,
        messages: [{
          role: "user",
          content:
            `POSTS THIS ROUND:\n${roundPosts.map((p) => `${p.seq} · ${p.name} (${p.role}): ${p.content.slice(0, 200)}`).join("\n")}\n\n` +
            `MEMBERS:\n${members.map((m) => `- ${m.spec.name}: ${m.spec.seat?.role ?? m.spec.role}${m.spec.stances?.[0] ? ` — stance: ${m.spec.stances[0]}` : ""}`).join("\n")}`,
        }],
      });
      await ctx.logCall("engine.burst", model, res.usage, t0, undefined, { mode: ctx.mode, round, members: k });
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const rows = (parseLooseArray(text) ?? []) as { name?: string; seq?: number; reaction?: string }[];
      const valid = new Set(roundPosts.map((p) => p.seq));
      let retargeted = 0;
      let droppedRows = 0;
      for (const r of rows) {
        const member = members.find((m) => m.spec.name === r.name) ?? members.find((m) => r.name && m.spec.name.startsWith(String(r.name).split(" ")[0]));
        if (!member || !r.reaction) { droppedRows += 1; continue; }
        // audit E-G9: a bad seq still lands on the round's last post, but the
        // retarget is COUNTED now instead of silently rewriting the thread
        const onTarget = valid.has(Number(r.seq));
        if (!onTarget) retargeted += 1;
        const target = onTarget ? Number(r.seq) : roundPosts[roundPosts.length - 1].seq;
        currentRound = round;
        seq += 1;
        const content = String(r.reaction).slice(0, 400);
        await ctx.emit({
          type: "post", seq, author: "agent", agent_key: member.key,
          name: member.spec.name, role: member.spec.seat?.role ?? member.spec.role, initials: member.spec.initials,
          thread: "CROWD", reply_to: target, tag: "INTERJECTION", content, cites: [], round,
        });
        posts.push({ name: member.spec.name, role: member.spec.seat?.role ?? member.spec.role, content, tag: "INTERJECTION", seq, agentKey: member.key, round, replyTo: target });
      }
      if (retargeted > 0 || droppedRows > 0) {
        await ctx.logCall("engine.burst", model, null, t0, undefined, { note: "burst integrity", retargeted, dropped: droppedRows, round });
      }
    } catch (e) {
      await ctx.logCall("engine.burst", model, null, t0, e instanceof Error ? e.message : "burst failed");
    }
  };

  /** §2b votes. Two layers share one pass (and one in-memory pair-dedupe):
   *  - microVotes: REALTIME — every 3rd substantive post at lively/bustling, a
   *    rotating 6-voter sample reacts to the last few posts, so ▲/▼ chips move
   *    WHILE the round argues instead of only at the close.
   *  - voteRound: the round close — every lead + a crowd sample sweeps the
   *    whole round (pairs already cast mid-round are skipped).
   *  Emitted as `votes` events; persisted to post_votes. Skipped when out of
   *  time — garnish, never a suspension. */
  const votedPairs = new Map<number, Set<string>>(); // round → "seq:voterKey"
  // 3e selective voting: per-voter per-round budgets (endorse ≤2, reject ≤1)
  // shared by the realtime layer and the closing sweep — a vote on every post
  // reads fake; scarcity is what makes ▲/▼ a citable signal
  const voteBudget = new Map<number, Map<string, { up: number; down: number }>>();
  const votePass = async (round: number, targets: PostRec[], voters: (EngineLead | EngineCrowdMember)[], micro: boolean) => {
    if (ctx.isCancelled() || Date.now() > ctx.deadline) return;
    if (targets.length === 0 || voters.length === 0) return;
    const pairs = votedPairs.get(round) ?? new Set<string>();
    votedPairs.set(round, pairs);
    const model = TIER_MODELS[ctx.cfg.tier].crowd;
    const all: { seq: number; voter_key: string; voter_name: string; voter_role: string; vote: 1 | -1 }[] = [];
    for (let i = 0; i < voters.length; i += 20) {
      if (Date.now() > ctx.deadline) break;
      const batch = voters.slice(i, i + 20);
      const t0 = Date.now();
      try {
        const res = await ctx.anthropic.messages.create({
          model,
          max_tokens: 90 * batch.length + 600,
          system:
            `You simulate panelists and crowd members casting votes on forum arguments about: "${ctx.problem}". ` +
            `Voting is OPT-IN: most voters abstain on most posts — a voter votes ONLY where they would genuinely take a public position. ` +
            `Budget per voter for the WHOLE round: at most 2 endorsements (up) and at most 1 rejection (down); never on their own post. ` +
            `An empty votes array is a normal, common answer. ` +
            `Reply ONLY a JSON array: [{"voter": "...", "votes": [{"seq": <post number>, "vote": "up|down"}]}]`,
          messages: [{
            role: "user",
            content:
              `POSTS:\n${targets.map((p) => `${p.seq} · ${p.name} (${p.role}): ${p.content.slice(0, 180)}`).join("\n")}\n\n` +
              `VOTERS:\n${batch.map((v) => `- ${v.spec.name}: ${v.spec.seat?.role ?? v.spec.role}${v.spec.stances?.[0] ? ` — stance: ${v.spec.stances[0]}` : ""}`).join("\n")}`,
          }],
        });
        await ctx.logCall("engine.votes", model, res.usage, t0, undefined, { mode: ctx.mode, round, voters: batch.length, micro });
        const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
        const rows = (parseLooseArray(text) ?? []) as { voter?: string; votes?: { seq?: number; vote?: string }[] }[];
        const valid = new Map(targets.map((p) => [p.seq, p.agentKey]));
        const budgets = voteBudget.get(round) ?? new Map<string, { up: number; down: number }>();
        voteBudget.set(round, budgets);
        for (const r of rows) {
          const voter = batch.find((v) => v.spec.name === r.voter);
          if (!voter) continue;
          const b = budgets.get(voter.key) ?? { up: 0, down: 0 };
          budgets.set(voter.key, b);
          for (const v of r.votes ?? []) {
            const s = Number(v.seq);
            const down = v.vote === "down";
            if (!valid.has(s) || valid.get(s) === voter.key) continue;   // never on their own post
            if (pairs.has(`${s}:${voter.key}`)) continue;                // each voter votes a post once per round
            if (down ? b.down >= 1 : b.up >= 2) continue;                // 3e: hard budget — enforced, not just prompted
            if (down) b.down += 1; else b.up += 1;
            pairs.add(`${s}:${voter.key}`);
            all.push({ seq: s, voter_key: voter.key, voter_name: voter.spec.name, voter_role: voter.spec.seat?.role ?? voter.spec.role, vote: down ? -1 : 1 });
            voteNet.set(s, (voteNet.get(s) ?? 0) + (down ? -1 : 1));
          }
        }
      } catch (e) {
        await ctx.logCall("engine.votes", model, null, t0, e instanceof Error ? e.message : "votes failed");
      }
    }
    if (all.length > 0) await ctx.emit({ type: "votes", round, votes: all });
    return all.length;
  };
  const substantive = (round: number) => posts.filter((p) => p.round === round && p.tag !== "TALLY" && p.tag !== "INTERJECTION");
  const microVotes = async (round: number) => {
    if (ctx.cfg.density === "focused") return;                       // realtime layer is a living-forum feature
    if (ctx.mode === "Desk" || ctx.mode === "Expedition") return;    // research choreographies never vote
    if (ctx.votedRounds.has(round)) return;                          // resumed past this round's close
    const roundPosts = substantive(round);
    if (roundPosts.length === 0 || roundPosts.length % 3 !== 0) return; // every 3rd post
    const pool = [...ctx.leads, ...ctx.crowd.slice(0, 12)];
    const start = (posts.length * 5) % pool.length;
    const voters = [...pool.slice(start), ...pool.slice(0, start)].slice(0, 6);
    await votePass(round, roundPosts.slice(-3), voters, true);
  };
  const voteRound = async (round: number) => {
    if (ctx.votedRounds.has(round)) return;
    // 3e retro slice: earlier-round posts that drew NEW replies this round
    // re-enter the ballot — votedPairs are per-round, so a voter can flip an
    // old vote (post_votes is (post, voter) latest-wins in the DB)
    const revivedSeqs = new Set(posts.filter((p) => p.round === round && p.replyTo != null).map((p) => p.replyTo!));
    const revived = posts.filter((p) => p.round < round && revivedSeqs.has(p.seq) && p.tag !== "TALLY" && p.tag !== "INTERJECTION");
    const targets = [...substantive(round), ...revived];
    const voters = [...ctx.leads, ...ctx.crowd.slice(0, 12)].slice(0, 32);
    const n = await votePass(round, targets, voters, false);
    // the round is marked once the closing sweep actually shipped votes (or
    // the realtime layer already covered every pair it tried)
    if ((n ?? 0) > 0 || (votedPairs.get(round)?.size ?? 0) > 0) ctx.votedRounds.add(round);
  };

  /** the standard round close for polling modes: poll → interjections → votes.
   *  The poll hears the round it just watched — a compact digest of the
   *  strongest recent posts — so stance movement is reaction, not noise. */
  const roundDigest = (round: number) =>
    substantive(round).slice(-8)
      .map((p) => `${p.name} (${p.role}): ${p.content.slice(0, 200)}`)
      .join("\n").slice(0, 1800);
  /** 6-PR3 resolution tracker (§6c): one Haiku pass per round scores every
   *  sub-ask 0–100 — the COVERAGE strip and the next round's agenda read it.
   *  Soft by design: a failed pass keeps the previous coverage and moves on. */
  const trackCoverage = async (round: number) => {
    if (!ctx.subAsks.length || ctx.trackedRounds.has(round)) return;
    if (Date.now() > ctx.deadline) return; // never start a tracker the slice can't finish
    const model = TIER_MODELS[ctx.cfg.tier].crowd;
    const t0 = Date.now();
    try {
      const res = await ctx.anthropic.messages.create({
        model, max_tokens: 120 * ctx.subAsks.length + 600,
        system: coverageSystem(ctx.subAsks),
        messages: [{ role: "user", content: `TRANSCRIPT SO FAR (latest posts):\n${windowOf(posts, 26)}` }],
      });
      await ctx.logCall("engine.tracker", model, res.usage, t0, undefined, { mode: ctx.mode, round, sub_asks: ctx.subAsks.length });
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const scores = parseCoverage(parseLooseArray(text) ?? [], ctx.subAsks);
      if (!scores) {
        // audit E-G10: an unparseable tracker reply used to freeze the
        // COVERAGE strip at stale values with no mark — re-emit them flagged
        if (ctx.coverage.length) await ctx.emit({ type: "coverage", round, scores: ctx.coverage, stale: true });
        return;
      }
      // merge latest-wins per sub-ask, keeping sub-ask order — EXCEPT settled
      // asks (audit E-G8): once a sub-ask scores ≥85 it never drops (the
      // tracker's sliding window forgets old rounds, and a forgotten-resolved
      // ask used to send the panel back to re-litigate it)
      const byId = new Map(ctx.coverage.map((c) => [c.id, c]));
      for (const s of scores) {
        const prev = byId.get(s.id);
        byId.set(s.id, prev && prev.score >= 85 && s.score < prev.score ? prev : s);
      }
      ctx.coverage = ctx.subAsks.map((s) => byId.get(s.id)).filter((x): x is CoverageScore => Boolean(x));
      ctx.trackedRounds.add(round);
      await ctx.emit({ type: "coverage", round, scores: ctx.coverage });
    } catch (e) {
      await ctx.logCall("engine.tracker", model, null, t0, e instanceof Error ? e.message : "tracker failed");
      // E-G10: same stale re-emit on a thrown tracker call
      if (ctx.coverage.length) await ctx.emit({ type: "coverage", round, scores: ctx.coverage, stale: true });
    }
  };
  // Wave 3 feedback loops: the crowd's read and the position ledger flow
  // back into the NEXT round's instructions (audit E-A1/E-A4)
  let lastCrowdRead = "";
  let positionsLine = "";
  // Wave 3 (audit E-A3): running net endorsement per post — rendered into
  // every transcript window and weighted into reply targeting
  const voteNet = new Map<number, number>();
  // audit E-G7: earlier slices' votes seed the pair-dedupe, the budgets, and
  // the ▲/▼ net overlay — a slice boundary used to reset all three, so a
  // resumed round could re-cast the same votes and double-count the feed
  for (const ev of ctx.priorVoteEvents ?? []) {
    const pairs = votedPairs.get(ev.round) ?? new Set<string>();
    votedPairs.set(ev.round, pairs);
    const budgets = voteBudget.get(ev.round) ?? new Map<string, { up: number; down: number }>();
    voteBudget.set(ev.round, budgets);
    for (const v of ev.votes) {
      if (pairs.has(`${v.seq}:${v.voter_key}`)) continue;
      pairs.add(`${v.seq}:${v.voter_key}`);
      const b = budgets.get(v.voter_key) ?? { up: 0, down: 0 };
      budgets.set(v.voter_key, b);
      if (v.vote === -1) b.down += 1; else b.up += 1;
      voteNet.set(v.seq, (voteNet.get(v.seq) ?? 0) + v.vote);
    }
  }
  const roundClose = async (round: number) => {
    const read = await pollCrowd(ctx, round, roundDigest(round));
    if (read) lastCrowdRead = read;
    await burst(round);
    await voteRound(round);
    await trackCoverage(round);
    if (round < ctx.cfg.rounds && !outOfTime()) {
      const ledger = await positionsDigest(ctx, posts);
      if (ledger) positionsLine = ledger;
    }
  };
  /** the round's agenda (§6c) — rides in opener instructions; emitted once
   *  per round so the feed and header can label the round. null without a
   *  contract, so contract-less runs read exactly as before. */
  const agendaOf = (round: number) =>
    agendaForRound(ctx.subAsks, ctx.coverage.length ? ctx.coverage : null, round, ctx.cfg.rounds);
  /** the feedback block appended to round instructions: last crowd read +
   *  the position ledger (empty on round 1 / when neither exists) */
  const extraContext = () => {
    const bits = [lastCrowdRead, positionsLine].filter(Boolean);
    return bits.length ? `\n${bits.join("\n")}` : "";
  };

  if (ctx.mode === "Roundtable") {
    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      // §6c: the agenda rides in the round instruction (every voice in the
      // circuit walks it); emitted once when the round actually opens fresh
      const agenda = agendaOf(round);
      if (agenda && !did(ctx.leads[0].spec.name, `ROUND ${round}`, round)) {
        await ctx.emit({ type: "agenda", round, label: agenda.label, detail: agenda.instruction });
      }
      const agendaLine = agenda ? ` THIS ROUND'S AGENDA: ${agenda.instruction}` : "";
      for (const lead of ctx.leads) {
        if (!budget()) break;
        if (did(lead.spec.name, `ROUND ${round}`, round)) continue; // resumed mid-round
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
        await turn(lead, {
          round, thread: "ROUNDTABLE", tag: `ROUND ${round}`,
          instruction: round === 1
            ? `Round 1 of ${ctx.cfg.rounds}. Give your opening read on the problem. ${q}${agendaLine}`
            : `Round ${round} of ${ctx.cfg.rounds}. React to the round so far — agree, refine, or push back. If your position changed, say so plainly.${agendaLine}`,
        });
      }
      // §2a crossfire: after the circuit, a density-scaled half-round of direct
      // challenges — the round stops being a polite roll call
      const xfire = crossfireSlots(ctx.leads.length, ctx.cfg.density);
      const xfireSpeakers = [...ctx.leads.slice((round - 1) % ctx.leads.length), ...ctx.leads.slice(0, (round - 1) % ctx.leads.length)].slice(0, xfire);
      for (const speaker of xfireSpeakers) {
        if (!budget()) break;
        if (did(speaker.spec.name, "CROSSFIRE", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
        const target = pickReplyTarget(posts, round, posts.length, speaker.key, ctx.cfg.density);
        if (!target) break;
        await turn(speaker, {
          round, thread: "ROUNDTABLE", tag: "CROSSFIRE", reply_to: target.seq,
          instruction: `${anchor(target as PostRec)} Crossfire: challenge the weakest claim in it or reinforce it with NEW evidence — no restating.`,
        });
      }
      // suspend at the round boundary rather than start a poll the slice can't finish
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
      await roundClose(round);
      if (ctx.cfg.convergence === "stability" && round >= 3) {
        stableStreak = (await stabilityCheck(ctx, windowOf(posts, 30))) ? stableStreak + 1 : 0;
        if (stableStreak >= 2) {
          // Wave 3 (audit E-B3): a stable panel with unresolved sub-asks is
          // NOT converged — coverage gates the stop (missing tracker data
          // never holds the run hostage; the rounds cap still applies)
          const gate = ctx.subAsks.length === 0 || ctx.coverage.length === 0 ||
            Math.min(...ctx.coverage.map((c) => c.score)) >= 70;
          if (gate) { converged = true; stopReason = "stability"; break; }
          await ctx.logCall("engine.converge", "none", null, Date.now(), undefined, { note: "stability blocked by coverage", round, min: Math.min(...ctx.coverage.map((c) => c.score)) });
        }
      }
    }
  } else if (ctx.mode === "Tribunal") {
    // benches: EXPLICIT seat.side first (the Casting Director assigns genuine
    // benches when it recommends Tribunal — field fix "sides split 10 vs 0"),
    // falling back to the kind heuristic for casts made without sides; then
    // AUTO-BALANCE so a 7-v-1 cast still gets a real contest
    const hasSides = ctx.leads.some((l) => l.spec.seat?.side === "pro" || l.spec.seat?.side === "con");
    const con = hasSides
      ? ctx.leads.filter((l) => l.spec.seat?.side === "con" || (!l.spec.seat?.side && l.spec.seat?.adversarial))
      : ctx.leads.filter((l) => l.spec.kind === "consumer" || l.spec.kind === "resident" || l.spec.seat?.adversarial);
    const pro = ctx.leads.filter((l) => !con.includes(l));
    if (ctx.leads.length >= 4) {
      while (con.length < 2 && pro.length > 2) con.push(pro.pop()!);
      while (pro.length < 2 && con.length > 2) pro.push(con.pop()!);
    }
    const residentSide = con;
    const proSide = pro;
    // rotate a 3-seat window each round so EVERY lead argues across the run
    const bench = <T,>(arr: T[], round: number, size = 3): T[] => {
      if (arr.length <= size) return arr;
      const start = ((round - 1) * size) % arr.length;
      return [...arr.slice(start), ...arr.slice(0, start)].slice(0, size);
    };
    // audit E-F7: the judge used to be a CLONE of the pro bench's first lead —
    // backstory and standing stances included — a structural pro-side bias in
    // every round verdict. The judge is now a neutral spec with an explicit
    // impartiality mandate and no inherited positions.
    const judgeLead = proSide[0] ?? ctx.leads[0]; // anchor key only (stable resume identity)
    const judge: EngineLead = { key: `${judgeLead.key}-judge`, spec: neutralJudgeSpec(judgeLead.spec) };
    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      for (const lead of bench(proSide, round)) {
        if (!budget()) break;
        if (did(lead.spec.name, "ARGUMENT", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
        await turn(lead, { round, thread: "TRIBUNAL", tag: "ARGUMENT", side: "pro", instruction: `Round ${round}: argue FOR the thesis with your strongest specific evidence. ${q}${agendaOf(round) ? ` ROUND AGENDA: ${agendaOf(round)!.instruction}` : ""}${extraContext()}` });
      }
      for (const lead of bench(residentSide, round)) {
        if (!budget()) break;
        if (did(lead.spec.name, "REBUTTAL", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
        await turn(lead, { round, thread: "TRIBUNAL", tag: "REBUTTAL", side: "con", instruction: `Round ${round}: rebut the arguments just made — attack the weakest link with specifics.${extraContext()}` });
      }
      // §2a counter-volley: density-scaled COUNTER slots alternating benches
      // (pro answers the rebuttals, con answers back) before the judge rules
      const counters = counterSlots(ctx.cfg.density);
      for (let cvi = 0; cvi < counters; cvi++) {
        if (!budget()) break;
        const side = cvi % 2 === 0 ? "pro" : "con";
        const benchArr = bench(side === "pro" ? proSide : residentSide, round);
        const speaker = benchArr[Math.floor(cvi / 2) % benchArr.length];
        if (did(speaker.spec.name, "COUNTER", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
        // counter the OTHER side's latest volley
        const oppTags = side === "pro" ? ["REBUTTAL", "COUNTER"] : ["ARGUMENT", "COUNTER"];
        const opp = [...posts].reverse().find((p) => p.round === round && oppTags.includes(p.tag) && p.agentKey !== speaker.key);
        if (!opp) break;
        await turn(speaker, {
          round, thread: "TRIBUNAL", tag: "COUNTER", side, reply_to: opp.seq,
          instruction: `${anchor(opp)} Counter it directly — concede what is true, then break the load-bearing claim with specifics.`,
        });
      }
      // resume-skip covers ONLY the judge's turn — `continue` here used to
      // jump the round's crowd poll on resume (the missing-poll bug)
      if (!did("The Judge", "JUDGE'S NOTE", round)) {
        currentRound = round;
        seq += 1;
        const jr = await speak(ctx, judge, { seq, round, thread: "TRIBUNAL", tag: "JUDGE'S NOTE", instruction: `As presiding judge, weigh THIS round only: who carried it and on what evidence? End with the scale: "Round to <side>, <x>–<y>".`, transcript: windowOf(posts), maxTokens: 800 });
        if (jr.text) record(judge, "JUDGE'S NOTE", jr.text); // E-G5: an empty note must not poison did() or the window
      }
      // suspend at the round boundary rather than start a poll the slice can't finish
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
      await roundClose(round);
    }
  } else if (ctx.mode === "Chamber") {
    // blind takes drift into ONE rhetorical mold ("Everybody's chasing…" ×10)
    // when every prompt is identical — rotate the opening angle per seat
    // audit E-D4: 12 angles (panels over 6 used to recycle) with a seeded,
    // resume-stable offset so two runs of the same panel don't share molds
    const angles = chamberAngles;
    const angleOff = chamberAngleOffset(ctx.problem);
    for (let li = 0; li < ctx.leads.length; li++) {
      const lead = ctx.leads[li];
      if (!budget()) break;
      if (did(lead.spec.name, "INDEPENDENT TAKE")) continue;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 1 };
      currentRound = 1;
      seq += 1;
      const r = await speak(ctx, lead, { seq, round: 1, thread: "CHAMBER", tag: "INDEPENDENT TAKE", phase: "takes", instruction: `Write your INDEPENDENT take — you have NOT seen anyone else's. ${angles[(angleOff + li) % angles.length]} ${q}`, transcript: "" });
      if (r.text) record(lead, "INDEPENDENT TAKE", r.text); // E-G5
    }
    if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 1 };
    await roundClose(1); // crowd reacts to the raw takes (poll + interjections + votes)
    const takes = posts.filter((p) => p.tag === "INDEPENDENT TAKE" && p.content.trim());
    // E-G5: with zero surviving takes there is nothing to review — the loop
    // used to peer-review an empty string (and % 0 would NaN the index)
    for (let i = 0; i < ctx.leads.length && budget() && takes.length > 0; i++) {
      const reviewer = ctx.leads[i];
      if (did(reviewer.spec.name, "BLIND REVIEW")) continue;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 2 };
      currentRound = 2;
      const target = takes[(i + 1) % takes.length];
      seq += 1;
      const r = await speak(ctx, reviewer, { seq, round: 2, thread: "CHAMBER", tag: "BLIND REVIEW", phase: "review", instruction: `Peer-review this ANONYMIZED take (author hidden): "${target.content}" — what holds, what breaks, what's missing?`, transcript: "" });
      if (r.text) record(reviewer, "BLIND REVIEW", r.text);
    }
    const chair = ctx.leads[0];
    if (outOfTime() && !did(chair.spec.name, "CHAIR SYNTHESIS")) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 3 };
    // E-G6: a resumed run whose synthesis already landed must not re-run it
    if (!did(chair.spec.name, "CHAIR SYNTHESIS")) {
      currentRound = 3;
      seq += 1;
      const r = await speak(ctx, chair, { seq, round: 3, thread: "CHAMBER", tag: "CHAIR SYNTHESIS", phase: "synthesis", instruction: `As chair, synthesize the takes and reviews into the panel's position: points of consensus, live disagreements, and the recommendation.`, transcript: windowOf(posts, 24), maxTokens: 1400 });
      if (r.text) record(chair, "CHAIR SYNTHESIS", r.text);
    }
    if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 3 };
    await roundClose(3); // and to the chair's recommendation
    stopReason = "choreography"; // fixed shape complete — NOT convergence
  } else if (ctx.mode === "Jury") {
    // §5 Jury = MixtureOfAgents; ROUNDS are the mixture's layers. Round 1 is
    // blind; every later round the jurors see the tally + peer verdicts and
    // re-score — hold or move. Convergence is computed in CODE from score
    // movement (no judge call): stable = nobody moved a full point.
    // (arithmetic lives in the exported jury* helpers so tests pin it)
    const scoresAt = (round: number) => juryScoresAt(posts, round);
    // field report 3: a choose-between brief has NO single scoreable
    // proposition ("which of my 3 images?" → every juror anchored the first
    // image and the panel read 2/10 across the board). When the poll
    // instrument derived options, jurors PICK one with a confidence score.
    const choice = ctx.pollOptions.length >= 2;
    const picksAt = (round: number) => juryPicksAt(posts, round, ctx.pollOptions);
    const optList = ctx.pollOptions.map((o) => `"${o}"`).join(" | ");
    const r1Instruction = choice
      ? `Independent verdict — you have NOT seen the others. THE QUESTION: "${ctx.pollQuestion}" THE OPTIONS — pick EXACTLY ONE, verbatim: ${optList}. Defend your pick in 3–4 sentences. Start EXACTLY with "PICK: <option> · CONFIDENCE: <n>/10 — ". ${q}`
      : `Independent verdict — you have NOT seen the others. Score the proposition 0–10 and defend it in 3–4 sentences. Start EXACTLY with "SCORE: <n>/10 — ". ${q}`;
    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      if (round === 1) {
        // 3e: round 1 is BLIND — verdicts are independent by definition, so
        // they generate fully in PARALLEL (seqs pre-assigned in juror order;
        // posts emitted in that order once all land). Later rounds stay
        // serial: jurors react to the tally and each other.
        const pending = ctx.leads.filter((lead) => !did(lead.spec.name, "VERDICT", 1));
        if (pending.length > 0 && budget()) {
          if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
          const slots = pending.slice(0, Math.max(ctx.cfg.max_posts - posts.length, 1)).map((lead) => { seq += 1; return { lead, mySeq: seq }; });
          const results = await Promise.all(slots.map((s) => speak(ctx, s.lead, {
            seq: s.mySeq, round: 1, thread: "JURY", tag: "VERDICT", transcript: "",
            instruction: r1Instruction,
            deferEmit: true,
          })));
          for (let s = 0; s < slots.length; s++) {
            currentRound = 1;
            if (!results[s].post || !results[s].text) continue; // ghost-post guard
            await ctx.emit(results[s].post!);
            posts.push({ name: slots[s].lead.spec.name, role: slots[s].lead.spec.seat?.role ?? slots[s].lead.spec.role, content: results[s].text, tag: "VERDICT", seq: slots[s].mySeq, agentKey: slots[s].lead.key, round: 1 });
          }
        }
      } else {
        for (const lead of ctx.leads) {
          if (!budget()) break;
          if (did(lead.spec.name, "VERDICT", round)) continue;
          if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
          await turn(lead, {
            round, thread: "JURY", tag: "VERDICT",
            transcript: windowOf(posts, ctx.leads.length + 3),
            instruction: choice
              ? `Deliberation round ${round} of ${ctx.cfg.rounds}. The tally and your peers' verdicts are above. Re-verdict: HOLD your pick or SWITCH — if you switch, name exactly which argument moved you; if you hold against the majority, defend why they're wrong. Options, verbatim: ${optList}. Start EXACTLY with "PICK: <option> · CONFIDENCE: <n>/10 — ".${extraContext()}`
              : `Deliberation round ${round} of ${ctx.cfg.rounds}. The tally and your peers' verdicts are above. Re-score: HOLD or MOVE — if you move, name exactly which argument moved you; if you hold against the majority, defend why they're wrong. Start EXACTLY with "SCORE: <n>/10 — ".${extraContext()}`,
          });
        }
      }
      // the tally is pure arithmetic over the round's scores — no model call
      const cur = scoresAt(round);
      const tallyContent = choice
        ? juryChoiceTallyLine(picksAt(round), round > 1 ? picksAt(round - 1) : new Map(), round, ctx.pollOptions)
        : juryTallyLine(cur, round > 1 ? scoresAt(round - 1) : new Map(), round);
      if (tallyContent && !did("The Tally", "TALLY", round)) {
        const content = tallyContent;
        currentRound = round;
        seq += 1;
        await ctx.emit({
          type: "post", seq, author: "agent", agent_key: "__tally",
          name: "The Tally", role: "Score aggregation", initials: "Σ",
          thread: "JURY", reply_to: null, tag: "TALLY", content, cites: [], round,
        });
        posts.push({ name: "The Tally", role: "Score aggregation", content, tag: "TALLY", seq, agentKey: "__tally", round });
      }
      // suspend at the round boundary rather than start a poll the slice can't finish
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
      await roundClose(round);
      if (ctx.cfg.convergence === "stability" && round >= 2) {
        if (choice) {
          const prevP = picksAt(round - 1);
          const curP = picksAt(round);
          // stable = every returning juror HELD their pick (and everyone who
          // picked this round also picked last round — a new voice = movement)
          const allReturning = [...curP.keys()].every((k) => prevP.has(k));
          if (curP.size > 0 && prevP.size > 0 && allReturning && jurySwitches(prevP, curP) === 0) { converged = true; stopReason = "stability"; break; }
        } else {
          const prev = scoresAt(round - 1);
          const { movedOrNew } = juryMovement(prev, cur);
          if (cur.size > 0 && prev.size > 0 && movedOrNew === 0) { converged = true; stopReason = "stability"; break; }
        }
      }
    }
  } else if (ctx.mode === "Desk") {
    const director = ctx.leads[0];
    const workers = ctx.leads.slice(1);
    // E-G6: the assignment used to re-run on every resumed slice
    if (!did(director.spec.name, "ASSIGNMENT")) {
      currentRound = 1;
      seq += 1;
      const outline = await speak(ctx, director, { seq, round: 1, thread: "DESK", tag: "ASSIGNMENT", phase: "outline", instruction: `As desk director, assign one memo section to each analyst by name: ${workers.map((w) => w.spec.name).join(", ")}. One line per assignment. ${q}`, transcript: "" });
      if (outline.text) record(director, "ASSIGNMENT", outline.text);
    }
    for (const w of workers) {
      if (!budget()) break;
      if (did(w.spec.name, "SECTION DRAFT")) continue;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 2 };
      currentRound = 2;
      seq += 1;
      const r = await speak(ctx, w, { seq, round: 2, thread: "DESK", tag: "SECTION DRAFT", phase: "draft", instruction: `Draft YOUR assigned memo section per the director's assignment — findings first, evidence cited by document name.`, transcript: windowOf(posts, 6) });
      if (r.text) record(w, "SECTION DRAFT", r.text);
    }
    // E-G6: the memo used to re-run on every resumed slice
    if (!did(director.spec.name, "DIRECTOR'S MEMO")) {
      currentRound = 3;
      seq += 1;
      const merge = await speak(ctx, director, { seq, round: 3, thread: "DESK", tag: "DIRECTOR'S MEMO", phase: "merge", instruction: `Merge the sections into the memo's executive summary: verdict, the three numbers that matter, and open risks.`, transcript: windowOf(posts, 20), maxTokens: 1400 });
      if (merge.text) record(director, "DIRECTOR'S MEMO", merge.text);
    }
    stopReason = "choreography";
  } else if (ctx.mode === "Expedition") {
    const phases: { name: string; instruction: string }[] = [
      { name: "QUESTIONS", instruction: "Phase 1 — sharpen the research questions: what must be true, what would kill it?" },
      { name: "RESEARCH", instruction: "Phase 2 — report what the documents and your expertise establish. Cite by name." },
      { name: "ANALYSIS", instruction: "Phase 3 — analyze: what do the findings mean for the decision?" },
      { name: "ALTERNATIVES", instruction: "Phase 4 — propose the strongest alternative path and its tradeoffs." },
      { name: "VERIFY & SYNTHESIZE", instruction: "Phase 5 — stress-test the emerging answer; state the finding you'd stake your name on." },
    ];
    for (let pi = 0; pi < phases.length && budget(); pi++) {
      const ph = phases[pi];
      const start = (pi * 3) % ctx.leads.length;
      const rotated = [...ctx.leads.slice(start), ...ctx.leads.slice(0, start)];
      const scouts = rotated.slice(0, Math.min(3, ctx.leads.length));
      for (const s of scouts) {
        if (!budget()) break;
        if (did(s.spec.name, ph.name)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: pi + 1 };
        currentRound = pi + 1;
        seq += 1;
        const r = await speak(ctx, s, { seq, round: pi + 1, thread: "EXPEDITION", tag: ph.name, phase: ph.name, instruction: `${ph.instruction} ${pi === 0 ? q : ""}`, transcript: windowOf(posts, 10) });
        if (r.text) record(s, ph.name, r.text); // E-G5
      }
    }
    stopReason = "choreography";
  } else {
    // Agora — the default open forum
    const router = async (last: PostRec | undefined): Promise<{ lead: EngineLead; replyTo: number | null }> => {
      if (ctx.cfg.speaker === "round-robin" || !last) return { lead: ctx.leads[posts.length % ctx.leads.length], replyTo: last?.seq ?? null };
      if (ctx.cfg.speaker === "random") return { lead: ctx.leads[Math.floor(((posts.length * 2654435761) % 4294967296) / 4294967296 * ctx.leads.length)], replyTo: last.seq };
      if (ctx.cfg.speaker === "mention-driven") {
        const mentioned = ctx.leads.find((l) => l.key !== last.agentKey && last.content.includes(l.spec.name.split(" ")[0]));
        if (mentioned) return { lead: mentioned, replyTo: last.seq };
      }
      // priority: cheap router picks the most relevant next voice
      const model = TIER_MODELS[ctx.cfg.tier].crowd;
      const t0 = Date.now();
      try {
        const res = await ctx.anthropic.messages.create({
          model, max_tokens: 100,
          system: `Given the last post, reply ONLY the full name of the panelist who should speak next (not the last author). Panel: ${ctx.leads.map((l) => `${l.spec.name} (${l.spec.seat?.role ?? l.spec.role})`).join("; ")}`,
          messages: [{ role: "user", content: `${last.name}: ${last.content}` }],
        });
        await ctx.logCall("engine.router", model, res.usage, t0, undefined, { mode: ctx.mode, picks: "next speaker", after: last.name });
        const name = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
        const pick = ctx.leads.find((l) => name.includes(l.spec.name.split(" ")[0]) && l.key !== last.agentKey);
        if (pick) return { lead: pick, replyTo: last.seq };
      } catch (e) {
        // audit E-G4: a 100%-failing router silently degraded Agora to
        // round-robin with zero trace in monitoring
        await ctx.logCall("engine.router", model, null, t0, e instanceof Error ? e.message : "router failed", { mode: ctx.mode });
      }
      return { lead: ctx.leads[posts.length % ctx.leads.length], replyTo: last.seq };
    };

    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      // resume position counts only the round's LEAD conversation (interjections
      // land after the reply loop, so they never inflate the restart index)
      const inRound = posts.filter((p) => p.round === round && (p.tag.startsWith("POST") || p.tag === "REPLY")).length;
      const opener = ctx.leads[(round - 1) % ctx.leads.length];
      const postNo = posts.filter((p) => p.tag.startsWith("POST")).length + 1;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
      // §6c: the agenda rides in the OPENER instruction — round 1 opens the
      // full brief, middle rounds chase the least-resolved sub-asks by name,
      // the final round forces synthesis. Choreography untouched.
      const agenda = inRound === 0 ? agendaOf(round) : null;
      if (agenda) await ctx.emit({ type: "agenda", round, label: agenda.label, detail: agenda.instruction });
      const agendaLine = agenda ? ` THIS ROUND'S AGENDA: ${agenda.instruction}` : "";
      if (inRound === 0) await turn(opener, {
        round, thread: opener.spec.seat?.discipline || "AGORA", tag: `POST ${postNo}`,
        instruction: round === 1
          ? `Open the deliberation with your read and ONE pointed question for a specific colleague. ${q}${agendaLine}`
          : `Open round ${round}: advance the argument — new evidence, a challenge, or a position change (say "changing my position" if so).${agendaLine}`,
      });
      // §2a density: replies scale with the panel (~1.5–2× leads on lively/
      // bustling), and each reply targets ANY post from the round — weighted
      // toward recent + contested — so real chains form instead of a relay
      const repliesPerRound = agoraReplies(ctx.leads.length, ctx.cfg.density);
      const spokenThisRound = (key: string) =>
        posts.filter((p) => p.round === round && p.agentKey === key && (p.tag.startsWith("POST") || p.tag === "REPLY")).length;
      // 3e parallel reply waves: replies land in batches that share one
      // transcript snapshot — voices genuinely overlap instead of a strict
      // relay. Width lives in lib/run.ts (waveWidth): lively 3 / bustling 4,
      // economy +1, focused serial outside economy. Budgets, seq order,
      // dedupe, and termination are untouched: seqs are pre-assigned in slot
      // order and the wave's posts are emitted in that order once generated.
      const waveWidth = waveWidthOf(ctx.cfg.density, ctx.cfg.tier);
      let i = Math.max(inRound - 1, 0);
      while (i < repliesPerRound && budget()) {
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
        // a wave can NEVER exceed the distinct voices available (leads minus
        // the previous speaker) — wider than that and the guardrail's
        // fallback pool empties, handing the mic back to a taken voice inside
        // the same snapshot where dedupe can't see the pending duplicate
        const size = Math.min(waveWidth, Math.max(ctx.leads.length - 1, 1), repliesPerRound - i, Math.max(ctx.cfg.max_posts - posts.length, 1));
        const snapshot = [...posts];
        const snapWindow = windowOf(snapshot, Math.max(16, repliesPerRound + 6));
        const lastAuthor = snapshot[snapshot.length - 1]?.agentKey;
        const wave: { lead: EngineLead; target: PostRec; mySeq: number }[] = [];
        // virtual view: pending wave assignments count as replies so the necro
        // gate and the contested weighting see them before they've landed
        const virtual = () => [
          ...snapshot,
          ...wave.map((a) => ({ name: a.lead.spec.name, role: "", content: "", tag: "REPLY", seq: a.mySeq, agentKey: a.lead.key, round, replyTo: a.target.seq })),
        ];
        for (let w = 0; w < size; w++) {
          const target = pickReplyTarget(virtual(), round, snapshot.length + w, undefined, ctx.cfg.density) ?? snapshot[snapshot.length - 1];
          let { lead } = await router(target as PostRec);
          const taken = new Set(wave.map((a) => a.lead.key));
          // speaker guardrails (the "Benjamin K. twice in a row" fix), wave-aware:
          // never the same voice back-to-back, never replying to yourself, never
          // twice in one wave; a hot hand yields the mic to a quiet lead.
          const quiet = ctx.leads.filter((l) => spokenThisRound(l.key) === 0 && l.key !== target.agentKey && l.key !== lastAuthor && !taken.has(l.key));
          if (lead.key === lastAuthor || lead.key === target.agentKey || taken.has(lead.key)) {
            // index modulo the FILTERED pool — modulo the panel size could run
            // off the end and hand the mic straight back to the excluded voice
            const pool = ctx.leads.filter((l) => l.key !== lastAuthor && l.key !== target.agentKey && !taken.has(l.key));
            lead = quiet[(snapshot.length + w) % Math.max(quiet.length, 1)]
              ?? pool[(snapshot.length + w) % Math.max(pool.length, 1)]
              ?? lead;
          } else if (quiet.length > 0 && spokenThisRound(lead.key) >= 2) {
            lead = quiet[(snapshot.length + w) % quiet.length];
          }
          seq += 1;
          wave.push({ lead, target: target as PostRec, mySeq: seq });
        }
        const results = await Promise.all(wave.map((a) => speak(ctx, a.lead, {
          seq: a.mySeq, round, thread: a.lead.spec.seat?.discipline || "AGORA", tag: "REPLY", reply_to: a.target.seq,
          transcript: snapWindow,
          // E-D1 + E-D3: own posts (all rounds) + the panel's recent posts +
          // every post being replied to IN THIS WAVE — parallel wave-mates
          // share a snapshot, so a reply that merely restates any wave
          // target would otherwise land as an undetectable twin
          dedupeAgainst: [
            ...snapshot.filter((p) => p.agentKey === a.lead.key).slice(-4).map((p) => p.content),
            ...snapshot.filter((p) => p.agentKey !== a.lead.key && p.tag !== "INTERJECTION" && p.tag !== "TALLY").slice(-6).map((p) => p.content),
            ...wave.map((w2) => w2.target.content),
          ],
          instruction:
            `${anchor(a.target)} Reply to it directly — agree with evidence, refute with specifics, or redirect to what actually matters. If you're changing your position, open with "Changing my position:".` +
            (a.target.round < round
              ? ` NOTE: that post is from ROUND ${a.target.round} — UPDATE the thread with where the debate has moved since; add what's new, never reopen settled points.`
              : ""),
          deferEmit: true,
        })));
        for (let w = 0; w < wave.length; w++) {
          currentRound = round;
          // ghost-post guard: an empty deferred turn has no post event to emit
          if (!results[w].post || !results[w].text) continue;
          await ctx.emit(results[w].post!);
          posts.push({
            name: wave[w].lead.spec.name, role: wave[w].lead.spec.seat?.role ?? wave[w].lead.spec.role,
            content: results[w].text, tag: "REPLY", seq: wave[w].mySeq, agentKey: wave[w].lead.key, round, replyTo: wave[w].target.seq,
          });
          await microVotes(round);
        }
        i += wave.length;
      }
      // suspend at the round boundary rather than start a poll the slice can't finish
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round, stableStreak };
      await roundClose(round);
      if (ctx.cfg.convergence === "stability" && round >= 3) {
        stableStreak = (await stabilityCheck(ctx, windowOf(posts, 30))) ? stableStreak + 1 : 0;
        if (stableStreak >= 2) {
          // Wave 3 (audit E-B3): a stable panel with unresolved sub-asks is
          // NOT converged — coverage gates the stop (missing tracker data
          // never holds the run hostage; the rounds cap still applies)
          const gate = ctx.subAsks.length === 0 || ctx.coverage.length === 0 ||
            Math.min(...ctx.coverage.map((c) => c.score)) >= 70;
          if (gate) { converged = true; stopReason = "stability"; break; }
          await ctx.logCall("engine.converge", "none", null, Date.now(), undefined, { note: "stability blocked by coverage", round, min: Math.min(...ctx.coverage.map((c) => c.score)) });
        }
      }
    }
  }

  // budget cap beats "rounds" as the honest label when it actually bit
  if (!converged && stopReason === "rounds" && posts.length >= ctx.cfg.max_posts) stopReason = "budget";

  // convergence readout (§6.2) — a REAL position census (audit E-B6: the old
  // readout was computed from the cast, not from anyone's position). One
  // crowd-tier call names the dissenters from the closing posts; on any
  // failure we fall back to the cast heuristic, honestly marked unmeasured.
  const census = await positionCensus(ctx, posts);
  if (census) {
    await ctx.emit({ type: "convergence", aligned: census.aligned, total: ctx.leads.length, dissents: census.dissenters.length, dissenters: census.dissenters, measured: true });
  } else {
    const aligned = Math.max(1, ctx.leads.length - (ctx.leads.some((l) => l.spec.seat?.adversarial) ? 1 : 0));
    await ctx.emit({ type: "convergence", aligned, total: ctx.leads.length, dissents: ctx.leads.length - aligned, measured: false });
  }
  return { posts: posts.length, converged, stopReason };
}

/* ---- Take the Floor (§2 Stage 4) — the user posts INTO the forum ---------
 * The user's post is already persisted by the route (author "user", tag
 * "FLOOR"); this generates the mentioned agents' replies with full context
 * of the transcript, corpus, and their personas. Replies are ordinary posts
 * (tag "REPLY", reply_to = the floor post), citable by the report. */

export async function takeTheFloor(ctx: EngineContext, floor: {
  posts: PostRec[];           // full persisted transcript, floor post included
  floorSeq: number;           // the user's post seq
  content: string;            // the user's message
  mentionKeys: string[];      // agent_keys the user @mentioned (may be empty)
}): Promise<number> {
  const round = floor.posts.reduce((m, p) => Math.max(m, p.round), 1);
  let responders = floor.mentionKeys
    .map((k) => ctx.leads.find((l) => l.key === k))
    .filter((l): l is EngineLead => !!l)
    .slice(0, 4);
  if (responders.length === 0) {
    // no explicit mention: first-name match in the message, else the router picks
    const named = ctx.leads.filter((l) => floor.content.includes(l.spec.name.split(" ")[0]));
    responders = named.slice(0, 2);
  }
  if (responders.length === 0) {
    const model = TIER_MODELS[ctx.cfg.tier].crowd;
    const t0 = Date.now();
    try {
      const res = await ctx.anthropic.messages.create({
        model, max_tokens: 100,
        system: `Given the user's question to a panel, reply ONLY the full name of the panelist best placed to answer. Panel: ${ctx.leads.map((l) => `${l.spec.name} (${l.spec.seat?.role ?? l.spec.role})`).join("; ")}`,
        messages: [{ role: "user", content: floor.content.slice(0, 1200) }],
      });
      await ctx.logCall("engine.router", model, res.usage, t0, undefined, { mode: ctx.mode, picks: "floor responder" });
      const name = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
      const pick = ctx.leads.find((l) => name.includes(l.spec.name.split(" ")[0]));
      if (pick) responders = [pick];
    } catch { /* fall through */ }
  }
  if (responders.length === 0 && ctx.leads.length > 0) responders = [ctx.leads[0]];

  const posts = [...floor.posts];
  let seq = posts.reduce((m, p) => Math.max(m, p.seq), 0);
  let replied = 0;
  for (const lead of responders) {
    if (ctx.isCancelled() || Date.now() > ctx.deadline) break;
    seq += 1;
    const r = await speak(ctx, lead, {
      seq, round, thread: "FLOOR", tag: "REPLY", reply_to: floor.floorSeq,
      transcript: windowOf(posts, 24),
      instruction:
        `The client has TAKEN THE FLOOR and posted this, addressed to you:\n"${floor.content.slice(0, 900)}"\n\n` +
        `Answer them directly, in character, with your seat's authority — specifics from the deliberation and the documents, not pleasantries. ` +
        `If their premise is wrong, say so and show why.`,
    });
    posts.push({ name: lead.spec.name, role: lead.spec.seat?.role ?? lead.spec.role, content: r.text, tag: "REPLY", seq, agentKey: lead.key, round, replyTo: floor.floorSeq });
    replied += 1;
  }
  return replied;
}
