/**
 * FakeAnthropic — the offline seam for the Phase-1 engine matrix
 * (docs/next-level-plan.md §1a). EngineContext takes its client by injection,
 * so this fake runs every choreography with zero tokens in milliseconds.
 *
 * It classifies each call by its system prompt (turn · poll · router ·
 * stability judge), answers deterministically, ADVANCES A MOCKED CLOCK per
 * call (so deadline/suspend paths are exactly controllable), and records a
 * call log for assertions. Failure injection covers empty responses, thrown
 * API errors, and malformed JSON.
 */

import { vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { EngineContext, EngineEvent, EngineLead, PostRec, RunResume } from "@/lib/engine";
import type { FrozenSpec } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig } from "@/lib/run";

/* ------------------------------- clock ---------------------------------- */

export class FakeClock {
  now = 1_700_000_000_000;
  constructor() {
    vi.spyOn(Date, "now").mockImplementation(() => this.now);
  }
  tick(ms: number) { this.now += ms; }
}

/* ---------------------------- call classification ------------------------ */

export type CallKind = "turn" | "poll" | "pollx" | "pollq" | "router" | "judge" | "burst" | "votes" | "unknown";

export function classify(system: string): CallKind {
  if (system.includes("Forum rules")) return "turn";
  if (system.includes("neutral poll question")) return "pollq";
  if (system.includes("preference poll")) return "pollx";
  if (system.includes("sentiment poll")) return "poll";
  if (system.includes("interjecting")) return "burst";
  if (system.includes("casting votes")) return "votes";
  if (system.includes("full name of the panelist")) return "router";
  if (system.includes('"stable" or "moving"')) return "judge";
  return "unknown";
}

export interface FakeCall { kind: CallKind; system: string; user: string; model: string; maxTokens: number; tools?: unknown[] }

export interface FakeOptions {
  /** ms the mocked clock advances per model call (drives deadline paths) */
  tickMs?: number;
  /** stability judge script: verdict for the Nth judge call (1-based); default all "moving" */
  judgeScript?: (n: number) => "stable" | "moving";
  /** juror score for (agentName, round) — drives Jury arithmetic */
  juryScore?: (name: string, round: number) => number;
  /** turn text override; return undefined for the default */
  turnText?: (call: FakeCall, n: number) => string | undefined;
  /** inject failures: called per call — "empty" | "throw" | "garbage" | undefined */
  failure?: (kind: CallKind, n: number) => "empty" | "throw" | "garbage" | undefined;
  /** 3d — fabricate a server-side web search on this turn call (default: never) */
  searchOnTurn?: (call: FakeCall, n: number) => boolean;
}

/* ------------------------------ the fake --------------------------------- */

