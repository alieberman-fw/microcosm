"use client";

/**
 * The LIVE run screen (engine v1) — real events from /run/launch streamed
 * into the §5 grammar. One canvas, seven arrangements (mode-specific node
 * layouts); one feed, seven structures (round markers, tribunal columns,
 * verdict cards, phase dividers). Crowd sentiment polls render as
 * expandable cards — the real-run answer to the demo's "+N POSTS" bursts:
 * nothing is hidden, everything persisted, click to open.
 */

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MiniSwarm } from "@/components/app/CastingTheater";
import Markdown from "@/components/app/Markdown";
import { distShares } from "@/lib/dist";
import { computeToolAttachment } from "@/lib/feed";
import PersonaProfile from "@/components/app/PersonaProfile";
import StageRail from "@/components/app/StageRail";
import { createClient } from "@/lib/supabase/client";
import { REPORTS_REFRESH_EVENT, ReportState, reportSynthFresh } from "@/lib/report-state";
import type { PersonaSpec } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface LiveLead {
  key: string;
  name: string;
  initials: string;
  role: string;
  discipline?: string;
  adversarial?: boolean;
  residentSide?: boolean;
  kind?: string;
  tagline?: string;
  stances?: string[];
  backstory?: string;
  /** full frozen spec — roster rail cards + PersonaProfile + canvas click */
  spec?: PersonaSpec;
}

export interface LivePost {
  seq: number;
  agent_key: string;
  author?: string; // "agent" | "user" (Take the Floor)
  name: string;
  role: string;
  initials: string;
  adversarial?: boolean;
  tag: string;
  reply_to: number | null;
  content: string;
  cites: { title: string; quote: string }[];
  round: number;
  phase?: string | null;
  side?: string | null;
}

export interface LiveSentiment {
  round: number;
  polled: number;
  dist: Record<string, number>;
  quotes: { name: string; stance: string; quote: string }[];
  question?: string; // what the crowd was asked (engine-derived from the brief; older runs pre-date it)
  options?: string[]; // choice instrument (PR-B): the alternatives on offer; absent = classic stance poll
  /** question-matched answer labels for the stance buckets ("Yes — would
   *  sell" instead of SUPPORT); absent = classic phrasing */
  labels?: Record<string, string>;
  ballots?: { name: string; stance: string }[]; // C2: every individual answer (older runs pre-date it)
}

/** poll bar colors: classic keeps its stance semantics (support=accent,
 *  oppose=warn); choice instruments cycle a distinguishable palette.
 *  Poll-language fix: proposition polls DISPLAY the poll's own answer
 *  labels when it carries them — keys and tallies stay the classic four. */
const CLASSIC_STANCES = ["support", "conditional", "oppose", "disengaged"] as const;
const classicColor = (i: number) => (i === 0 ? "var(--acc)" : i === 1 ? "var(--t5)" : i === 2 ? "var(--warn)" : "var(--ln5)");
const CHOICE_PALETTE = ["var(--acc)", "var(--warn)", "var(--t5)", "var(--ln7)", "var(--ln4)"];
function pollKeys(s: LiveSentiment): { key: string; label: string; color: string }[] {
  if (s.options?.length) {
    const keys = s.options.map((o, i) => ({ key: o, label: o, color: CHOICE_PALETTE[i % CHOICE_PALETTE.length] }));
    if ((s.dist.undecided ?? 0) > 0) keys.push({ key: "undecided", label: "undecided", color: "var(--ln5)" });
    return keys;
  }
  return CLASSIC_STANCES.map((k, i) => ({ key: k, label: s.labels?.[k] ?? k, color: classicColor(i) }));
}

export interface LiveVote {
  seq: number;
  voter_key: string;
  voter_name: string;
  voter_role: string;
  vote: 1 | -1;
}

export interface LiveTool {
  agent_key: string;
  name: string;
  tool: string;
  query: string;
  results: { title: string; url: string }[];
  round: number;
}

type Item = { kind: "post"; post: LivePost } | { kind: "sentiment"; s: LiveSentiment } | { kind: "tool"; t: LiveTool };

interface Node { x: number; y: number; label?: string; adversarial?: boolean; key?: string }

function cssToken(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** mode-specific lead arrangements (§5 table) */
function layoutLeads(mode: string, leads: LiveLead[], w: number, h: number): Record<string, Node> {
  const cx = w / 2, cy = h / 2;
  const out: Record<string, Node> = {};
  // first name + last initial ("ELISE J.") — one "ROSA" per canvas was ambiguous
  // the moment two leads shared a first name; handles "Elise J." and "Larry Liu"
  const shortName = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name.toUpperCase();
    const last = parts[parts.length - 1];
    return `${parts[0]} ${last[0].toUpperCase()}.`.toUpperCase();
  };
  const label = (l: LiveLead) => `${shortName(l.name)}${l.discipline ? ` · ${l.discipline}` : ""}`;
  if (mode === "Tribunal") {
    const pro = leads.filter((l) => !l.residentSide && !l.adversarial);
    const con = leads.filter((l) => l.residentSide || l.adversarial);
    pro.forEach((l, i) => { out[l.key] = { x: w * 0.22, y: h * (0.3 + (i / Math.max(pro.length - 1, 1)) * 0.45), label: label(l), adversarial: l.adversarial, key: l.key }; });
    con.forEach((l, i) => { out[l.key] = { x: w * 0.78, y: h * (0.3 + (i / Math.max(con.length - 1, 1)) * 0.45), label: label(l), adversarial: l.adversarial, key: l.key }; });
    out["__judge"] = { x: cx, y: h * 0.14, label: "THE JUDGE", key: "__judge" };
  } else if (mode === "Jury") {
    leads.forEach((l, i) => { out[l.key] = { x: w * 0.18, y: h * (0.12 + (i / Math.max(leads.length - 1, 1)) * 0.76), label: label(l), adversarial: l.adversarial, key: l.key }; });
    out["__agg"] = { x: w * 0.82, y: cy, label: "TALLY", key: "__agg" };
  } else if (mode === "Desk") {
    out[leads[0].key] = { x: cx, y: h * 0.16, label: label(leads[0]), key: leads[0].key };
    leads.slice(1).forEach((l, i, arr) => { out[l.key] = { x: w * (0.14 + (i / Math.max(arr.length - 1, 1)) * 0.72), y: h * 0.72, label: label(l), adversarial: l.adversarial, key: l.key }; });
  } else if (mode === "Expedition") {
    leads.forEach((l, i) => {
      const p = i / Math.max(leads.length - 1, 1);
      out[l.key] = { x: w * (0.1 + p * 0.8), y: cy + Math.sin(i * 1.9) * h * 0.2, label: label(l), adversarial: l.adversarial, key: l.key };
    });
  } else {
    // Agora · Roundtable · Chamber: the ring
    const R = Math.min(w, h) * 0.34;
    leads.forEach((l, i) => {
      const a = (i / leads.length) * Math.PI * 2 - Math.PI / 2;
      out[l.key] = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, label: label(l), adversarial: l.adversarial, key: l.key };
    });
  }
  return out;
}

