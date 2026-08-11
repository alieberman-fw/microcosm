"use client";

/**
 * SIMULATION MODE — its own stage (Adam's flow, field report on #115):
 * brief → WHAT I UNDERSTOOD → **choose the deliberation** → population →
 * run config. The animated mode cards live HERE now (the run-config
 * duplicate picker is gone): ✦ AUTO lets the Casting Director recommend
 * (its pick lands tagged on the card), any explicit card is a casting
 * constraint. Changing the mode after a cast exists raises the RE-CAST
 * chip on the population stage — this component only owns the choice.
 */

import { CSSProperties } from "react";
import ModeDiagram, { ModeKey } from "@/components/app/docs/ModeDiagram";
import { SIM_MODES } from "@/lib/casting";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const MODE_HINTS: Record<string, string> = {
  Agora: "Open forum — the default; threads form organically",
  Roundtable: "Every lead speaks each round, in order",
  Tribunal: "Two sides argue; a judge rules each round",
  Chamber: "Independent takes → blind review → synthesis",
  Jury: "Independent scored verdicts, aggregated",
  Desk: "Director assigns memo sections to workers",
  Expedition: "Phased background research, not deliberation",
};

export default function ModeStage({
  selected,
  recommended,
  onSelect,
}: {
  /** null = ✦ AUTO — the director decides at cast time */
  selected: string | null;
  /** the director's pick from the last cast (tags its card) */
  recommended: string | null;
  onSelect: (mode: string | null) => void;
}) {
  const card = (on: boolean): CSSProperties => ({
    textAlign: "left", cursor: "pointer", borderRadius: 14, padding: "14px 14px 12px",
    border: `1px solid ${on ? "var(--acc)" : "var(--ln3)"}`,
    background: on ? "var(--acc-dim)" : "var(--sf)",
    transition: "border-color .15s, background .15s",
  });
  return (
    <div id="stage-mode" style={{ marginTop: 26 }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" }}>
        SIMULATION MODE <span style={{ color: "var(--t7)" }}>— HOW THE PANEL DELIBERATES · THE CAST IS DESIGNED FOR IT</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 12 }}>
        <button onClick={() => onSelect(null)} style={card(selected === null)} aria-pressed={selected === null}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: selected === null ? "var(--acc)" : "var(--t1)" }}>✦ Auto</span>
            {selected === null && <span style={{ ...mono, fontSize: 8, color: "var(--acc)" }}>SELECTED</span>}
          </div>
          <div style={{ borderRadius: 8, background: "var(--sf2)", marginTop: 8, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
              {recommended ? `✦ DIRECTOR'S PICK: ${recommended.toUpperCase()}` : "THE DIRECTOR DECIDES"}
            </span>
          </div>
          <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--t6)", marginTop: 7 }}>
            The Casting Director reads your brief and documents, recommends the choreography, and shows its reasoning.
          </div>
        </button>
        {SIM_MODES.map((m) => {
          const on = selected === m;
          return (
            <button key={m} onClick={() => onSelect(m)} style={card(on)} aria-pressed={on}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: on ? "var(--acc)" : "var(--t1)" }}>{m}</span>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                  {m === recommended && (
                    <span title="Director's pick — the Casting Director recommended this mode for your brief" style={{ fontSize: 13, lineHeight: 1, color: "var(--acc)", cursor: "help" }}>✦</span>
                  )}
                  {on && <span style={{ ...mono, fontSize: 8, color: "var(--acc)" }}>SELECTED</span>}
                </span>
              </div>
              <div style={{ borderRadius: 8, overflow: "hidden", background: "var(--sf2)", marginTop: 8 }}>
                <ModeDiagram mode={m.toLowerCase() as ModeKey} height={64} />
              </div>
              <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--t6)", marginTop: 7 }}>{MODE_HINTS[m]}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
