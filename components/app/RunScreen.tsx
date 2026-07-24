"use client";

/**
 * The live simulation screen (CLAUDE.md §2 Stage 4, demo Stage 03 grammar):
 * agent network canvas left, threaded forum feed right, progress bar,
 * pause / speed / skip controls. Today it runs the Site 47-A golden fixture
 * in replay; the engine (next batch) will feed the same component real
 * events over the identical shapes — the driver is the only thing swapped.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  REPLAY_AGENTS, REPLAY_BRIEF, REPLAY_DAYS, REPLAY_EVENTS, REPLAY_LEAD_KEYS, REPLAY_TOTAL_T,
  ReplayEvent,
} from "@/lib/replay-fixture";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

interface Node { x: number; y: number; lead?: boolean; label?: string; p?: number }
interface Pulse { a: Node; b: Node; t0: number; dur: number; strong: boolean }

interface FeedItem {
  key: string;
  kind: "post" | "reply" | "burst";
  author?: string;
  tag?: string;
  warn?: boolean;
  text: string;
}

function cssToken(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function RunScreen({ simId, problem }: { simId: string; problem?: string }) {
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const feedEl = useRef<HTMLDivElement>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [vt, setVt] = useState(0);            // virtual clock, seconds
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [typingName, setTypingName] = useState<string | null>(null);
  const done = vt >= REPLAY_TOTAL_T;

  // ---- refs shared between the clock and the canvas ----
  const nodes = useRef<{ experts: Node[]; residents: Node[] } | null>(null);
  const leadNodes = useRef<Record<string, Node>>({});
  const pulses = useRef<Pulse[]>([]);
  const trail = useRef<[Node, Node][]>([]);
  const speaker = useRef<{ node: Node | null; until: number }>({ node: null, until: 0 });
  const fired = useRef(0);
  const runningRef = useRef(true);
  const speedRef = useRef(1);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // deterministic pseudo-random for burst pulse targets
  const rand = (i: number, salt: number) => {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  const fireVisual = (ev: ReplayEvent, evIndex: number) => {
    const now = performance.now();
    const N = nodes.current;
    if (!N) return;
    if (ev.k === "b") {
      for (let i = 0; i < 7; i++) {
        const a = N.experts[Math.floor(rand(evIndex * 7 + i, 3) * N.experts.length)];
        const b = rand(evIndex * 7 + i, 9) < 0.3
          ? N.residents[Math.floor(rand(evIndex * 7 + i, 5) * N.residents.length)]
          : N.experts[Math.floor(rand(evIndex * 7 + i, 7) * N.experts.length)];
        if (a && b && a !== b) { pulses.current.push({ a, b, t0: now + i * 140, dur: 1600, strong: false }); trail.current.push([a, b]); }
      }
      trail.current = trail.current.slice(-30);
      return;
    }
    const a = ev.a ? leadNodes.current[ev.a] : null;
    const b = ev.to ? leadNodes.current[ev.to] : null;
    if (!a) return;
    const targets = b ? [b] : N.experts.filter((n) => n.lead && n !== a);
    targets.forEach((t, i) => pulses.current.push({ a, b: t, t0: now + i * 90, dur: b ? 4200 : 2400, strong: !!b }));
    if (b) trail.current.push([a, b]);
    trail.current = trail.current.slice(-30);
    const next = REPLAY_EVENTS[evIndex + 1];
    speaker.current = { node: a, until: now + Math.min(4800, next ? ((next.t - ev.t) * 1000) / speedRef.current : 4000) };
  };

  // ---- the virtual clock: advance vt, fire events as they pass ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (runningRef.current && clock < REPLAY_TOTAL_T) {
        clock = Math.min(REPLAY_TOTAL_T, clock + dt * speedRef.current);
        setVt(clock);
        while (fired.current < REPLAY_EVENTS.length && REPLAY_EVENTS[fired.current].t <= clock) {
          const idx = fired.current;
          const ev = REPLAY_EVENTS[idx];
          fired.current += 1;
          fireVisual(ev, idx);
          setFeed((prev) => [...prev, toFeedItem(ev, idx)]);
          const upcoming = REPLAY_EVENTS[fired.current];
          setTypingName(upcoming && upcoming.k !== "b" && upcoming.a ? REPLAY_AGENTS[upcoming.a]?.name ?? null : null);
        }
        if (clock >= REPLAY_TOTAL_T) setTypingName(null);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toFeedItem = (ev: ReplayEvent, idx: number): FeedItem => {
    if (ev.k === "b") return { key: `e${idx}`, kind: "burst", text: ev.x };
    const flip = !!ev.flip;
    return {
      key: `e${idx}`,
      kind: ev.k === "p" ? "post" : "reply",
      author: ev.a,
      tag: flip ? "CHANGED POSITION" : ev.k === "p" ? `POST ${ev.n}` : "REPLY",
      warn: flip,
      text: ev.x,
    };
  };

  // autoscroll the feed
  useEffect(() => {
    const el = feedEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length, typingName]);

  const skipToEnd = () => {
    const missed = REPLAY_EVENTS.slice(fired.current);
    fired.current = REPLAY_EVENTS.length;
    setFeed((prev) => [...prev, ...missed.map((ev, i) => toFeedItem(ev, REPLAY_EVENTS.length - missed.length + i))]);
    setVt(REPLAY_TOTAL_T);
    setTypingName(null);
    setRunning(false);
    // the clock closure reads refs; force it past the end
    runningRef.current = false;
  };

  const replay = () => {
    fired.current = 0;
    pulses.current = [];
    trail.current = [];
    speaker.current = { node: null, until: 0 };
    setFeed([]);
    setVt(0);
    setTypingName(null);
    setRunning(true);
    runningRef.current = true;
    // restart the clock by remount-free reset: the rAF closure uses `clock`… simplest is a full reload of state
    window.location.reload();
  };

  // ---- canvas: layout + draw loop (the demo renderer, ported) ----
  useEffect(() => {
    const el = canvasEl.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const layout = () => {
      el.width = el.offsetWidth * dpr;
      el.height = el.offsetHeight * dpr;
      const w = el.width, h = el.height, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;
      const experts: Node[] = [];
      const leads: Record<string, Node> = {};
      const members: Record<string, Node[]> = {};
      REPLAY_LEAD_KEYS.forEach((k, i) => {
        const ang = (i / REPLAY_LEAD_KEYS.length) * Math.PI * 2 - Math.PI / 2;
        const gx = cx + Math.cos(ang) * R, gy = cy + Math.sin(ang) * R;
        const agent = REPLAY_AGENTS[k];
        const lead: Node = { x: gx, y: gy, lead: true, label: `${agent.name.split(" ")[0].toUpperCase()} · ${(agent.tag ?? "").split(" ")[0]}` };
        leads[k] = lead; experts.push(lead); members[k] = [];
        for (let j = 0; j < 5; j++) {
          const a2 = (j / 5) * Math.PI * 2 + i, r2 = (0.055 + (j % 3) * 0.02) * Math.min(w, h);
          const nd: Node = { x: gx + Math.cos(a2) * r2, y: gy + Math.sin(a2) * r2 };
          experts.push(nd); members[k].push(nd);
        }
      });
      Object.entries(REPLAY_AGENTS).forEach(([k, a]) => {
        if (a.cluster && members[a.cluster]) { const nd = members[a.cluster][0]; nd.label = a.label; leads[k] = nd; }
      });
      const residents: Node[] = [];
      for (let i = 0; i < 110; i++) {
        const ang = (i / 110) * Math.PI * 2, r = Math.min(w, h) * (0.44 + ((i * 7) % 10) * 0.004);
        residents.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, p: (i * 13) % 7 });
      }
      Object.entries(REPLAY_AGENTS).forEach(([k, a]) => {
        if (a.res != null && residents[a.res]) { residents[a.res].label = a.label; leads[k] = residents[a.res]; }
      });
      nodes.current = { experts, residents };
      leadNodes.current = leads;
    };
    layout();
    window.addEventListener("resize", layout);

    let raf = 0;
    const draw = () => {
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const w = el.width, h = el.height, now = performance.now();
      const acc = cssToken("--acc", "#37d98a"), dim = cssToken("--t7", "#6d7378"), mid = cssToken("--t5", "#9aa0a6");
      ctx.clearRect(0, 0, w, h);
      const N = nodes.current;
      if (N) {
        ctx.lineWidth = dpr * 0.6; ctx.strokeStyle = mid;
        for (const [a, b] of trail.current) { ctx.globalAlpha = 0.07; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        pulses.current = pulses.current.filter((p) => (now - p.t0) / p.dur <= 1);
        for (const p of pulses.current) {
          const k = (now - p.t0) / p.dur;
          if (k < 0) continue;
          ctx.globalAlpha = (p.strong ? 0.8 : 0.35) * (1 - k * 0.6); ctx.strokeStyle = acc; ctx.lineWidth = dpr * (p.strong ? 1.5 : 0.7);
          ctx.beginPath(); ctx.moveTo(p.a.x, p.a.y); ctx.lineTo(p.b.x, p.b.y); ctx.stroke();
          const mx = p.a.x + (p.b.x - p.a.x) * k, my = p.a.y + (p.b.y - p.a.y) * k;
          ctx.globalAlpha = 0.9 * (1 - k * 0.5); ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(mx, my, dpr * (p.strong ? 2.4 : 1.6), 0, 7); ctx.fill();
        }
        for (const r of N.residents) {
          const speaking = r === speaker.current.node && now < speaker.current.until;
          ctx.globalAlpha = speaking ? 1 : 0.26 + 0.13 * Math.sin(now / 1400 + (r.p ?? 0));
          ctx.fillStyle = speaking ? acc : dim;
          ctx.beginPath(); ctx.arc(r.x, r.y, dpr * (speaking ? 3.4 : 1.1), 0, 7); ctx.fill();
          if (speaking && r.label) { ctx.globalAlpha = 1; ctx.fillStyle = acc; ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`; ctx.textAlign = "center"; ctx.fillText(r.label, r.x, r.y - dpr * 9); }
        }
        for (const e of N.experts) {
          const speaking = e === speaker.current.node && now < speaker.current.until;
          ctx.globalAlpha = 1; ctx.fillStyle = speaking ? acc : (e.lead ? mid : dim);
          const rr = dpr * (e.lead ? 3.4 : 2) * (speaking ? 1.5 + 0.25 * Math.sin(now / 130) : 1);
          ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, 7); ctx.fill();
          if (speaking) { ctx.globalAlpha = 0.25; ctx.strokeStyle = acc; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(e.x, e.y, rr + dpr * 6 + dpr * 2 * Math.sin(now / 200), 0, 7); ctx.stroke(); }
          if (e.label && (e.lead || speaking)) {
            ctx.globalAlpha = speaking ? 1 : 0.55; ctx.fillStyle = speaking ? acc : mid;
            ctx.font = `${10 * dpr}px "JetBrains Mono", monospace`; ctx.textAlign = "center";
            ctx.fillText(e.label, e.x, e.y - dpr * 10);
          }
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", layout); };
  }, []);

  const day = Math.max(1, Math.min(REPLAY_DAYS, Math.ceil((vt / REPLAY_TOTAL_T) * REPLAY_DAYS)));
  const pct = Math.min(100, (vt / REPLAY_TOTAL_T) * 100);

  const Avatar = ({ k }: { k: string }) => (
    <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--sf2)", border: `1px solid ${REPLAY_AGENTS[k]?.adv ? "var(--warn)" : "var(--ln5)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 9.5, color: "var(--t3)", flex: "none" }}>
      {REPLAY_AGENTS[k]?.initials ?? "?"}
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", boxSizing: "border-box", padding: "22px 26px" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/sim/${simId}`} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>← WORKSPACE</Link>
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: done ? "var(--acc)" : "var(--t4)" }}>
          {done ? "CONVERGED" : "SIMULATING"}
        </span>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--warn)", border: "1px solid var(--warn)", background: "var(--warn-dim)", borderRadius: 100, padding: "3px 10px" }}>
          REPLAY · SITE 47-A GOLDEN FIXTURE — YOUR OWN RUN ARRIVES WITH THE ENGINE
        </span>
        <span style={{ marginLeft: "auto", ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--t6)" }}>DAY {day} / {REPLAY_DAYS}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: "var(--t5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {problem || REPLAY_BRIEF}
      </div>
      {/* progress */}
      <div style={{ height: 4, borderRadius: 100, background: "var(--sf2)", marginTop: 12, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: done ? "var(--acc)" : "var(--acc)", opacity: done ? 1 : 0.8, transition: "width .3s linear" }} />
      </div>

      {/* body */}
      <div style={{ display: "flex", gap: 18, flex: 1, minHeight: 0, marginTop: 14 }}>
        {/* canvas */}
        <div style={{ flex: 1.15, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--ln2)", borderRadius: 14, padding: "14px 16px", background: "var(--sf)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
            <span>AGENT NETWORK · {done ? "SETTLED" : "LIVE"}</span>
            <span>8 LEADS · 48 EXPERTS · 110 RESIDENTS SHOWN</span>
          </div>
          <canvas ref={canvasEl} style={{ flex: 1, width: "100%", minHeight: 0, marginTop: 10 }} />
        </div>

        {/* feed */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf)", overflow: "hidden" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--ln2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>FORUM FEED</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setRunning((r) => !r)} disabled={done} style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "4px 12px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln5)", color: done ? "var(--t7)" : "var(--t4)", cursor: done ? "default" : "pointer" }}>
                {running ? "PAUSE" : "RESUME"}
              </button>
              <button onClick={() => setSpeed((s) => (s === 1 ? 4 : 1))} disabled={done} style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "4px 12px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln5)", color: done ? "var(--t7)" : "var(--t4)", cursor: done ? "default" : "pointer" }}>
                SPEED {speed}×
              </button>
              {!done ? (
                <button onClick={skipToEnd} style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "4px 12px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln5)", color: "var(--t4)", cursor: "pointer" }}>
                  SKIP TO END
                </button>
              ) : (
                <button onClick={replay} style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "4px 12px", borderRadius: 100, background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)", cursor: "pointer" }}>
                  ↺ REPLAY
                </button>
              )}
            </div>
          </div>
          <div ref={feedEl} style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
            {feed.map((f) =>
              f.kind === "burst" ? (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
                  <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>{f.text}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                </div>
              ) : (
                <div key={f.key} style={{ marginTop: 14, marginLeft: f.kind === "reply" ? 36 : 0, paddingLeft: f.kind === "reply" ? 14 : 0, borderLeft: f.kind === "reply" ? "1px solid var(--ln2)" : "none", animation: "fadeUp .3s ease both" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    {f.author && <Avatar k={f.author} />}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>
                        {f.author ? REPLAY_AGENTS[f.author]?.name : ""}
                        <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", marginLeft: 8, padding: "2px 7px", borderRadius: 100, border: `1px solid ${f.warn ? "var(--warn)" : "var(--ln4)"}`, color: f.warn ? "var(--warn)" : f.kind === "post" ? "var(--acc)" : "var(--t6)", background: f.warn ? "var(--warn-dim)" : "transparent" }}>
                          {f.tag}
                        </span>
                      </div>
                      <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", marginTop: 2 }}>
                        {f.author ? REPLAY_AGENTS[f.author]?.role.toUpperCase() : ""}
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t3)" }}>{f.text}</p>
                </div>
              )
            )}
            {typingName && !done && (
              <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)", marginTop: 14, display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.1s ease infinite" }} />
                {typingName.toUpperCase()} IS COMPOSING…
              </div>
            )}
            {done && (
              <div style={{ margin: "20px 0 6px", padding: "14px 16px", border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 12 }}>
                <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--acc)" }}>CONVERGED · 45 OF 48 ALIGNED · 3 DISSENTS PRESERVED</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t4)", marginTop: 6 }}>
                  In a real run the report engine now takes the transcript. This replay ends here — the report arrives with the engine build.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
