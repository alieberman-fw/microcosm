"use client";

import { CSSProperties, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const modes = [
  { t: "Agora", tag: "DEFAULT · OPEN FORUM", d: "The open square — the demo's mode. Everyone sees everything; threads form by discipline, replies chain, and positions shift in public. The most natural fit for big, multi-sided questions." },
  { t: "Roundtable", tag: "EVERY VOICE, EVERY ROUND", d: "Structured turns: each panelist speaks every cycle. Best for panels of equals — brainstorming product ideas, building consensus, making sure the quiet seat gets heard." },
  { t: "Tribunal", tag: "TWO SIDES · ONE JUDGE", d: "A contested question argued properly: advocates take sides, a judge weighs the rounds and rules. Built for the sharpest yes/no calls — and for rehearsing the fight you're about to have." },
  { t: "Chamber", tag: "INDEPENDENT · PEER-REVIEWED", d: "Panelists answer independently, review each other's work anonymously, and a chair synthesizes. The structure that kills groupthink — nobody anchors on the first loud voice." },
  { t: "Jury", tag: "PARALLEL VERDICTS · FAST", d: "Every panelist scores the question independently; verdicts aggregate into a fast, cheap first read. The screening pass before you commit to a full deliberation." },
  { t: "Desk", tag: "DIRECTOR + ANALYSTS · MEMO", d: "A research desk: a director assigns sections to specialist analysts and edits the result into one memo. The mode behind every Microcosm report synthesis." },
  { t: "Expedition", tag: "AUTONOMOUS DEEP RESEARCH", d: "Before the room convenes: an autonomous research pass decomposes your question, gathers evidence, tests alternatives, and verifies claims — the background pack the panel argues from." },
];

export default function Modes() {
  const [open, setOpen] = useState(0);
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 40px 110px" }}>
      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 60, alignItems: "start" }}>
        <div className="stickyCol">
          <div className="kicker">Interaction modes</div>
          <h2 style={{ margin: "16px 0 0", fontSize: "clamp(28px,3vw,40px)", fontWeight: 600, letterSpacing: "-.03em" }}>
            Seven ways<br />to run the room.
          </h2>
          <p style={{ margin: "18px 0 0", fontSize: 15, lineHeight: 1.65, color: "var(--t5)" }}>
            Microcosm recommends the right mode from your question — an open forum for a land decision, a tribunal for a contested call, a jury for a fast read. Every choice stays yours.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {modes.map((m, i) => (
            <div
              key={m.t}
              onClick={() => setOpen(i)}
              style={{
                border: `1px solid ${open === i ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 14,
                padding: "22px 28px", background: open === i ? "var(--acc-dim)" : "var(--sf)",
                cursor: "pointer", transition: "border-color .25s, background .25s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
                <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: "-.01em" }}>{m.t}</h3>
                <span style={{ ...mono, fontSize: 11, color: open === i ? "var(--acc)" : "var(--t7)" }}>{m.tag}</span>
              </div>
              {open === i && (
                <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t4)", maxWidth: 560 }}>{m.d}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
