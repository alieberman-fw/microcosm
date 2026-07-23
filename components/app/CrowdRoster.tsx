"use client";

/**
 * Browse the materialized crowd (CLAUDE.md §3 Stage 3 / §4.1) — every crowd
 * member behind the leads, searchable and reviewable before the run. Click a
 * row for the full profile; × removes a member. Leads deliberate; the crowd
 * is sampled as interjectors and polled for sentiment at run time (§5).
 */

import { CSSProperties, useMemo, useState } from "react";
import { WorkspaceSeat } from "@/components/app/PopulationStage";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const GROUPS = [
  { key: "all", label: "ALL" },
  { key: "experts", label: "EXPERTS" },
  { key: "residents", label: "RESIDENTS · CONSUMERS" },
] as const;

function isResident(s: WorkspaceSeat): boolean {
  return s.spec.kind === "resident" || s.spec.kind === "consumer";
}

export default function CrowdRoster({
  members,
  note,
  onRemove,
  onProfile,
  onClose,
}: {
  members: WorkspaceSeat[];
  note?: string; // sample-cap or shortfall context, computed by the caller
  onRemove: (key: string) => void;
  onProfile: (seat: WorkspaceSeat) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<(typeof GROUPS)[number]["key"]>("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (group === "experts" && isResident(m)) return false;
      if (group === "residents" && !isResident(m)) return false;
      if (!q) return true;
      const d = m.spec.demographics as { metro?: string; occupation?: string } | undefined;
      return `${m.spec.name} ${m.spec.role} ${m.spec.discipline ?? ""} ${m.spec.tagline ?? ""} ${d?.metro ?? ""} ${d?.occupation ?? ""}`
        .toLowerCase().includes(q);
    });
  }, [members, query, group]);

  const expertCount = members.filter((m) => !isResident(m)).length;
  const residentCount = members.length - expertCount;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadeUp .2s ease both" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(760px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, overflow: "hidden" }}
      >
        <div style={{ padding: "22px 26px 16px", borderBottom: "1px solid var(--ln3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>
              THE CROWD · {members.length.toLocaleString()} MEMBERS
              {note && <span style={{ color: "var(--t7)" }}> · {note}</span>}
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--t5)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, role, discipline, metro…"
              style={{
                flex: 1, minWidth: 200, padding: "10px 16px", background: "var(--sf2)",
                border: "1px solid var(--ln3)", borderRadius: 100, fontFamily: "var(--font-sans), sans-serif",
                fontSize: 13, color: "var(--t1)", outline: "none",
              }}
            />
            {GROUPS.map((g) => {
              const count = g.key === "all" ? members.length : g.key === "experts" ? expertCount : residentCount;
              if (g.key !== "all" && count === 0) return null;
              return (
                <button
                  key={g.key}
                  onClick={() => setGroup(g.key)}
                  style={{
                    ...mono, fontSize: 9, letterSpacing: ".05em", padding: "6px 12px", borderRadius: 100, cursor: "pointer",
                    background: group === g.key ? "var(--acc-dim)" : "transparent",
                    border: `1px solid ${group === g.key ? "var(--acc)" : "var(--ln4)"}`,
                    color: group === g.key ? "var(--acc)" : "var(--t6)",
                  }}
                >
                  {g.label} {count}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "10px 14px" }}>
          {visible.length === 0 && (
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--t6)", padding: "22px 12px" }}>
              NO CROWD MEMBERS MATCH
            </div>
          )}
          {visible.map((m) => {
            const d = m.spec.demographics as { age?: number; metro?: string; state?: string; tenure?: string; occupation?: string } | undefined;
            const meta = [
              d?.age ? `${d.age}` : null,
              d?.metro ? `${d.metro}${d.state ? `, ${d.state}` : ""}` : null,
              isResident(m) ? d?.tenure?.toUpperCase() : m.spec.discipline,
            ].filter(Boolean).join(" · ");
            return (
              <div
                key={m.key}
                onClick={() => onProfile(m)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10,
                  cursor: "pointer", borderBottom: "1px solid var(--ln1)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--sf2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 9.5, color: "var(--t3)", flex: "none" }}>
                  {m.spec.initials}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{m.spec.name}</span>
                    <span style={{ fontSize: 12, color: "var(--t5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.spec.role}</span>
                  </div>
                  {meta && <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)", marginTop: 2 }}>{meta}</div>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(m.key); }}
                  aria-label={`Remove ${m.spec.name}`}
                  style={{ background: "none", border: "none", color: "var(--t7)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 4, flex: "none" }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