export function makeFakeAnthropic(clock: FakeClock, opts: FakeOptions = {}) {
  const calls: FakeCall[] = [];
  let judgeN = 0;
  let turnRound = 0; // parsed from instruction when present

  const respond = (params: { model: string; system?: unknown; max_tokens: number; messages: { role: string; content: unknown }[]; tools?: unknown[] }) => {
    clock.tick(opts.tickMs ?? 1000);
    const system = String(params.system ?? "");
    const userBlocks = params.messages[params.messages.length - 1]?.content;
    const user = typeof userBlocks === "string"
      ? userBlocks
      : (userBlocks as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const kind = classify(system);
    const call: FakeCall = { kind, system, user, model: params.model, maxTokens: params.max_tokens, tools: params.tools };
    calls.push(call);
    const n = calls.length;

    const failure = opts.failure?.(kind, n);
    if (failure === "throw") throw new Error(`fake API error (call ${n})`);

    let text = "";
    if (failure === "empty") {
      text = "";
    } else if (failure === "garbage") {
      text = "not json at all {{{";
    } else if (kind === "poll") {
      // answer AS each listed member, echoing their names back
      const names = user.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).split(":")[0]);
      text = JSON.stringify(names.map((name, i) => ({
        name, stance: ["support", "conditional", "oppose", "disengaged"][i % 4], quote: `as ${name} says`,
      })));
    } else if (kind === "pollx") {
      // choice instrument: members pick the offered choices round-robin
      const options = [...system.matchAll(/^- "([^"]+)"$/gm)].map((m) => m[1]);
      const names = user.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).split(":")[0]);
      text = JSON.stringify(names.map((name, i) => ({
        name, choice: options[i % Math.max(options.length, 1)] ?? "undecided", quote: `as ${name} picks`,
      })));
    } else if (kind === "burst") {
      // every listed member reacts to the FIRST post of the round
      const seqs = user.split("\n").map((l) => l.match(/^(\d+) · /)).filter(Boolean).map((m) => Number(m![1]));
      const names = user.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).split(":")[0]);
      text = JSON.stringify(names.map((name, i) => ({ name, seq: seqs[i % seqs.length] ?? seqs[0], reaction: `${name} reacts.` })));
    } else if (kind === "votes") {
      // every voter upvotes the first post and downvotes the second (if any)
      const seqs = user.split("\n").map((l) => l.match(/^(\d+) · /)).filter(Boolean).map((m) => Number(m![1]));
      const names = user.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).split(":")[0]);
      text = JSON.stringify(names.map((name) => ({
        voter: name,
        votes: [{ seq: seqs[0], vote: "up" }, ...(seqs.length > 1 ? [{ seq: seqs[1], vote: "down" }] : [])],
      })));
    } else if (kind === "pollq") {
      text = `{"question": "Should the town let the project go ahead?", "options": []}`;
    } else if (kind === "router") {
      // pick the second panelist listed (never the last author by construction)
      const m = system.match(/Panel: ([^;]+); ([^ ]+ [^ ]+?) \(/);
      text = m?.[2] ?? "Bea B.";
    } else if (kind === "judge") {
      judgeN += 1;
      text = (opts.judgeScript?.(judgeN) ?? "moving");
    } else {
      // turn — jury verdicts get scripted scores, everything else prose.
      // Round comes from the Jury INSTRUCTION ("Deliberation round N of M"),
      // never from a bare /round \d/ scan — the transcript above the
      // instruction quotes earlier rounds and would match first.
      const rm = user.match(/Deliberation round (\d+) of/);
      turnRound = rm ? Number(rm[1]) : 1;
      const nameM = system.match(/^You are ([^,]+),/);
      const name = nameM?.[1] ?? "Agent";
      const override = opts.turnText?.(call, n);
      if (override !== undefined) {
        text = override;
      } else if (user.includes('Start EXACTLY with "SCORE:')) {
        const score = opts.juryScore?.(name, turnRound) ?? 5;
        text = `SCORE: ${score}/10 — ${name} verdict for round ${turnRound}.`;
      } else {
        text = `${name} argues point ${n} with a concrete number ($${n}00K).`;
      }
    }

    // 3d — a turn that carries tools MAY search (opt-in per test): fabricate
    // the server-side block pair the real API returns before the prose
    const content: Record<string, unknown>[] = [];
    if (kind === "turn" && (params.tools?.length ?? 0) > 0 && opts.searchOnTurn?.(call, n)) {
      content.push(
        { type: "server_tool_use", name: "web_search", input: { query: `current facts (call ${n})` } },
        { type: "web_search_tool_result", content: [
          { type: "web_search_result", url: "https://example.com/fact-a", title: "Fact A" },
          { type: "web_search_result", url: "https://example.com/fact-b", title: "Fact B" },
        ] },
      );
    }
    if (text) content.push({ type: "text", text });
    return {
      content,
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: text ? "end_turn" : "max_tokens",
    };
  };

  const client = {
    messages: { create: async (p: never) => respond(p) },
    beta: { messages: { create: async (p: never) => respond(p) } },
  } as unknown as Anthropic;

  return { client, calls };
}

/* ------------------------------ cast builders ---------------------------- */

export function makeLead(name: string, over: Partial<FrozenSpec> & { seatRole?: string; adversarial?: boolean } = {}): EngineLead {
  const initials = name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const spec: FrozenSpec = {
    name,
    initials,
    role: over.role ?? `${name} role`,
    kind: over.kind ?? "expert",
    backstory: `Backstory of ${name}.`,
    stances: [`${name} stance`],
    seat: {
      role: over.seatRole ?? over.role ?? `${name} seat`,
      why: "test seat",
      discipline: "TEST",
      adversarial: over.adversarial ?? false,
      provenance: "library",
    },
    ...over,
  } as FrozenSpec;
  return { key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), spec };
}

