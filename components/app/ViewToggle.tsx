"use client";

/**
 * The card/list view toggle (field fix): ONE segmented control instead of
 * two pills — two icon segments in a single pill container, active segment
 * accent-filled. Used by the Simulations and Reports toolbars.
 */

import { CSSProperties } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export default function ViewToggle<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; icon: string; title: string }[];
}) {
  return (
    <span style={{ display: "inline-flex", padding: 3, borderRadius: 100, border: "1px solid var(--ln4)", background: "var(--sf)", gap: 2 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            title={o.title}
            aria-label={o.title}
            aria-pressed={on}
            style={{
              ...mono, fontSize: 10.5, lineHeight: 1, width: 30, height: 24, borderRadius: 100,
              border: "none", cursor: "pointer",
              background: on ? "var(--acc)" : "transparent",
              color: on ? "var(--acc-c)" : "var(--t5)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              transition: "background .15s, color .15s",
            }}
          >
            {o.icon}
          </button>
        );
      })}
    </span>
  );
}
