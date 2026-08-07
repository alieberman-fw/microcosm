"use client";

/**
 * Theme control for MAGIC-LINK report views (field fix): recipients aren't
 * signed in and have no Settings — a small, out-of-the-way control at the
 * top-right lets them pick what's easiest to read. Collapsed: just the
 * current mode's icon (☀ / ◐ / ☾). Click: expands to the three-mode
 * picker; clicking anywhere else collapses it back. Shared views DEFAULT
 * TO LIGHT (the safest read for an emailed link) and remember the
 * viewer's choice on their device under a shared-only key — it never
 * fights an org member's own app theme.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const KEY = "mc-shared-theme";
const MODES = [
  { id: "light", icon: "☀", label: "LIGHT" },
  { id: "gray", icon: "◐", label: "GRAY" },
  { id: "dark", icon: "☾", label: "DARK" },
] as const;
type Mode = (typeof MODES)[number]["id"];

export default function SharedThemeSwitch() {
  const [mode, setMode] = useState<Mode>("light");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // shared pages open LIGHT unless this viewer chose otherwise before
  useEffect(() => {
    const saved = localStorage.getItem(KEY) as Mode | null;
    const m = saved && MODES.some((x) => x.id === saved) ? saved : "light";
    setMode(m);
    document.documentElement.dataset.theme = m;
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const apply = (m: Mode) => {
    setMode(m);
    localStorage.setItem(KEY, m);
    document.documentElement.dataset.theme = m;
    setOpen(false);
  };

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div ref={ref} style={{ position: "fixed", top: 16, right: 18, zIndex: 80 }}>
      {open ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: 4, borderRadius: 100, background: "var(--sf2)", border: "1px solid var(--ln5)", boxShadow: "0 8px 24px rgba(0,0,0,.25)", animation: "fadeUp .15s ease both" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => apply(m.id)}
              title={m.label}
              aria-label={`Switch to ${m.label.toLowerCase()} mode`}
              style={{
                width: 30, height: 30, borderRadius: "50%", border: "none", cursor: "pointer",
                background: m.id === mode ? "var(--acc-dim)" : "transparent",
                color: m.id === mode ? "var(--acc)" : "var(--t5)",
                fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center",
                boxShadow: m.id === mode ? "inset 0 0 0 1px var(--acc)" : "none",
              }}
            >
              {m.icon}
            </button>
          ))}
          <span style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--t6)", padding: "0 8px 0 4px" }}>{current.label}</span>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Reading mode — light, gray, or dark"
          aria-label="Change the reading theme"
          style={{
            width: 34, height: 34, borderRadius: "50%", cursor: "pointer",
            background: "var(--sf2)", border: "1px solid var(--ln4)", color: "var(--t4)",
            fontSize: 15, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 14px rgba(0,0,0,.18)",
          }}
        >
          {current.icon}
        </button>
      )}
    </div>
  );
}
