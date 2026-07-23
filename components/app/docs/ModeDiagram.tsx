"use client";

/**
 * Looping canvas diagrams for the seven interaction modes (CLAUDE.md §5) —
 * the demo's node/pulse grammar, one small choreography per mode. Built for
 * the docs; the run-config mode picker reuses these as its card visuals and
 * the live run screen as its legends. Tokens only, deterministic motion,
 * reduced-motion renders a single settled frame.
 */

import { useEffect, useRef } from "react";

export type ModeKey = "agora" | "roundtable" | "tribunal" | "chamber" | "jury" | "desk" | "expedition";

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface Palette { acc: string; warn: string; dim: string; line: string }

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function pulse(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, p: number, color: string) {
  // a bright bead travelling from (x1,y1) to (x2,y2), p in [0,1]
  const x = x1 + (x2 - x1) * p;
  const y = y1 + (y2 - y1) * p;
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  dot(ctx, x, y, 1.8, color);
}

/* ------------------------------ choreographies ------------------------------ */

function drawAgora(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) {
  // three discipline clusters + crisscross pulses (the demo as-is, miniature)
  const clusters = [
    { x: W * 0.28, y: H * 0.38 }, { x: W * 0.62, y: H * 0.3 }, { x: W * 0.48, y: H * 0.68 },
  ];
  const nodes: { x: number; y: number }[] = [];
  clusters.forEach((cl, ci) => {
    for (let i = 0; i < 5; i++) {
      nodes.push({
        x: cl.x + (rand(i, ci * 7 + 1) - 0.5) * 44 + Math.sin(t * 0.7 + i + ci) * 2,
        y: cl.y + (rand(i, ci * 7 + 4) - 0.5) * 30 + Math.cos(t * 0.6 + i * 2 + ci) * 2,
      });
    }
  });
  // outer-ring residents
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + t * 0.05;
    dot(ctx, W / 2 + Math.cos(a) * (W * 0.44), H / 2 + Math.sin(a) * (H * 0.44), 1, c.dim, 0.5);
  }
  nodes.forEach((n, i) => dot(ctx, n.x, n.y, i % 5 === 0 ? 2.6 : 1.8, i === 3 ? c.warn : c.acc, 0.9));
  // three staggered pulses between random node pairs
  for (let k = 0; k < 3; k++) {
    const cycle = Math.floor(t / 1.4) + k * 13;
    const p = ((t % 1.4) / 1.4 + k * 0.33) % 1;
    const a = nodes[Math.floor(rand(cycle, k * 3 + 2) * nodes.length)];
    const b = nodes[Math.floor(rand(cycle, k * 5 + 8) * nodes.length)];
    if (a && b && a !== b) pulse(ctx, a.x, a.y, b.x, b.y, p, c.acc);
  }
}

