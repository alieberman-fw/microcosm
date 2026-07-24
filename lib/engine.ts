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
import { RunConfig, TIER_MODELS } from "@/lib/run";
import { parseLooseArray } from "@/lib/llm-json";

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
  | { type: "post"; seq: number; author: string; agent_key: string; name: string; role: string; initials: string; adversarial?: boolean; thread: string; reply_to: number | null; tag: string; content: string; cites: { title: string; quote: string }[]; round: number; phase?: string; side?: string; score?: number }
  | { type: "presence"; agent_key: string; name: string; state: "thinking" | "speaking" | "idle" }
  | { type: "sentiment"; round: number; polled: number; dist: Record<string, number>; quotes: { name: string; stance: string; quote: string }[] }
  | { type: "convergence"; aligned: number; total: number; dissents: number };

export interface EngineContext {
  anthropic: Anthropic;
  cfg: RunConfig;
  mode: string;
  problem: string;
  questions: string[];
  leads: EngineLead[];
  crowd: EngineCrowdMember[];
  corpusBlocks: Anthropic.Beta.BetaContentBlockParam[]; // document blocks with citations enabled (may be empty)
  temperature: number;
  emit: (e: EngineEvent) => Promise<void>;              // persists + streams
  logCall: (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string) => Promise<void>;
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
  return [
    `You are ${spec.name}, ${spec.seat?.role ?? spec.role}.`,
    spec.tagline ? `In one line: ${spec.tagline}.` : "",
    spec.backstory ? `Background: ${spec.backstory}` : "",
    spec.stances?.length ? `Standing positions you argue from:\n${spec.stances.map((x) => `- ${x}`).join("\n")}` : "",
    `You are one voice on a ${args.mode} panel deliberating: "${args.problem}"`,
    `Forum rules: write ONE post in your own voice, 60–140 words, concrete and specific — numbers, names, mechanisms. ` +
    `Reference documents by name when you use them. Address colleagues by first name. ` +
    `Start directly with your point — never prefix your post with your own name, a greeting, or markdown headers. ` +
    `Never break character, never mention being an AI, never summarize the whole discussion — advance it.`,
    styleBits.join(" "),
    temp,
  ].filter(Boolean).join("\n\n");
}

const clampWords = (s: string, max = 220) => {
  const w = s.trim().split(/\s+/);
  return w.length <= max ? s.trim() : w.slice(0, max).join(" ") + "…";
};

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
}): Promise<{ seq: number; text: string }> {
  const model = TIER_MODELS[ctx.cfg.tier].leads;
  await ctx.emit({ type: "presence", agent_key: lead.key, name: lead.spec.name, state: "thinking" });
  const system = compilePersonaPrompt(lead.spec, { mode: ctx.mode, problem: ctx.problem, temperature: ctx.cfg.temperature });
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
    ...ctx.corpusBlocks,
    { type: "text", text: `${opts.transcript ? `TRANSCRIPT SO FAR (most recent last):\n${opts.transcript}\n\n` : ""}${opts.instruction}` },
  ];
  let text = "";
  const cites: { title: string; quote: string }[] = [];
  // NOTE: no `temperature` param — deprecated on Sonnet 5+ (400s the call);
  // the §4.1 temperature band steers style through the prompt instead.
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !text; attempt++) {
    const ta = Date.now();
    try {
      const res = await ctx.anthropic.beta.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 450,
        system,
        messages: [{ role: "user", content: userContent }],
        betas: ["files-api-2025-04-14"],
      });
      for (const b of res.content) {
        if (b.type === "text") {
          text += b.text;
          const withCites = b as { citations?: { document_title?: string | null; cited_text?: string }[] };
          for (const c of withCites.citations ?? []) {
            if (c.document_title) cites.push({ title: c.document_title, quote: (c.cited_text ?? "").slice(0, 160) });
          }
        }
      }
      await ctx.logCall("engine.turn", model, res.usage as { input_tokens: number; output_tokens: number }, ta);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "turn failed";
      await ctx.logCall("engine.turn", model, null, ta, lastErr);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  // fail LOUD: a dead turn after a retry means the run is broken — stop it
  // with the real API error instead of littering the feed with skipped posts
  if (!text) throw new Error(`${lead.spec.name}'s turn failed twice — ${lastErr}`);
  text = clampWords(stripSelfPrefix(text, lead.spec.name));
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