export default function LiveRun({
  simId, problem, mode, configuredMode, leads, crowdCount, crowdTarget = 0, initialPosts, initialSentiments, initialVotes = [], initialTools = [], initialCoverage = [], initialAgendas = {}, autoStart = false, initialStatus, maxRounds, hasReport = false, hasStaleReport = false,
}: {
  simId: string;
  problem: string;
  /** the mode of the transcript being DISPLAYED (last run's mode when posts exist) */
  mode: string;
  /** the mode currently saved in run config — a re-run uses this one */
  configuredMode?: string;
  leads: LiveLead[];
  crowdCount: number;
  crowdTarget?: number;
  initialPosts: LivePost[];
  initialSentiments: LiveSentiment[];
  initialVotes?: LiveVote[];
  /** 3d — persisted tool events (search cards) for replay */
  initialTools?: LiveTool[];
  /** 6-PR3 — latest tracker scores (the COVERAGE strip) + agenda labels */
  initialCoverage?: { id: string; ask: string; score: number; missing: string }[];
  initialAgendas?: Record<number, string>;
  /** 6-PR2 Quick Run: launch on mount (?autostart=1) — the proven launch
   *  path materializes the crowd and streams; ignored if a run exists */
  autoStart?: boolean;
  initialStatus: string;
  maxRounds: number;
  hasReport?: boolean;
  /** a report exists but predates the latest run — reachable, never primary */
  hasStaleReport?: boolean;
}) {
  const merged: Item[] = [
    ...initialPosts.map((p) => ({ kind: "post" as const, post: p })),
  ];
  // weave persisted search cards before their author's post that round —
  // the feed reads "searched, then argued", same as it did live
  for (const t of initialTools) {
    let at = merged.length;
    const byAuthor = merged.findIndex((it) => it.kind === "post" && it.post.round === t.round && it.post.agent_key === t.agent_key);
    if (byAuthor >= 0) at = byAuthor;
    else {
      const inRound = merged.findIndex((it) => it.kind === "post" && it.post.round === t.round);
      if (inRound >= 0) at = inRound;
    }
    merged.splice(at, 0, { kind: "tool", t });
  }
  // weave persisted sentiment cards after their round's posts
  for (const s of initialSentiments) {
    let at = merged.length;
    for (let i = merged.length - 1; i >= 0; i--) {
      const it = merged[i];
      if (it.kind === "post" && it.post.round <= s.round) { at = i + 1; break; }
    }
    merged.splice(at, 0, { kind: "sentiment", s });
  }
  const [items, setItems] = useState<Item[]>(merged);
  const [status, setStatus] = useState<string>(initialStatus === "complete" && initialPosts.length ? "done" : "idle");
  const [thinking, setThinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [synthesizing, setSynthesizing] = useState<string | null>(null);
  const [liveCrowd, setLiveCrowd] = useState(crowdCount);
  const [materializing, setMaterializing] = useState<{ landed: number; target: number } | null>(null);
  const [maxR, setMaxR] = useState(maxRounds);       // corrected live by the engine's config event
  const [viewMode, setViewMode] = useState(mode);    // switches to the engine's mode when a new run starts
  const [reportReady, setReportReady] = useState(hasReport);
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [probOpen, setProbOpen] = useState(false);
  const [votes, setVotes] = useState<LiveVote[]>(initialVotes);
  // 6-PR3 — the run walks the brief: sub-ask resolution scores + round agendas
  const [coverage, setCoverage] = useState(initialCoverage);
  const [agendas, setAgendas] = useState<Record<number, string>>(initialAgendas);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [rosterOpen, setRosterOpen] = useState(false);
  const [profileKey, setProfileKey] = useState<string | null>(null);
  const [floorText, setFloorText] = useState("");
  const [floorBusy, setFloorBusy] = useState(false);
  const [mentionQ, setMentionQ] = useState<string | null>(null); // text after the live "@"
  const floorMentions = useRef<Map<string, string>>(new Map());  // display name → agent_key
  const router = useRouter();

  // ---- 3c walk-away state: the run lives server-side; this screen is a
  // WINDOW (attached stream) or an OBSERVER (database tail) ----
  const [stale, setStale] = useState(false);           // orphaned run (no heartbeat) — offer RESUME
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const observing = useRef(false);
  // field fix: an orphaned run self-heals — the observer reclaims it once
  // automatically (the reaper cron covers walked-away tabs server-side);
  // only a failed reclaim falls back to the manual RESUME button
  const autoReclaimed = useRef(false);
  // dedupe across sources (stream ↔ observer handoff must never double-apply)
  const appliedSeq = useRef<Set<number>>(new Set(initialPosts.map((p) => p.seq)));
  const appliedPolls = useRef<Set<number>>(new Set(initialSentiments.map((s) => s.round)));
  const appliedVotes = useRef<Set<string>>(new Set(initialVotes.map((v) => `${v.seq}:${v.voter_key}`)));
  const appliedTools = useRef<Set<string>>(new Set(initialTools.map((t) => `${t.agent_key}:${t.round}:${t.query}`)));

  // ---- §2b votes: per-post tallies with hover attribution ----
  const votesBySeq = useMemo(() => {
    const m = new Map<number, { up: LiveVote[]; down: LiveVote[] }>();
    for (const v of votes) {
      const e = m.get(v.seq) ?? { up: [], down: [] };
      (v.vote === 1 ? e.up : e.down).push(v);
      m.set(v.seq, e);
    }
    return m;
  }, [votes]);
  // highest NET endorsement per round gets the accent ring
  const topOfRound = useMemo(() => {
    const best = new Map<number, { seq: number; net: number }>();
    for (const it of items) {
      if (it.kind !== "post" || it.post.tag === "TALLY" || it.post.tag === "INTERJECTION") continue;
      const e = votesBySeq.get(it.post.seq);
      const net = (e?.up.length ?? 0) - (e?.down.length ?? 0);
      if (net <= 0) continue;
      const cur = best.get(it.post.round);
      if (!cur || net > cur.net) best.set(it.post.round, { seq: it.post.seq, net });
    }
    return new Set([...best.values()].map((b) => b.seq));
  }, [items, votesBySeq]);

  // ---- §2a threading: depth via reply_to chains (visual cap 5) + collapse ----
  const { depthBySeq, childrenBySeq } = useMemo(() => {
    const parent = new Map<number, number>();
    const children = new Map<number, number[]>();
    for (const it of items) {
      if (it.kind !== "post") continue;
      const p = it.post;
      if (p.reply_to != null) {
        parent.set(p.seq, p.reply_to);
        children.set(p.reply_to, [...(children.get(p.reply_to) ?? []), p.seq]);
      }
    }
    const depth = new Map<number, number>();
    const depthOf = (seq: number): number => {
      if (depth.has(seq)) return depth.get(seq)!;
      const par = parent.get(seq);
      const d = par == null ? 0 : Math.min(depthOf(par) + 1, 12);
      depth.set(seq, d);
      return d;
    };
    for (const it of items) if (it.kind === "post") depthOf(it.post.seq);
    return { depthBySeq: depth, childrenBySeq: children };
  }, [items]);
  // field report: a search belongs to the POST it informed — attach each tool
  // event to the SAME AGENT's next post (the engine emits searches before the
  // post of the turn that ran them). ORDER-INDEPENDENT second pass (field
  // fix): the observer tail polls posts before events each cycle, so a live
  // search can land AFTER the post it informed — those attach BACKWARD to
  // the agent's latest post in the same round instead of falling out as a
  // standalone card. The card remains only for truly orphaned searches
  // (the turn failed after searching, so its post never landed).
  const { toolsBySeq, attachedTools } = useMemo(() => computeToolAttachment(items), [items]);
  const [searchOpen, setSearchOpen] = useState<Set<string>>(new Set());

  // 3e breadcrumbs: a reply that revives an EARLIER round gets a chip that
  // names the parent and jumps to it
  const postMetaBySeq = useMemo(() => {
    const m = new Map<number, { name: string; round: number }>();
    for (const it of items) if (it.kind === "post") m.set(it.post.seq, { name: it.post.name, round: it.post.round });
    return m;
  }, [items]);
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const jumpToSeq = (seqN: number) => {
    const el = feedEl.current?.querySelector(`[data-seq="${seqN}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlashSeq(seqN);
      setTimeout(() => setFlashSeq((s) => (s === seqN ? null : s)), 1600);
    }
  };
  const descendantCount = (seq: number): number => {
    const kids = childrenBySeq.get(seq) ?? [];
    return kids.length + kids.reduce((s, k) => s + descendantCount(k), 0);
  };
  const hiddenByCollapse = (seq: number): boolean => {
    let cur = seq;
    for (let guard = 0; guard < 24; guard++) {
      const it = items.find((x) => x.kind === "post" && x.post.seq === cur) as { kind: "post"; post: LivePost } | undefined;
      const par = it?.post.reply_to;
      if (par == null) return false;
      if (collapsed.has(par)) return true;
      cur = par;
    }
    return false;
  };

  // self-heal a stale client-cache hit: a completed run can never be empty —
  // if the server payload says complete but carried no posts, refetch once
  useEffect(() => {
    if (initialStatus === "complete" && initialPosts.length === 0) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PR D: reports you can walk away from — a synthesis can be running for
  // this sim whether or not THIS tab started it. Field fix (2026-08-06): the
  // old check ran ONCE on mount — trigger a synthesis, navigate away, and
  // come back inside the queued-write window and this screen showed
  // "Synthesize the report" over a synthesis already in flight, forever. Now
  // the screen keeps a soft WATCH (4s) whenever the sim is complete and this
  // tab isn't streaming its own synthesis: it attaches to a running
  // synthesis, follows its ticker, and when a NEW report lands it flips
  // READ THE REPORT and pops the unread-reports badge.
  const streamingSynth = useRef(false); // this tab's synthesize() stream owns the UI while true
  useEffect(() => {
    if (initialStatus !== "complete") return;
    const supa = createClient();
    if (!supa) return;
    let stop = false;
    let sawFresh = false;            // we watched a synthesis run during this mount
    let seeded = false;              // the first read is baseline — an OLD done is not news
    let knownDone: string | null = null;
    const tick = async () => {
      if (stop || streamingSynth.current) return;
      const { data } = await supa.from("simulations").select("config").eq("id", simId).maybeSingle();
      if (stop || streamingSynth.current) return;
      const st = ((data?.config as { report_state?: ReportState } | null)?.report_state ?? null);
      if (reportSynthFresh(st, Date.now())) {
        sawFresh = true;
        setSynthesizing(st!.note ?? "SYNTHESIZING…");
      } else if (st?.stage === "done" && st.report_id) {
        const isNews = sawFresh || (seeded && st.report_id !== knownDone);
        knownDone = st.report_id;
        if (isNews) {
          sawFresh = false;
          setSynthesizing(null);
          setReportReady(true);
          window.dispatchEvent(new Event(REPORTS_REFRESH_EVENT)); // the (n) badge learns NOW, not at its next poll
          router.refresh();
        }
      } else if (sawFresh) {
        sawFresh = false;
        setSynthesizing(null); // error or heartbeat lost — the button offers a retry
      }
      seeded = true;
    };
    void tick();
    const t = setInterval(() => void tick(), 4_000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // field fix (2026-08-06): the synthesis TAIL must die with the page. It
  // used to keep reading after unmount and router.push the report from
  // wherever the user had navigated to — which also stamped the report SEEN
  // (ReportView marks on mount), so the unread badge never appeared. The
  // WORKER is untouched by the abort; the watch above and the badge carry
  // the news instead.
  const mountedRef = useRef(true);
  const synthAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; synthAbort.current?.abort(); };
  }, []);

  const synthesize = async () => {
    if (synthesizing) return;
    setSynthesizing("SYNTHESIZING…");
    streamingSynth.current = true;
    const ac = new AbortController();
    synthAbort.current = ac;
    try {
      const res = await fetch(`/api/simulations/${simId}/report`, { method: "POST", signal: ac.signal });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Synthesis failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as { type: string; note?: string; error?: string };
          if (evt.type === "stage") setSynthesizing(String(evt.note ?? "SYNTHESIZING…"));
          else if (evt.type === "done") {
            streamingSynth.current = false;
            if (!mountedRef.current) { window.dispatchEvent(new Event(REPORTS_REFRESH_EVENT)); return; }
            setReportReady(true);
            setSynthesizing(null);
            router.refresh(); // drop any cached payloads before landing on the report
            router.push(`/sim/${simId}/report`);
            return;
          }
          else if (evt.type === "error") throw new Error(evt.error ?? "Synthesis failed");
        }
      }
    } catch (e) {
      // page left mid-synthesis: the abort kills only the TAIL — the worker
      // keeps going and the watch/badge announce the report when it lands
      if (ac.signal.aborted || !mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Synthesis failed");
      setSynthesizing(null);
    } finally {
      streamingSynth.current = false;
    }
  };
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [ballotsOpen, setBallotsOpen] = useState<Set<number>>(new Set()); // SEE EVERY VOTE, per poll card
  const feedEl = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Record<string, Node>>({});
  const crowdRef = useRef<Node[]>([]);
  const pulses = useRef<{ a: Node; b: Node; t0: number; dur: number; strong: boolean }[]>([]);
  const speaker = useRef<{ node: Node | null; until: number }>({ node: null, until: 0 });
  const composing = useRef<{ key: string; until: number } | null>(null); // presence: who is thinking right now
  const edges = useRef<{ a: Node; b: Node; until: number }[]>([]);       // steady reply lines, feed↔canvas sync
  const authorBySeq = useRef<Map<number, string>>(new Map());
  const pollWave = useRef<number>(0); // performance.now() when the last crowd poll landed
  const polling = useRef<{ t0: number; n: number } | null>(null); // live sweep while the poll executes
  const chunkCount = useRef(0);

  useEffect(() => {
    for (const it of merged) if (it.kind === "post") authorBySeq.current.set(it.post.seq, it.post.agent_key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** apply one engine event to the screen — shared by the attached stream
   *  and the observer tail; dedupes so a stream→observer handoff never
   *  double-applies. Returns "terminal" when the run ended. */
  const handleEvt = (evt: Record<string, unknown>): "terminal" | null => {
    if (evt.type === "config") {
      // the engine's real parameters win over the server-rendered props —
      // including the MODE: a re-run after a mode change switches the
      // arrangement the moment the new run starts
      if (Number(evt.rounds)) setMaxR(Number(evt.rounds));
      if (typeof evt.mode === "string" && evt.mode) setViewMode(evt.mode);
    } else if (evt.type === "post") {
      const p = evt as unknown as LivePost & { type: string };
      if (appliedSeq.current.has(p.seq)) return null;
      appliedSeq.current.add(p.seq);
      setItems((prev) => [...prev, { kind: "post", post: p }]);
      setThinking(null);
      // canvas: pulse + speaker — in lockstep with the feed item landing
      authorBySeq.current.set(p.seq, p.agent_key);
      composing.current = null;
      const a = nodesRef.current[p.agent_key] ?? nodesRef.current["__judge"] ?? nodesRef.current["__agg"];
      if (a) {
        // a reply pulses to the ACTUAL author being answered; an open post broadcasts
        const replyAuthor = p.reply_to != null ? authorBySeq.current.get(p.reply_to) : undefined;
        const replyNode = replyAuthor ? nodesRef.current[replyAuthor] : undefined;
        const now = performance.now();
        const targets = replyNode && replyNode !== a
          ? [replyNode]
          : Object.values(nodesRef.current).filter((n) => n.key !== p.agent_key && n.key !== "__judge").slice(0, 8);
        targets.forEach((t, i) => pulses.current.push({ a, b: t, t0: now + i * 90, dur: targets.length === 1 ? 3600 : 2200, strong: targets.length === 1 }));
        // replies also hold a steady line while the post is read
        if (replyNode && replyNode !== a) {
          edges.current = [...edges.current.filter((e) => e.until > now), { a, b: replyNode, until: now + 7000 }].slice(-3);
        }
        speaker.current = { node: a, until: now + 4200 };
      }
    } else if (evt.type === "presence") {
      if (evt.state === "thinking") {
        setThinking(String(evt.name));
        const key = String(evt.agent_key ?? "");
        if (nodesRef.current[key]) composing.current = { key, until: performance.now() + 30_000 };
      }
    } else if (evt.type === "polling") {
      polling.current = { t0: performance.now(), n: Number(evt.count) || crowdCount };
    } else if (evt.type === "sentiment") {
      const s = evt as unknown as LiveSentiment;
      if (appliedPolls.current.has(s.round)) return null;
      appliedPolls.current.add(s.round);
      polling.current = null;
      setItems((prev) => [...prev, { kind: "sentiment", s }]);
      // canvas: the crowd lights up and pulses inward while the poll lands
      pollWave.current = performance.now();
      const ring = crowdRef.current;
      const cx = (canvasEl.current?.width ?? 0) / 2, cy = (canvasEl.current?.height ?? 0) / 2;
      const now = performance.now();
      for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 14))) {
        pulses.current.push({ a: ring[i], b: { x: cx, y: cy }, t0: now + (i % 7) * 120, dur: 2200, strong: false });
      }
    } else if (evt.type === "coverage") {
      // latest tracker pass wins — the strip always shows current resolution
      const scores = (evt as unknown as { scores?: { id: string; ask: string; score: number; missing: string }[] }).scores;
      if (Array.isArray(scores) && scores.length) setCoverage(scores);
    } else if (evt.type === "agenda") {
      const a = evt as unknown as { round: number; label: string };
      if (a.label) setAgendas((prev) => (prev[a.round] === a.label ? prev : { ...prev, [a.round]: a.label }));
    } else if (evt.type === "votes") {
      const vs = ((evt as unknown as { votes: LiveVote[] }).votes ?? [])
        .filter((v) => !appliedVotes.current.has(`${v.seq}:${v.voter_key}`));
      for (const v of vs) appliedVotes.current.add(`${v.seq}:${v.voter_key}`);
      if (vs.length) setVotes((prev) => [...prev, ...vs]);
    } else if (evt.type === "tool") {
      // 3d — a search card lands in the feed right before its author's post
      const t = evt as unknown as LiveTool;
      const dk = `${t.agent_key}:${t.round}:${t.query}`;
      if (appliedTools.current.has(dk)) return null;
      appliedTools.current.add(dk);
      setItems((prev) => [...prev, { kind: "tool", t }]);
      const a = nodesRef.current[t.agent_key];
      if (a) speaker.current = { node: a, until: performance.now() + 2600 };
    } else if (evt.type === "stage") {
      if (evt.value === "running" && evt.detail) setNote(String(evt.detail));
      if (evt.value === "converged") setNote(`CONVERGED — POSITIONS STABILIZED, STOPPED BEFORE THE ROUND CAP · SET "STOP WHEN: ROUNDS EXHAUSTED" TO FORCE EVERY ROUND`);
      if (evt.value === "done") {
        // honest stop reasons — "converged" is reserved for the stability rule
        const reason = String(evt.detail ?? "");
        if (reason === "choreography") setNote(`RUN COMPLETE — THIS MODE RUNS A FIXED CHOREOGRAPHY (PHASES, NOT ROUNDS), AND EVERY PHASE DELIVERED`);
        else if (reason === "budget") setNote(`STOPPED AT THE MAX-POSTS BUDGET — RAISE IT IN RUN CONFIG FOR A LONGER RUN`);
        else if (reason === "rounds") setNote(`ALL ROUNDS COMPLETE`);
        else if (reason === "stopped") setNote(`STOPPED BY YOU — THE TRANSCRIPT IS PRESERVED AND THE REPORT CAN SYNTHESIZE IT`);
      }
      if (evt.value === "converged" || evt.value === "done") { setStatus("done"); setStopping(false); return "terminal"; }
      if (evt.value === "error") { setStatus("idle"); setStopping(false); setError(String(evt.detail ?? "Run failed")); return "terminal"; }
    } else if (evt.type === "error") {
      setStatus("idle");
      setStopping(false);
      setError(String(evt.error ?? "Run failed"));
      return "terminal";
    } else if (evt.type === "finished") {
      setStatus("done");
      setStopping(false);
      setReportReady(false); // a FRESH transcript makes any earlier report stale — the CTA is SYNTHESIZE
      return "terminal";
    }
    return null;
  };

  const launch = async (cont = false) => {
    if (!cont && status === "running") return;
    observing.current = false; // an explicit launch takes over from any tail
    setStatus("running");
    setStale(false);
    if (!cont) {
      setItems([]); chunkCount.current = 0;
      setVotes([]);
      appliedSeq.current = new Set();
      appliedPolls.current = new Set();
      appliedVotes.current = new Set();
      appliedTools.current = new Set();
    }
    setError(null);
    try {
      // the run needs its crowd: auto-materialize when the target says there
      // should be one but nothing exists yet (e.g. after a re-cast)
      if (!cont && liveCrowd === 0 && crowdTarget > 0) {
        setMaterializing({ landed: 0, target: Math.min(crowdTarget, 300) });
        const cres = await fetch(`/api/simulations/${simId}/crowd`, { method: "POST" });
        if (cres.ok && cres.body) {
          const creader = cres.body.getReader();
          const cdec = new TextDecoder();
          let cbuf = "";
          for (;;) {
            const { done, value } = await creader.read();
            if (done) break;
            cbuf += cdec.decode(value, { stream: true });
            const lines = cbuf.split("\n");
            cbuf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const evt = JSON.parse(line) as { type: string; generated?: number };
              if (evt.type === "members") setMaterializing((m) => m ? { ...m, landed: Number(evt.generated) || m.landed } : m);
              if (evt.type === "done") setLiveCrowd(Number(evt.generated) || 0);
            }
          }
        }
        setMaterializing(null);
      }
      const res = await fetch(`/api/simulations/${simId}/run/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ continue: cont }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; live?: boolean };
        if (data.live) {
          // 3c: a worker is already driving this run — watch it instead
          setNote("THIS RUN IS ALREADY GOING SERVER-SIDE — WATCHING LIVE");
          void observe();
          return;
        }
        throw new Error(data.error ?? "Launch failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawContinue = false;
      let sawTerminal = false; // finished / done / converged / error — anything else = interrupted
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as Record<string, unknown>;
          if (evt.type === "continue") {
            // the slice hit the serverless window; the worker hands off
            sawContinue = true;
            chunkCount.current += 1;
            if (evt.chained) {
              // 3c: the next slice is already scheduled SERVER-SIDE — stop
              // driving from the tab and just watch the transcript land
              setNote(`LONG RUN · CONTINUING SERVER-SIDE (SLICE ${chunkCount.current + 1}) — ROUND ${evt.round} · SAFE TO CLOSE THE TAB`);
              setTimeout(() => void observe(), 800);
            } else if (chunkCount.current < 40) {
              // no service key on this deployment — legacy client-driven chain
              setNote(`LONG RUN · CONTINUING SEAMLESSLY (SLICE ${chunkCount.current + 1}) — ROUND ${evt.round}`);
              setTimeout(() => void launch(true), 400);
            }
          } else if (handleEvt(evt) === "terminal") {
            sawTerminal = true;
          }
        }
      }
      setThinking(null);
      polling.current = null; // the sweep must never keep looping after the stream closes
      if (!sawContinue && sawTerminal) {
        setStatus((s) => (s === "running" ? "done" : s));
        router.refresh(); // the persisted run replaces any cached empty payload
      } else if (!sawContinue && !sawTerminal) {
        // 3c: the WINDOW died, not the run — the worker survives stream loss
        // under waitUntil. Switch to observing the persisted transcript; the
        // observer itself sorts out complete/error/orphaned on its first poll.
        setNote("STREAM DETACHED — THE RUN CONTINUES SERVER-SIDE; WATCHING THE TRANSCRIPT LIVE");
        void observe();
      }
    } catch (e) {
      polling.current = null;
      setError(e instanceof Error ? e.message : "Launch failed");
      setStatus("idle");
    }
  };

  /** a persisted post row → the §6.2 post event handleEvt expects */
  const postRowToEvt = (r: Record<string, unknown>): Record<string, unknown> => {
    const meta = (r.cites as { cites?: { title: string; quote: string }[]; name?: string; role?: string; initials?: string; adversarial?: boolean; round?: number; phase?: string | null; side?: string | null } | null) ?? {};
    return {
      type: "post", seq: r.seq, agent_key: r.agent_key, author: r.author,
      name: meta.name ?? "Agent", role: meta.role ?? "", initials: meta.initials ?? "·", adversarial: meta.adversarial ?? false,
      thread: r.thread, reply_to: r.reply_to, tag: r.tag, content: r.content,
      cites: meta.cites ?? [], round: meta.round ?? 1, phase: meta.phase ?? null, side: meta.side ?? null,
    };
  };

  /** 3c OBSERVER: the run lives server-side; tail the database until it ends.
   *  This is how a reopened tab (or a teammate's tab) watches a run it did
   *  not launch — and how the launcher keeps watching after slice handoffs. */
  const observe = async () => {
    if (observing.current) return;
    observing.current = true;
    setStale(false);
    setError(null);
    setStatus("running");
    setNote("WATCHING LIVE — THIS RUN IS GOING SERVER-SIDE; CLOSING THE TAB WON'T STOP IT");
    const supa = createClient();
    if (!supa) { observing.current = false; return; }
    let lastProgress = Date.now();
    let maxSeq = appliedSeq.current.size ? Math.max(...appliedSeq.current) : 0;
    try {
      for (;;) {
        if (!observing.current) return;
        const [postsQ, evQ, simQ] = await Promise.all([
          supa.from("posts").select("seq, agent_key, author, thread, reply_to, tag, content, cites")
            .eq("sim_id", simId).gt("seq", maxSeq).order("seq", { ascending: true }).limit(200),
          supa.from("events").select("type, payload").eq("sim_id", simId).in("type", ["sentiment", "votes", "tool", "coverage", "agenda"]),
          supa.from("simulations").select("status, config").eq("id", simId).maybeSingle(),
        ]);
        const rows = (postsQ.data ?? []) as Record<string, unknown>[];
        if (rows.length) {
          lastProgress = Date.now();
          autoReclaimed.current = false; // real progress — a future orphaning earns a fresh auto-reclaim
        }
        for (const r of rows) {
          maxSeq = Math.max(maxSeq, Number(r.seq) || 0);
          handleEvt(postRowToEvt(r));
        }
        for (const e of (evQ.data ?? []) as { payload: Record<string, unknown> }[]) {
          if (["sentiment", "votes", "tool", "coverage", "agenda"].includes(String(e.payload?.type))) handleEvt(e.payload);
        }
        const st = (simQ.data?.status as string | undefined) ?? "";
        const cfg2 = (simQ.data?.config ?? {}) as { run_state?: { heartbeat_at?: string | null }; run_result?: { stop?: string } };
        if (st === "complete") {
          observing.current = false;
          polling.current = null;
          setThinking(null);
          setStatus("done");
          setStopping(false);
          const reason = cfg2.run_result?.stop ?? "";
          if (reason === "stability") setNote(`CONVERGED — POSITIONS STABILIZED, STOPPED BEFORE THE ROUND CAP`);
          else if (reason === "choreography") setNote(`RUN COMPLETE — EVERY PHASE DELIVERED`);
          else if (reason === "budget") setNote(`STOPPED AT THE MAX-POSTS BUDGET`);
          else if (reason === "stopped") setNote(`STOPPED BY YOU — THE TRANSCRIPT IS PRESERVED AND THE REPORT CAN SYNTHESIZE IT`);
          else if (reason === "rounds") setNote(`ALL ROUNDS COMPLETE`);
          router.refresh();
          return;
        }
        if (st !== "running") {
          observing.current = false;
          polling.current = null;
          setThinking(null);
          setStatus("idle");
          setStopping(false);
          setError("The run stopped with an error — every post so far is persisted; RE-RUN starts fresh");
          return;
        }
        // liveness: a fresh heartbeat OR new posts count as progress; a null
        // heartbeat is a between-slice handoff (the chain child claims within
        // seconds), so only a long silence marks the run orphaned
        const hb = cfg2.run_state?.heartbeat_at ? Date.parse(cfg2.run_state.heartbeat_at) : NaN;
        if (Number.isFinite(hb) && Date.now() - hb < 60_000) lastProgress = Date.now();
        if (Date.now() - lastProgress > 120_000) {
          observing.current = false;
          if (!autoReclaimed.current) {
            autoReclaimed.current = true;
            setNote("NO HEARTBEAT FROM THE RUN — RECLAIMING IT AUTOMATICALLY FROM THE PERSISTED TRANSCRIPT");
            void launch(true); // a 409 (reaper or another tab got there first) drops back into observing
            return;
          }
          setStale(true);
          setStatus("idle");
          setNote("NO HEARTBEAT FROM THE RUN — IT LOOKS ORPHANED (DEPLOY OR CRASH). RESUME CONTINUES FROM THE PERSISTED TRANSCRIPT");
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    } catch {
      // transient network failure — drop out quietly; the header RESUME/refresh path re-enters
      observing.current = false;
    }
  };

  /** 3c graceful stop: the worker suspends at the next safe boundary and the
   *  run completes with reason "stopped" — transcript preserved */
  const stopRun = async () => {
    setConfirmStop(false);
    setStopping(true);
    setNote("STOPPING AT THE NEXT SAFE BOUNDARY — THE TRANSCRIPT IS PRESERVED AND THE REPORT CAN SYNTHESIZE IT");
    try { await fetch(`/api/simulations/${simId}/run/stop`, { method: "POST" }); } catch { /* the poll below will surface reality */ }
  };

  // 3c: landing on a RUNNING sim means the run is going server-side — watch it.
  // 6-PR2 Quick Run: ?autostart=1 launches immediately through the proven
  // path (crowd materialization + stream + walkaway) — but never over an
  // existing run or transcript, so a reload of the URL can't double-launch.
  useEffect(() => {
    if (initialStatus === "running") void observe();
    else if (autoStart && initialPosts.length === 0 && leads.length >= 2) void launch(false);
    return () => { observing.current = false; }; // leaving the page stops the tail, never the run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scroll-position-aware autoscroll: follow the live feed only while the
  // user is AT the bottom — scrolled up to read means stay put, count what
  // lands below, and offer a one-click jump back to the live edge
  const atBottomRef = useRef(true);
  const prevItemCount = useRef(items.length);
  const [newBelow, setNewBelow] = useState(0);
  const jumpToLatest = () => {
    const el = feedEl.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setNewBelow(0);
  };
  const onFeedScroll = () => {
    const el = feedEl.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    atBottomRef.current = nearBottom;
    if (nearBottom) setNewBelow(0);
  };
  useEffect(() => {
    const el = feedEl.current;
    const added = items.length - prevItemCount.current;
    prevItemCount.current = items.length;
    if (!el) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setNewBelow((n) => n + added);
  }, [items.length, thinking]);

  // ---- Take the Floor: post into the forum, @mentioned agents answer ----
  const takeFloor = async () => {
    const content = floorText.trim();
    if (!content || floorBusy) return;
    setFloorBusy(true);
    setError(null);
    const mentions = [...floorMentions.current.entries()]
      .filter(([name]) => content.includes(`@${name}`))
      .map(([, key]) => key);
    try {
      const res = await fetch(`/api/simulations/${simId}/floor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mentions }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "The floor is unavailable");
      }
      setFloorText("");
      setMentionQ(null);
      floorMentions.current.clear();
      const round = items.reduce((m, i) => (i.kind === "post" ? Math.max(m, i.post.round) : m), 1);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as Record<string, unknown>;
          if (evt.type === "floor") {
            setItems((prev) => [...prev, { kind: "post", post: {
              seq: Number(evt.seq), agent_key: "__user", author: "user", name: "You", role: "Taking the floor",
              initials: "YOU", tag: "FLOOR", reply_to: null, content, cites: [], round,
            } }]);
          } else if (evt.type === "post") {
            const p = evt as unknown as LivePost & { type: string };
            setItems((prev) => [...prev, { kind: "post", post: p }]);
            setThinking(null);
            authorBySeq.current.set(p.seq, p.agent_key);
            const a = nodesRef.current[p.agent_key];
            if (a) speaker.current = { node: a, until: performance.now() + 4200 };
          } else if (evt.type === "presence" && evt.state === "thinking") {
            setThinking(String(evt.name));
          } else if (evt.type === "error") {
            setError(String(evt.error ?? "The panel could not answer"));
          }
        }
      }
      setThinking(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The floor is unavailable");
    } finally {
      setFloorBusy(false);
    }
  };

  // canvas click → the lead under the cursor opens their full profile
  const canvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = canvasEl.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dpr = el.width / rect.width;
    const x = (e.clientX - rect.left) * dpr, y = (e.clientY - rect.top) * dpr;
    let best: { key: string; d: number } | null = null;
    for (const nd of Object.values(nodesRef.current)) {
      if (!nd.key) continue;
      const d = Math.hypot(nd.x - x, nd.y - y);
      if (d < 16 * dpr && (!best || d < best.d)) best = { key: nd.key, d };
    }
    if (best && leads.some((l) => l.key === best!.key)) setProfileKey(best.key);
  };

  // canvas: layout + draw
  useEffect(() => {
    const el = canvasEl.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const layout = () => {
      el.width = el.offsetWidth * dpr;
      el.height = el.offsetHeight * dpr;
      nodesRef.current = layoutLeads(viewMode, leads, el.width, el.height);
      const cx = el.width / 2, cy = el.height / 2;
      const ring: Node[] = [];
      const n = Math.min(Math.max(Math.ceil(Math.max(liveCrowd, crowdCount) / 2), 0), 110);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, r = Math.min(el.width, el.height) * (0.45 + ((i * 7) % 10) * 0.004);
        ring.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      crowdRef.current = ring;
    };
    layout();
    window.addEventListener("resize", layout);
    let raf = 0;
    const draw = () => {
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const now = performance.now();
      const acc = cssToken("--acc", "#37d98a"), dim = cssToken("--t7", "#6d7378"), mid = cssToken("--t5", "#9aa0a6"), warn = cssToken("--warn", "#d9a03f");
      ctx.clearRect(0, 0, el.width, el.height);
      // steady reply lines: who is answering whom, held while the post is read
      edges.current = edges.current.filter((e) => e.until > now);
      for (const e of edges.current) {
        const left = (e.until - now) / 7000;
        ctx.globalAlpha = 0.28 * Math.min(1, left * 3);
        ctx.strokeStyle = acc; ctx.lineWidth = dpr * 0.8;
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
        ctx.globalAlpha = 0.4 * Math.min(1, left * 3); ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(e.b.x, e.b.y, dpr * 6.5, 0, 7); ctx.stroke();
      }
      pulses.current = pulses.current.filter((p) => (now - p.t0) / p.dur <= 1);
      for (const p of pulses.current) {
        const k = (now - p.t0) / p.dur;
        if (k < 0) continue;
        ctx.globalAlpha = (p.strong ? 0.8 : 0.3) * (1 - k * 0.6); ctx.strokeStyle = acc; ctx.lineWidth = dpr * (p.strong ? 1.4 : 0.7);
        ctx.beginPath(); ctx.moveTo(p.a.x, p.a.y); ctx.lineTo(p.b.x, p.b.y); ctx.stroke();
        ctx.globalAlpha = 0.9 * (1 - k * 0.5); ctx.fillStyle = acc;
        ctx.beginPath(); ctx.arc(p.a.x + (p.b.x - p.a.x) * k, p.a.y + (p.b.y - p.a.y) * k, dpr * (p.strong ? 2.4 : 1.6), 0, 7); ctx.fill();
      }
      const ring = crowdRef.current;
      const wave = now - pollWave.current;
      const finale = pollWave.current > 0 && wave < 3200;
      const sweep = polling.current;
      let ci = 0;
      for (const r of ring) {
        if (sweep) {
          // POLLING sweep: members get "counted" one by one — a bright frontier
          // circles the ring while the real poll executes server-side
          const cycle = ((now - sweep.t0) / 2400) % 1;              // one lap ≈ 2.4s, loops until results land
          const frontier = Math.floor(cycle * ring.length);
          const dist = (ci - frontier + ring.length) % ring.length; // distance behind the frontier
          const counted = dist > ring.length * 0.55;                // trail stays lit ~45% of the lap
          const atFrontier = dist < 3;
          ctx.fillStyle = counted || atFrontier ? acc : dim;
          ctx.globalAlpha = atFrontier ? 1 : counted ? 0.75 : 0.18;
          ctx.beginPath(); ctx.arc(r.x, r.y, dpr * (atFrontier ? 2.6 : counted ? 1.6 : 1.0), 0, 7); ctx.fill();
          if (atFrontier && dist === 0) {
            ctx.globalAlpha = 0.3; ctx.strokeStyle = acc; ctx.lineWidth = dpr;
            ctx.beginPath(); ctx.arc(r.x, r.y, dpr * 6, 0, 7); ctx.stroke();
          }
        } else if (finale) {
          // results landed: one bright ripple through the whole crowd
          const phase = Math.sin((wave / 380) - ci * 0.35);
          ctx.globalAlpha = Math.max(0.18, Math.min(0.95, 0.35 + 0.6 * phase * (1 - wave / 3200)));
          ctx.fillStyle = acc;
          ctx.beginPath(); ctx.arc(r.x, r.y, dpr * (1.4 + Math.max(0, phase) * 0.9), 0, 7); ctx.fill();
        } else {
          ctx.globalAlpha = 0.24 + 0.12 * Math.sin(now / 1400 + r.x);
          ctx.fillStyle = dim;
          ctx.beginPath(); ctx.arc(r.x, r.y, dpr * 1.1, 0, 7); ctx.fill();
        }
        ci++;
      }
      if (sweep) {
        // the counting sweep speaks for itself — one quiet caption at the base
        ctx.globalAlpha = 0.9; ctx.fillStyle = acc;
        ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`; ctx.textAlign = "center";
        ctx.fillText(`POLLING ${sweep.n} CROWD MEMBERS…`, el.width / 2, el.height - 12 * dpr);
      }
      for (const nd of Object.values(nodesRef.current)) {
        const speaking = nd === speaker.current.node && now < speaker.current.until;
        const isComposing = !speaking && composing.current !== null && nd.key === composing.current.key && now < composing.current.until;
        ctx.globalAlpha = 1;
        ctx.fillStyle = speaking ? acc : nd.adversarial ? warn : mid;
        const rr = dpr * 3.4 * (speaking ? 1.5 + 0.25 * Math.sin(now / 130) : 1);
        ctx.beginPath(); ctx.arc(nd.x, nd.y, rr, 0, 7); ctx.fill();
        if (speaking) { ctx.globalAlpha = 0.25; ctx.strokeStyle = acc; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(nd.x, nd.y, rr + dpr * 6, 0, 7); ctx.stroke(); }
        if (isComposing) {
          // "X IS COMPOSING…" in the feed = this breathing ring on the canvas
          ctx.globalAlpha = 0.3 + 0.2 * Math.sin(now / 300);
          ctx.strokeStyle = acc; ctx.lineWidth = dpr;
          ctx.beginPath(); ctx.arc(nd.x, nd.y, rr + dpr * (5 + 1.5 * Math.sin(now / 300)), 0, 7); ctx.stroke();
        }
        if (nd.label) {
          ctx.globalAlpha = speaking ? 1 : 0.55; ctx.fillStyle = speaking ? acc : mid;
          ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`; ctx.textAlign = "center";
          ctx.fillText(nd.label, nd.x, nd.y - dpr * 10);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", layout); };
  }, [viewMode, leads, crowdCount, liveCrowd]);

  // feed grouping: insert a divider when round/phase changes (mode-appropriate);
  // interjections and floor posts never open or close a group
  const dividers = (idx: number): string | null => {
    const it = items[idx];
    if (it.kind !== "post") return null;
    if (it.post.tag === "INTERJECTION" || it.post.tag === "FLOOR" || it.post.author === "user") return null;
    const prev = [...items.slice(0, idx)].reverse().find((x) =>
      x.kind === "post" && x.post.tag !== "INTERJECTION" && x.post.tag !== "FLOOR" && x.post.author !== "user") as { kind: "post"; post: LivePost } | undefined;
    if (viewMode === "Chamber" || viewMode === "Expedition" || viewMode === "Desk") {
      const ph = it.post.phase ?? it.post.tag;
      const prevPh = prev?.post.phase ?? prev?.post.tag;
      return ph !== prevPh ? String(ph).toUpperCase() : null;
    }
    // §6c: round dividers carry the round's AGENDA when the contract set one
    if (!prev || it.post.round !== prev.post.round) {
      const agenda = agendas[it.post.round];
      return `ROUND ${it.post.round}${agenda ? ` — ${agenda}` : viewMode === "Roundtable" ? " — EVERY VOICE IN ORDER" : viewMode === "Jury" ? " — SCORE, THEN DELIBERATE" : ""}`;
    }
    return null;
  };

  const scoreOf = (p: LivePost): string | null => {
    const s = p.content.match(/SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i)?.[1];
    if (s) return `SCORE ${s}/10`;
    // choice juries (field report 3) verdict with a PICK + confidence
    const pick = p.content.match(/PICK:\s*"?([^"·|—–\n]+?)"?\s*[·|\-–—]\s*CONFIDENCE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    return pick ? `PICK ${pick[1].trim().toUpperCase().slice(0, 18)} · ${pick[2]}/10` : null;
  };
  const posts = items.filter((i) => i.kind === "post").length;
  const currentRound = items.reduce((m, i) => (i.kind === "post" ? Math.max(m, i.post.round) : m), 0);

  const statusLabel = status === "running" ? "SIMULATING" : status === "done" ? "COMPLETE" : "READY";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", boxSizing: "border-box", padding: "22px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {/* the five-stage rail with 04 RUN as the you-are-here (field fix:
            same grammar as the workspace and report pages) */}
        <StageRail
          gap={8}
          stages={[
            { label: "BRIEF", done: true, href: `/sim/${simId}`, title: "Back to the workspace — brief" },
            { label: "CORPUS", done: true, href: `/sim/${simId}`, title: "Back to the workspace — corpus" },
            { label: "POPULATION", done: true, href: `/sim/${simId}`, title: "Back to the workspace — population" },
            { label: "RUN", done: status === "done", current: true, title: "You're here — the live run" },
            reportReady
              ? { label: "REPORT", done: true, href: `/sim/${simId}/report`, title: "Open the report" }
              : { label: "REPORT", done: false, title: "Synthesize the report after the run completes" },
          ]}
        />
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: status === "done" ? "var(--acc)" : "var(--t4)" }}>{statusLabel}</span>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--acc)", border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 100, padding: "3px 10px" }}>
          LIVE · {viewMode.toUpperCase()} · ENGINE V1
        </span>
        <button
          onClick={() => setRosterOpen((v) => !v)}
          style={{ marginLeft: "auto", ...mono, fontSize: 9, letterSpacing: ".07em", color: rosterOpen ? "var(--acc)" : "var(--t5)", background: "transparent", border: `1px solid ${rosterOpen ? "var(--acc)" : "var(--ln4)"}`, borderRadius: 100, padding: "4px 12px", cursor: "pointer" }}
        >
          {leads.length} ON THE PANEL {rosterOpen ? "←" : "→"}
        </button>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--t6)" }}>
          {currentRound > 0 ? `ROUND ${currentRound} / ${maxR} · ` : ""}{posts} POSTS
        </span>
      </div>
      {/* the full brief is one click away — a clipped question helps nobody */}
      <div
        onClick={() => setProbOpen((v) => !v)}
        title={probOpen ? "Collapse" : "Show the full problem statement"}
        style={{ marginTop: 8, cursor: "pointer", display: "flex", alignItems: "baseline", gap: 8 }}
      >
        <span style={{
          fontSize: 13, lineHeight: 1.55, color: "var(--t5)", minWidth: 0, flex: 1,
          ...(probOpen ? {} : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
        }}>
          {problem}
        </span>
        <span style={{ ...mono, flex: "none", fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>
          {probOpen ? "COLLAPSE ▴" : "FULL BRIEF ▾"}
        </span>
      </div>
      {note && <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t6)", marginTop: 6 }}>ⓘ {note.toUpperCase()}</div>}
      {configuredMode && configuredMode !== viewMode && items.length > 0 && status !== "running" && (
        <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t5)", marginTop: 6 }}>
          ⓘ THIS TRANSCRIPT IS THE LAST RUN — {viewMode.toUpperCase()}. MODE IS NOW SET TO {configuredMode.toUpperCase()} — RE-RUN TO DELIBERATE IN {configuredMode.toUpperCase()} (REPLACES THIS TRANSCRIPT; REPORTS KEEP THEIR FROZEN COPY)
        </div>
      )}
      {liveCrowd === 0 && crowdTarget > 0 && status !== "running" && (
        <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--warn)", marginTop: 6 }}>
          ⚠ NO CROWD MATERIALIZED YET — LAUNCH WILL GENERATE IT AUTOMATICALLY, OR{" "}
          <Link href={`/sim/${simId}`} style={{ color: "var(--warn)", textDecoration: "underline" }}>REVIEW IT ON THE POPULATION STAGE FIRST</Link>
          {" "}(RE-CASTS CLEAR THE CROWD)
        </div>
      )}
      {/* §6c COVERAGE — one chip per sub-ask filling toward resolved, so
          convergence is visible and MEANS something. Only when the contract
          gave the run sub-asks and the tracker has spoken. */}
      {coverage.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <span style={{ ...mono, fontSize: 8, letterSpacing: ".1em", color: "var(--t6)" }}>COVERAGE</span>
          {coverage.map((c) => (
            <span
              key={c.id}
              title={`${c.ask}${c.missing ? ` — still missing: ${c.missing}` : c.score >= 85 ? " — settled" : ""} (${c.score}/100)`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${c.score >= 85 ? "var(--acc)" : "var(--ln4)"}`, borderRadius: 100, padding: "3px 10px", cursor: "help" }}
            >
              <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", color: c.score >= 85 ? "var(--acc)" : "var(--t5)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.ask.toUpperCase()}
              </span>
              <span style={{ width: 34, height: 3, borderRadius: 100, background: "var(--sf2)", overflow: "hidden", flex: "none" }}>
                <span style={{ display: "block", width: `${c.score}%`, height: "100%", borderRadius: 100, background: c.score >= 85 ? "var(--acc)" : c.score >= 50 ? "var(--t5)" : "var(--warn)", transition: "width .6s ease" }} />
              </span>
            </span>
          ))}
          {agendas[currentRound] && status === "running" && (
            <span style={{ ...mono, fontSize: 8, letterSpacing: ".07em", color: "var(--acc)" }}>· AGENDA: {agendas[currentRound]}</span>
          )}
        </div>
      )}
      <div style={{ height: 4, borderRadius: 100, background: "var(--sf2)", marginTop: 12, overflow: "hidden" }}>
        <div style={{ width: `${status === "done" ? 100 : Math.min(96, (currentRound / Math.max(maxR, 1)) * 100)}%`, height: "100%", background: "var(--acc)", transition: "width .4s ease" }} />
      </div>

      <div style={{ display: "flex", gap: 18, flex: 1, minHeight: 0, marginTop: 14 }}>
        <div style={{ flex: 1.15, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--ln2)", borderRadius: 14, padding: "14px 16px", background: "var(--sf)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
            <span>AGENT NETWORK · {viewMode.toUpperCase()} ARRANGEMENT</span>
            <span>{leads.length} LEADS · {liveCrowd} CROWD</span>
          </div>
          <canvas ref={canvasEl} onClick={canvasClick} title="Click a lead for their full profile" style={{ flex: 1, width: "100%", minHeight: 0, marginTop: 10, cursor: "pointer" }} />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf)", overflow: "hidden", position: "relative" }}>
          {newBelow > 0 && (
            <button
              onClick={jumpToLatest}
              style={{
                position: "absolute", left: "50%", transform: "translateX(-50%)",
                bottom: items.length > 0 && status !== "running" ? 74 : 16, zIndex: 6,
                ...mono, fontSize: 9, letterSpacing: ".06em", padding: "7px 16px", borderRadius: 100,
                background: "var(--acc)", color: "var(--acc-c)", border: "none", cursor: "pointer",
                boxShadow: "0 6px 22px rgba(0,0,0,.35)", animation: "fadeUp .2s ease both",
              }}
            >
              ↓ GO TO BOTTOM · {newBelow} NEW
            </button>
          )}
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--ln2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
              {viewMode === "Jury" ? "VERDICTS" : viewMode === "Desk" ? "THE MEMO, ASSEMBLING" : viewMode === "Expedition" ? "FINDINGS LOG" : "FORUM FEED"}
            </span>
            {/* one launch control at a time: empty feed → the hero button below; a finished
                run → two-step RE-RUN (it REPLACES the persisted transcript); a live run →
                two-step STOP (3c graceful: suspends at the next safe boundary); an
                orphaned run → RESUME from the persisted transcript */}
            {status === "running" && !stopping && (
              <button
                onClick={() => { if (confirmStop) void stopRun(); else setConfirmStop(true); }}
                onBlur={() => setConfirmStop(false)}
                style={{
                  ...mono, fontSize: 9, letterSpacing: ".06em", padding: "5px 14px", borderRadius: 100,
                  background: confirmStop ? "var(--warn)" : "transparent",
                  color: confirmStop ? "var(--acc-c)" : "var(--warn)",
                  border: `1px solid var(--warn)`, cursor: "pointer",
                }}
              >
                {confirmStop ? "■ STOPS AT THE NEXT SAFE POINT — CONFIRM" : "■ STOP RUN"}
              </button>
            )}
            {status === "running" && stopping && (
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--warn)" }}>STOPPING…</span>
            )}
            {stale && status !== "running" && (
              <button
                onClick={() => { setStale(false); void launch(true); }}
                style={{
                  ...mono, fontSize: 9, letterSpacing: ".06em", padding: "5px 14px", borderRadius: 100,
                  background: "var(--acc)", color: "var(--acc-c)", border: "none", cursor: "pointer",
                }}
              >
                ▶ RESUME THE RUN
              </button>
            )}
            {status !== "running" && !stale && items.length > 0 && (
              <button
                onClick={() => { if (confirmRerun) { setConfirmRerun(false); void launch(false); } else setConfirmRerun(true); }}
                onBlur={() => setConfirmRerun(false)}
                style={{
                  ...mono, fontSize: 9, letterSpacing: ".06em", padding: "5px 14px", borderRadius: 100,
                  background: confirmRerun ? "var(--warn)" : "var(--acc)", color: "var(--acc-c)", border: "none", cursor: "pointer",
                }}
              >
                {confirmRerun ? "↺ REPLACES THIS TRANSCRIPT — CONFIRM" : "↺ RE-RUN"}
              </button>
            )}
          </div>
          <div ref={feedEl} onScroll={onFeedScroll} style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
            {items.length === 0 && status !== "running" && !stale && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "60px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--t4)", maxWidth: 420 }}>
                  Watch the {configuredMode ?? viewMode} deliberation live — every post persists, the crowd is polled between rounds, and citations link back to your documents.
                </div>
                <button
                  onClick={() => void launch(false)}
                  className="runCta"
                  style={{
                    background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 16,
                    padding: "15px 38px", borderRadius: 100, border: "none", cursor: "pointer",
                    fontFamily: "var(--font-sans), sans-serif",
                  }}
                >
                  ▶ Launch the run
                </button>
                {liveCrowd === 0 && crowdTarget > 0 && (
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t6)" }}>
                    THE CROWD ({Math.min(crowdTarget, 300)} MEMBERS) MATERIALIZES AUTOMATICALLY FIRST
                  </span>
                )}
              </div>
            )}
            {materializing && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 24px" }}>
                <div style={{ width: "100%", maxWidth: 360 }}>
                  <MiniSwarm label={`MATERIALIZING THE CROWD · ${materializing.landed}/${materializing.target}`} />
                </div>
                <div style={{ fontSize: 13, color: "var(--t5)" }}>
                  Casting {materializing.target} crowd members before the run — they’ll be polled every round.
                </div>
              </div>
            )}
            {items.map((it, idx) => {
              if (it.kind === "tool") {
                // searches ride INSIDE their author's post as dropdowns (field
                // report) — a standalone card renders only when no post by
                // that agent ever followed (a failed turn)
                if (attachedTools.has(idx)) return null;
                const t = it.t;
                return (
                  <div key={`t${idx}`} style={{ margin: "12px 0 12px 0", border: "1px solid var(--ln3)", borderRadius: 12, background: "var(--sf)", padding: "11px 15px" }}>
                    <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--acc)" }}>
                      🔎 WEB RESEARCH · {t.name.toUpperCase()}
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--t3)", marginTop: 5 }}>
                      searched “{t.query}”
                    </div>
                    {t.results.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
                        {t.results.slice(0, 3).map((r, ri) => (
                          <a key={ri} href={r.url} target="_blank" rel="noopener noreferrer"
                            style={{ display: "flex", gap: 8, alignItems: "baseline", textDecoration: "none", minWidth: 0 }}>
                            <span style={{ ...mono, fontSize: 8, color: "var(--t7)", flex: "none" }}>↗</span>
                            <span style={{ fontSize: 11.5, color: "var(--t4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
                            <span style={{ ...mono, fontSize: 8, letterSpacing: ".03em", color: "var(--t7)", flex: "none" }}>
                              {(() => { try { return new URL(r.url).hostname.replace(/^www\./, "").toUpperCase(); } catch { return ""; } })()}
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              if (it.kind === "sentiment") {
                const keys = pollKeys(it.s);
                const shares = distShares(it.s.dist, keys.map((k) => k.key)); // sums to exactly 100
                const colorOf = Object.fromEntries(keys.map((k) => [k.key, k.color]));
                const labelOf = Object.fromEntries(keys.map((k) => [k.key, k.label]));
                const open = expanded.has(idx);
                const votesOpen = ballotsOpen.has(idx);
                return (
                  <div key={`s${idx}`} style={{ margin: "16px 0", border: "1px solid var(--ln3)", borderRadius: 12, background: "var(--sf2)", padding: "12px 16px", cursor: "pointer" }}
                    onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; })}>
                    <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>
                      CROWD POLL · ROUND {it.s.round} · {it.s.polled} POLLED — CLICK TO {open ? "COLLAPSE" : "EXPAND"}
                    </div>
                    {it.s.question && (
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--t3)", marginTop: 6 }}>
                        <span style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--acc)" }}>ASKED · </span>
                        “{it.s.question}”
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 4, height: 8, borderRadius: 100, overflow: "hidden", marginTop: 8 }}>
                      {shares.map((s2) => (
                        <span key={s2.key} title={`${labelOf[s2.key] ?? s2.key} — ${s2.count} of ${it.s.polled}`} style={{ width: `${s2.pct}%`, background: colorOf[s2.key] }} />
                      ))}
                    </div>
                    {/* legend rows: swatch · label · % · raw count — replaces the cramped one-liner */}
                    <div style={{ display: "flex", flexWrap: "wrap", columnGap: 16, rowGap: 5, marginTop: 8 }}>
                      {shares.map((s2) => (
                        <span key={s2.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 3, background: colorOf[s2.key], flex: "none" }} />
                          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".04em", color: "var(--t4)" }}>{(labelOf[s2.key] ?? s2.key).toUpperCase()}</span>
                          <span style={{ ...mono, fontSize: 10.5, color: "var(--t1)", fontWeight: 500 }}>{s2.pct}%</span>
                          <span style={{ ...mono, fontSize: 8.5, color: "var(--t7)" }}>({s2.count})</span>
                        </span>
                      ))}
                    </div>
                    {open && (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                        {it.s.quotes.map((qt, qi) => (
                          <div key={qi} style={{ fontSize: 12, lineHeight: 1.55, color: "var(--t4)" }}>
                            <span style={{ ...mono, fontSize: 8.5, color: qt.stance === "oppose" ? "var(--warn)" : qt.stance === "undecided" || qt.stance === "disengaged" ? "var(--t6)" : "var(--acc)" }}>{(labelOf[qt.stance] ?? qt.stance).toUpperCase()} · </span>
                            “{qt.quote}” <span style={{ color: "var(--t6)" }}>— {qt.name}</span>
                          </div>
                        ))}
                        {(it.s.ballots?.length ?? 0) > 0 && (
                          <div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setBallotsOpen((prev) => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; }); }}
                              style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", background: "none", border: "none", padding: 0, color: "var(--t6)", cursor: "pointer" }}
                            >
                              SEE EVERY VOTE ({it.s.ballots!.length}) {votesOpen ? "▴" : "▾"}
                            </button>
                            {votesOpen && (
                              <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 6 }}
                                onClick={(e) => e.stopPropagation()}>
                                {shares.filter((s2) => s2.count > 0).map((s2) => (
                                  <div key={s2.key}>
                                    <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: colorOf[s2.key] === "var(--ln5)" ? "var(--t6)" : colorOf[s2.key], marginBottom: 3 }}>
                                      {(labelOf[s2.key] ?? s2.key).toUpperCase()} · {s2.count}
                                    </div>
                                    <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--t5)" }}>
                                      {it.s.ballots!.filter((b) => b.stance === s2.key).map((b) => b.name).join(" · ")}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              const p = it.post;
              if (hiddenByCollapse(p.seq)) return null;
              const div = dividers(idx);
              const score = viewMode === "Jury" && p.tag !== "TALLY" ? scoreOf(p) : null;
              const judge = p.tag === "JUDGE'S NOTE" || p.tag === "TALLY";
              const isFloor = p.author === "user" || p.tag === "FLOOR";
              const isInterjection = p.tag === "INTERJECTION";
              const depth = Math.min(depthBySeq.get(p.seq) ?? 0, 5);
              const kids = childrenBySeq.get(p.seq)?.length ?? 0;
              const nested = descendantCount(p.seq);
              const isCollapsed = collapsed.has(p.seq);
              const ve = votesBySeq.get(p.seq);
              const voteTitle = (list: LiveVote[]) => list.map((v) => `${v.voter_name} — ${v.voter_role}`).join("\n");
              const topPost = topOfRound.has(p.seq);
              return (
                <div key={`p${p.seq}`}>
                  {div && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 4px" }}>
                      <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>{div}</span>
                      <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                    </div>
                  )}
                  <div style={{
                    marginTop: isInterjection ? 8 : 14,
                    // reddit-style nesting: indent per reply depth (visual cap 5), chain line in --ln3
                    marginLeft: (viewMode === "Tribunal" && p.side === "con" ? 20 : 0) + depth * 18,
                    paddingLeft: depth > 0 ? 12 : 0,
                    borderLeft: depth > 0 ? "1px solid var(--ln3)" : "none",
                    ...(judge ? { border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 12, padding: "12px 14px" } : {}),
                    ...(isFloor ? { border: "1px solid var(--acc)", borderRadius: 12, padding: "12px 14px", background: "var(--sf2)" } : {}),
                    ...(topPost ? { boxShadow: "0 0 0 1px var(--acc)", borderRadius: 12, padding: "10px 12px" } : {}),
                    ...(flashSeq === p.seq ? { boxShadow: "0 0 0 2px var(--acc)", borderRadius: 12, transition: "box-shadow .3s ease" } : {}),
                    animation: "fadeUp .3s ease both",
                  }} data-seq={p.seq}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: isInterjection ? 22 : 30, height: isInterjection ? 22 : 30, borderRadius: "50%", background: isFloor ? "var(--acc-dim)" : "var(--sf2)", border: `1px solid ${isFloor ? "var(--acc)" : p.adversarial ? "var(--warn)" : "var(--ln5)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: isInterjection ? 7.5 : 9.5, color: isFloor ? "var(--acc)" : "var(--t3)", flex: "none" }}>{p.initials}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: isInterjection ? 11.5 : 12.5, fontWeight: 600, lineHeight: 1.2 }}>
                          {p.name}
                          <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", marginLeft: 8, padding: "2px 7px", borderRadius: 100, border: `1px solid ${isFloor ? "var(--acc)" : p.tag === "REBUTTAL" || p.tag === "COUNTER" || p.adversarial ? "var(--warn)" : "var(--ln4)"}`, color: isFloor ? "var(--acc)" : p.tag === "REBUTTAL" || p.tag === "COUNTER" ? "var(--warn)" : p.tag.startsWith("POST") || judge ? "var(--acc)" : "var(--t6)" }}>
                            {isFloor ? "YOU · TAKING THE FLOOR" : p.tag}
                          </span>
                          {score && <span style={{ ...mono, fontSize: 9, marginLeft: 8, color: "var(--acc)" }}>{score}</span>}
                          {topPost && <span style={{ ...mono, fontSize: 8, letterSpacing: ".05em", marginLeft: 8, color: "var(--acc)" }}>▲ MOST ENDORSED · ROUND {p.round}</span>}
                          {p.reply_to != null && (postMetaBySeq.get(p.reply_to)?.round ?? p.round) < p.round && (
                            <button
                              onClick={() => jumpToSeq(p.reply_to!)}
                              title="This reply revives an earlier thread — jump to the post it answers"
                              style={{ ...mono, fontSize: 7.5, letterSpacing: ".06em", marginLeft: 8, padding: "2px 8px", borderRadius: 100, border: "1px solid var(--ln4)", background: "transparent", color: "var(--acc)", cursor: "pointer" }}
                            >
                              ↩ ROUND {postMetaBySeq.get(p.reply_to)!.round} · {postMetaBySeq.get(p.reply_to)!.name.split(" ")[0].toUpperCase()}
                            </button>
                          )}
                        </div>
                        {!isFloor && <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", marginTop: 2 }}>{p.role.toUpperCase()}</div>}
                      </div>
                    </div>
                    <div style={{ margin: "8px 0 0", fontSize: isInterjection ? 11.5 : 12.5, lineHeight: 1.6, color: isInterjection ? "var(--t5)" : "var(--t3)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <Markdown text={p.content} />
                    </div>
                    {/* the searches THIS post ran — collapsible, inside the post */}
                    {(toolsBySeq.get(p.seq) ?? []).map((t, ti) => {
                      const k = `${p.seq}:${ti}`;
                      const open = searchOpen.has(k);
                      return (
                        <div key={k} style={{ marginTop: 7, border: "1px solid var(--ln2)", borderRadius: 10, background: "var(--sf2)", padding: "7px 12px" }}>
                          <button
                            onClick={() => setSearchOpen((prev) => { const n2 = new Set(prev); if (n2.has(k)) n2.delete(k); else n2.add(k); return n2; })}
                            style={{ display: "flex", width: "100%", alignItems: "baseline", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", minWidth: 0 }}
                          >
                            <span style={{ ...mono, fontSize: 8, letterSpacing: ".07em", color: "var(--acc)", flex: "none" }}>🔎 SEARCHED</span>
                            <span style={{ ...mono, fontSize: 9.5, color: "var(--t5)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>“{t.query}”</span>
                            <span style={{ ...mono, fontSize: 8, color: "var(--t6)", flex: "none" }}>{t.results.length} SOURCE{t.results.length === 1 ? "" : "S"} {open ? "▴" : "▾"}</span>
                          </button>
                          {open && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
                              {t.results.map((r, ri) => (
                                <a key={ri} href={r.url} target="_blank" rel="noopener noreferrer"
                                  style={{ display: "flex", gap: 8, alignItems: "baseline", textDecoration: "none", minWidth: 0 }}>
                                  <span style={{ ...mono, fontSize: 8, color: "var(--t7)", flex: "none" }}>↗</span>
                                  <span style={{ fontSize: 11.5, color: "var(--t4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
                                  <span style={{ ...mono, fontSize: 8, letterSpacing: ".03em", color: "var(--t7)", flex: "none" }}>
                                    {(() => { try { return new URL(r.url).hostname.replace(/^www\./, "").toUpperCase(); } catch { return ""; } })()}
                                  </span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {p.cites.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                        {p.cites.map((c, ci) => (
                          <span key={ci} title={c.quote} style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", border: "1px solid var(--ln4)", borderRadius: 100, padding: "2px 8px", color: "var(--t6)" }}>
                            ⌗ {c.title.toUpperCase().slice(0, 28)}
                          </span>
                        ))}
                      </div>
                    )}
                    {(ve || kids > 0) && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                        {ve && ve.up.length > 0 && (
                          <span title={voteTitle(ve.up)} style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--acc)", border: "1px solid var(--ln3)", borderRadius: 100, padding: "2px 8px", cursor: "default" }}>▲ {ve.up.length}</span>
                        )}
                        {ve && ve.down.length > 0 && (
                          <span title={voteTitle(ve.down)} style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--warn)", border: "1px solid var(--ln3)", borderRadius: 100, padding: "2px 8px", cursor: "default" }}>▼ {ve.down.length}</span>
                        )}
                        {kids > 0 && (
                          <button
                            onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(p.seq)) n.delete(p.seq); else n.add(p.seq); return n; })}
                            style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t6)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                          >
                            {isCollapsed ? `+ SHOW ${nested} REPL${nested === 1 ? "Y" : "IES"}` : `— HIDE ${nested} REPL${nested === 1 ? "Y" : "IES"}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {thinking && status === "running" && (
              <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)", marginTop: 14, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.1s ease infinite" }} />
                {thinking.toUpperCase()} IS COMPOSING…
              </div>
            )}
            {status === "done" && posts > 0 && (
              <div style={{ margin: "20px 0 6px", padding: "16px 18px", border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 12 }}>
                <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--acc)" }}>RUN COMPLETE · {posts} POSTS PERSISTED</div>
                {synthesizing ? (
                  /* the button becomes the instrument: a full-width strip streaming stage updates */
                  <div style={{ marginTop: 12, borderRadius: 100, background: "var(--acc)", padding: "13px 24px", position: "relative", overflow: "hidden" }}>
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "linear-gradient(90deg, transparent 30%, rgba(255,255,255,.28) 50%, transparent 70%)",
                      backgroundSize: "400px 100%", animation: "shim 1.4s linear infinite",
                    }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 11, position: "relative", minWidth: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc-c)", animation: "pulseDot 1.1s ease infinite", flex: "none" }} />
                      <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--acc-c)", fontFamily: "var(--font-sans), sans-serif", flex: "none" }}>
                        Synthesizing the report
                      </span>
                      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--acc-c)", opacity: 0.8, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {synthesizing}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                    {reportReady ? (
                      <>
                        <button
                          onClick={() => router.push(`/sim/${simId}/report`)}
                          style={{
                            background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 13.5,
                            padding: "10px 22px", borderRadius: 100, border: "none", cursor: "pointer",
                            fontFamily: "var(--font-sans), sans-serif",
                          }}
                        >
                          Read the report →
                        </button>
                        <button
                          onClick={() => void synthesize()}
                          style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln6)", color: "var(--t5)", cursor: "pointer" }}
                        >
                          SYNTHESIZE A NEW VERSION
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => void synthesize()}
                          style={{
                            background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 13.5,
                            padding: "10px 22px", borderRadius: 100, border: "none", cursor: "pointer",
                            fontFamily: "var(--font-sans), sans-serif",
                          }}
                        >
                          Synthesize the report →
                        </button>
                        {hasStaleReport && (
                          <Link href={`/sim/${simId}/report`} style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, border: "1px solid var(--ln6)", color: "var(--t5)" }}>
                            READ THE PREVIOUS RUN&apos;S REPORT →
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {error && <div style={{ ...mono, fontSize: 10.5, color: "var(--warn)", marginTop: 14 }}>{error}</div>}
          </div>

          {/* Take the Floor — the user is a participant, not a spectator */}
          {items.length > 0 && status !== "running" && (
            <div style={{ borderTop: "1px solid var(--ln2)", padding: "10px 14px", position: "relative" }}>
              {mentionQ !== null && (
                <div style={{ position: "absolute", bottom: "100%", left: 14, right: 14, marginBottom: 6, background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 10, overflow: "hidden", zIndex: 5, boxShadow: "0 8px 30px rgba(0,0,0,.35)" }}>
                  {leads.filter((l) => l.name.toLowerCase().includes(mentionQ.toLowerCase()) || l.role.toLowerCase().includes(mentionQ.toLowerCase())).slice(0, 6).map((l) => (
                    <button
                      key={l.key}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        floorMentions.current.set(l.name, l.key);
                        setFloorText((t) => t.replace(/@[^@]*$/, `@${l.name} `));
                        setMentionQ(null);
                      }}
                      style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", textAlign: "left", padding: "7px 12px", background: "transparent", border: "none", cursor: "pointer" }}
                    >
                      <span style={{ ...mono, fontSize: 8, width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--ln5)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--t4)", flex: "none" }}>{l.initials}</span>
                      <span style={{ fontSize: 12, color: "var(--t2)" }}>{l.name}</span>
                      <span style={{ ...mono, fontSize: 8, letterSpacing: ".05em", color: "var(--t6)" }}>{l.role.toUpperCase().slice(0, 34)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={floorText}
                  disabled={floorBusy}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFloorText(v);
                    const m = v.match(/@([^@]*)$/);
                    setMentionQ(m && !m[1].includes("  ") && m[1].length <= 30 ? m[1] : null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" && mentionQ === null) void takeFloor(); if (e.key === "Escape") setMentionQ(null); }}
                  placeholder={`Take the floor — challenge a claim or ask the panel (@ mentions someone directly)`}
                  style={{ flex: 1, background: "var(--sf2)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "9px 16px", fontSize: 12.5, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
                />
                <button
                  onClick={() => void takeFloor()}
                  disabled={floorBusy || !floorText.trim()}
                  style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "9px 16px", borderRadius: 100, background: floorBusy || !floorText.trim() ? "var(--sf2)" : "var(--acc)", color: floorBusy || !floorText.trim() ? "var(--t6)" : "var(--acc-c)", border: "none", cursor: floorBusy ? "wait" : "pointer", flex: "none" }}
                >
                  {floorBusy ? "THE PANEL IS ANSWERING…" : "POST ➤"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* §2c roster rail — the cast is knowable mid-run */}
        {rosterOpen && (
          <div style={{ width: 268, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf)", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--ln2)", ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
              THE PANEL · {leads.length} LEADS
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {leads.map((l) => (
                <button
                  key={l.key}
                  onClick={() => setProfileKey(l.key)}
                  style={{ textAlign: "left", background: "var(--sf2)", border: `1px solid ${l.adversarial ? "var(--warn)" : "var(--ln3)"}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ ...mono, fontSize: 8.5, width: 26, height: 26, borderRadius: "50%", border: `1px solid ${l.adversarial ? "var(--warn)" : "var(--ln5)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: l.adversarial ? "var(--warn)" : "var(--t4)", flex: "none" }}>{l.initials}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                      <div style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.role.toUpperCase()}</div>
                    </div>
                  </div>
                  {(l.discipline || l.adversarial) && (
                    <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                      {l.discipline && <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", border: "1px solid var(--ln4)", borderRadius: 100, padding: "1px 7px", color: "var(--t6)" }}>{l.discipline}</span>}
                      {l.adversarial && <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", border: "1px solid var(--warn)", borderRadius: 100, padding: "1px 7px", color: "var(--warn)" }}>ADVERSARIAL</span>}
                    </div>
                  )}
                  {(l.tagline || l.backstory) && (
                    <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--t5)", marginTop: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {l.tagline || l.backstory}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {profileKey && (() => {
        const l = leads.find((x) => x.key === profileKey);
        if (!l?.spec) return null;
        return (
          <PersonaProfile
            kind={l.kind ?? "expert"}
            spec={l.spec}
            chatKey={l.key}
            source="library"
            showChatCta={false}
            onClose={() => setProfileKey(null)}
          />
        );
      })()}
    </div>
  );
}
