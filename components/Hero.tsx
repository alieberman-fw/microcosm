"use client";

import { useEffect, useRef, useState } from "react";

const heroLines: [string, string][] = [
  ["agent_0412 · first-move-up buyer", "The flex room reads as an office to me — I'd trade the formal dining for it without blinking."],
  ["agent_1187 · adjacent homeowner", "Three stories at that corner changes my morning light. I'll be at the hearing."],
  ["agent_0093 · institutional LP", "The absorption assumption is the whole underwrite. Show me the sensitivity at 14 months."],
  ["agent_0771 · renter, 29, relocating", "I'd pay $180 more for in-unit laundry before I'd pay anything for a rooftop lounge."],
];

export default function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState("");

  // resilient autoplay
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    const tryPlay = () => el.play().catch(() => {});
    tryPlay();
    const evs: (keyof WindowEventMap)[] = ["click", "scroll", "touchstart"];
    evs.forEach((ev) => window.addEventListener(ev, tryPlay, { once: true, passive: true }));
    return () => evs.forEach((ev) => window.removeEventListener(ev, tryPlay));
  }, []);

  // typing ticker
  useEffect(() => {
    let li = 0, ci = 0, t: ReturnType<typeof setTimeout>;
    const step = () => {
      const text = heroLines[li][1];
      if (ci <= text.length) {
        setTyped(text.slice(0, ci));
        setLine(li);
        ci++;
        t = setTimeout(step, 26);
      } else {
        t = setTimeout(() => { li = (li + 1) % heroLines.length; ci = 0; step(); }, 3200);
      }
    };
    step();
    return () => clearTimeout(t);
  }, []);

  // ambient agent-network canvas
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const fit = () => { cv.width = cv.offsetWidth * devicePixelRatio; cv.height = cv.offsetHeight * devicePixelRatio; };
    fit();
    window.addEventListener("resize", fit);
    const N = 55;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 2e-4, vy: (Math.random() - 0.5) * 2e-4,
      r: 1 + Math.random() * 1.6, p: Math.random() * Math.PI * 2,
    }));
    let raf = 0;
    const draw = (t: number) => {
      const w = cv.width, h = cv.height;
      const acc = getComputedStyle(document.documentElement).getPropertyValue("--acc-hero").trim() || "#37d98a";
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
      }
      ctx.lineWidth = devicePixelRatio * 0.5;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const a = pts[i], b = pts[j];
        const dx = (a.x - b.x) * w, dy = (a.y - b.y) * h, d = Math.hypot(dx, dy), max = w * 0.09;
        if (d < max) {
          ctx.strokeStyle = `rgba(255,255,255,${(1 - d / max) * 0.14})`;
          ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
        }
      }
      for (const p of pts) {
        const lit = Math.sin(t / 900 + p.p) > 0.92;
        ctx.fillStyle = lit ? acc : "rgba(255,255,255,.5)";
        ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r * devicePixelRatio * (lit ? 1.8 : 1), 0, 7); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); };
  }, []);

  return (
    <header id="top" style={{ position: "relative", minHeight: "100vh", display: "flex", alignItems: "flex-end", overflow: "hidden", background: "#0a0b0c" }}>
      <video
        ref={videoRef}
        src="/media/hero-bg.mp4"
        autoPlay muted loop playsInline preload="auto"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(.35) brightness(.52) contrast(1.05)" }}
      />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(10,11,12,.55) 0%,rgba(10,11,12,.25) 40%,rgba(10,11,12,.92) 88%,#0a0b0c 100%)" }} />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.85, pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 2, width: "100%", maxWidth: 1240, margin: "0 auto", padding: "140px 40px 90px" }}>
        <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, letterSpacing: ".14em", color: "var(--acc-hero)", textTransform: "uppercase", animation: "fadeUp .7s ease both" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc-hero)", animation: "pulseDot 2.2s infinite" }} />
          Agent-simulation platform for the built world
        </div>
        <h1 style={{ color: "#f2f3f4", margin: "22px 0 0", fontSize: "clamp(44px,6.2vw,88px)", lineHeight: 1.02, letterSpacing: "-.035em", fontWeight: 600, maxWidth: 900, animation: "fadeUp .7s .08s ease both" }}>
          Simulate the market<br />before you build for it.
        </h1>
        <p style={{ margin: "26px 0 0", maxWidth: 620, fontSize: 18, lineHeight: 1.6, color: "#c7cbcf", animation: "fadeUp .7s .16s ease both" }}>
          Microcosm convenes a panel of AI experts and a census-grounded crowd — buyers, renters, neighbors, lenders — around your hardest real-estate question. They read your documents, deliberate in the open, and hand you a decision-grade report before a single dollar of capital is committed.
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 38, flexWrap: "wrap", animation: "fadeUp .7s .24s ease both" }}>
          <a href="/login" className="btnAcc" style={{ padding: "14px 28px", fontSize: 15 }}>Get started</a>
          <a href="/demo.html" style={{ border: "1px solid rgba(255,255,255,.25)", color: "#ececec", fontWeight: 500, fontSize: 15, padding: "14px 28px", borderRadius: 100, backdropFilter: "blur(6px)" }}>
            Watch a live simulation
          </a>
        </div>
        <div className="mono" style={{ marginTop: 64, display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: "#9aa0a6", minHeight: 20, animation: "fadeUp .7s .32s ease both" }}>
          <span style={{ color: "var(--acc-hero)" }}>{heroLines[line][0]} ›</span>
          <span>{typed}</span>
          <span style={{ display: "inline-block", width: 7, height: 14, background: "var(--acc-hero)", animation: "blink 1s step-end infinite" }} />
        </div>
      </div>
    </header>
  );
}
