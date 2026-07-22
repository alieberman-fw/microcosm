"use client";

/**
 * The casting animation shown while the Casting Director runs (CLAUDE.md §5
 * node/pulse visual grammar). Agent dots drift in from the edges toward a
 * forming panel ring, pulsing accent lines to a central hub, while status
 * lines rotate through what the director is actually doing. Pure canvas in
 * design-system tokens; respects prefers-reduced-motion.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const STATUS_LINES = [
  "Reading the brief and diligence corpus…",
  "Mapping each question to a discipline…",
  "Drafting the seats this problem needs…",
  "Searching your library for matches…",
  "Scanning 1,800 built-world personas…",
  "Seeding an adversarial skeptic…",
  "Grounding backstories in the market…",
  "Calibrating the panel…",
];

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function CastingTheater({ label }: { label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [statusIdx, setStatusIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStatusIdx((i) => (i + 1) % STATUS_LINES.length), 1900);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth;
    const H = 220;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const cx = W / 2;
    const cy = H / 2;

    const acc = cssVar("--acc", "#37d98a");
    const line = cssVar("--ln5", "rgba(255,255,255,.16)");
    const t2 = cssVar("--t5", "#9aa0a6");

    // agents drift from a random edge point toward a slot on a forming ring
    const N = 14;
    const R = 74;
    const agents = Array.from({ length: N }, (_, i) => {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      const edge = Math.floor((i * 2654435761) % 4); // deterministic (no Math.random on first paint)
      const from =
        edge === 0 ? { x: (i * 53) % W, y: -10 } :
        edge === 1 ? { x: W + 10, y: (i * 71) % H } :
        edge === 2 ? { x: (i * 97) % W, y: H + 10 } :
        { x: -10, y: (i * 37) % H };
      return {
        from, tx: cx + Math.cos(angle) * R, ty: cy + Math.sin(angle) * R,
        delay: (i / N) * 1.1, adversarial: i === N - 1,
      };
    });

    let raf = 0;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const draw = (now: number) => {
      const elapsed = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);

      for (const a of agents) {
        const p = Math.max(0, Math.min(1, (elapsed - a.delay) / 1.3));
        const e = ease(p);
        const x = a.from.x + (a.tx - a.from.x) * e;
        const y = a.from.y + (a.ty - a.from.y) * e;

        // pulse line to hub once seated
        if (p > 0.55) {
          const pulse = (Math.sin(elapsed * 2.4 + a.tx) + 1) / 2;
          ctx.strokeStyle = line;
          ctx.globalAlpha = 0.25 + 0.35 * (p - 0.55) / 0.45;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(cx, cy);
          ctx.stroke();
          // travelling pulse dot
          ctx.globalAlpha = 0.7 * pulse;
          ctx.fillStyle = acc;
          ctx.beginPath();
          ctx.arc(x + (cx - x) * pulse, y + (cy - y) * pulse, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalAlpha = 0.3 + 0.7 * e;
        ctx.fillStyle = a.adversarial ? cssVar("--warn", "#d9a03f") : acc;
        ctx.beginPath();
        ctx.arc(x, y, a.adversarial ? 3.6 : 2.8, 0, Math.PI * 2);
        ctx.fill();
        if (p >= 1) {
          ctx.globalAlpha = 0.4 + 0.3 * Math.sin(elapsed * 3 + a.ty);
          ctx.strokeStyle = a.adversarial ? cssVar("--warn", "#d9a03f") : acc;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // hub
      ctx.globalAlpha = 1;
      ctx.fillStyle = acc;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(elapsed * 2);
      ctx.strokeStyle = acc;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 9 + 3 * Math.sin(elapsed * 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    if (reduced) draw(t0 + 2000); // one settled frame
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ marginTop: 18, border: "1px solid var(--ln3)", borderRadius: 14, background: "var(--sf)", padding: "8px 8px 20px", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: 220, display: "block" }} />
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.6s infinite" }} />
          {(label ?? "CASTING THE PANEL").toUpperCase()}
        </div>
        <div key={statusIdx} style={{ fontSize: 13, color: "var(--t5)", marginTop: 10, animation: "fadeUp .4s ease both" }}>
          {STATUS_LINES[statusIdx]}
        </div>
      </div>
    </div>
  );
}
