"use client";

/**
 * Settings → Appearance — the four-point theme slider (field fix):
 * ☀ light · fog (light warm gray) · gray (warm dark middle) · ☾ dark.
 * Persists to localStorage ("mc-theme", same key the boot script and the
 * profile-menu quick switch read) and stamps <html data-theme> live.
 * Broadcasts "mc-theme-changed" so the AppShell menu label stays honest.
 */

import { CSSProperties, useEffect, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const THEMES = ["light", "fog", "gray", "dark"] as const;
type Theme = (typeof THEMES)[number];
const LABELS: Record<Theme, string> = {
  light: "LIGHT",
  fog: "FOG — LIGHT WARM GRAY",
  gray: "GRAY — WARM MIDDLE",
  dark: "DARK",
};

export default function ThemePref() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const t = localStorage.getItem("mc-theme") as Theme | null;
    setTheme(t && THEMES.includes(t) ? t : "dark");
  }, []);

  const apply = (t: Theme) => {
    setTheme(t);
    localStorage.setItem("mc-theme", t);
    document.documentElement.dataset.theme = t;
    window.dispatchEvent(new Event("mc-theme-changed"));
  };

  const idx = THEMES.indexOf(theme);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, maxWidth: 380 }}>
        <span aria-hidden style={{ fontSize: 16, color: theme === "light" ? "var(--acc)" : "var(--t6)", flex: "none", lineHeight: 1 }}>☀</span>
        <input
          type="range"
          min={0}
          max={3}
          step={1}
          value={idx < 0 ? 3 : idx}
          onChange={(e) => apply(THEMES[Number(e.target.value)] ?? "dark")}
          aria-label="Theme: light, fog, warm gray, or dark"
          style={{ flex: 1, accentColor: "var(--acc)", height: 4, cursor: "pointer" }}
        />
        <span aria-hidden style={{ fontSize: 15, color: theme === "dark" ? "var(--acc)" : "var(--t6)", flex: "none", lineHeight: 1 }}>☾</span>
      </div>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--acc)", marginTop: 10 }}>
        {LABELS[theme] ?? "DARK"}
      </div>
    </div>
  );
}
