"use client";

/**
 * Reports tab — every synthesized report in the org, one card per simulation
 * (latest version leads; older versions stay reachable from the report's
 * V-chips). Search, verdict filters, date, pagination, and a hover ⋯ menu
 * with per-version delete — reports are permanent run records until the
 * user explicitly removes them.
 */

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };
const PAGE = 12;

export interface ReportRow {
  id: string;
  sim_id: string;
  version: number;
  created_at: string;
  tone: string;
  label: string;
  headline: string;
  problem: string;
  mode: string;
  posts: number;
  dissents: number;
  /** 3b — non-decision reports bucket as INSIGHT; leadMetric is the card chip
   *  ("$4.2M–$4.6M", "68% LIKELY", "KEY FINDING") */
  leadKind?: string;
  leadMetric?: string;
}

const TONES = [
  { key: "all", label: "ALL" },
  { key: "go", label: "GO" },
  { key: "conditional", label: "CONDITIONAL" },
  { key: "no-go", label: "NO-GO" },
  { key: "split", label: "SPLIT" },
  { key: "insight", label: "INSIGHT" },
] as const;

const toneColor = (t: string) => (t === "go" ? "var(--acc)" : t === "split" ? "var(--t4)" : "var(--warn)");
/** exclusive buckets: a range/odds/finding report lives in INSIGHT, never in a tone */
const bucketOf = (r: ReportRow) => (r.leadKind && r.leadKind !== "decision" ? "insight" : r.tone);