export function makeLeads(n: number, residents = 0): EngineLead[] {
  const first = ["Al", "Bea", "Cy", "Dee", "Ed", "Fay", "Gus", "Hal", "Ida", "Jo", "Kai", "Lu", "Mo", "Nia", "Ora", "Pip"];
  return Array.from({ length: n }, (_, i) =>
    makeLead(`${first[i % first.length]} ${String.fromCharCode(66 + i)}.`, {
      kind: i < residents ? "consumer" : "expert",
    }));
}

export function makeCrowd(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const lead = makeLead(`Crowd ${i + 1} Z.`, { kind: "consumer" });
    (lead.spec.seat as { tier?: string }).tier = "crowd";
    return { key: `crowd-${i + 1}`, spec: lead.spec };
  });
}

/* ------------------------------ ctx builder ------------------------------ */

export interface Harness {
  ctx: EngineContext;
  events: EngineEvent[];
  calls: FakeCall[];
  clock: FakeClock;
  /** posts as PostRec (mirrors the launch route's resume reconstruction) */
  postRecs: () => PostRec[];
  sentimentRounds: () => number[];
  voteEvents: () => Extract<EngineEvent, { type: "votes" }>[];
  /** build the RunResume the launch route would build from persisted state */
  resume: (round: number) => RunResume;
}

export function makeHarness(args: {
  mode: string;
  leads: EngineLead[];
  crowd?: ReturnType<typeof makeCrowd>;
  cfg?: Partial<RunConfig>;
  deadlineInMs?: number;          // relative to clock start; default: effectively infinite
  fake?: FakeOptions;
  polledRounds?: Set<number>;
  votedRounds?: Set<number>;
  clock?: FakeClock;
  /** 3d — enabled tool keys for the run under test */
  tools?: string[];
  /** PR-B — choice instrument options (empty = classic stance poll) */
  pollOptions?: string[];
}): Harness {
  const clock = args.clock ?? new FakeClock();
  const { client, calls } = makeFakeAnthropic(clock, args.fake ?? {});
  const events: EngineEvent[] = [];
  const ctx: EngineContext = {
    anthropic: client,
    // density defaults to FOCUSED in tests: the Phase-1 matrix pins the tight
    // v1 shapes; density tests opt into lively/bustling explicitly
    cfg: { ...RUN_DEFAULTS, convergence: "fixed", density: "focused", ...args.cfg } as RunConfig,
    mode: args.mode,
    problem: "Test problem — pool or finishes?",
    questions: ["Q ONE", "Q TWO"],
    leads: args.leads,
    crowd: args.crowd ?? [],
    pollQuestion: "Should the builder spend the leftover budget on the pool?",
    pollOptions: args.pollOptions ?? [],
    tools: args.tools ?? [],
    pulledFacts: [],
    corpusBlocks: [],
    temperature: 0.7,
    deadline: clock.now + (args.deadlineInMs ?? 10 ** 12),
    polledRounds: args.polledRounds ?? new Set<number>(),
    votedRounds: args.votedRounds ?? new Set<number>(),
    emit: async (e) => { events.push(e); },
    logCall: async () => {},
    isCancelled: () => false,
  };
  const postRecs = () => events
    .filter((e): e is Extract<EngineEvent, { type: "post" }> => e.type === "post")
    .map((e) => ({ name: e.name, role: e.role, content: e.content, tag: e.tag, seq: e.seq, agentKey: e.agent_key, round: e.round, replyTo: e.reply_to }));
  const sentimentRounds = () => events
    .filter((e): e is Extract<EngineEvent, { type: "sentiment" }> => e.type === "sentiment")
    .map((e) => e.round);
  const voteEvents = () => events
    .filter((e): e is Extract<EngineEvent, { type: "votes" }> => e.type === "votes");
  const resume = (round: number): RunResume => {
    const recs = postRecs();
    return { posts: recs, seq: recs.reduce((m, r) => Math.max(m, r.seq), 0), round };
  };
  return { ctx, events, calls, clock, postRecs, sentimentRounds, voteEvents, resume };
}
