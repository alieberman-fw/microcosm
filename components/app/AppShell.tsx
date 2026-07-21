"use client";

/**
 * The authenticated app shell: collapsible sidebar, nav, profile menu.
 * Wraps every page in the (app) route group.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Nav";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  sims: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  personas: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.85M15.5 3.15A4 4 0 0 1 15.5 11",
  consult: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  demo: "M5 3l14 9-14 9V3z",
  reports: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  market: "M20 7H4L2 12v2h2v7h16v-7h2v-2l-2-5zM8 21v-6h8v6",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
};

type NavItem = { href: string | null; label: string; icon: string; soon?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Simulations", icon: ICONS.sims },
  { href: "/conversations", label: "Conversations", icon: ICONS.consult },
  { href: "/personas", label: "Agent Library", icon: ICONS.personas },
  { href: null, label: "Reports", icon: ICONS.reports, soon: true },
  { href: null, label: "Marketplace", icon: ICONS.market, soon: true },
];

export default function AppShell({
  email,
  orgName,
  children,
}: {
  email: string;
  orgName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem("mc-sidebar") === "collapsed");
    setTheme((localStorage.getItem("mc-theme") as "dark" | "light") || "dark");
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggleCollapse = () => {
    const c = !collapsed;
    setCollapsed(c);
    localStorage.setItem("mc-sidebar", c ? "collapsed" : "open");
  };

  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    localStorage.setItem("mc-theme", t);
    document.documentElement.dataset.theme = t;
    setTheme(t);
  };

  const initials = (email[0] ?? "?").toUpperCase() + (email.split("@")[0]?.[1] ?? "").toUpperCase();
  const W = collapsed ? 68 : 236;

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      {/* sidebar */}
      <aside
        style={{
          width: W, flex: "none", display: "flex", flexDirection: "column",
          background: "var(--sf)", borderRight: "1px solid var(--ln2)",
          transition: "width .22s ease", boxSizing: "border-box", padding: "16px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", padding: "2px 6px 14px" }}>
          <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Logo size={24} />
            {!collapsed && <span style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: "-.02em" }}>microcosm</span>}
          </Link>
          {!collapsed && (
            <button onClick={toggleCollapse} aria-label="Collapse sidebar" style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 4 }}>
              <Icon d="M15 18l-6-6 6-6" size={14} />
            </button>
          )}
        </div>
        {collapsed && (
          <button onClick={toggleCollapse} aria-label="Expand sidebar" style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: "0 0 12px", display: "flex", justifyContent: "center" }}>
            <Icon d="M9 18l6-6-6-6" size={14} />
          </button>
        )}

        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((item) => {
            const active = item.href && pathname.startsWith(item.href);
            const inner = (
              <span
                style={{
                  display: "flex", alignItems: "center", gap: 11,
                  justifyContent: collapsed ? "center" : "flex-start",
                  padding: collapsed ? "11px 0" : "10px 12px", borderRadius: 10,
                  color: active ? "var(--acc)" : item.soon ? "var(--t7)" : "var(--t4)",
                  background: active ? "var(--acc-dim)" : "transparent",
                  fontSize: 13.5, fontWeight: active ? 600 : 500,
                  cursor: item.soon ? "default" : "pointer",
                  transition: "background .15s, color .15s",
                }}
                title={collapsed ? item.label : undefined}
              >
                <Icon d={item.icon} />
                {!collapsed && item.label}
                {!collapsed && item.soon && (
                  <span style={{ ...mono, marginLeft: "auto", fontSize: 8.5, letterSpacing: ".06em", color: "var(--t7)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "2px 7px" }}>
                    SOON
                  </span>
                )}
              </span>
            );
            return item.href ? (
              <Link key={item.label} href={item.href}>{inner}</Link>
            ) : (
              <div key={item.label}>{inner}</div>
            );
          })}
        </nav>

        {/* profile */}
        <div ref={menuRef} style={{ marginTop: "auto", position: "relative" }}>
          {menuOpen && (
            <div
              style={{
                position: "absolute", bottom: "calc(100% + 10px)", left: 0,
                width: 226, background: "var(--sf2)", border: "1px solid var(--ln5)",
                borderRadius: 14, padding: 8, zIndex: 60, animation: "fadeUp .18s ease both",
                boxShadow: "0 12px 32px rgba(0,0,0,.4)",
              }}
            >
              <div style={{ padding: "10px 12px 12px", borderBottom: "1px solid var(--ln3)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{email}</div>
                <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>
                  ORG · {orgName.toUpperCase()}
                </div>
              </div>
              <button onClick={toggleTheme} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", color: "var(--t3)", cursor: "pointer", padding: "10px 12px", fontSize: 13, borderRadius: 8 }}>
                <Icon d={theme === "dark" ? "M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" : "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M1 12h2M21 12h2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M19.8 4.2l-1.4 1.4M5.6 18.4l-1.4 1.4"} size={14} />
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <Link href="/settings" onClick={() => setMenuOpen(false)} style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--t3)", padding: "10px 12px", fontSize: 13, borderRadius: 8 }}>
                <Icon d={ICONS.settings} size={14} />
                Settings
              </Link>
              <form action="/auth/signout" method="post" style={{ borderTop: "1px solid var(--ln3)", marginTop: 4, paddingTop: 4 }}>
                <button type="submit" style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", color: "var(--t4)", cursor: "pointer", padding: "10px 12px", fontSize: 13, borderRadius: 8 }}>
                  <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" size={14} />
                  Sign out
                </button>
              </form>
            </div>
          )}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              justifyContent: collapsed ? "center" : "flex-start",
              background: menuOpen ? "var(--sf2)" : "none", border: "none", cursor: "pointer",
              padding: collapsed ? "8px 0" : "8px 10px", borderRadius: 10,
            }}
          >
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--acc)", color: "var(--acc-c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none" }}>
              {initials}
            </span>
            {!collapsed && (
              <span style={{ minWidth: 0, textAlign: "left" }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                  {email.split("@")[0]}
                </span>
                <span style={{ ...mono, display: "block", fontSize: 9, letterSpacing: ".05em", color: "var(--t6)" }}>ACCOUNT</span>
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* content */}
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", boxSizing: "border-box" }}>
        {children}
      </main>
    </div>
  );
}
