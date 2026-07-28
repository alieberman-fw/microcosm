"use client";

/**
 * The LIVE run screen (engine v1) — real events from /run/launch streamed
 * into the §5 grammar. One canvas, seven arrangements (mode-specific node
 * layouts); one feed, seven structures (round markers, tribunal columns,
 * verdict cards, phase dividers). Crowd sentiment polls render as
 * expandable cards — the real-run answer to the demo's "+N POSTS" bursts:
 * nothing is hidden, everything persisted, click to open.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MiniSwarm } from "@/components/app/CastingTheater";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface LiveLead {
  key: string;
  name: string;
  initials: string;
  role: string;
  discipline?: string;
  adversarial?: boolean;
  residentSide?: boolean;
}

export interface LivePost {
  seq: number;
  agent_key: string;
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
}

type Item = { kind: "post"; post: LivePost } | { kind: "sentiment"; s: LiveSentiment };

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
  simId, problem, mode, configuredMode, leads, crowdCount, crowdTarget = 0, initialPosts, initialSentiments, initialStatus, maxRounds, hasReport = false,
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
  initialStatus: string;
  maxRounds: number;
  hasReport?: boolean;
}) {
  const merged: Item[] = [
    ...initialPosts.map((p) => ({ kind: "post" as const, post: p })),
  ];
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
  const router = useRouter();

  // self-heal a stale client-cache hit: a completed run can never be empty —
  // if the server payload says complete but carried no posts, refetch once
  useEffect(() => {
    if (initialStatus === "complete" && initialPosts.length === 0) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const synthesize = async () => {
    if (synthesizing) return;
    setSynthesizing("SYNTHESIZING…");
    try {
      const res = await fetch(`/api/simulations/${simId}/report`, { method: "POST" });
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
      setError(e instanceof Error ? e.message : "Synthesis failed");
      setSynthesizing(null);
    }
  };
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
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

  const launch = async (cont = false) => {
    if (!cont && status === "running") return;
    setStatus("running");
    if (!cont) { setItems([]); chunkCount.current = 0; }
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
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Launch failed");
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
          if (evt.type === "config") {
            // the engine's real parameters win over the server-rendered props —
            // including the MODE: a re-run after a mode change switches the
            // arrangement the moment the new run starts
            if (Number(evt.rounds)) setMaxR(Number(evt.rounds));
            if (typeof evt.mode === "string" && evt.mode) setViewMode(evt.mode);
          } else if (evt.type === "post") {
            const p = evt as unknown as LivePost & { type: string };
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
            polling.current = null;
            setItems((prev) => [...prev, { kind: "sentiment", s: evt as unknown as LiveSentiment }]);
            // canvas: the crowd lights up and pulses inward while the poll lands
            pollWave.current = performance.now();
            const ring = crowdRef.current;
            const cx = (canvasEl.current?.width ?? 0) / 2, cy = (canvasEl.current?.height ?? 0) / 2;
            const now = performance.now();
            for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 14))) {
              pulses.current.push({ a: ring[i], b: { x: cx, y: cy }, t0: now + (i % 7) * 120, dur: 2200, strong: false });
            }
          } else if (evt.type === "stage") {
            if (evt.value === "running" && evt.detail) setNote(String(evt.detail));
            if (evt.value === "converged") setNote(`CONVERGED — POSITIONS STABILIZED, STOPPED BEFORE THE ROUND CAP · SET "STOP WHEN: ROUNDS EXHAUSTED" TO FORCE EVERY ROUND`);
            if (evt.value === "done") {
              // honest stop reasons — "converged" is reserved for the stability rule
              const reason = String(evt.detail ?? "");
              if (reason === "choreography") setNote(`RUN COMPLETE — THIS MODE RUNS A FIXED CHOREOGRAPHY (PHASES, NOT ROUNDS), AND EVERY PHASE DELIVERED`);
              else if (reason === "budget") setNote(`STOPPED AT THE MAX-POSTS BUDGET — RAISE IT IN RUN CONFIG FOR A LONGER RUN`);
              else if (reason === "rounds") setNote(`ALL ROUNDS COMPLETE`);
            }
            if (evt.value === "converged" || evt.value === "done") { sawTerminal = true; setStatus("done"); }
            if (evt.value === "error") { sawTerminal = true; setStatus("idle"); setError(String(evt.detail ?? "Run failed")); }
          } else if (evt.type === "error") {
            sawTerminal = true;
            setStatus("idle");
            setError(String(evt.error ?? "Run failed"));
          } else if (evt.type === "finished") {
            sawTerminal = true;
            setStatus("done");
          } else if (evt.type === "continue") {
            // the slice hit the serverless window — reconnect for the next one
            sawContinue = true;
            chunkCount.current += 1;
            if (chunkCount.current < 40) {
              setNote(`LONG RUN · CONTINUING SEAMLESSLY (SLICE ${chunkCount.current + 1}) — ROUND ${evt.round}`);
              setTimeout(() => void launch(true), 400);
            }
          }
        }
      }
      setThinking(null);
      polling.current = null; // the sweep must never keep looping after the stream closes
      if (!sawContinue && sawTerminal) {
        setStatus((s) => (s === "running" ? "done" : s));
        router.refresh(); // the persisted run replaces any cached empty payload
      } else if (!sawContinue && !sawTerminal) {
        // the stream died WITHOUT a verdict (platform hard-kill mid-slice,
        // network drop) — the run is NOT done; resume it from the transcript
        chunkCount.current += 1;
        if (chunkCount.current < 40) {
          setNote(`CONNECTION DROPPED MID-SLICE — RESUMING FROM THE PERSISTED TRANSCRIPT (SLICE ${chunkCount.current + 1})`);
          setTimeout(() => void launch(true), 1500);
        } else {
          setStatus("idle");
          setError("The run was interrupted repeatedly — hit RE-RUN to continue; every post so far is persisted");
        }
      }
    } catch (e) {
      polling.current = null;
      setError(e instanceof Error ? e.message : "Launch failed");
      setStatus("idle");
    }
  };

  useEffect(() => {
    const el = feedEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, thinking]);

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

  // feed grouping: insert a divider when round/phase changes (mode-appropriate)
  const dividers = (idx: number): string | null => {
    const it = items[idx];
    if (it.kind !== "post") return null;
    const prev = [...items.slice(0, idx)].reverse().find((x) => x.kind === "post") as { kind: "post"; post: LivePost } | undefined;
    if (viewMode === "Chamber" || viewMode === "Expedition" || viewMode === "Desk") {
      const ph = it.post.phase ?? it.post.tag;
      const prevPh = prev?.post.phase ?? prev?.post.tag;
      return ph !== prevPh ? String(ph).toUpperCase() : null;
    }
    if (!prev || it.post.round !== prev.post.round) return `ROUND ${it.post.round}${viewMode === "Roundtable" ? " — EVERY VOICE IN ORDER" : viewMode === "Jury" ? " — SCORE, THEN DELIBERATE" : ""}`;
    return null;
  };

  const scoreOf = (p: LivePost): string | null => p.content.match(/SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i)?.[1] ?? null;
  const posts = items.filter((i) => i.kind === "post").length;
  const currentRound = items.reduce((m, i) => (i.kind === "post" ? Math.max(m, i.post.round) : m), 0);

  const statusLabel = status === "running" ? "SIMULATING" : status === "done" ? "COMPLETE" : "READY";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", boxSizing: "border-box", padding: "22px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/sim/${simId}`} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>← WORKSPACE</Link>
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: status === "done" ? "var(--acc)" : "var(--t4)" }}>{statusLabel}</span>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--acc)", border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 100, padding: "3px 10px" }}>
          LIVE · {viewMode.toUpperCase()} · ENGINE V1
        </span>
        <span style={{ marginLeft: "auto", ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--t6)" }}>
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
      <div style={{ height: 4, borderRadius: 100, background: "var(--sf2)", marginTop: 12, overflow: "hidden" }}>
        <div style={{ width: `${status === "done" ? 100 : Math.min(96, (currentRound / Math.max(maxR, 1)) * 100)}%`, height: "100%", background: "var(--acc)", transition: "width .4s ease" }} />
      </div>

      <div style={{ display: "flex", gap: 18, flex: 1, minHeight: 0, marginTop: 14 }}>
        <div style={{ flex: 1.15, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--ln2)", borderRadius: 14, padding: "14px 16px", background: "var(--sf)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
            <span>AGENT NETWORK · {viewMode.toUpperCase()} ARRANGEMENT</span>
            <span>{leads.length} LEADS · {liveCrowd} CROWD</span>
          </div>
          <canvas ref={canvasEl} style={{ flex: 1, width: "100%", minHeight: 0, marginTop: 10 }} />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf)", overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--ln2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
              {viewMode === "Jury" ? "VERDICTS" : viewMode === "Desk" ? "THE MEMO, ASSEMBLING" : viewMode === "Expedition" ? "FINDINGS LOG" : "FORUM FEED"}
            </span>
            {/* one launch control at a time: empty feed → the hero button below; a finished
                run → two-step RE-RUN (it REPLACES the persisted transcript) */}
            {status !== "running" && items.length > 0 && (
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
          <div ref={feedEl} style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
            {items.length === 0 && status !== "running" && (
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
              if (it.kind === "sentiment") {
                const total = Math.max(it.s.polled, 1);
                const open = expanded.has(idx);
                return (
                  <div key={`s${idx}`} style={{ margin: "16px 0", border: "1px solid var(--ln3)", borderRadius: 12, background: "var(--sf2)", padding: "12px 16px", cursor: "pointer" }}
                    onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; })}>
                    <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>
                      CROWD POLL · ROUND {it.s.round} · {it.s.polled} POLLED — CLICK TO {open ? "COLLAPSE" : "EXPAND"}
                    </div>
                    <div style={{ display: "flex", gap: 4, height: 8, borderRadius: 100, overflow: "hidden", marginTop: 8 }}>
                      {(["support", "conditional", "oppose", "disengaged"] as const).map((k, i2) => (
                        <span key={k} title={`${k} ${it.s.dist[k] ?? 0}`} style={{ width: `${((it.s.dist[k] ?? 0) / total) * 100}%`, background: i2 === 0 ? "var(--acc)" : i2 === 1 ? "var(--t5)" : i2 === 2 ? "var(--warn)" : "var(--ln5)" }} />
                      ))}
                    </div>
                    <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", marginTop: 6 }}>
                      {(["support", "conditional", "oppose", "disengaged"] as const).map((k) => `${Math.round(((it.s.dist[k] ?? 0) / total) * 100)}% ${k.toUpperCase()}`).join(" · ")}
                    </div>
                    {open && (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                        {it.s.quotes.map((qt, qi) => (
                          <div key={qi} style={{ fontSize: 12, lineHeight: 1.55, color: "var(--t4)" }}>
                            <span style={{ ...mono, fontSize: 8.5, color: qt.stance === "oppose" ? "var(--warn)" : "var(--acc)" }}>{qt.stance.toUpperCase()} · </span>
                            “{qt.quote}” <span style={{ color: "var(--t6)" }}>— {qt.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              const p = it.post;
              const div = dividers(idx);
              const score = viewMode === "Jury" && p.tag !== "TALLY" ? scoreOf(p) : null;
              const judge = p.tag === "JUDGE'S NOTE" || p.tag === "TALLY";
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
                    marginTop: 14,
                    marginLeft: viewMode === "Tribunal" && p.side === "con" ? 28 : p.tag === "REPLY" ? 36 : 0,
                    paddingLeft: p.tag === "REPLY" ? 14 : 0,
                    borderLeft: p.tag === "REPLY" ? "1px solid var(--ln2)" : "none",
                    ...(judge ? { border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 12, padding: "12px 14px" } : {}),
                    animation: "fadeUp .3s ease both",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--sf2)", border: `1px solid ${p.adversarial ? "var(--warn)" : "var(--ln5)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 9.5, color: "var(--t3)", flex: "none" }}>{p.initials}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>
                          {p.name}
                          <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", marginLeft: 8, padding: "2px 7px", borderRadius: 100, border: `1px solid ${p.tag === "REBUTTAL" || p.adversarial ? "var(--warn)" : "var(--ln4)"}`, color: p.tag === "REBUTTAL" ? "var(--warn)" : p.tag.startsWith("POST") || judge ? "var(--acc)" : "var(--t6)" }}>
                            {p.tag}
                          </span>
                          {score && <span style={{ ...mono, fontSize: 9, marginLeft: 8, color: "var(--acc)" }}>SCORE {score}/10</span>}
                        </div>
                        <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", marginTop: 2 }}>{p.role.toUpperCase()}</div>
                      </div>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t3)" }}>{p.content}</p>
                    {p.cites.length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                        {p.cites.map((c, ci) => (
                          <span key={ci} title={c.quote} style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", border: "1px solid var(--ln4)", borderRadius: 100, padding: "2px 8px", color: "var(--t6)" }}>
                            ⌗ {c.title.toUpperCase().slice(0, 28)}
                          </span>
                        ))}
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
                    )}
                  </div>
                )}
              </div>
            )}
            {error && <div style={{ ...mono, fontSize: 10.5, color: "var(--warn)", marginTop: 14 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
