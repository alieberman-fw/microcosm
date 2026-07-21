"use client";

/**
 * Full conversation history: every thread, searchable by title, participant
 * name, or role. Rows link back into the chat view (/conversations?open=id).
 */

import { CSSProperties, useState } from "react";
import Link from "next/link";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface HistoryRow {
  id: string;
  title: string;
  updated_at: string;
  messages: number;
  participants: { name: string; initials: string; role: string }[];
}

function timeAgo(ts: string) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ConversationHistory({ rows }: { rows: HistoryRow[] }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? rows.filter((r) =>
        [r.title, ...r.participants.flatMap((p) => [p.name, p.role])].join(" ").toLowerCase().includes(ql)
      )
    : rows;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "44px 40px 80px" }}>
      <Link href="/conversations" style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
        ← CONVERSATIONS
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginTop: 18 }}>
        <div>
          <div className="kicker">History</div>
          <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>
            Every conversation
          </h1>
        </div>
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", paddingBottom: 8 }}>
          {filtered.length} OF {rows.length}
        </span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by title, person, or role…"
        autoFocus
        style={{ width: "100%", boxSizing: "border-box", marginTop: 24, background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "12px 20px", fontSize: 14, color: "var(--t1)", outline: "none" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 22 }}>
        {filtered.length === 0 && (
          <div className="card" style={{ padding: "34px 28px", border: "1px dashed var(--ln6)", textAlign: "center" }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".07em", color: "var(--t6)" }}>
              {rows.length === 0 ? "NO CONVERSATIONS YET" : `NOTHING MATCHES “${q.toUpperCase()}”`}
            </div>
          </div>
        )}
        {filtered.map((r) => (
          <Link
            key={r.id}
            href={`/conversations?open=${r.id}`}
            className="card cardHoverQuiet"
            style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", borderRadius: 14 }}
          >
            <span style={{ display: "flex", flex: "none" }}>
              {r.participants.slice(0, 3).map((p, i) => (
                <span key={i} style={{ ...mono, width: 30, height: 30, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, color: "var(--t3)", marginLeft: i ? -8 : 0, position: "relative", zIndex: 3 - i }}>
                  {p.initials}
                </span>
              ))}
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.title}
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--t6)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.participants.map((p) => p.name).join(", ") || "—"}
              </span>
            </span>
            <span style={{ ...mono, flex: "none", textAlign: "right", fontSize: 9.5, letterSpacing: ".05em", color: "var(--t7)", lineHeight: 1.8 }}>
              {r.messages} MSG{r.messages === 1 ? "" : "S"}
              <br />
              {timeAgo(r.updated_at).toUpperCase()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
