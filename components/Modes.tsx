"use client";

import { CSSProperties, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const modes = [
  { t: "Panel", tag: "SECONDS · WORKHORSE", d: "Fast reads and rankings: preference splits, willingness-to-pay, A-versus-B. The everyday instrument for floor plans, renderings, listing creative, and pricing ladders." },
  { t: "Forum", tag: "MINUTES · SOCIAL", d: "Agents post, reply, and influence each other on a simulated social layer — capturing word-of-mouth and momentum effects that one-shot AI answers structurally miss." },
  { t: "Adversarial debate", tag: "MINUTES · STRUCTURED", d: "Seeded opposition: neighbors vs. developer, bull vs. bear investor. Surfaces the strongest counterargument before a real opponent does." },
  { t: "Longitudinal market", tag: "HOURS · DEEP", d: "Populations live through simulated months under changing conditions — rate moves, new supply, climate shocks — for absorption curves and demand-shift scenarios." },
];

export default function Modes() {
  const [open, setOpen] = useState(0);
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "20px 40px 110px" }}>
      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 60, alignItems: "start" }}>
        <div className="stickyCol">
          <div className="kicker">Simulation modes</div>
          <h2 style={{ margin: "16px 0 0", fontSize: "clamp(28px,3vw,40px)", fontWeight: 600, letterSpacing: "-.03em" }}>
            One population.<br />Four ways to run it.
          </h2>
          <p style={{ margin: "18px 0 0", fontSize: 15, lineHeight: 1.65, color: "var(--t5)" }}>
            Pricing maps to compute intensity — a quick panel resolves in seconds; a longitudinal market lives for simulated months.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {modes.map((m, i) => (
            <div
              key={m.t}
              onClick={() => setOpen(i)}
              style={{
                border: `1px solid ${open === i ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 14,
                padding: "26px 28px", background: open === i ? "var(--acc-dim)" : "var(--sf)",
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