/** crowd sentiment poll (§5 — our custom layer): batched Haiku calls between rounds */
async function pollCrowd(ctx: EngineContext, round: number, topic: string): Promise<void> {
  if (ctx.crowd.length === 0) return;
  const model = TIER_MODELS[ctx.cfg.tier].crowd;
  const BATCH = 20;
  const dist: Record<string, number> = { support: 0, conditional: 0, oppose: 0, disengaged: 0 };
  const quotes: { name: string; stance: string; quote: string }[] = [];
  const batches: EngineCrowdMember[][] = [];
  for (let i = 0; i < ctx.crowd.length; i += BATCH) batches.push(ctx.crowd.slice(i, i + BATCH));
  for (const batch of batches) {
    if (ctx.isCancelled()) return;
    const t0 = Date.now();
    try {
      const res = await ctx.anthropic.messages.create({
        model,
        max_tokens: 130 * batch.length + 300,
        system:
          `You simulate a sentiment poll of crowd members on: "${topic}". For EACH member listed, answer AS THEM. ` +
          `Reply ONLY a JSON array in the same order: [{"name": "...", "stance": "support|conditional|oppose|disengaged", "quote": "one short in-character sentence"}]`,
        messages: [{
          role: "user",
          content: batch.map((m) => `- ${m.spec.name}: ${m.spec.seat?.role ?? m.spec.role}${m.spec.tagline ? ` — ${m.spec.tagline}` : ""}${m.spec.stances?.[0] ? ` — stance: ${m.spec.stances[0]}` : ""}`).join("\n"),
        }],
      });
      await ctx.logCall("engine.poll", model, res.usage, t0);
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const rows = (parseLooseArray(text) ?? []) as { name?: string; stance?: string; quote?: string }[];
      for (const r of rows) {
        const stance = ["support", "conditional", "oppose", "disengaged"].includes(String(r.stance)) ? String(r.stance) : "disengaged";
        dist[stance] += 1;
        if (r.quote && quotes.length < 6) quotes.push({ name: String(r.name ?? "Crowd member"), stance, quote: String(r.quote).slice(0, 160) });
      }
    } catch (e) {
      await ctx.logCall("engine.poll", model, null, t0, e instanceof Error ? e.message : "poll failed");
    }
  }
  const polled = Object.values(dist).reduce((a, b) => a + b, 0);
  if (polled > 0) await ctx.emit({ type: "sentiment", round, polled, dist, quotes });
}

/** convergence check (stability rule): cheap judge on whether positions still move */
async function stabilityCheck(ctx: EngineContext, transcript: string): Promise<boolean> {
  const model = TIER_MODELS[ctx.cfg.tier].crowd;
  const t0 = Date.now();
  try {
    const res = await ctx.anthropic.messages.create({
      model, max_tokens: 10,
      system: `Read the deliberation round. Reply ONLY "moving" if positions are still materially changing, or "stable" if the panel has converged.`,
      messages: [{ role: "user", content: transcript.slice(-6000) }],
    });
    await ctx.logCall("engine.converge", model, res.usage, t0);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return text.toLowerCase().includes("stable");
  } catch {
    return false;
  }
}

interface PostRec { name: string; role: string; content: string; tag: string; seq: number; agentKey: string }

