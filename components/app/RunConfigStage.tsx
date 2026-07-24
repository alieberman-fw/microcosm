"use client";

/**
 * Stage 4 — Run configuration (CLAUDE.md §4.1). Mode cards (the docs'
 * animated diagrams doubling as the picker, per §5), the run parameters with
 * plain-language help, mode-fit warnings, and the pre-launch cost estimate.
 * Everything persists to config.run; LAUNCH activates with the engine —
 * PREVIEW opens the run screen on the Site 47-A golden fixture today.
 */

import { CSSProperties, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ModeDiagram, { ModeKey } from "@/components/app/docs/ModeDiagram";
import { SIM_MODES } from "@/lib/casting";
import { RUN_DEFAULTS, RUN_RANGES, RunConfig, estimateRunCost, modeFitFlags } from "@/lib/run";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const MODE_HINTS: Record<string, string> = {
  Agora: "Open forum — the default; threads form organically",
  Roundtable: "Every lead speaks each round, in order",
  Tribunal: "Two sides argue; a judge rules each round",
  Chamber: "Independent takes → blind review → synthesis",
  Jury: "Independent scored verdicts, aggregated",
  Desk: "Director assigns memo sections to workers",
  Expedition: "Phased background research, not deliberation",
};

const HELP: Record<string, string> = {
  rounds: "Full passes over the question. 1–3 quick reads · 10–30 contested · cost scales linearly",
  max_posts: "Hard budget cap — the run stops gracefully and synthesizes what it has",
  duration_days: "The narrative clock (DAY 7 / 14) — pacing and report framing, not compute",
  speaker: "Agora only: who talks next — priority (relevance) is the natural default",
  convergence: "When to stop: stability (positions stop moving) is the honest default",
  temperature: "How loose agents think — exploratory finds tail risks, repeats less",
  tier: "Which models power the run — standard is the workhorse; frontier when the decision dwarfs the cost",
  verifier: "A fact-checker behind the deliberation — claims tested against your documents",
};

export default function RunConfigStage({
  simId,
  mode: initialMode,
  leads,
  expertSide,
  residentSide,
  crowd,
  initialRun,
}: {
  simId: string;
  mode: string | null;
  leads: number;
  expertSide: number;
  residentSide: number;
  crowd: number;
  initialRun?: Partial<RunConfig> | null;
}) {
  const [mode, setMode] = useState<string>(initialMode ?? "Agora");
  const [cfg, setCfg] = useState<RunConfig>({ ...RUN_DEFAULTS, ...(initialRun ?? {}) });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(false);

  const persist = (next: RunConfig, nextMode?: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await fetch(`/api/simulations/${simId}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: next, ...(nextMode ? { mode: nextMode } : {}) }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }, 500);
  };

  const set = <K extends keyof RunConfig>(k: K, v: RunConfig[K]) => {
    setCfg((prev) => {
      const next = { ...prev, [k]: v };
      persist(next);
      return next;
    });
  };

  const pickMode = (m: string) => {
    setMode(m);
    persist(cfg, m);
  };

  const est = useMemo(() => estimateRunCost({ leads, crowd, cfg }), [leads, crowd, cfg]);
  const flags = useMemo(() => modeFitFlags({ mode, leads, expertSide, residentSide, crowd }), [mode, leads, expertSide, residentSide, crowd]);

  const label: CSSProperties = { ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", width: 110, flex: "none", paddingTop: 6 };

  const Pill = ({ on, children, onClick, title }: { on: boolean; children: React.ReactNode; onClick: () => void; title?: string }) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        ...mono, fontSize: 9, letterSpacing: ".05em", padding: "5px 12px", borderRadius: 100, cursor: "pointer",
        background: on ? "var(--acc-dim)" : "transparent",
        border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`,
        color: on ? "var(--acc)" : "var(--t6)", transition: "all .15s",
      }}
    >
      {children}
    </button>
  );

  const NumInput = ({ k, min, max }: { k: "rounds" | "max_posts" | "duration_days"; min: number; max: number }) => (
    <input
      type="number" min={min} max={max}
      value={cfg[k]}
      onChange={(e) => set(k, Math.min(Math.max(parseInt(e.target.value, 10) || min, min), max))}
      onWheel={(e) => (e.target as HTMLInputElement).blur()}
      style={{ ...mono, width: 74, padding: "5px 8px", fontSize: 10.5, background: "var(--sf)", border: "1px solid var(--ln4)", borderRadius: 8, color: "var(--t1)", outline: "none" }}
    />
  );

  return (
    <div id="stage-run" className="card" style={{ padding: "26px 30px", marginTop: 20, scrollMarginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>
          CONFIGURE THE RUN
        </div>
        {saved && <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--acc)" }}>SAVED ✓</span>}
      </div>

      {/* mode picker — the §5 animated diagrams as cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 10, marginTop: 16 }}>
        {SIM_MODES.map((m) => {
          const on = mode === m;
          return (
            <button
              key={m}
              onClick={() => pickMode(m)}
              style={{
                textAlign: "left", border: `1px solid ${on ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 12,
                background: on ? "var(--acc-dim)" : "var(--sf)", cursor: "pointer", padding: "10px 12px 9px",
                transition: "all .15s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--acc)" : "var(--t2)", fontFamily: "var(--font-sans), sans-serif" }}>{m}</span>
                {on && <span style={{ ...mono, fontSize: 8, color: "var(--acc)" }}>SELECTED</span>}
              </div>
              <div style={{ borderRadius: 8, overflow: "hidden", background: "var(--sf2)", marginTop: 8 }}>
                <ModeDiagram mode={m.toLowerCase() as ModeKey} height={64} />
              </div>
              <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--t6)", marginTop: 7, fontFamily: "var(--font-sans), sans-serif" }}>
                {MODE_HINTS[m]}
              </div>
            </button>
          );
        })}
      </div>

      {/* fit flags */}
      {flags.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
          {flags.map((f, i) => (
            <div key={i} style={{ ...mono, fontSize: 9, letterSpacing: ".05em", lineHeight: 1.7, color: f.level === "warn" ? "var(--warn)" : "var(--t6)", border: `1px solid ${f.level === "warn" ? "var(--warn)" : "var(--ln3)"}`, background: f.level === "warn" ? "var(--warn-dim)" : "transparent", borderRadius: 10, padding: "8px 14px" }}>
              {f.text}
            </div>
          ))}
        </div>
      )}

      {/* parameters */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18, padding: "16px 18px", border: "1px solid var(--ln2)", borderRadius: 12, background: "var(--sf2)" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span style={label}>ROUNDS</span>
          <NumInput k="rounds" min={RUN_RANGES.rounds.min} max={RUN_RANGES.rounds.max} />
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t7)", alignSelf: "center" }}>{HELP.rounds}</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span style={label}>MAX POSTS</span>
          <NumInput k="max_posts" min={RUN_RANGES.max_posts.min} max={RUN_RANGES.max_posts.max} />
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t7)", alignSelf: "center" }}>{HELP.max_posts}</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span style={label}>SIM DAYS</span>
          <NumInput k="duration_days" min={RUN_RANGES.duration_days.min} max={RUN_RANGES.duration_days.max} />
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t7)", alignSelf: "center" }}>{HELP.duration_days}</span>
        </div>
        {mode === "Agora" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={label}>SPEAKER</span>
            {(["priority", "round-robin", "random", "mention-driven"] as const).map((v) => (
              <Pill key={v} on={cfg.speaker === v} onClick={() => set("speaker", v)} title={HELP.speaker}>{v.toUpperCase()}</Pill>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={label}>STOP WHEN</span>
          {(["stability", "fixed", "budget"] as const).map((v) => (
            <Pill key={v} on={cfg.convergence === v} onClick={() => set("convergence", v)} title={HELP.convergence}>
              {v === "stability" ? "POSITIONS STABILIZE" : v === "fixed" ? "ROUNDS EXHAUSTED" : "BUDGET SPENT"}
            </Pill>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={label}>TEMPERATURE</span>
          {(["conservative", "balanced", "exploratory"] as const).map((v) => (
            <Pill key={v} on={cfg.temperature === v} onClick={() => set("temperature", v)} title={HELP.temperature}>{v.toUpperCase()}</Pill>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={label}>MODEL TIER</span>
          {(["economy", "standard", "frontier"] as const).map((v) => (
            <Pill key={v} on={cfg.tier === v} onClick={() => set("tier", v)} title={HELP.tier}>{v.toUpperCase()}</Pill>
          ))}
          <span style={{ width: 1, height: 16, background: "var(--ln4)", margin: "0 4px" }} />
          <span style={label.width ? { ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)" } : undefined}>VERIFIER</span>
          <Pill on={cfg.verifier} onClick={() => set("verifier", !cfg.verifier)} title={HELP.verifier}>
            {cfg.verifier ? "ON — CLAIMS CHECKED VS DOCS" : "OFF"}
          </Pill>
        </div>
      </div>

      {/* footer: the estimate and the launch path, one card */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap", marginTop: 16, padding: "18px 22px", border: "1px solid var(--ln3)", borderRadius: 14, background: "var(--sf)" }}>
        <div>
          <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>ESTIMATED COST · SHOWN BEFORE YOU COMMIT</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 5 }}>
            <span style={{ ...mono, fontSize: 22, color: "var(--acc)" }}>
              ${est.low.toFixed(2)}–{est.high.toFixed(2)}
            </span>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)" }}>
              ~{est.posts.toLocaleString()} POSTS{est.polls > 0 ? ` · ${est.polls.toLocaleString()} POLLS` : ""} · {cfg.tier.toUpperCase()}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7 }}>
          <Link href={`/sim/${simId}/run`} style={{ textDecoration: "none" }}>
            <span
              className="runCta"
              style={{
                display: "inline-flex", alignItems: "center", gap: 10,
                background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 15,
                padding: "13px 30px", borderRadius: 100, fontFamily: "var(--font-sans), sans-serif", cursor: "pointer",
              }}
            >
              Proceed to launch
              <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>→</span>
            </span>
          </Link>
          <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>
            OPENS THE RUN SCREEN · PRESS ▶ LAUNCH WHEN READY · <Link href={`/sim/${simId}/run?replay=1`} style={{ color: "var(--t6)", textDecoration: "underline" }}>DEMO REPLAY</Link>
          </span>
        </div>
      </div>
    </div>
  );
}
