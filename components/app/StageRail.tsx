"use client";

/**
 * The five-stage rail (01 BRIEF … 05 REPORT) — ONE component for every
 * surface so the grammar can't drift (workspace scroll-spy, run screen,
 * report page). States per stage:
 *   done    → accent text + ✓
 *   current → the you-are-here pill (accent border + dim fill) — field fix:
 *             completion alone left users unsure which page they were on
 *   else    → muted text
 * A stage acts as a link (href) or a button (onClick); neither = inert.
 */

import { CSSProperties } from "react";
import Link from "next/link";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface RailStage {
  label: string;
  done: boolean;
  current?: boolean;
  href?: string;
  onClick?: () => void;
  title?: string;
}

export default function StageRail({ stages, gap = 10 }: { stages: RailStage[]; gap?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap, flexWrap: "wrap" }}>
      {stages.map((s, i) => {
        const text = `${String(i + 1).padStart(2, "0")} ${s.label}${s.done ? " ✓" : ""}`;
        const style: CSSProperties = s.current
          ? { ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--acc)", background: "var(--acc-dim)", border: "1px solid var(--acc)", borderRadius: 100, padding: "3px 11px", whiteSpace: "nowrap" }
          : { ...mono, fontSize: 10, letterSpacing: ".1em", color: s.done ? "var(--acc)" : "var(--t5)", whiteSpace: "nowrap" };
        const inner = s.href ? (
          <Link href={s.href} prefetch={false} title={s.title} style={style}>{text}</Link>
        ) : s.onClick ? (
          <button onClick={s.onClick} title={s.title} style={{ ...style, background: s.current ? "var(--acc-dim)" : "none", border: s.current ? "1px solid var(--acc)" : "none", padding: s.current ? "3px 11px" : 0, cursor: "pointer" }}>
            {text}
          </button>
        ) : (
          <span title={s.title} style={{ ...style, color: s.current ? "var(--acc)" : "var(--t7)" }}>{text}</span>
        );
        return (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap }}>
            {inner}
            {i < stages.length - 1 && <span style={{ width: 16, height: 1, background: "var(--ln4)", display: "inline-block" }} />}
          </span>
        );
      })}
    </span>
  );
}
