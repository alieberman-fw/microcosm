"use client";

/**
 * The casting animation shown while the Casting Director runs (CLAUDE.md §5
 * node/pulse visual grammar) — a live particle swarm whose choreography
 * mirrors the director's actual phases and loops until the plan lands:
 *
 *   SCATTER  agents drift in from the edges           (reading the brief)
 *   SWEEP    murmuration around a moving attractor    (scanning the library)
 *   CLUSTER  the swarm splits into discipline orbits  (mapping questions)
 *   ASSEMBLE dissolves and reforms as the panel ring  (drafting the seats)
 *
 * Transitions are emergent — forces simply re-target, so each phase change
 * reads as the swarm breaking apart and reassembling. The swarm also parts
 * around the user's cursor. Pure canvas in design-system tokens; honors
 * prefers-reduced-motion with a single settled frame.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const INTRO_LEN = 1.8;             // scatter-in
const PHASE_LEN = 4.6;             // sweep / cluster / assemble each
const PHASES = ["SWEEP", "CLUSTER", "ASSEMBLE"] as const;

const STATUS_BY_PHASE: Record<string, string[]> = {
  SCATTER: ["Reading the brief and diligence corpus…"],
  SWEEP: ["Scanning 1,800 built-world personas…", "Searching your library for matches…"],
  CLUSTER: ["Mapping questions to disciplines…", "Weighing coverage against the brief…"],
  ASSEMBLE: ["Drafting the ideal seats…", "Seeding an adversarial skeptic…", "Calibrating the panel…"],
};

function phaseAt(elapsed: number): string {
  if (elapsed < INTRO_LEN) return "SCATTER";
  return PHASES[Math.floor((elapsed - INTRO_LEN) / PHASE_LEN) % PHASES.length];
}

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function CastingTheater({ label }: { label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<number>(0);
  const [phase, setPhase] = useState("SCATTER");
  const [statusIdx, setStatusIdx] = useState(0);

  // status text follows the choreography (same clock as the canvas)
  useEffect(() => {
    startRef.current = performance.now();
    const t = setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const p = phaseAt(elapsed);
      setPhase(p);
      setStatusIdx(Math.floor(elapsed / 2.3));
    }, 500);
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
    const H = 240;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(84, H * 0.36);

    const acc = cssVar("--acc", "#37d98a");
    const warn = cssVar("--warn", "#d9a03f");
    const line = cssVar("--ln5", "rgba(255,255,255,.16)");

    // deterministic pseudo-random (no Math.random — keeps SSR/replay sane)
    const rand = (i: number, salt: number) => {
      const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };

    const N = 26;
    const particles = Array.from({ length: N }, (_, i) => {
      const edge = i % 4;
      return {
        x: edge === 0 ? rand(i, 1) * W : edge === 1 ? W + 12 : edge === 2 ? rand(i, 2) * W : -12,
        y: edge === 0 ? -12 : edge === 1 ? rand(i, 3) * H : edge === 2 ? H + 12 : rand(i, 4) * H,
        vx: 0, vy: 0,
        adversarial: i === N - 1,
        cluster: i % 4,
        jitter: rand(i, 5) * Math.PI * 2,
      };
    });

    // 4 discipline-cluster anchors
    const clusterCenters = [
      { x: cx - W * 0.3, y: cy - H * 0.18 },
      { x: cx + W * 0.3, y: cy - H * 0.18 },
      { x: cx - W * 0.18, y: cy + H * 0.26 },
      { x: cx + W * 0.18, y: cy + H * 0.26 },
    ];

    const mouse = { x: -9999, y: -9999, active: false };
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    };
    const onLeave = () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    let raf = 0;
    const t0 = startRef.current || performance.now();

    const draw = (now: number) => {
      const elapsed = (now - t0) / 1000;
      const ph = phaseAt(elapsed);
      const phaseElapsed = ph === "SCATTER" ? elapsed : ((elapsed - INTRO_LEN) % PHASE_LEN);
      ctx.clearRect(0, 0, W, H);

      // moving murmuration attractor (lissajous sweep)
      const ax = cx + W * 0.3 * Math.sin(elapsed * 0.9);
      const ay = cy + H * 0.28 * Math.sin(elapsed * 1.35 + 1.2);

      for (let i = 0; i < N; i++) {
        const p = particles[i];

        if (ph === "SCATTER") {
          // loose gathering toward a breathing cloud at center
          p.vx += (cx + Math.sin(p.jitter + elapsed) * 40 - p.x) * 0.012;
          p.vy += (cy + Math.cos(p.jitter + elapsed * 1.2) * 26 - p.y) * 0.012;
          p.vx *= 0.94; p.vy *= 0.94;
        } else if (ph === "SWEEP") {
          // murmuration: chase the attractor, avoid crowding
          p.vx += (ax - p.x) * 0.0125;
          p.vy += (ay - p.y) * 0.0125;
          for (let j = 0; j < N; j++) {
            if (j === i) continue;
            const q = particles[j];
            const dx = p.x - q.x, dy = p.y - q.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 1 && d2 < 400) {
              p.vx += (dx / d2) * 4.2;
              p.vy += (dy / d2) * 4.2;
            }
          }
          p.vx *= 0.965; p.vy *= 0.965;
        } else if (ph === "CLUSTER") {
          // split into discipline orbits
          const c = clusterCenters[p.cluster];
          const dx = p.x - c.x, dy = p.y - c.y;
          const d = Math.max(Math.hypot(dx, dy), 0.001);
          p.vx += (c.x - p.x) * 0.02 + (-dy / d) * 0.42;
          p.vy += (c.y - p.y) * 0.02 + (dx / d) * 0.42;
          p.vx *= 0.93; p.vy *= 0.93;
        } else {
          // ASSEMBLE: reform as the panel ring
          const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
          p.vx += (cx + Math.cos(angle) * R - p.x) * 0.03;
          p.vy += (cy + Math.sin(angle) * R - p.y) * 0.03;
          p.vx *= 0.9; p.vy *= 0.9;
        }

        // the swarm parts around the cursor — strong enough to beat any
        // phase force, so the parting always reads
        if (mouse.active) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const d = Math.hypot(dx, dy);
          if (d < 95 && d > 0.1) {
            const f = ((95 - d) / 95) * 3.2;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }

        // speed clamp + integrate
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 3.4) { p.vx = (p.vx / sp) * 3.4; p.vy = (p.vy / sp) * 3.4; }
        p.x += p.vx;
        p.y += p.vy;

        const color = p.adversarial ? warn : acc;
        // velocity tail — the swarm look
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 3.2, p.y - p.vy * 3.2);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        ctx.globalAlpha = ph === "SCATTER" ? Math.min(1, elapsed / INTRO_LEN) : 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.adversarial ? 3.4 : 2.6, 0, Math.PI * 2);
        ctx.fill();

        // seated pulses to the hub near the end of ASSEMBLE
        if (ph === "ASSEMBLE" && phaseElapsed > 1.2) {
          const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
          const sx = cx + Math.cos(angle) * R, sy = cy + Math.sin(angle) * R;
          if (Math.hypot(p.x - sx, p.y - sy) < 7) {
            const pulse = (Math.sin(elapsed * 2.6 + i) + 1) / 2;
            ctx.globalAlpha = 0.22;
            ctx.strokeStyle = line;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(cx, cy);
            ctx.stroke();
            ctx.globalAlpha = 0.7 * pulse;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x + (cx - p.x) * pulse, p.y + (cy - p.y) * pulse, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // hub breathes in ASSEMBLE, rests otherwise
      const hubOn = ph === "ASSEMBLE" ? 1 : 0.35;
      ctx.globalAlpha = hubOn;
      ctx.fillStyle = acc;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (ph === "ASSEMBLE") {
        ctx.globalAlpha = 0.3 + 0.25 * Math.sin(elapsed * 2);
        ctx.strokeStyle = acc;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 9 + 3 * Math.sin(elapsed * 2), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    if (reduced) {
      // one settled frame: the assembled ring
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
        particles[i].x = cx + Math.cos(angle) * R;
        particles[i].y = cy + Math.sin(angle) * R;
      }
      draw(t0 + INTRO_LEN * 1000 + (2 * PHASE_LEN + 2) * 1000);
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = STATUS_BY_PHASE[phase] ?? STATUS_BY_PHASE.SCATTER;
  const statusLine = lines[statusIdx % lines.length];

  return (
    <div style={{ marginTop: 18, border: "1px solid var(--ln3)", borderRadius: 14, background: "var(--sf)", padding: "8px 8px 20px", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: 240, display: "block", cursor: "crosshair" }} />
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.6s infinite" }} />
          {(label ?? "CASTING THE PANEL").toUpperCase()}
          <span style={{ color: "var(--t6)" }}>· {phase}</span>
        </div>
        <div key={statusLine} style={{ fontSize: 13, color: "var(--t5)", marginTop: 10, animation: "fadeUp .4s ease both" }}>
          {statusLine}
        </div>
        <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", marginTop: 8 }}>
          THE SWARM PARTS AROUND YOUR CURSOR
        </div>
      </div>
    </div>
  );
}
