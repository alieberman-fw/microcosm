"use client";

/**
 * /sim/new view switch (6-PR2): CLASSIC (the staged brief composer — the
 * default) vs QUICK RUN (the one-box view straight into a live run). The
 * choice persists per user; the toggle lives in each view's header so
 * switching is always one click.
 */

import { CSSProperties, useEffect, useState } from "react";
import BriefComposer from "@/components/app/BriefComposer";
import QuickRun from "@/components/app/QuickRun";

const PREF_KEY = "mc-composer-view";
const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export default function NewSimClient() {
  const [view, setView] = useState<"classic" | "quick" | null>(null); // null until the pref loads — no flash

  useEffect(() => {
    try {
      setView(localStorage.getItem(PREF_KEY) === "quick" ? "quick" : "classic");
    } catch {
      setView("classic");
    }
  }, []);

  const pick = (v: "classic" | "quick") => {
    setView(v);
    try { localStorage.setItem(PREF_KEY, v); } catch { /* private mode — session-only */ }
  };

  if (view === null) return null;

  if (view === "quick") return <QuickRun onClassic={() => pick("classic")} />;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => pick("quick")}
        title="One box, no population review — config appears as you type, RUN goes straight to the live simulation"
        style={{
          ...mono, position: "absolute", top: -6, right: 0, zIndex: 5,
          fontSize: 9.5, letterSpacing: ".08em", padding: "5px 13px", borderRadius: 100,
          background: "transparent", border: "1px solid var(--ln6)", color: "var(--acc)", cursor: "pointer",
        }}
      >
        ⚡ QUICK RUN
      </button>
      <BriefComposer mode="create" />
    </div>
  );
}
