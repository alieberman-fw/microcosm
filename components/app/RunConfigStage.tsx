"use client";

/**
 * Stage 4 — Run configuration (CLAUDE.md §4.1). Mode cards (the docs'
 * animated diagrams doubling as the picker, per §5), the run parameters with
 * plain-language help, mode-fit warnings, and the pre-launch cost estimate.
 * Everything persists to config.run; LAUNCH activates with the engine —
 * PREVIEW opens the run screen on the Site 47-A golden fixture today.
 */

import { CSSProperties, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ModeDiagram, { ModeKey } from "@/components/app/docs/ModeDiagram";
import { SIM_MODES } from "@/lib/casting";
import { RUN_DEFAULTS, RUN_RANGES, RunConfig, estimateRunCost, isFixedShape, modeFitFlags } from "@/lib/run";
import { TOOL_RACK, availableToolKeys, normalizeEnabledTools } from "@/lib/tools";

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
  density: "How busy each round gets — replies scale with the panel, crossfire and counter-volleys open up, crowd voices interject. Priced in the estimate below",
  speaker: "Agora only: who talks next — priority (relevance) is the natural default",
  convergence: "When to stop: stability (positions stop moving) is the honest default",
  temperature: "How loose agents think — exploratory finds tail risks, repeats less",
  tier: "Which models power the run — standard is the workhorse; frontier when the decision dwarfs the cost",
  verifier: "A fact-checker behind the deliberation — claims tested against your documents",
  report_length: "How deep the report goes — auto matches the transcript; dense writes the long-form memo",
};

