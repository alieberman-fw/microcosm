"use client";

/**
 * The live simulation view: agent network canvas + threaded forum feed.
 * Ported from public/demo.html Stage 3 (the visual spec, CLAUDE.md §10) and
 * driven by any RunStream — replay fixture today, Supabase Realtime later.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { PostEvent, RunStream } from "@/lib/events";
import { AGENTS, SITE47A } from "@/lib/fixtures/site47a";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

type Node = { x: number; y: number; lead?: boolean; label?: string; p?: number };

export default function RunScreen({ stream }: { stream: RunStream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [posts, setPosts] = useState<PostEvent[]>([]);
  const [vtState, setVtState] = useState({ progress: 0, simDay: 1, postCount: 0 });
  const [typing, setTyping] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [speedLabel, setSpeedLabel] = useState("SPEED 1×");
  const [pausedLabel, setPausedLabel] = useState(false);

  // graph internals live outside React state
  const g = useRef<{
    nodes: { experts: Node[]; residents: Node[] } | null;
    leads: Record<string, Node>;
    pulses: { a: Node; b: Node; t0: number; dur: number; strong: boolean }[];
    trail: [Node, Node][];
    speaker: Node | null;
    speakerUntil: number;
  }>({ nodes: null, leads: {}, pulses: [], trail: [], speaker: null, speakerUntil: 0 });

  /* ---------- layout + draw (ported from demo.html) ---------- */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const dpr = devicePixelRatio || 1;

    const layout = () => {
      const w = el.width, h = el.height, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;
      const experts: Node[] = [];
      const leads: Record<string, Node> = {};
      const members: Record<string, Node[]> = {};
      SITE47A.leads.forEach((k, i) => {
        const ang = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const gx = cx + Math.cos(ang) * R, gy = cy + Math.sin(ang) * R;
        const a = AGENTS[k];
        const lead: Node = { x: gx, y: gy, lead: true, label: a.name.split(" ")[0].toUpperCase() + " · " + (a.tag ?? "").split(" ")[0] };
        leads[k] = lead; experts.push(lead); members[k] = [];
        for (let j = 0; j < 5; j++) {
          const a2 = (j / 5) * Math.PI * 2 + i, r2 = (0.055 + (j % 3) * 0.02) * Math.min(w, h);
          const nd: Node = { x: gx + Math.cos(a2) * r2, y: gy + Math.sin(a2) * r2 };
          experts.push(nd); members[k].push(nd);
        }
      });
      Object.values(AGENTS).forEach((a) => {
        if (a.cluster && members[a.cluster]) { const nd = members[a.cluster][0]; nd.label = a.label; leads[a.key] = nd; }
      });
      const residents: Node[] = [];
      for (let i = 0; i < 110; i++) {
        const ang = (i / 110) * Math.PI * 2, r = Math.min(w, h) * (0.44 + ((i * 7) % 10) * 0.004);
        residents.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, p: (i * 13) % 7 });
      }
      Object.values(AGENTS).forEach((a) => {
        if (a.res != null) { residents[a.res].label = a.label; leads[a.key] = residents[a.res]; }
      });
      g.current.nodes = { experts, residents };
      g.current.leads = leads;
    };

    const fit = () => { el.width = el.offsetWidth * dpr; el.height = el.offsetHeight * dpr; layout(); };
    fit();
    window.addEventListener("resize", fit);

    let raf = 0;
    const draw = () => {
      const ctx = el.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(draw); return; }
      const w = el.width, h = el.height, now = performance.now();
      const css = getComputedStyle(document.documentElement);
      const acc = css.getPropertyValue("--acc").trim(), dim = css.getPropertyValue("--t7").trim(), mid = css.getPropertyValue("--t5").trim();
      ctx.clearRect(0, 0, w, h);
      const N = g.current.nodes;
      if (!N) { raf = requestAnimationFrame(draw); return; }
      ctx.lineWidth = dpr * 0.6; ctx.strokeStyle = mid;
      for (const [a, b] of g.current.trail) { ctx.globalAlpha = 0.07; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      for (const p of g.current.pulses) {
        const k = (now - p.t0) / p.dur; if (k < 0 || k > 1) continue;
        ctx.globalAlpha = (p.strong ? 0.8 : 0.35) * (1 - k * 0.6); ctx.strokeStyle = acc; ctx.lineWidth = dpr * (p.strong ? 1.5 : 0.7);
        ctx.beginPath(); ctx.moveTo(p.a.x, p.a.y); ctx.lineTo(p.b.x, p.b.y); ctx.stroke();
        const mx = p.a.x + (p.b.x - p.a.x) * (k % 1), my = p.a.y + (p.b.y - p.a.y) * (k % 1);
        ctx.globalAlpha = 0.9 * (1 - k * 0.5); ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(mx, my, dpr * (p.strong ? 2.4 : 1.6), 0, 7); ctx.fill();
      }
      for (const r of N.residents) {
        const speaking = r === g.current.speaker && now < g.current.speakerUntil;
        ctx.globalAlpha = speaking ? 1 : 0.26 + 0.13 * Math.sin(now / 1400 + (r.p ?? 0));
        ctx.fillStyle = speaking ? acc : dim;
        ctx.beginPath(); ctx.arc(r.x, r.y, dpr * (speaking ? 3.4 : 1.1), 0, 7); ctx.fill();
        if (speaking && r.label) { ctx.globalAlpha = 1; ctx.fillStyle = acc; ctx.font = `${10 * dpr}px var(--font-mono), monospace`; ctx.textAlign = "center"; ctx.fillText(r.label, r.x, r.y - dpr * 9); }
      }
      for (const e of N.experts) {
        const speaking = e === g.current.speaker && now < g.current.speakerUntil;
        ctx.globalAlpha = 1; ctx.fillStyle = speaking ? acc : e.lead ? mid : dim;
        const r = dpr * (e.lead ? 3.4 : 2) * (speaking ? 1.5 + 0.25 * Math.sin(now / 130) : 1);
        ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, 7); ctx.fill();
        if (speaking) { ctx.globalAlpha = 0.25; ctx.strokeStyle = acc; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(e.x, e.y, r + dpr * 6 + dpr * 2 * Math.sin(now / 200), 0, 7); ctx.stroke(); }
        if (e.label && (e.lead || speaking)) {
          ctx.globalAlpha = speaking ? 1 : 0.55; ctx.fillStyle = speaking ? acc : mid;
          ctx.font = `${10 * dpr}px var(--font-mono), monospace`; ctx.textAlign = "center";
          ctx.fillText(e.label, e.x, e.y - dpr * 10);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); };
  }, []);

  /* ---------- pulse on events ---------- */
  const pulse = (ev: PostEvent) => {
    const G = g.current;
    if (!G.nodes) return;
    const now = performance.now();
    G.pulses = G.pulses.filter((p) => now - p.t0 < 6000);
    if (ev.tag === "BURST") {
      const e = G.nodes.experts, r = G.nodes.residents;
      for (let i = 0; i < 7; i++) {
        const a = e[Math.floor(Math.random() * e.length)];
        const b = Math.random() < 0.3 ? r[Math.floor(Math.random() * r.length)] : e[Math.floor(Math.random() * e.length)];
        if (a !== b) { G.pulses.push({ a, b, t0: now + i * 140, dur: 1600, strong: false }); G.trail.push([a, b]); }
      }
      G.trail = G.trail.slice(-30);
      return;
    }
    const a = ev.agent_id ? G.leads[ev.agent_id] : null;
    if (!a) return;
    const to = ev.mentions[0] ? G.leads[ev.mentions[0]] : null;
    const targets = to ? [to] : G.nodes.experts.filter((n) => n.lead && n !== a);
    targets.forEach((t, i) => G.pulses.push({ a, b: t, t0: now + i * 90, dur: to ? 4200 : 2400, strong: !!to }));
    if (to) G.trail.push([a, to]);
    G.trail = G.trail.slice(-30);
    G.speaker = a;
    G.speakerUntil = now + 4200;
  };

  /* ---------- consume the stream ---------- */
  useEffect(() => {
    const unsub = stream.subscribe((u) => {
      if (u.event && u.event.type === "post") {
        const ev = u.event;
        setPosts((p) => [...p, ev]);
        pulse(ev);
        requestAnimationFrame(() => { const f = feedRef.current; if (f) f.scrollTop = f.scrollHeight; });
      }
      setVtState({ progress: u.progress, simDay: u.simDay, postCount: u.postCount });
      setTyping(u.typingAgent);
      setDone(u.done);
    });
    stream.play();
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ ...mono, display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, color: "var(--t6)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--acc)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: done ? undefined : "pulseDot 1.6s infinite" }} />
            {done ? "CONVERGED" : "SIMULATING"}
          </span>
          <span>SITE 47-A · SIGNAL BUTTE &amp; PECOS · GO/NO-GO</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => { stream.pause(); setPausedLabel(stream.paused); }} className="btnGhost" style={{ ...mono, fontSize: 11, padding: "8px 16px" }}>
            {pausedLabel ? "RESUME ▶" : "PAUSE ⏸"}
          </button>
          <button onClick={() => setSpeedLabel(`SPEED ${stream.toggleSpeed()}×`)} className="btnGhost" style={{ ...mono, fontSize: 11, padding: "8px 16px" }}>
            {speedLabel}
          </button>
          <button onClick={() => stream.skipToEnd()} className="btnGhost" style={{ ...mono, fontSize: 11, padding: "8px 16px" }}>
            SKIP TO END ⇥
          </button>
        </div>
      </div>

      <div style={{ height: 3, borderRadius: 100, background: "var(--sf2)", marginTop: 16 }}>
        <div style={{ width: `${(vtState.progress * 100).toFixed(1)}%`, height: 3, borderRadius: 100, background: "var(--acc)", transition: "width .3s linear" }} />
      </div>

      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 20, marginTop: 20, alignItems: "stretch" }}>
        {/* canvas panel */}
        <div className="card" style={{ borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", height: 640, boxSizing: "border-box" }}>
          <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)" }}>
            <span>AGENT NETWORK · LIVE</span><span>DAY {vtState.simDay} / {SITE47A.simDays}</span>
          </div>
          <canvas ref={canvasRef} style={{ flex: 1, width: "100%", minHeight: 0, marginTop: 12 }} />
          <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--t6)", paddingTop: 12, borderTop: "1px solid var(--ln2)", marginTop: 12 }}>
            <span>{SITE47A.expertCount} EXPERTS · {SITE47A.disciplineCount} DISCIPLINES</span>
            <span>{SITE47A.residentCount} RESIDENTS</span>
            <span style={{ color: "var(--acc)" }}>{vtState.postCount} POSTS</span>
          </div>
        </div>

        {/* feed panel */}
        <div className="card" style={{ borderRadius: 16, display: "flex", flexDirection: "column", height: 640, boxSizing: "border-box", overflow: "hidden", padding: 0 }}>
          <div style={{ ...mono, padding: "16px 22px", borderBottom: "1px solid var(--ln2)", fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)", flex: "none", display: "flex", justifyContent: "space-between" }}>
            <span>THREAD 47-A · MAIN CHANNEL</span><span>PARALLEL THREADS ROLL UP BELOW</span>
          </div>
          <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            {posts.map((f, i) =>
              f.tag === "BURST" ? (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "1px 0", animation: "fadeUp .35s ease both" }}>
                  <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                  <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t7)", textAlign: "center" }}>{f.content}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                </div>
              ) : (
                <div
                  key={i}
                  style={{
                    marginLeft: f.tag === "REPLY" ? 36 : 0,
                    border: `1px solid ${f.tag === "FLIP" ? "var(--warn)" : f.tag === "REPLY" ? "var(--ln2)" : "var(--ln4)"}`,
                    borderRadius: 12, padding: "13px 16px",
                    background: f.tag === "REPLY" ? "transparent" : "var(--sf2)",
                    animation: "fadeUp .4s ease both",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ ...mono, flex: "none", width: 26, height: 26, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, color: "var(--t3)" }}>
                      {f.agent_initials}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--t5)" }}>
                      <span style={{ fontWeight: 600, color: "var(--t1)" }}>{f.agent_name}</span> · {f.agent_role} ·{" "}
                      <span style={{ ...mono, fontSize: 10, color: f.tag === "FLIP" ? "var(--warn)" : f.tag === "REPLY" ? "var(--t7)" : "var(--acc)" }}>
                        {f.tag === "FLIP" ? "CHANGED POSITION" : f.tag === "REPLY" ? "REPLY" : `POST ${f.post_number}`}
                      </span>
                    </div>
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.58, color: "var(--t2)" }}>{f.content}</p>
                </div>
              )
            )}
            {typing && !done && (
              <div style={{ ...mono, fontSize: 11, color: "var(--t7)", paddingLeft: 36 }}>
                {typing} is writing<span style={{ animation: "blink 1s step-end infinite" }}>…</span>
              </div>
            )}
            {done && (
              <div style={{ borderTop: "1px solid var(--ln2)", paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", animation: "fadeUp .5s ease both" }}>
                <span style={{ ...mono, fontSize: 11, color: "var(--t6)" }}>
                  CONVERGED · {SITE47A.totalPosts} POSTS · {SITE47A.dissents} DISSENTS ON RECORD
                </span>
                <span className="btnGhost" style={{ ...mono, fontSize: 11, padding: "10px 20px", opacity: 0.6, cursor: "default" }}>
                  SYNTHESIZE REPORT · LANDS WITH THE ENGINE (STEP 5)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
