"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.4" strokeDasharray="66 22" strokeLinecap="round" transform="rotate(-50 16 16)" />
      <path d="M9.5 21.5 V11.5 L16 18.5 L22.5 11.5 V21.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="16" cy="18.5" r="2" fill="var(--acc)" />
    </svg>
  );
}

export default function Nav() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const t = (localStorage.getItem("mc-theme") as "dark" | "light") || "dark";
    setTheme(t);
  }, []);

  const toggleTheme = useCallback(() => {
    const t = theme === "dark" ? "light" : "dark";
    localStorage.setItem("mc-theme", t);
    document.documentElement.dataset.theme = t;
    setTheme(t);
  }, [theme]);

  return (
    <nav
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 40px", height: 64, background: "var(--navbg)",
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--ln1)",
      }}
    >
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Logo />
        <span style={{ fontWeight: 600, fontSize: 17, letterSpacing: "-.02em" }}>microcosm</span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 13.5, color: "var(--t3)" }}>
        <div className="navLinks" style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <a href="/#product" style={{ color: "var(--t3)" }}>How it works</a>
          <a href="/#usecases" style={{ color: "var(--t3)" }}>Use cases</a>
          <a href="/#why" style={{ color: "var(--t3)" }}>Why it works</a>
          <a href="/demo.html" style={{ color: "var(--t3)" }}>Live demo</a>
        </div>
        <button
          onClick={toggleTheme}
          aria-label="Toggle light/dark theme"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: "50%",
            border: "1px solid var(--ln6)", background: "transparent",
            color: "var(--t3)", cursor: "pointer", padding: 0,
          }}
        >
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
        <Link href="/login" style={{ color: "var(--t3)", fontWeight: 500 }}>Sign in</Link>
        <a href="/#access" className="btnAcc" style={{ padding: "8px 18px", fontSize: 13 }}>
          Get started
        </a>
      </div>
    </nav>
  );
}
