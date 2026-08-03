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
import { FrozenSpec } from "@/lib/casting";
import { RunConfig, TIER_MODELS, agoraReplies, burstSize, counterSlots, crossfireSlots } from "@/lib/run";
import { parseLooseArray } from "@/lib/llm-json";
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
  | { type: "sentiment"; round: number; polled: number; dist: Record<string, number>; quotes: { name: string; stance: string; quote: string }[]; question?: string; options?: string[] }
  | { type: "votes"; round: number; votes: { seq: number; voter_key: string; voter_name: string; voter_role: string; vote: 1 | -1 }[] }
  | { type: "convergence"; aligned: number; total: number; dissents: number };

export interface EngineContext {
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
  emit: (e: EngineEvent) => Promise<void>;              // persists + streams
  logCall: (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => Promise<void>;
  isCancelled: () => boolean;
}

/** §6.1: pure persona → system prompt compilation. Versioned by content. */
export function compilePersonaPrompt(spec: FrozenSpec, args: { mode: string; problem: string; temperature: RunConfig["temperature"] }): string {
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

const clampWords = (s: string, max = 220) => {
  const w = s.trim().split(/\s+/);
  return w.length <= max ? s.trim() : w.slice(0, max).join(" ") + "…";
};

/** cheap token-overlap similarity (0–1) — the duplicate-post detector.
 *  Exported PURE so tests pin the threshold behavior. */
export function textSimilarity(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const A = tok(a), B = tok(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

/** models love opening with "**Their Name.**" — strip any self-prefix */
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
  /** this speaker's earlier posts this round — a near-duplicate draft gets ONE
   *  do-not-restate retry (the "Benjamin K. said it twice" fix) */
  dedupeAgainst?: string[];
}): Promise<{ seq: number; text: string }> {
  const model = TIER_MODELS[ctx.cfg.tier].leads;
  await ctx.emit({ type: "presence", agent_key: lead.key, name: lead.spec.name, state: "thinking" });
  // 3d — tools attach to LEAD turns only, and only when the user enabled them;
  // the addendum makes use agent-decided, never mandatory
  const toolBlocks = toolBlocksFor(ctx.tools, model);
  const system = compilePersonaPrompt(lead.spec, { mode: ctx.mode, problem: ctx.problem, temperature: ctx.cfg.temperature })
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
    return { text, cites };
  };

  let { text, cites } = await attempt();
  // anti-repeat: a contested target can pull the same voice back in — if the
  // draft substantially restates one of this speaker's earlier posts this
  // round, retry ONCE with an explicit order; emit the retry either way
  // (a slightly-similar post beats a hole in the choreography)
  if (opts.dedupeAgainst?.some((prev) => textSimilarity(text, prev) >= 0.8)) {
    try {
      const redo = await attempt(
        "IMPORTANT: Your draft repeated a post you already made this round. Do NOT restate it — " +
        "contribute a NEW argument, a NEW number, or engage a DIFFERENT colleague's point directly."
      );
      text = redo.text;
      cites = redo.cites;
    } catch { /* keep the first draft rather than kill the run */ }
  }
  text = clampWords(stripSelfPrefix(text, lead.spec.name));
  // 3d — every search this turn ran becomes a shared panel fact and a feed
  // card, emitted BEFORE the post so the feed reads "searched, then argued"
  const seenQueries = new Set<string>();
  for (const s of turnSearches) {
    if (seenQueries.has(s.query)) continue;
    seenQueries.add(s.query);
    ctx.pulledFacts.push(s);
    await ctx.emit({ type: "tool", agent_key: lead.key, name: lead.spec.name, tool: "web_search", query: s.query, results: s.results, round: opts.round });
  }
  await ctx.emit({
    type: "post", seq: opts.seq, author: "agent", agent_key: lead.key,
    name: lead.spec.name, role: lead.spec.seat?.role ?? lead.spec.role, initials: lead.spec.initials,
    adversarial: lead.spec.seat?.adversarial || lead.spec.kind === "adversarial",
    thread: opts.thread, reply_to: opts.reply_to ?? null, tag: opts.tag, content: text,
    cites: cites.slice(0, 4), round: opts.round, phase: opts.phase, side: opts.side,
  });
  return { seq: opts.seq, text };
}

/** transcript window: the last N posts as compact attributed lines */
function windowOf(posts: { name: string; role: string; content: string; tag: string }[], n = 16): string {
  return posts.slice(-n).map((p) => `[${p.tag}] ${p.name} (${p.role}): ${p.content}`).join("\n");
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
 *  degrades to the classic stance poll (one choice is a proposition). */
export function parsePollInstrument(text: string, fallback: string): { question: string; options: string[] } {
  const bail = { question: fallback, options: [] as string[] };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return bail;
  try {
    const obj = JSON.parse(m[0]) as { question?: unknown; options?: unknown };
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
    return {
      question: question.length >= 12 && question.length <= 240 ? question : fallback,
      options: options.length >= 2 ? options : [],
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
): Promise<{ question: string; options: string[] }> {
  const t0 = Date.now();
  try {
    const res = await anthropic.messages.create({
      model, max_tokens: 900, // headroom for adaptive thinking on Sonnet-class crowd tiers
      system:
        `Turn a research brief into ONE neutral poll question for a crowd of ordinary people (residents, buyers, renters, neighbors), and decide the instrument:\n` +
        `- If the brief asks to CHOOSE AMONG named alternatives (photos, floor plans, sites, unit mixes, price points), the question asks which one — and "options" lists those alternatives EXACTLY as the brief names them (2-5, each under 6 words, brief's order; never invent an alternative).\n` +
        `- Otherwise "options" is [] and the question is a single plain-language proposition someone can SUPPORT or OPPOSE — answerable YES or NO, never an either/or choice (if the brief weighs unnamed options, make the leading one the subject: "Should X do Y?").\n` +
        `Question max 22 words, no jargon, no acronyms. Reply ONLY JSON: {"question": "...", "options": []}`,
      messages: [{ role: "user", content: problem.slice(0, 4000) }],
    });
    await logCall("engine.poll_question", model, res.usage, t0);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return parsePollInstrument(text, problem);
  } catch (e) {
    await logCall("engine.poll_question", model, null, t0, e instanceof Error ? e.message : "derive failed");
    return { question: problem, options: [] };
  }
}

/** crowd sentiment poll (§5 — our custom layer): batched Haiku calls between
 *  rounds. Batches run 3-CONCURRENT (a 169-member poll was ~9 serial calls —
 *  minutes of wall-clock that blew slices past the serverless window) and the
 *  poll is DEADLINE-AWARE: when time runs out mid-poll it emits the partial
 *  tally honestly instead of dragging the run into a hard kill. Each round's
 *  poll carries a digest of what the panel just argued, so movement between
 *  rounds is reaction, not sampling noise. */
async function pollCrowd(ctx: EngineContext, round: number, digest?: string): Promise<void> {
  if (ctx.crowd.length === 0) return;
  if (ctx.polledRounds.has(round)) return; // already polled before a suspension
  await ctx.emit({ type: "polling", round, count: ctx.crowd.length }); // canvas animates WHILE the poll runs
  const model = TIER_MODELS[ctx.cfg.tier].crowd;
  const BATCH = 20;
  const choice = ctx.pollOptions.length >= 2; // the brief named alternatives — poll the actual choices
  const dist: Record<string, number> = choice
    ? Object.fromEntries(ctx.pollOptions.map((o) => [o, 0])) // insertion order = display order
    : { support: 0, conditional: 0, oppose: 0, disengaged: 0 };
  const quotes: { name: string; stance: string; quote: string }[] = [];
  const batches: EngineCrowdMember[][] = [];
  for (let i = 0; i < ctx.crowd.length; i += BATCH) batches.push(ctx.crowd.slice(i, i + BATCH));
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
            ? `You simulate a preference poll. THE POLL QUESTION: "${ctx.pollQuestion}". For EACH member listed, answer AS THEM${digest ? ", reacting to the question AND to what the panel just argued" : ""}. ` +
              `THE CHOICES — pick EXACTLY ONE per member, verbatim:\n` +
              ctx.pollOptions.map((o) => `- "${o}"`).join("\n") + "\n" +
              `A member who genuinely cannot pick may answer "undecided" — use it sparingly; most people lean somewhere.\n` +
              `Reply ONLY a JSON array in the same order: [{"name": "...", "choice": "one of the choices verbatim", "quote": "one short in-character sentence on why"}]`
            : `You simulate a sentiment poll. THE POLL QUESTION: "${ctx.pollQuestion}". For EACH member listed, answer AS THEM${digest ? ", reacting to the question AND to what the panel just argued" : ""}. ` +
              `Stances — exactly one per member:\n` +
              `- "support": they would say yes to the question.\n` +
              `- "conditional": yes, but only if a specific concern is handled — name it in the quote.\n` +
              `- "oppose": they would say no.\n` +
              `- "disengaged": the outcome truly would not touch their life and they would pay no attention. Most people have SOME leaning — use this sparingly, and NEVER as a stand-in for neutral or undecided (that is "conditional").\n` +
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
        for (const r of rows) {
          let stance: string;
          if (choice) {
            const norm = normalizeChoice(r.choice ?? r.stance, ctx.pollOptions);
            stance = norm ?? "undecided"; // unrecognized answers are counted honestly, never assigned a choice
            if (!norm) coerced += 1;
            if (!(stance in dist)) dist[stance] = 0;
          } else {
            const norm = normalizeStance(r.stance);
            stance = norm ?? "disengaged"; // truly unrecognized only — counted below, no longer the neutral dumping ground
            if (!norm) coerced += 1;
          }
          dist[stance] += 1;
          if (r.quote && quotes.length < 6) quotes.push({ name: String(r.name ?? "Crowd member"), stance, quote: String(r.quote).slice(0, 160) });
        }
        if (coerced > 0) await ctx.logCall("engine.poll", model, null, t0, undefined, { note: "unrecognized stances coerced", coerced, round });
      } catch (e) {
        await ctx.logCall("engine.poll", model, null, t0, e instanceof Error ? e.message : "poll failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  const polled = Object.values(dist).reduce((a, b) => a + b, 0);
  // the round counts as polled only once results actually shipped — an
  // aborted poll gets re-run in full on the next slice
  if (polled > 0) {
    ctx.polledRounds.add(round);
    await ctx.emit({ type: "sentiment", round, polled, dist, quotes, question: ctx.pollQuestion, ...(choice ? { options: ctx.pollOptions } : {}) });
  }
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
    return text.toLowerCase().includes("stable");
  } catch {
    return false;
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

/* ---- reply targeting (§2a threading) — exported PURE so tests pin it ---- */

/** Pick which post a reply should target: any substantive post from this
 *  round, weighted toward RECENT and CONTESTED (already drawing replies) —
 *  real chains (John → Sarah → Bob) instead of a strict last-post relay.
 *  `salt` rotates among the top candidates so chains fork deterministically. */
export function pickReplyTarget(
  posts: Pick<PostRec, "seq" | "round" | "tag" | "agentKey" | "name" | "content" | "replyTo">[],
  round: number,
  salt: number,
  excludeAgentKey?: string,
): (typeof posts)[number] | null {
  const replyCount = new Map<number, number>();
  for (const p of posts) {
    if (p.replyTo != null) replyCount.set(p.replyTo, (replyCount.get(p.replyTo) ?? 0) + 1);
  }
  const cands = posts.filter((p) =>
    p.round === round && p.tag !== "TALLY" && p.tag !== "INTERJECTION" && p.agentKey !== excludeAgentKey);
  if (cands.length === 0) return null;
  const scored = cands.map((p, i) => ({
    p,
    w: 1 / (1 + (cands.length - 1 - i)) + 0.7 * (replyCount.get(p.seq) ?? 0),
  }));
  scored.sort((a, b) => b.w - a.w || b.p.seq - a.p.seq);
  return scored[Math.abs(salt) % Math.min(3, scored.length)].p;
}

/** why the run stopped — the UI and the report must never claim convergence
 *  for a mode that simply finished its fixed choreography */
export type StopReason = "stability" | "rounds" | "budget" | "choreography";

/** the seven §5 choreographies over shared primitives */
export interface RunResume { posts: PostRec[]; seq: number; round: number }

export async function runMode(ctx: EngineContext, resume?: RunResume): Promise<{ posts: number; converged: boolean; stopReason: StopReason; suspendedAtRound?: number }> {
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
  let stableStreak = 0; // stop only after TWO consecutive stable rounds (round ≥ 3)

  const turn = async (lead: EngineLead, o: { round: number; thread: string; tag: string; reply_to?: number | null; instruction: string; phase?: string; side?: string; transcript?: string }) => {
    const { transcript, ...rest } = o;
    currentRound = o.round;
    seq += 1;
    // the speaker's own earlier posts this round feed the anti-repeat check
    const dedupeAgainst = posts
      .filter((p) => p.agentKey === lead.key && p.round === o.round)
      .map((p) => p.content);
    const r = await speak(ctx, lead, { seq, transcript: transcript ?? windowOf(posts), dedupeAgainst, ...rest });
    record(lead, o.tag, r.text, o.reply_to ?? null);
    await microVotes(o.round);
    return r;
  };
  const startRound = resume?.round ?? 1;
  /** quoted anchor for a reply instruction — the target may have scrolled out
   *  of the transcript window in dense rounds, so it travels with the ask */
  const anchor = (t: PostRec) => `You are replying DIRECTLY to [${t.tag}] ${t.name} (${t.role}): "${t.content.slice(0, 260)}".`;

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
      for (const r of rows) {
        const member = members.find((m) => m.spec.name === r.name) ?? members.find((m) => r.name && m.spec.name.startsWith(String(r.name).split(" ")[0]));
        if (!member || !r.reaction) continue;
        const target = valid.has(Number(r.seq)) ? Number(r.seq) : roundPosts[roundPosts.length - 1].seq;
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
            `For EACH voter listed, decide IN CHARACTER which of the posts they would endorse (up) or reject (down) — up to 2 votes each, never on their own post. ` +
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
        for (const r of rows) {
          const voter = batch.find((v) => v.spec.name === r.voter);
          if (!voter) continue;
          for (const v of (r.votes ?? []).slice(0, 2)) {
            const s = Number(v.seq);
            if (!valid.has(s) || valid.get(s) === voter.key) continue;   // never on their own post
            if (pairs.has(`${s}:${voter.key}`)) continue;                // each voter votes a post once
            pairs.add(`${s}:${voter.key}`);
            all.push({ seq: s, voter_key: voter.key, voter_name: voter.spec.name, voter_role: voter.spec.seat?.role ?? voter.spec.role, vote: v.vote === "down" ? -1 : 1 });
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
    const targets = substantive(round);
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
  const roundClose = async (round: number) => {
    await pollCrowd(ctx, round, roundDigest(round));
    await burst(round);
    await voteRound(round);
  };

  if (ctx.mode === "Roundtable") {
    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      for (const lead of ctx.leads) {
        if (!budget()) break;
        if (did(lead.spec.name, `ROUND ${round}`, round)) continue; // resumed mid-round
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
        await turn(lead, {
          round, thread: "ROUNDTABLE", tag: `ROUND ${round}`,
          instruction: round === 1
            ? `Round 1 of ${ctx.cfg.rounds}. Give your opening read on the problem. ${q}`
            : `Round ${round} of ${ctx.cfg.rounds}. React to the round so far — agree, refine, or push back. If your position changed, say so plainly.`,
        });
      }
      // §2a crossfire: after the circuit, a density-scaled half-round of direct
      // challenges — the round stops being a polite roll call
      const xfire = crossfireSlots(ctx.leads.length, ctx.cfg.density);
      const xfireSpeakers = [...ctx.leads.slice((round - 1) % ctx.leads.length), ...ctx.leads.slice(0, (round - 1) % ctx.leads.length)].slice(0, xfire);
      for (const speaker of xfireSpeakers) {
        if (!budget()) break;
        if (did(speaker.spec.name, "CROSSFIRE", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
        const target = pickReplyTarget(posts, round, posts.length, speaker.key);
        if (!target) break;
        await turn(speaker, {
          round, thread: "ROUNDTABLE", tag: "CROSSFIRE", reply_to: target.seq,
          instruction: `${anchor(target as PostRec)} Crossfire: challenge the weakest claim in it or reinforce it with NEW evidence — no restating.`,
        });
      }
      // suspend at the round boundary rather than start a poll the slice can't finish
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
      await roundClose(round);
      if (ctx.cfg.convergence === "stability" && round >= 3) {
        stableStreak = (await stabilityCheck(ctx, windowOf(posts, 30))) ? stableStreak + 1 : 0;
        if (stableStreak >= 2) { converged = true; stopReason = "stability"; break; }
      }
    }
  } else if (ctx.mode === "Tribunal") {
    // benches by kind first, then AUTO-BALANCE: a 7-v-1 cast still gets a
    // real contest — the skeptic plus the nearest leads move to the thin side
    const con = ctx.leads.filter((l) => l.spec.kind === "consumer" || l.spec.kind === "resident" || l.spec.seat?.adversarial);
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
    const judgeLead = proSide[0] ?? ctx.leads[0]; // strongest available voice chairs
    const judge: EngineLead = { key: `${judgeLead.key}-judge`, spec: { ...judgeLead.spec, name: "The Judge", initials: "JD", role: "Presiding judge", seat: { ...(judgeLead.spec.seat ?? { role: "", why: "", discipline: "", adversarial: false, provenance: "generated" as const }), role: "Presiding judge" } } };
    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      for (const lead of bench(proSide, round)) {
        if (!budget()) break;
        if (did(lead.spec.name, "ARGUMENT", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
        await turn(lead, { round, thread: "TRIBUNAL", tag: "ARGUMENT", side: "pro", instruction: `Round ${round}: argue FOR the thesis with your strongest specific evidence. ${q}` });
      }
      for (const lead of bench(residentSide, round)) {
        if (!budget()) break;
        if (did(lead.spec.name, "REBUTTAL", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
        await turn(lead, { round, thread: "TRIBUNAL", tag: "REBUTTAL", side: "con", instruction: `Round ${round}: rebut the arguments just made — attack the weakest link with specifics.` });
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
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
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
        record(judge, "JUDGE'S NOTE", jr.text);
      }
      // suspend at the round boundary rather than start a poll the slice can't finish
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
      await roundClose(round);
    }
  } else if (ctx.mode === "Chamber") {
    // blind takes drift into ONE rhetorical mold ("Everybody's chasing…" ×10)
    // when every prompt is identical — rotate the opening angle per seat
    const angles = [
      "Open with the single most decisive NUMBER from your domain and build from it.",
      "Open with a specific place, project, or deal you know first-hand and what it proves here.",
      "Open with the failure mode you'd bet on — what breaks first, and at what threshold.",
      "Open with the question the brief should have asked but didn't, then answer it.",
      "Open with the strongest point AGAINST your own instinct, then say why you still land where you land.",
      "Open with a timeline — what has to happen by when, and where the calendar kills the plan.",
    ];
    for (let li = 0; li < ctx.leads.length; li++) {
      const lead = ctx.leads[li];
      if (!budget()) break;
      if (did(lead.spec.name, "INDEPENDENT TAKE")) continue;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 1 };
      currentRound = 1;
      seq += 1;
      const r = await speak(ctx, lead, { seq, round: 1, thread: "CHAMBER", tag: "INDEPENDENT TAKE", phase: "takes", instruction: `Write your INDEPENDENT take — you have NOT seen anyone else's. ${angles[li % angles.length]} ${q}`, transcript: "" });
      record(lead, "INDEPENDENT TAKE", r.text);
    }
    if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 1 };
    await roundClose(1); // crowd reacts to the raw takes (poll + interjections + votes)
    const takes = posts.filter((p) => p.tag === "INDEPENDENT TAKE");
    for (let i = 0; i < ctx.leads.length && budget(); i++) {
      const reviewer = ctx.leads[i];
      if (did(reviewer.spec.name, "BLIND REVIEW")) continue;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 2 };
      currentRound = 2;
      const target = takes[(i + 1) % takes.length];
      seq += 1;
      const r = await speak(ctx, reviewer, { seq, round: 2, thread: "CHAMBER", tag: "BLIND REVIEW", phase: "review", instruction: `Peer-review this ANONYMIZED take (author hidden): "${target.content}" — what holds, what breaks, what's missing?`, transcript: "" });
      record(reviewer, "BLIND REVIEW", r.text);
    }
    const chair = ctx.leads[0];
    if (outOfTime() && !did(chair.spec.name, "CHAIR SYNTHESIS")) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 3 };
    currentRound = 3;
    seq += 1;
    const r = await speak(ctx, chair, { seq, round: 3, thread: "CHAMBER", tag: "CHAIR SYNTHESIS", phase: "synthesis", instruction: `As chair, synthesize the takes and reviews into the panel's position: points of consensus, live disagreements, and the recommendation.`, transcript: windowOf(posts, 24), maxTokens: 1400 });
    record(chair, "CHAIR SYNTHESIS", r.text);
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
    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      for (const lead of ctx.leads) {
        if (!budget()) break;
        if (did(lead.spec.name, "VERDICT", round)) continue;
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
        await turn(lead, {
          round, thread: "JURY", tag: "VERDICT",
          transcript: round === 1 ? "" : windowOf(posts, ctx.leads.length + 3),
          instruction: round === 1
            ? `Independent verdict — you have NOT seen the others. Score the proposition 0–10 and defend it in 3–4 sentences. Start EXACTLY with "SCORE: <n>/10 — ". ${q}`
            : `Deliberation round ${round} of ${ctx.cfg.rounds}. The tally and your peers' verdicts are above. Re-score: HOLD or MOVE — if you move, name exactly which argument moved you; if you hold against the majority, defend why they're wrong. Start EXACTLY with "SCORE: <n>/10 — ".`,
        });
      }
      // the tally is pure arithmetic over the round's scores — no model call
      const cur = scoresAt(round);
      const tallyContent = juryTallyLine(cur, round > 1 ? scoresAt(round - 1) : new Map(), round);
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
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
      await roundClose(round);
      if (ctx.cfg.convergence === "stability" && round >= 2) {
        const prev = scoresAt(round - 1);
        const { movedOrNew } = juryMovement(prev, cur);
        if (cur.size > 0 && prev.size > 0 && movedOrNew === 0) { converged = true; stopReason = "stability"; break; }
      }
    }
  } else if (ctx.mode === "Desk") {
    const director = ctx.leads[0];
    const workers = ctx.leads.slice(1);
    currentRound = 1;
    seq += 1;
    const outline = await speak(ctx, director, { seq, round: 1, thread: "DESK", tag: "ASSIGNMENT", phase: "outline", instruction: `As desk director, assign one memo section to each analyst by name: ${workers.map((w) => w.spec.name).join(", ")}. One line per assignment. ${q}`, transcript: "" });
    record(director, "ASSIGNMENT", outline.text);
    for (const w of workers) {
      if (!budget()) break;
      if (did(w.spec.name, "SECTION DRAFT")) continue;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: 2 };
      currentRound = 2;
      seq += 1;
      const r = await speak(ctx, w, { seq, round: 2, thread: "DESK", tag: "SECTION DRAFT", phase: "draft", instruction: `Draft YOUR assigned memo section per the director's assignment — findings first, evidence cited by document name.`, transcript: windowOf(posts, 6) });
      record(w, "SECTION DRAFT", r.text);
    }
    seq += 1;
    const merge = await speak(ctx, director, { seq, round: 3, thread: "DESK", tag: "DIRECTOR'S MEMO", phase: "merge", instruction: `Merge the sections into the memo's executive summary: verdict, the three numbers that matter, and open risks.`, transcript: windowOf(posts, 20), maxTokens: 1400 });
    record(director, "DIRECTOR'S MEMO", merge.text);
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
        record(s, ph.name, r.text);
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
      } catch { /* fall through */ }
      return { lead: ctx.leads[posts.length % ctx.leads.length], replyTo: last.seq };
    };

    for (let round = startRound; round <= ctx.cfg.rounds && budget(); round++) {
      // resume position counts only the round's LEAD conversation (interjections
      // land after the reply loop, so they never inflate the restart index)
      const inRound = posts.filter((p) => p.round === round && (p.tag.startsWith("POST") || p.tag === "REPLY")).length;
      const opener = ctx.leads[(round - 1) % ctx.leads.length];
      const postNo = posts.filter((p) => p.tag.startsWith("POST")).length + 1;
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
      if (inRound === 0) await turn(opener, {
        round, thread: opener.spec.seat?.discipline || "AGORA", tag: `POST ${postNo}`,
        instruction: round === 1
          ? `Open the deliberation with your read and ONE pointed question for a specific colleague. ${q}`
          : `Open round ${round}: advance the argument — new evidence, a challenge, or a position change (say "changing my position" if so).`,
      });
      // §2a density: replies scale with the panel (~1.5–2× leads on lively/
      // bustling), and each reply targets ANY post from the round — weighted
      // toward recent + contested — so real chains form instead of a relay
      const repliesPerRound = agoraReplies(ctx.leads.length, ctx.cfg.density);
      const spokenThisRound = (key: string) =>
        posts.filter((p) => p.round === round && p.agentKey === key && (p.tag.startsWith("POST") || p.tag === "REPLY")).length;
      for (let i = Math.max(inRound - 1, 0); i < repliesPerRound && budget(); i++) {
        if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
        const target = pickReplyTarget(posts, round, posts.length) ?? posts[posts.length - 1];
        const lastAuthor = posts[posts.length - 1]?.agentKey;
        let { lead } = await router(target as PostRec);
        // speaker guardrails (the "Benjamin K. twice in a row" fix):
        // 1. never the same voice back-to-back, never replying to yourself;
        // 2. relevance yields to COVERAGE — a hot hand with 2+ posts this
        //    round gives the mic to a lead who has not spoken yet.
        const quiet = ctx.leads.filter((l) => spokenThisRound(l.key) === 0 && l.key !== target.agentKey && l.key !== lastAuthor);
        if (lead.key === lastAuthor || lead.key === target.agentKey) {
          lead = quiet[posts.length % Math.max(quiet.length, 1)]
            ?? ctx.leads.filter((l) => l.key !== lastAuthor && l.key !== target.agentKey)[posts.length % Math.max(ctx.leads.length - 1, 1)]
            ?? lead;
        } else if (quiet.length > 0 && spokenThisRound(lead.key) >= 2) {
          lead = quiet[posts.length % quiet.length];
        }
        await turn(lead, {
          round, thread: lead.spec.seat?.discipline || "AGORA", tag: "REPLY", reply_to: target.seq,
          transcript: windowOf(posts, Math.max(16, repliesPerRound + 6)),
          instruction: `${anchor(target as PostRec)} Reply to it directly — agree with evidence, refute with specifics, or redirect to what actually matters. If you're changing your position, open with "Changing my position:".`,
        });
      }
      // suspend at the round boundary rather than start a poll the slice can't finish
      if (outOfTime()) return { posts: posts.length, converged: false, stopReason, suspendedAtRound: round };
      await roundClose(round);
      if (ctx.cfg.convergence === "stability" && round >= 3) {
        stableStreak = (await stabilityCheck(ctx, windowOf(posts, 30))) ? stableStreak + 1 : 0;
        if (stableStreak >= 2) { converged = true; stopReason = "stability"; break; }
      }
    }
  }

  // budget cap beats "rounds" as the honest label when it actually bit
  if (!converged && stopReason === "rounds" && posts.length >= ctx.cfg.max_posts) stopReason = "budget";

  // convergence readout (§6.2): quick position census over the leads
  const aligned = Math.max(1, ctx.leads.length - (ctx.leads.some((l) => l.spec.seat?.adversarial) ? 1 : 0));
  await ctx.emit({ type: "convergence", aligned, total: ctx.leads.length, dissents: ctx.leads.length - aligned });
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