function drawRoundtable(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) {
  // a ring of equals; the talking stick orbits in strict order
  const N = 8, cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.36;
  const active = Math.floor((t / 1.1) % N);
  const p = (t / 1.1) % 1;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    dot(ctx, x, y, i === active ? 3.2 : 2, i === active ? c.acc : c.dim, i === active ? 1 : 0.7);
    if (i === active) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = c.acc;
      ctx.beginPath();
      ctx.arc(x, y, 6 + Math.sin(t * 6) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // pulse travels the ring from active to next
  const a1 = (active / N) * Math.PI * 2 - Math.PI / 2;
  const a2 = ((active + 1) / N) * Math.PI * 2 - Math.PI / 2;
  const am = a1 + (a2 - a1) * p;
  dot(ctx, cx + Math.cos(am) * R, cy + Math.sin(am) * R, 1.6, c.acc, 0.9);
}

function drawTribunal(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) {
  // two benches volley; the judge rules; the scale tilts
  const L = { x: W * 0.2, y: H * 0.58 }, R = { x: W * 0.8, y: H * 0.58 }, J = { x: W / 2, y: H * 0.2 };
  for (let i = 0; i < 4; i++) {
    dot(ctx, L.x + (rand(i, 2) - 0.5) * 30, L.y + (rand(i, 5) - 0.5) * 34, 2.2, c.acc, 0.85);
    dot(ctx, R.x + (rand(i, 9) - 0.5) * 30, R.y + (rand(i, 11) - 0.5) * 34, 2.2, c.warn, 0.85);
  }
  const phase = (t % 4.2) / 4.2;
  if (phase < 0.35) pulse(ctx, L.x, L.y, R.x, R.y, phase / 0.35, c.acc);
  else if (phase < 0.7) pulse(ctx, R.x, R.y, L.x, L.y, (phase - 0.35) / 0.35, c.warn);
  else {
    // judge flash + verdict beam down
    const jp = (phase - 0.7) / 0.3;
    dot(ctx, J.x, J.y, 3.6 + Math.sin(jp * Math.PI) * 1.6, c.acc);
    pulse(ctx, J.x, J.y, W / 2, H * 0.62, jp, c.acc);
  }
  dot(ctx, J.x, J.y, 3.2, c.acc);
  // the scale: a tilting beam under the judge
  const tilt = Math.sin(t * 0.5) * 0.18;
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(J.x - 16 * Math.cos(tilt), J.y + 10 - 16 * Math.sin(tilt));
  ctx.lineTo(J.x + 16 * Math.cos(tilt), J.y + 10 + 16 * Math.sin(tilt));
  ctx.stroke();
}

function drawChamber(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) {
  // three phases: isolated takes → anonymized peer review → chair synthesis
  const N = 6;
  const nodes = Array.from({ length: N }, (_, i) => ({
    x: W * 0.18 + rand(i, 3) * W * 0.64,
    y: H * 0.4 + rand(i, 8) * H * 0.42,
  }));
  const chair = { x: W / 2, y: H * 0.16 };
  const phase = (t % 6) / 6;
  // the isolated phase is intentionally still — a slow breathe keeps it alive
  nodes.forEach((n, i) => dot(ctx, n.x, n.y, 2.2 + Math.sin(t * 2 + i * 1.3) * 0.5, c.acc, phase < 0.33 ? 0.95 : 0.7));
  if (phase >= 0.33 && phase < 0.66) {
    // dotted anonymous review edges
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = c.dim;
    ctx.globalAlpha = 0.55;
    for (let k = 0; k < 5; k++) {
      const a = nodes[Math.floor(rand(k, 21) * N)], b = nodes[Math.floor(rand(k, 33) * N)];
      if (a !== b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  } else if (phase >= 0.66) {
    const p = (phase - 0.66) / 0.34;
    nodes.forEach((n, i) => {
      const d = Math.min(1, Math.max(0, p * 1.6 - i * 0.1));
      if (d > 0) pulse(ctx, n.x, n.y, chair.x, chair.y, d, c.acc);
    });
  }
  dot(ctx, chair.x, chair.y, phase >= 0.66 ? 3.6 : 2.6, c.acc);
}

function drawJury(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) {
  // isolated lanes fire independent verdicts into the aggregator; a tally builds
  const N = 6, agg = { x: W * 0.82, y: H / 2 };
  const cycle = (t % 3.6) / 3.6;
  for (let i = 0; i < N; i++) {
    const y = H * 0.14 + (i / (N - 1)) * H * 0.72;
    dot(ctx, W * 0.14, y, 2.2, c.acc, 0.85);
    const d = Math.min(1, Math.max(0, cycle * 1.8 - i * 0.12));
    if (d > 0 && d < 1) pulse(ctx, W * 0.14, y, agg.x, agg.y, d, c.acc);
  }
  dot(ctx, agg.x, agg.y, 3.6, c.acc);
  // the tally: bars growing beside the aggregator
  const bars = [0.9, 0.6, 0.35];
  bars.forEach((b, i) => {
    const grow = Math.min(1, cycle * 1.5);
    ctx.fillStyle = i === 0 ? c.acc : c.dim;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(agg.x + 8, agg.y - 10 + i * 8, 14 * b * grow, 3);
    ctx.globalAlpha = 1;
  });
}

function drawDesk(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) {
  // director delegates down; drafts flow up; sections complete in order
  const dir = { x: W / 2, y: H * 0.18 };
  const workers = Array.from({ length: 4 }, (_, i) => ({ x: W * 0.16 + (i / 3) * W * 0.68, y: H * 0.72 }));
  const phase = (t % 4.8) / 4.8;
  dot(ctx, dir.x, dir.y, 3.4, c.acc);
  workers.forEach((w, i) => {
    const litAt = 0.5 + i * 0.12;
    dot(ctx, w.x, w.y, 2.4, phase > litAt ? c.acc : c.dim, phase > litAt ? 1 : 0.6);
    if (phase < 0.4) {
      const d = Math.min(1, Math.max(0, phase * 3.4 - i * 0.12));
      if (d > 0 && d < 1) pulse(ctx, dir.x, dir.y, w.x, w.y, d, c.acc);
    } else if (phase > litAt && phase < litAt + 0.12) {
      pulse(ctx, w.x, w.y, dir.x, dir.y, (phase - litAt) / 0.12, c.acc);
    }
  });
}

function drawExpedition(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) {
  // a route through phase waypoints; scouts fan out and return at each stop
  const stops = Array.from({ length: 5 }, (_, i) => ({
    x: W * 0.1 + (i / 4) * W * 0.8,
    y: H / 2 + Math.sin(i * 1.9) * H * 0.18,
  }));
  ctx.strokeStyle = c.line;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  stops.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  const seg = (t / 2.2) % 5;
  const i = Math.floor(seg), p = seg - i;
  stops.forEach((s, j) => dot(ctx, s.x, s.y, j <= i ? 2.6 : 1.8, j <= i ? c.acc : c.dim, j <= i ? 0.95 : 0.6));
  const a = stops[i], b = stops[Math.min(i + 1, 4)];
  const x = a.x + (b.x - a.x) * p, y = a.y + (b.y - a.y) * p;
  dot(ctx, x, y, 2.8, c.acc);
  // scouts fanning out around the traveller
  for (let k = 0; k < 3; k++) {
    const fan = Math.sin(p * Math.PI);
    dot(ctx, x + Math.cos(k * 2.1 + t) * 12 * fan, y + Math.sin(k * 2.1 + t) * 10 * fan, 1.3, c.acc, 0.65);
  }
}

const DRAW: Record<ModeKey, (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, c: Palette) => void> = {
  agora: drawAgora, roundtable: drawRoundtable, tribunal: drawTribunal,
  chamber: drawChamber, jury: drawJury, desk: drawDesk, expedition: drawExpedition,
};

export default function ModeDiagram({ mode, height = 120 }: { mode: ModeKey; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 240;
    const H = height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const palette: Palette = {
      acc: cssVar("--acc", "#37d98a"),
      warn: cssVar("--warn", "#d9a03f"),
      dim: cssVar("--t6", "#8b9096"),
      line: cssVar("--ln5", "rgba(255,255,255,.16)"),
    };
    const draw = DRAW[mode];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      ctx.clearRect(0, 0, W, H);
      draw(ctx, W, H, 2.0, palette);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      ctx.clearRect(0, 0, W, H);
      draw(ctx, W, H, (now - t0) / 1000, palette);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, height]);

  return <canvas ref={ref} style={{ width: "100%", height, display: "block" }} aria-hidden />;
}
