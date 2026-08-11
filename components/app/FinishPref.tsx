"use client";

/**
 * Settings → Appearance — the finish picker. NORMAL is the shipped app,
 * untouched; PREMIUM stamps <html data-finish="premium"> and activates the
 * scoped skin in globals.css (card depth, machined numbers, tinted accents,
 * row washes, kicker dots, verdict seal, micro-details) across all four
 * themes. Each option renders a live mini-specimen — a card + button in that
 * finish — so the choice is made by eye. The premium tokens are defined per
 * theme whether or not the skin is on, which is what lets the PREMIUM
 * specimen preview accurately from inside normal mode.
 */

import { CSSProperties, useEffect, useState } from "react";
import { DEFAULT_FINISH, Finish, readFinish, writeFinish } from "@/lib/finish";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const OPTIONS: { finish: Finish; name: string; blurb: string }[] = [
  { finish: "normal", name: "NORMAL", blurb: "The shipped design — flat surfaces, hairline borders, quiet and exact." },
  { finish: "premium", name: "PREMIUM", blurb: "Depth, glow, and motion — cards catch light, numbers read machined, hovers lift." },
];

/** mini specimen: one stat card + one primary pill, drawn in the option's finish */
function Specimen({ premium }: { premium: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        aria-hidden
        style={{
          flex: "1 1 auto", minWidth: 0, borderRadius: 10, padding: "9px 12px",
          border: "1px solid var(--ln3)",
          ...(premium
            ? { borderColor: "var(--ln2)", borderTopColor: "var(--edge-top)", background: "var(--sheen), var(--sf)", boxShadow: "var(--shadow-card)" }
            : { background: "var(--sf)" }),
        }}
      >
        <span style={{ ...mono, display: "block", fontSize: 7.5, letterSpacing: ".1em", color: "var(--t6)" }}>REPORTS</span>
        <span style={{
          display: "block", fontSize: 19, color: "var(--t0)", marginTop: 2, lineHeight: 1,
          ...(premium ? { fontWeight: 560, letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" } : { fontWeight: 600 }),
        }}>
          1,207
        </span>
      </span>
      <span
        aria-hidden
        style={{
          flex: "none", borderRadius: 100, padding: "7px 14px", fontSize: 11, fontWeight: 600, color: "var(--acc-c)",
          ...(premium
            ? { background: "linear-gradient(180deg, color-mix(in srgb, var(--acc) 86%, white 14%), var(--acc))", boxShadow: "var(--shadow-btn)" }
            : { background: "var(--acc)" }),
        }}
      >
        Launch →
      </span>
    </span>
  );
}

export default function FinishPref() {
  const [finish, setFinish] = useState<Finish>(DEFAULT_FINISH);
  useEffect(() => { setFinish(readFinish()); }, []);

  const pick = (f: Finish) => {
    setFinish(f);
    writeFinish(f);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, maxWidth: 640 }}>
      {OPTIONS.map((o) => {
        const on = finish === o.finish;
        return (
          <button
            key={o.finish}
            onClick={() => pick(o.finish)}
            aria-pressed={on}
            style={{
              textAlign: "left", cursor: "pointer", borderRadius: 14, padding: "16px 18px",
              border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`,
              background: on ? "var(--acc-dim)" : "var(--sf2)",
              transition: "border-color .15s, background .15s",
            }}
          >
            <Specimen premium={o.finish === "premium"} />
            <span style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 }}>
              <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: on ? "var(--acc)" : "var(--t5)" }}>
                {o.name}{o.finish === DEFAULT_FINISH ? " · DEFAULT" : ""}
              </span>
            </span>
            <span style={{ display: "block", marginTop: 6, fontSize: 12.5, lineHeight: 1.55, color: "var(--t5)" }}>{o.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
