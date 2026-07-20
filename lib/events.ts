/**
 * The event schema — the contract between the simulation engine and the UI.
 * Mirrors CLAUDE.md §6.2. The Python engine has matching pydantic models in
 * engine/app/events.py; keep the two in sync.
 */

export type PostTag = "POST" | "REPLY" | "FLIP" | "BURST" | "FLOOR";

export interface Cite {
  kind: "doc" | "tool" | "post";
  ref: string;
}

export interface PostEvent {
  type: "post";
  sim: string;
  seq: number;
  author: "agent" | "user";
  agent_id: string | null;
  user_id: string | null;
  thread: string;
  reply_to: number | null;
  tag: PostTag;
  mentions: string[];
  content: string;
  cites: Cite[];
  ts: string;
  /** display metadata resolved by the engine so the UI never joins */
  agent_name?: string;
  agent_role?: string;
  agent_initials?: string;
  post_number?: number;
}

export interface StageEvent {
  type: "stage";
  sim: string;
  value: "seeding" | "running" | "converged" | "synthesizing" | "done";
}

export interface PresenceEvent {
  type: "presence";
  sim: string;
  agent_id: string;
  state: "thinking" | "speaking" | "idle";
}

export interface SentimentEvent {
  type: "sentiment";
  sim: string;
  cohort: string;
  dist: { support: number; conditional: number; oppose: number; disengaged: number };
}

export interface ConvergenceEvent {
  type: "convergence";
  sim: string;
  aligned: number;
  total: number;
  dissents: number;
}

export type SimEvent = PostEvent | StageEvent | PresenceEvent | SentimentEvent | ConvergenceEvent;

/** A tick from a run stream: either a real SimEvent or a clock update for pacing UI. */
export interface StreamUpdate {
  event: SimEvent | null;
  /** virtual time in seconds since run start */
  vt: number;
  /** 0..1 */
  progress: number;
  simDay: number;
  postCount: number;
  typingAgent: string | null;
  done: boolean;
}

/**
 * The transport interface the run screen consumes. Two implementations:
 * - createReplayStream (lib/replay.ts) — the golden fixture, no backend
 * - createRealtimeStream (later) — Supabase Realtime channel per simulation
 */
export interface RunStream {
  play(): void;
  pause(): void;
  toggleSpeed(): number;
  skipToEnd(): void;
  subscribe(cb: (u: StreamUpdate) => void): () => void;
  readonly speed: number;
  readonly paused: boolean;
}
