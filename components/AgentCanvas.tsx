"use client";

/** Ambient agent-network canvas — the hero's dot field, reusable. */

import { useEffect, useRef } from "react";

export default function AgentCanvas({ density = 55, style }: { density?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const fit = () => { cv.width = cv.offsetWidth * devicePixelRatio; cv.height = cv.offsetHeight * devicePixelRatio; };
    fit();
    window.addEventListener("resize", fit);
    const N = density;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 2e-4, vy: (Math.random() - 0.5) * 2e-4,
      r: 1 + Math.random() * 1.6, p: Math.random() * Math.PI * 2,
    }));
    let raf = 0;
    const draw = (t: number) => {
      const w = cv.width, h = cv.height;
      const acc = getComputedStyle(document.documentElement).getPropertyValue("--acc").trim() || "#37d98a";
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
      }
      ctx.lineWidth = devicePixelRatio * 0.5;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const a = pts[i], b = pts[j];
        const dx = (a.x - b.x) * w, dy = (a.y - b.y) * h, d = Math.hypot(dx, dy), max = w * 0.11;
        if (d < max) {
          ctx.strokeStyle = `rgba(128,140,148,${(1 - d / max) * 0.22})`;
          ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
        }
      }
      for (const p of pts) {
        const lit = Math.sin(t / 900 + p.p) > 0.92;
        ctx.fillStyle = lit ? acc : "rgba(128,140,148,.6)";
        ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r * devicePixelRatio * (lit ? 1.8 : 1), 0, 7); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); };
  }, [density]);

  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", ...style }} />;
}
