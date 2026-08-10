"use client";

/**
 * Settings → Appearance — the loading-orb ink picker. Two live option
 * cards (each animating real orbs in its own ink) so the choice is made
 * by eye, not by label: ACCENT (default) tints the orbs with the theme's
 * accent; MONO is the library's shipped grayscale. Persists per device
 * ("mc-orb-ink"), broadcasts so every mounted orb re-inks instantly.
 */

import { CSSProperties, useEffect, useState } from "react";
import Orb from "@/components/app/Orb";
import { DEFAULT_ORB_INK, OrbInk, readOrbInk, writeOrbInk } from "@/lib/orb-ink";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const OPTIONS: { ink: OrbInk; name: string; blurb: string }[] = [
  { ink: "accent", name: "ACCENT", blurb: "Orbs wear the theme's green — cognition reads as the system being alive." },
  { ink: "mono", name: "MONO", blurb: "The library's shipped ink — quiet grayscale, light or dark to match the theme." },
];

export default function OrbInkPref() {
  const [ink, setInk] = useState<OrbInk>(DEFAULT_ORB_INK);
  useEffect(() => { setInk(readOrbInk()); }, []);

  const pick = (i: OrbInk) => {
    setInk(i);
    writeOrbInk(i);
  };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--t6)" }}>LOADING ORBS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginTop: 12, maxWidth: 640 }}>
        {OPTIONS.map((o) => {
          const on = ink === o.ink;
          return (
            <button
              key={o.ink}
              onClick={() => pick(o.ink)}
              aria-pressed={on}
              style={{
                textAlign: "left", cursor: "pointer", borderRadius: 14, padding: "16px 18px",
                border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`,
                background: on ? "var(--acc-dim)" : "var(--sf2)",
                transition: "border-color .15s, background .15s",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Orb state="composing" size={20} ink={o.ink} aria-label={`${o.name} composing preview`} />
                <Orb state="solving" size={20} ink={o.ink} aria-label={`${o.name} solving preview`} />
                <Orb state="searching" size={20} ink={o.ink} aria-label={`${o.name} searching preview`} />
                <span style={{ ...mono, marginLeft: "auto", fontSize: 9.5, letterSpacing: ".08em", color: on ? "var(--acc)" : "var(--t5)" }}>
                  {o.name}{o.ink === DEFAULT_ORB_INK ? " · DEFAULT" : ""}
                </span>
              </span>
              <span style={{ display: "block", marginTop: 10, fontSize: 12.5, lineHeight: 1.55, color: "var(--t5)" }}>{o.blurb}</span>
            </button>
          );
        })}
      </div>
      {/* the picked ink, at both scales, right where it was chosen */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 16 }}>
        <Orb state="connecting" size={64} aria-label="connecting preview" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
            <Orb state="composing" size={20} /> MARCUS IS TYPING…
          </span>
          <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>
            <Orb state="searching" size={20} /> SEARCHING THE LIBRARY…
          </span>
        </div>
      </div>
    </div>
  );
}