export default function ReportsClient({ initialRows }: { initialRows: ReportRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[]>(initialRows);
  const [q, setQ] = useState("");
  const [tone, setTone] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) { setMenuFor(null); setConfirmFor(null); }
    };
    if (menuFor) document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  // latest version per simulation carries the card; the rest ride along
  const grouped = useMemo(() => {
    const bySim = new Map<string, ReportRow[]>();
    for (const r of rows) {
      const list = bySim.get(r.sim_id) ?? [];
      list.push(r);
      bySim.set(r.sim_id, list);
    }
    return [...bySim.values()]
      .map((list) => ({ latest: [...list].sort((a, b) => b.version - a.version)[0], versions: list.length, all: list }))
      .sort((a, b) => +new Date(b.latest.created_at) - +new Date(a.latest.created_at));
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const visible = grouped.filter((g) => {
    if (tone !== "all" && bucketOf(g.latest) !== tone) return false;
    if (!needle) return true;
    return `${g.latest.problem} ${g.latest.headline} ${g.latest.label}`.toLowerCase().includes(needle);
  });
  const countFor = (t: string) => (t === "all" ? grouped.length : grouped.filter((g) => bucketOf(g.latest) === t).length);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const pageRows = visible.slice(page * PAGE, page * PAGE + PAGE);
  useEffect(() => { setPage(0); }, [q, tone]);

  const remove = async (report: ReportRow, wholeSet: boolean) => {
    const ids = wholeSet ? rows.filter((r) => r.sim_id === report.sim_id).map((r) => r.id) : [report.id];
    setDeleting(report.sim_id);
    setMenuFor(null);
    setConfirmFor(null);
    for (const id of ids) await fetch(`/api/reports/${id}`, { method: "DELETE" });
    setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
    setDeleting(null);
    router.refresh();
  };

  if (grouped.length === 0) {
    return (
      <div className="card" style={{ marginTop: 30, padding: "26px 28px", maxWidth: 560 }}>
        <div style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--t6)" }}>NO REPORTS YET</div>
        <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "var(--t5)" }}>
          Run a simulation, then hit “Synthesize the report” on the run screen.
          <Link href="/dashboard" style={{ color: "var(--acc)" }}> Your simulations →</Link>
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 26 }}>
      {/* search + verdict filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search reports…"
          style={{
            width: 260, padding: "9px 14px", background: "var(--sf)", border: "1px solid var(--ln3)",
            borderRadius: 100, fontFamily: "var(--font-sans), sans-serif", fontSize: 12.5,
            color: "var(--t1)", outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TONES.map((t) => {
            const on = tone === t.key;
            const n = countFor(t.key);
            if (t.key !== "all" && n === 0) return null;
            return (
              <button
                key={t.key}
                onClick={() => setTone(t.key)}
                style={{
                  ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "5px 12px", borderRadius: 100,
                  cursor: "pointer", transition: "all .15s",
                  background: on ? "var(--acc-dim)" : "transparent",
                  border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`,
                  color: on ? "var(--acc)" : "var(--t6)",
                }}
              >
                {t.label} · {n}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, marginTop: 18 }}>
        {pageRows.map((g) => {
          const r = g.latest;
          const menuOpen = menuFor === r.id;
          return (
            <div key={r.id} className="card simCard" style={{ position: "relative", opacity: deleting === r.sim_id ? 0.4 : 1, transition: "opacity .2s" }}>
              <Link href={`/sim/${r.sim_id}/report`} style={{ display: "block", padding: "22px 24px", height: "100%", boxSizing: "border-box" }}>
                <div style={{ ...mono, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, letterSpacing: ".07em", color: "var(--t6)", paddingRight: 22 }}>
                  {bucketOf(r) === "insight" ? (
                    <span style={{ fontSize: 9, letterSpacing: ".08em", padding: "4px 12px", borderRadius: 100, border: "1px solid var(--acc)", color: "var(--acc)" }}>
                      {r.leadMetric ?? "KEY FINDING"}
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, letterSpacing: ".08em", padding: "4px 12px", borderRadius: 100, border: `1px solid ${toneColor(r.tone)}`, color: toneColor(r.tone) }}>
                      {r.label}
                    </span>
                  )}
                  <span>{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.4, margin: "12px 0 8px", color: "var(--t1)" }}>
                  {r.problem}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t5)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {r.headline}
                </div>
                <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t7)", marginTop: 12 }}>
                  V{r.version}{g.versions > 1 ? ` OF ${g.versions}` : ""} · {r.mode.toUpperCase()} · {r.posts} POSTS · {r.dissents} DISSENT{r.dissents === 1 ? "" : "S"}
                </div>
              </Link>

              <button
                className="rowActions"
                onClick={(e) => { e.preventDefault(); setMenuFor(menuOpen ? null : r.id); setConfirmFor(null); }}
                aria-label="Report actions"
                style={{
                  position: "absolute", top: 14, right: 12, width: 26, height: 26, borderRadius: 8,
                  background: menuOpen ? "var(--sf2)" : "transparent", border: "none", color: "var(--t5)",
                  cursor: "pointer", fontSize: 15, lineHeight: 1, letterSpacing: 1,
                  ...(menuOpen ? { opacity: 1 } : {}),
                }}
              >
                ⋮
              </button>

              {menuOpen && (
                <div
                  ref={menuRef}
                  style={{
                    position: "absolute", top: 42, right: 12, zIndex: 40, width: 210,
                    background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 6,
                    boxShadow: "0 10px 28px rgba(0,0,0,.35)", animation: "fadeUp .15s ease both",
                  }}
                >
                  <Link href={`/sim/${r.sim_id}/report`} style={{ display: "block", padding: "9px 12px", fontSize: 12.5, color: "var(--t2)", borderRadius: 8 }}>
                    Open the report
                  </Link>
                  <Link href={`/sim/${r.sim_id}/run`} prefetch={false} style={{ display: "block", padding: "9px 12px", fontSize: 12.5, color: "var(--t2)", borderRadius: 8 }}>
                    View the run
                  </Link>
                  <button
                    onClick={() => (confirmFor === r.id ? void remove(r, false) : setConfirmFor(r.id))}
                    style={{
                      width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 12.5,
                      background: "none", border: "none", borderRadius: 8, cursor: "pointer",
                      color: "var(--warn)", fontFamily: "var(--font-sans), sans-serif",
                      fontWeight: confirmFor === r.id ? 600 : 400,
                    }}
                  >
                    {confirmFor === r.id ? `Really delete V${r.version}? The run stays` : `Delete V${r.version}${g.versions > 1 ? " (latest)" : ""}`}
                  </button>
                  {g.versions > 1 && (
                    <button
                      onClick={() => (confirmFor === `${r.id}-all` ? void remove(r, true) : setConfirmFor(`${r.id}-all`))}
                      style={{
                        width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 12.5,
                        background: "none", border: "none", borderRadius: 8, cursor: "pointer",
                        color: "var(--warn)", fontFamily: "var(--font-sans), sans-serif",
                        fontWeight: confirmFor === `${r.id}-all` ? 600 : 400,
                      }}
                    >
                      {confirmFor === `${r.id}-all` ? `Really delete all ${g.versions}?` : `Delete all ${g.versions} versions`}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 24 }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "6px 14px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln4)", color: page === 0 ? "var(--t7)" : "var(--t4)", cursor: page === 0 ? "default" : "pointer" }}
          >
            ← PREV
          </button>
          <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)" }}>
            PAGE {page + 1}/{pages} · {visible.length} REPORT{visible.length === 1 ? "" : "S"}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
            style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "6px 14px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln4)", color: page >= pages - 1 ? "var(--t7)" : "var(--t4)", cursor: page >= pages - 1 ? "default" : "pointer" }}
          >
            NEXT →
          </button>
        </div>
      )}
    </div>
  );
}