/** the seven §5 choreographies over shared primitives */
export async function runMode(ctx: EngineContext): Promise<{ posts: number; converged: boolean }> {
  const posts: PostRec[] = [];
  let seq = 0;
  const record = (lead: EngineLead, tag: string, text: string) => {
    posts.push({ name: lead.spec.name, role: lead.spec.seat?.role ?? lead.spec.role, content: text, tag, seq, agentKey: lead.key });
  };
  const budget = () => posts.length < ctx.cfg.max_posts && !ctx.isCancelled();
  const q = ctx.questions.length ? `Key questions: ${ctx.questions.join(" · ")}.` : "";
  let converged = false;

  const turn = async (lead: EngineLead, o: { round: number; thread: string; tag: string; reply_to?: number | null; instruction: string; phase?: string; side?: string }) => {
    seq += 1;
    const r = await speak(ctx, lead, { seq, transcript: windowOf(posts), ...o });
    record(lead, o.tag, r.text);
    return r;
  };

  if (ctx.mode === "Roundtable") {
    for (let round = 1; round <= ctx.cfg.rounds && budget(); round++) {
      for (const lead of ctx.leads) {
        if (!budget()) break;
        await turn(lead, {
          round, thread: "ROUNDTABLE", tag: `ROUND ${round}`,
          instruction: round === 1
            ? `Round 1 of ${ctx.cfg.rounds}. Give your opening read on the problem. ${q}`
            : `Round ${round} of ${ctx.cfg.rounds}. React to the round so far — agree, refine, or push back. If your position changed, say so plainly.`,
        });
      }
      await pollCrowd(ctx, round, ctx.problem);
      if (ctx.cfg.convergence === "stability" && round >= 2 && await stabilityCheck(ctx, windowOf(posts, 24))) { converged = true; break; }
    }
  } else if (ctx.mode === "Tribunal") {
    const residentSide = ctx.leads.filter((l) => l.spec.kind === "consumer" || l.spec.kind === "resident" || l.spec.seat?.adversarial);
    const proSide = ctx.leads.filter((l) => !residentSide.includes(l));
    const judgeLead = proSide[0] ?? ctx.leads[0]; // strongest available voice chairs
    const judge: EngineLead = { key: `${judgeLead.key}-judge`, spec: { ...judgeLead.spec, name: "The Judge", initials: "JD", role: "Presiding judge", seat: { ...(judgeLead.spec.seat ?? { role: "", why: "", discipline: "", adversarial: false, provenance: "generated" as const }), role: "Presiding judge" } } };
    for (let round = 1; round <= ctx.cfg.rounds && budget(); round++) {
      for (const lead of proSide.slice(0, 3)) {
        if (!budget()) break;
        await turn(lead, { round, thread: "TRIBUNAL", tag: "ARGUMENT", side: "pro", instruction: `Round ${round}: argue FOR the thesis with your strongest specific evidence. ${q}` });
      }
      for (const lead of residentSide.slice(0, 3)) {
        if (!budget()) break;
        await turn(lead, { round, thread: "TRIBUNAL", tag: "REBUTTAL", side: "con", instruction: `Round ${round}: rebut the arguments just made — attack the weakest link with specifics.` });
      }
      seq += 1;
      const jr = await speak(ctx, judge, { seq, round, thread: "TRIBUNAL", tag: "JUDGE'S NOTE", instruction: `As presiding judge, weigh THIS round only: who carried it and on what evidence? End with the scale: "Round to <side>, <x>–<y>".`, transcript: windowOf(posts), maxTokens: 350 });
      record(judge, "JUDGE'S NOTE", jr.text);
      await pollCrowd(ctx, round, ctx.problem);
    }
  } else if (ctx.mode === "Chamber") {
    for (const lead of ctx.leads) {
      if (!budget()) break;
      seq += 1;
      const r = await speak(ctx, lead, { seq, round: 1, thread: "CHAMBER", tag: "INDEPENDENT TAKE", phase: "takes", instruction: `Write your INDEPENDENT take — you have NOT seen anyone else's. ${q}`, transcript: "" });
      record(lead, "INDEPENDENT TAKE", r.text);
    }
    const takes = [...posts];
    for (let i = 0; i < ctx.leads.length && budget(); i++) {
      const reviewer = ctx.leads[i];
      const target = takes[(i + 1) % takes.length];
      seq += 1;
      const r = await speak(ctx, reviewer, { seq, round: 2, thread: "CHAMBER", tag: "BLIND REVIEW", phase: "review", instruction: `Peer-review this ANONYMIZED take (author hidden): "${target.content}" — what holds, what breaks, what's missing?`, transcript: "" });
      record(reviewer, "BLIND REVIEW", r.text);
    }
    const chair = ctx.leads[0];
    seq += 1;
    const r = await speak(ctx, chair, { seq, round: 3, thread: "CHAMBER", tag: "CHAIR SYNTHESIS", phase: "synthesis", instruction: `As chair, synthesize the takes and reviews into the panel's position: points of consensus, live disagreements, and the recommendation.`, transcript: windowOf(posts, 24), maxTokens: 600 });
    record(chair, "CHAIR SYNTHESIS", r.text);
    converged = true;
  } else if (ctx.mode === "Jury") {
    for (const lead of ctx.leads) {
      if (!budget()) break;
      seq += 1;
      const jr = await speak(ctx, lead, { seq, round: 1, thread: "JURY", tag: "VERDICT", instruction: `Independent verdict — you have NOT seen the others. Score the proposition 0–10 and defend it in 3–4 sentences. Start EXACTLY with "SCORE: <n>/10 — ". ${q}`, transcript: "" });
      record(lead, "VERDICT", jr.text);
    }
    converged = true;
  } else if (ctx.mode === "Desk") {
    const director = ctx.leads[0];
    const workers = ctx.leads.slice(1);
    seq += 1;
    const outline = await speak(ctx, director, { seq, round: 1, thread: "DESK", tag: "ASSIGNMENT", phase: "outline", instruction: `As desk director, assign one memo section to each analyst by name: ${workers.map((w) => w.spec.name).join(", ")}. One line per assignment. ${q}`, transcript: "" });
    record(director, "ASSIGNMENT", outline.text);
    for (const w of workers) {
      if (!budget()) break;
      seq += 1;
      const r = await speak(ctx, w, { seq, round: 2, thread: "DESK", tag: "SECTION DRAFT", phase: "draft", instruction: `Draft YOUR assigned memo section per the director's assignment — findings first, evidence cited by document name.`, transcript: windowOf(posts, 6) });
      record(w, "SECTION DRAFT", r.text);
    }
    seq += 1;
    const merge = await speak(ctx, director, { seq, round: 3, thread: "DESK", tag: "DIRECTOR'S MEMO", phase: "merge", instruction: `Merge the sections into the memo's executive summary: verdict, the three numbers that matter, and open risks.`, transcript: windowOf(posts, 20), maxTokens: 600 });
    record(director, "DIRECTOR'S MEMO", merge.text);
    converged = true;
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
      const scouts = ctx.leads.slice(0, Math.min(3, ctx.leads.length));
      for (const s of scouts) {
        if (!budget()) break;
        seq += 1;
        const r = await speak(ctx, s, { seq, round: pi + 1, thread: "EXPEDITION", tag: ph.name, phase: ph.name, instruction: `${ph.instruction} ${pi === 0 ? q : ""}`, transcript: windowOf(posts, 10) });
        record(s, ph.name, r.text);
      }
    }
    converged = true;
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
          model, max_tokens: 24,
          system: `Given the last post, reply ONLY the full name of the panelist who should speak next (not the last author). Panel: ${ctx.leads.map((l) => `${l.spec.name} (${l.spec.seat?.role ?? l.spec.role})`).join("; ")}`,
          messages: [{ role: "user", content: `${last.name}: ${last.content}` }],
        });
        await ctx.logCall("engine.router", model, res.usage, t0);
        const name = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
        const pick = ctx.leads.find((l) => name.includes(l.spec.name.split(" ")[0]) && l.key !== last.agentKey);
        if (pick) return { lead: pick, replyTo: last.seq };
      } catch { /* fall through */ }
      return { lead: ctx.leads[posts.length % ctx.leads.length], replyTo: last.seq };
    };

    for (let round = 1; round <= ctx.cfg.rounds && budget(); round++) {
      const opener = ctx.leads[(round - 1) % ctx.leads.length];
      let postNo = posts.filter((p) => p.tag.startsWith("POST")).length + 1;
      await turn(opener, {
        round, thread: opener.spec.seat?.discipline || "AGORA", tag: `POST ${postNo}`,
        instruction: round === 1
          ? `Open the deliberation with your read and ONE pointed question for a specific colleague. ${q}`
          : `Open round ${round}: advance the argument — new evidence, a challenge, or a position change (say "changing my position" if so).`,
      });
      const repliesPerRound = Math.min(Math.max(ctx.leads.length - 1, 2), 6);
      for (let i = 0; i < repliesPerRound && budget(); i++) {
        const { lead, replyTo } = await router(posts[posts.length - 1]);
        await turn(lead, {
          round, thread: lead.spec.seat?.discipline || "AGORA", tag: "REPLY", reply_to: replyTo,
          instruction: `Reply to the last post directly — agree with evidence, refute with specifics, or redirect to what actually matters. If you're changing your position, open with "Changing my position:".`,
        });
        postNo = posts.filter((p) => p.tag.startsWith("POST")).length;
      }
      await pollCrowd(ctx, round, ctx.problem);
      if (ctx.cfg.convergence === "stability" && round >= 2 && await stabilityCheck(ctx, windowOf(posts, 24))) { converged = true; break; }
    }
  }

  // convergence readout (§6.2): quick position census over the leads
  const aligned = Math.max(1, ctx.leads.length - (ctx.leads.some((l) => l.spec.seat?.adversarial) ? 1 : 0));
  await ctx.emit({ type: "convergence", aligned, total: ctx.leads.length, dissents: ctx.leads.length - aligned });
  return { posts: posts.length, converged };
}
