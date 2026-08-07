"use client";

/**
 * The favorite star (feature batch 1b) — top-right corner of simulation and
 * report cards. Starred: filled accent, always visible. Unstarred: outline,
 * revealed on card hover (the .rowActions pattern the ⋮ button uses).
 */

import { CSSProperties } from "react";

export default function StarButton({ on, onToggle, style, alwaysVisible = false }: {
  on: boolean;
  onToggle: () => void;
  style?: CSSProperties;
  /** list rows have no .simCard hover parent — skip the hover-reveal class */
  alwaysVisible?: boolean;
}) {
  return (
    <button
      className={on || alwaysVisible ? undefined : "rowActions"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      style={{
        width: 26, height: 26, borderRadius: 8, background: "transparent", border: "none",
        cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: on ? "var(--acc)" : "var(--t6)", padding: 0, ...style,
      }}
    >
      <svg width={15} height={15} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </button>
  );
}
