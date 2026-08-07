"use client";

/**
 * The card ⋮ menu, polished (feature batch 1b — Adam's field note): one
 * shell for the simulation and report cards so the grammar can't drift.
 * A mono context header names what the menu acts on; each row carries a
 * small stroke icon and a hover state; destructive actions sit below a
 * divider in warn, with the same tap-again-to-confirm contract as before.
 */

import { CSSProperties, ReactNode } from "react";
import Link from "next/link";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export function MenuIcon({ d }: { d: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", opacity: 0.75 }}>
      <path d={d} />
    </svg>
  );
}

export const MENU_ICONS = {
  open: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8",
  run: "M5 3l14 9-14 9V3z",
  rename: "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
} as const;

export interface MenuEntry {
  key: string;
  label: ReactNode;
  icon?: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  /** bold — the tap-again-to-confirm state */
  emphasized?: boolean;
}

export default function CardMenu({ header, entries, width = 218 }: {
  header: string;
  entries: MenuEntry[];
  width?: number;
}) {
  const rowStyle = (e: MenuEntry): CSSProperties => ({
    width: "100%", display: "flex", alignItems: "center", gap: 10, textAlign: "left",
    padding: "9px 12px", fontSize: 12.5, borderRadius: 9, cursor: "pointer",
    background: "none", border: "none",
    color: e.danger ? "var(--warn)" : "var(--t2)",
    fontFamily: "var(--font-sans), sans-serif",
    fontWeight: e.emphasized ? 600 : 400,
    transition: "background .12s",
  });
  const hover = (el: HTMLElement, on: boolean) => { el.style.background = on ? "var(--sf)" : "transparent"; };

  const normal = entries.filter((e) => !e.danger);
  const danger = entries.filter((e) => e.danger);

  return (
    <div
      style={{
        width, background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 13, padding: 6,
        boxShadow: "0 14px 36px rgba(0,0,0,.38)", animation: "fadeUp .15s ease both",
        backdropFilter: "blur(10px)",
      }}
    >
      <div style={{ ...mono, fontSize: 8, letterSpacing: ".12em", color: "var(--t7)", padding: "6px 12px 8px", borderBottom: "1px solid var(--ln2)", marginBottom: 4, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {header}
      </div>
      {normal.map((e) =>
        e.href ? (
          <Link key={e.key} href={e.href} prefetch={false} style={rowStyle(e)}
            onMouseEnter={(ev) => hover(ev.currentTarget, true)} onMouseLeave={(ev) => hover(ev.currentTarget, false)}>
            {e.icon && <MenuIcon d={e.icon} />}
            {e.label}
          </Link>
        ) : (
          <button key={e.key} onClick={e.onClick} style={rowStyle(e)}
            onMouseEnter={(ev) => hover(ev.currentTarget, true)} onMouseLeave={(ev) => hover(ev.currentTarget, false)}>
            {e.icon && <MenuIcon d={e.icon} />}
            {e.label}
          </button>
        ),
      )}
      {danger.length > 0 && <div style={{ borderTop: "1px solid var(--ln2)", margin: "4px 0" }} />}
      {danger.map((e) => (
        <button key={e.key} onClick={e.onClick} style={rowStyle(e)}
          onMouseEnter={(ev) => hover(ev.currentTarget, true)} onMouseLeave={(ev) => hover(ev.currentTarget, false)}>
          {e.icon && <MenuIcon d={e.icon} />}
          {e.label}
        </button>
      ))}
    </div>
  );
}
