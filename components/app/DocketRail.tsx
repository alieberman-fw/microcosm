"use client";

// The DOCKET RAIL — the run's mission instruments, docked on the agent-network
// canvas. Collapsed: a 34px spine (one mini score bar per sub-ask + the
// aggregate) that costs the graph almost nothing. Expanded: a content-height
// panel where every question is a full-text row — score, §10 bar, and the
// tracker's "still missing" note inline — with the round's agenda as a card
// on top. Replaces the header's COVERAGE pill strip + AGENDA row (field
// report: pills truncated every question and hid meaning behind popovers).
// The rail is a pure overlay: the canvas keeps its full size and the feed
// never reflows. Open/closed is remembered per simulation; default closed.

import { useEffect, useRef, useState, type CSSProperties } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export type DocketEntry = { id: string; ask: string; score: number; missing: string; pending?: boolean };

/** the strip's color grammar, unchanged: settled → accent, working → neutral, weak → warn */
const scoreColor = (c: DocketEntry) =>
  c.pending ? "var(--t7)" : c.score >= 85 ? "var(--acc)" : c.score >= 50 ? "var(--t5)" : "var(--warn)";

export default function DocketRail({
  simId, coverage, agendas, round, maxRounds, running,
}: {
  simId: string;
  coverage: DocketEntry[];
  agendas: Record<number, { label: string; detail: string }>;
  round: number;
  maxRounds: number;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  // one-shot flash on a bar whose score just moved — a tick, never a loop
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  const prevScores = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    try { if (localStorage.getItem(`mc-docket:${simId}`) === "1") setOpen(true); } catch { /* private mode */ }
  }, [simId]);
  const toggle = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem(`mc-docket:${simId}`, v ? "1" : "0"); } catch { /* private mode */ }
  };

  useEffect(() => {
    const changed: string[] = [];
    for (const c of coverage) {
      if (c.pending) continue;
      const prev = prevScores.current.get(c.id);
      if (prev !== undefined && prev !== c.score) changed.push(c.id);
      prevScores.current.set(c.id, c.score);
    }
    if (!changed.length) return;
    setTicks(new Set(changed));
    const t = setTimeout(() => setTicks(new Set()), 950);
    return () => clearTimeout(t);
  }, [coverage]);

  if (!coverage.length) return null;

  const scored = coverage.filter((c) => !c.pending);
  const agg = scored.length ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length) : null;
  const agenda = running ? agendas[round] : undefined;

  const bar = (c: DocketEntry, width: number) => (
    <span style={{ width, height: 3, borderRadius: 100, background: "var(--ln2)", overflow: "hidden", flex: "none", display: "block" }}>
      {!c.pending && (
        <span style={{
          display: "block", width: `${c.score}%`, height: "100%", borderRadius: 100,
          background: c.score >= 85 ? "var(--acc)" : c.score >= 50 ? "var(--t5)" : "var(--warn)",
          transition: "width .6s ease",
          ...(ticks.has(c.id) ? { animation: "dockTick .9s ease-out" } : {}),
        }} />
      )}
    </span>
  );

  if (!open) {
    return (
      <button
        onClick={() => toggle(true)}
        aria-label="Open the docket — how resolved each question is"
        style={{
          position: "absolute", top: 40, left: 12, bottom: 12, width: 34, zIndex: 30, boxSizing: "border-box",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
          padding: "10px 0 8px", border: "1px solid var(--ln3)", borderRadius: 10,
          background: "var(--sf2)", cursor: "pointer",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--acc)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--ln3)"; }}
      >
        <span style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--acc)", writingMode: "vertical-rl" }}>
          DOCKET{agg !== null ? ` · ${agg}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {coverage.map((c) => (
          <span key={c.id} style={{ opacity: c.pending ? 0.5 : 1 }}>{bar(c, 16)}</span>
        ))}
        <span style={{ ...mono, fontSize: 9, color: "var(--t6)", marginTop: 2 }}>▸</span>
      </button>
    );
  }

  return (
    <div style={{
      position: "absolute", top: 40, left: 12, zIndex: 30, boxSizing: "border-box",
      width: "min(460px, calc(100% - 24px))", maxHeight: "calc(100% - 54px)", overflowY: "auto",
      border: "1px solid var(--ln4)", borderRadius: 12, background: "var(--sf)",
      boxShadow: "0 12px 36px rgba(0,0,0,.35)", padding: "12px 16px",
      animation: "fadeUp .2s ease both",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ ...mono, fontSize: 8, letterSpacing: ".1em", color: "var(--t6)", flex: "none" }}>
          DOCKET{round > 0 ? ` · R${round}/${Math.max(maxRounds, round)}` : ""}
        </span>
        <span style={{ ...mono, fontSize: 9.5, color: agg === null ? "var(--t7)" : agg >= 85 ? "var(--acc)" : "var(--t4)" }}>
          {agg === null ? "NOT YET SCORED" : `${agg}/100 RESOLVED`}
        </span>
        <button
          onClick={() => toggle(false)}
          aria-label="Collapse the docket"
          style={{ ...mono, marginLeft: "auto", fontSize: 10, color: "var(--t6)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
        >
          ◂
        </button>
      </div>
      <div style={{ ...mono, fontSize: 7.5, letterSpacing: ".06em", color: "var(--t7)", marginTop: 3 }}>
        HOW RESOLVED EACH QUESTION IS (0–100) — RE-SCORED EVERY ROUND, STEERING EACH ROUND&apos;S AGENDA
      </div>

      {agenda && (
        <div style={{ border: "1px solid var(--ln3)", borderLeft: "3px solid var(--acc)", borderRadius: 10, background: "var(--sf2)", padding: "9px 12px", margin: "10px 0 4px" }}>
          <button
            onClick={() => agenda.detail && setAgendaOpen((v) => !v)}
            style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, cursor: agenda.detail ? "pointer" : "default", textAlign: "left" }}
          >
            <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".1em", color: "var(--acc)" }}>R{round} AGENDA</span>
            <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.55, color: "var(--t3)", marginTop: 3, overflowWrap: "break-word" }}>
              {agenda.label}{agenda.detail ? (agendaOpen ? " ▴" : " ▾") : ""}
            </span>
          </button>
          {agendaOpen && agenda.detail && (
            <div style={{ marginTop: 7, fontSize: 11, lineHeight: 1.6, color: "var(--t4)", overflowWrap: "break-word" }}>
              {(() => {
                // "1) … 2) …" runs render as a real numbered list, prose as prose
                const parts = agenda.detail.split(/\s*\d+\)\s+/);
                if (parts.length < 3) return agenda.detail;
                return (
                  <>
                    {parts[0].trim() && <div style={{ marginBottom: 7 }}>{parts[0].trim()}</div>}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {parts.slice(1).map((item, i) => (
                        <div key={i} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                          <span style={{ ...mono, fontSize: 8.5, color: "var(--acc)", flex: "none", width: 13, textAlign: "right" }}>{i + 1}</span>
                          <span style={{ minWidth: 0 }}>{item.trim()}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: agenda ? 4 : 8 }}>
        {coverage.map((c, i) => (
          <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: i < coverage.length - 1 ? "1px solid var(--ln1)" : "none" }}>
            <span style={{ fontSize: 12, lineHeight: 1.5, color: c.pending ? "var(--t5)" : "var(--t2)", flex: 1, minWidth: 0, overflowWrap: "break-word" }}>
              {c.ask}
              {!c.pending && c.missing && c.score < 85 && (
                <span style={{ display: "block", fontSize: 10.5, lineHeight: 1.5, color: "var(--warn)", marginTop: 2 }}>Still missing: {c.missing}</span>
              )}
              {c.pending && (
                <span style={{ ...mono, display: "block", fontSize: 7.5, letterSpacing: ".05em", color: "var(--t7)", marginTop: 2 }}>SCORED AFTER ROUND 1</span>
              )}
            </span>
            {!c.pending && c.score >= 85 && (
              <span style={{ ...mono, fontSize: 7, letterSpacing: ".08em", color: "var(--acc)", flex: "none" }}>SETTLED</span>
            )}
            <span style={{ ...mono, fontSize: 10, width: 26, textAlign: "right", flex: "none", color: scoreColor(c) }}>
              {c.pending ? "—" : c.score}
            </span>
            <span style={{ alignSelf: "center" }}>{bar(c, 56)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