export default function RunConfigStage({
  simId,
  mode: initialMode,
  recommendedMode = null,
  leads,
  expertSide,
  residentSide,
  crowd,
  initialRun,
  initialTools = null,
  crowdBusy = false,
}: {
  simId: string;
  mode: string | null;
  /** the Casting Director's pick — tags its card so the recommendation survives changes */
  recommendedMode?: string | null;
  leads: number;
  expertSide: number;
  residentSide: number;
  crowd: number;
  initialRun?: Partial<RunConfig> | null;
  /** 3d — the saved agent-tools allowlist (config.tools; empty = all off) */
  initialTools?: string[] | null;
  /** crowd generation in flight — launch waits so the run never starts on a half-crowd (field fix) */
  crowdBusy?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<string>(initialMode ?? "Agora");
  const [cfg, setCfg] = useState<RunConfig>({ ...RUN_DEFAULTS, ...(initialRun ?? {}) });
  const [tools, setTools] = useState<string[]>(normalizeEnabledTools(initialTools ?? []));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(false);
  const [launching, setLaunching] = useState(false);

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

  // 3d — tool toggles save immediately (discrete clicks, no debounce needed)
  const saveTools = (next: string[]) => {
    setTools(next);
    setSaved(false);
    void fetch(`/api/simulations/${simId}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tools: next }),
    }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1800); });
  };
  const toggleTool = (key: string) =>
    saveTools(tools.includes(key) ? tools.filter((k) => k !== key) : [...tools, key]);

  // proceed = FLUSH then navigate: the debounced save raced client-side nav,
  // so the run screen could render stale defaults (ROUND x / 3) — commit any
  // in-flight drafts, PATCH synchronously, and only then open the run screen
  const proceed = async () => {
    if (launching) return;
    setLaunching(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const final = { ...cfg };
    for (const k of ["rounds", "max_posts"] as const) {
      const raw = drafts[k];
      if (raw === undefined) continue;
      const r = RUN_RANGES[k];
      const v = parseInt(raw, 10);
      if (!isNaN(v)) final[k] = Math.min(Math.max(v, r.min), r.max);
    }
    try {
      await fetch(`/api/simulations/${simId}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: final, mode, tools }),
      });
    } catch { /* launch route re-reads config server-side either way */ }
    router.push(`/sim/${simId}/run`);
  };

  const est = useMemo(() => estimateRunCost({ leads, crowd, cfg, mode }), [leads, crowd, cfg, mode]);
  const flags = useMemo(() => modeFitFlags({ mode, leads, expertSide, residentSide, crowd }), [mode, leads, expertSide, residentSide, crowd]);
  const fixedShape = isFixedShape(mode);

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

  // NOTE: defined via useCallback-free stable render — draft commits on
  // blur/Enter so typing never fights the clamp, with −/+ steppers
  const stepFor = (k: string) => (k === "max_posts" ? 50 : 1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const commitNum = (k: "rounds" | "max_posts", min: number, max: number) => {
    const raw = drafts[k];
    if (raw === undefined) return;
    const v = Math.min(Math.max(parseInt(raw, 10) || min, min), max);
    setDrafts((d) => { const n = { ...d }; delete n[k]; return n; });
    if (v !== cfg[k]) set(k, v);
  };
  const numInput = (k: "rounds" | "max_posts", min: number, max: number) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 0, border: "1px solid var(--ln4)", borderRadius: 10, background: "var(--sf)", overflow: "hidden" }}>
      <button
        onClick={() => set(k, Math.max(min, cfg[k] - stepFor(k)))}
        aria-label={`decrease ${k}`}
        style={{ ...mono, fontSize: 12, width: 28, height: 30, border: "none", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
      >−</button>
      <input
        type="text" inputMode="numeric"
        value={drafts[k] ?? String(cfg[k])}
        onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value.replace(/[^0-9]/g, "") }))}
        onBlur={() => commitNum(k, min, max)}
        onKeyDown={(e) => { if (e.key === "Enter") commitNum(k, min, max); }}
        style={{ ...mono, width: 56, textAlign: "center", padding: "6px 0", fontSize: 11, background: "transparent", border: "none", borderLeft: "1px solid var(--ln3)", borderRight: "1px solid var(--ln3)", color: "var(--t1)", outline: "none" }}
      />
      <button
        onClick={() => set(k, Math.min(max, cfg[k] + stepFor(k)))}
        aria-label={`increase ${k}`}
        style={{ ...mono, fontSize: 12, width: 28, height: 30, border: "none", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
      >+</button>
    </span>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--acc)" : "var(--t2)", fontFamily: "var(--font-sans), sans-serif" }}>{m}</span>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                  {/* the director's pick is a single ✦ — hover for the story */}
                  {m === recommendedMode && (
                    <span
                      title="Director's pick — the Casting Director recommended this mode for your brief"
                      style={{ fontSize: 13, lineHeight: 1, color: "var(--acc)", cursor: "help" }}
                    >
                      ✦
                    </span>
                  )}
                  {on && <span style={{ ...mono, fontSize: 8, color: "var(--acc)" }}>SELECTED</span>}
                </span>
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

      {/* fit flags — warns carry a jump to the population stage to fix the cast */}
      {flags.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
          {flags.map((f, i) => (
            <div key={i} style={{ ...mono, fontSize: 9, letterSpacing: ".05em", lineHeight: 1.7, color: f.level === "warn" ? "var(--warn)" : "var(--t6)", border: `1px solid ${f.level === "warn" ? "var(--warn)" : "var(--ln3)"}`, background: f.level === "warn" ? "var(--warn-dim)" : "transparent", borderRadius: 10, padding: "8px 14px" }}>
              {f.text}
              {f.level === "warn" && (
                <button
                  onClick={() => document.getElementById("stage-population")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  style={{ ...mono, marginLeft: 10, fontSize: 8.5, letterSpacing: ".05em", background: "none", border: "none", color: "var(--warn)", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}
                >
                  FIX THE CAST — RE-CAST OR ADD SEATS ON THE POPULATION STAGE ↑
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 3d — AGENT TOOLS: the rack. All off by default; the user allowlists,
          the agents decide when an allowed tool is actually worth using. */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: 9, letterSpacing: ".1em", color: "var(--t6)" }}>
            AGENT TOOLS · OFF BY DEFAULT — AGENTS DECIDE WHEN TO USE THEM
          </span>
          <span style={{ display: "inline-flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: tools.length ? "var(--acc)" : "var(--t7)" }}>
              {tools.length} OF {availableToolKeys().length} AVAILABLE ENABLED
            </span>
            <button onClick={() => saveTools(availableToolKeys())} style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", background: "none", border: "none", color: "var(--acc)", cursor: "pointer", padding: 0 }}>ENABLE ALL</button>
            <button onClick={() => saveTools([])} style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0 }}>DISABLE ALL</button>
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10, marginTop: 12 }}>
          {TOOL_RACK.map((t) => {
            const soon = t.status === "coming_soon";
            const on = tools.includes(t.key);
            return (
              <button
                key={t.key}
                onClick={soon ? undefined : () => toggleTool(t.key)}
                disabled={soon}
                title={soon ? "Coming soon — new tools land as new cards" : on ? "Enabled — click to disable" : "Click to enable for this simulation"}
                style={{
                  textAlign: "left", borderRadius: 12, padding: "13px 15px", transition: "all .15s",
                  border: `1px solid ${on ? "var(--acc)" : "var(--ln3)"}`,
                  background: on ? "var(--acc-dim)" : "var(--sf)",
                  cursor: soon ? "default" : "pointer",
                  opacity: soon ? 0.5 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--acc)" : "var(--t2)", fontFamily: "var(--font-sans), sans-serif" }}>{t.name}</span>
                  {soon ? (
                    <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".07em", color: "var(--t6)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "2px 8px", flex: "none" }}>COMING SOON</span>
                  ) : (
                    <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".07em", flex: "none", borderRadius: 100, padding: "2px 8px", border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`, color: on ? "var(--acc)" : "var(--t6)" }}>
                      {on ? "ENABLED ✓" : "OFF"}
                    </span>
                  )}
                </div>
                <div style={{ ...mono, fontSize: 7.5, letterSpacing: ".08em", color: "var(--t7)", marginTop: 4 }}>{t.tagline}</div>
                <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--t5)", marginTop: 7, fontFamily: "var(--font-sans), sans-serif" }}>{t.description}</div>
                <div style={{ fontSize: 10, lineHeight: 1.45, color: "var(--t6)", marginTop: 6, fontStyle: "italic", fontFamily: "var(--font-sans), sans-serif" }}>e.g. {t.example}</div>
                <div style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", color: "var(--t7)", marginTop: 7 }}>{t.costNote.toUpperCase()}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* parameters */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18, padding: "16px 18px", border: "1px solid var(--ln2)", borderRadius: 12, background: "var(--sf2)" }}>
        {fixedShape ? (
          <div style={{ ...mono, fontSize: 9, letterSpacing: ".05em", lineHeight: 1.7, color: "var(--t6)" }}>
            {mode.toUpperCase()} RUNS A FIXED CHOREOGRAPHY — ITS PHASES EXECUTE ONCE, SO ROUNDS AND THE STOP RULE DON'T APPLY. MAX POSTS STILL CAPS SPEND.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={label}>ROUNDS</span>
            {numInput("rounds", RUN_RANGES.rounds.min, RUN_RANGES.rounds.max)}
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t7)", alignSelf: "center" }}>
              {mode === "Jury" ? "Deliberation layers: round 1 scores blind; later rounds see the tally and re-score" : HELP.rounds}
            </span>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span style={label}>MAX POSTS</span>
          {numInput("max_posts", RUN_RANGES.max_posts.min, RUN_RANGES.max_posts.max)}
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t7)", alignSelf: "center" }}>{HELP.max_posts}</span>
        </div>
        {mode !== "Desk" && mode !== "Expedition" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={label}>DENSITY</span>
            {(["focused", "lively", "bustling"] as const).map((v) => (
              <Pill key={v} on={cfg.density === v} onClick={() => set("density", v)} title={HELP.density}>{v.toUpperCase()}</Pill>
            ))}
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t7)", alignSelf: "center" }}>
              {cfg.density === "focused" ? "Tight rounds — votes at the round close only" : cfg.density === "lively" ? "Reply chains ~1.5× the panel · crowd interjections · votes land live" : "Full melee — ~2× replies, counter-volleys, six interjectors, live votes"}
            </span>
          </div>
        )}
        {mode === "Agora" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={label}>SPEAKER</span>
            {(["priority", "round-robin", "random", "mention-driven"] as const).map((v) => (
              <Pill key={v} on={cfg.speaker === v} onClick={() => set("speaker", v)} title={HELP.speaker}>{v.toUpperCase()}</Pill>
            ))}
          </div>
        )}
        {!fixedShape && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={label}>STOP WHEN</span>
            {(["stability", "fixed", "budget"] as const).map((v) => (
              <Pill key={v} on={cfg.convergence === v} onClick={() => set("convergence", v)} title={HELP.convergence}>
                {v === "stability" ? "POSITIONS STABILIZE" : v === "fixed" ? "ROUNDS EXHAUSTED" : "BUDGET SPENT"}
              </Pill>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={label}>TEMPERATURE</span>
          {(["conservative", "balanced", "exploratory"] as const).map((v) => (
            <Pill key={v} on={cfg.temperature === v} onClick={() => set("temperature", v)} title={HELP.temperature}>{v.toUpperCase()}</Pill>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={label}>REPORT LENGTH</span>
          {(["auto", "brief", "standard", "dense"] as const).map((v) => (
            <Pill key={v} on={cfg.report_length === v} onClick={() => set("report_length", v)} title={HELP.report_length}>
              {v === "auto" ? "✦ AUTO" : v.toUpperCase()}
            </Pill>
          ))}
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".04em", color: "var(--t7)", alignSelf: "center" }}>{HELP.report_length}</span>
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
              ~{est.posts.toLocaleString()} POSTS{est.polls > 0 ? ` · ${est.polls.toLocaleString()} POLLS` : ""}{est.votes > 0 ? ` · VOTES` : ""} · {cfg.density.toUpperCase()} · {cfg.tier.toUpperCase()}
            </span>
          </div>
          {tools.includes("web_search") && (
            // usage-based annotation, not part of the fixed estimate: assumes
            // ~1 search per 4 lead posts at ~1¢/search + result tokens
            <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", marginTop: 5 }}>
              + WEB RESEARCH · USAGE-BASED ≈ ${(Math.ceil(est.posts / 4) * 0.01).toFixed(2)}–{(Math.ceil(est.posts / 4) * 0.04).toFixed(2)} — AGENTS SEARCH ONLY WHEN IT CHANGES THEIR ANSWER
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7 }}>
          <button
            onClick={() => void proceed()}
            disabled={launching || crowdBusy}
            className="runCta"
            style={{
              display: "inline-flex", alignItems: "center", gap: 10, border: "none",
              background: crowdBusy ? "var(--sf2)" : "var(--acc)", color: crowdBusy ? "var(--t5)" : "var(--acc-c)", fontWeight: 600, fontSize: 15,
              padding: "13px 30px", borderRadius: 100, fontFamily: "var(--font-sans), sans-serif",
              cursor: launching || crowdBusy ? "default" : "pointer", opacity: launching ? 0.75 : 1,
              ...(crowdBusy ? { border: "1px solid var(--ln4)" } : {}),
            }}
          >
            {crowdBusy ? "Waiting for the crowd to generate…" : launching ? "Saving settings…" : "Proceed to launch"}
            {!crowdBusy && <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>→</span>}
          </button>
          <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>
            SAVES THESE SETTINGS · OPENS THE RUN SCREEN
          </span>
        </div>
      </div>
    </div>
  );
}
