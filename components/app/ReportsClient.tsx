"use client";

/**
 * Reports tab — every synthesized report in the org, one card per simulation
 * (latest version leads; older versions stay reachable from the report's
 * V-chips). Search, verdict filters, date, pagination, and a hover ⋯ menu
 * with rename + per-version delete — reports are permanent run records until
 * the user explicitly removes them. Cards follow the SimCards grammar: the
 * NAME leads (spec.name → the sim's name), the brief collapses behind a
 * FULL BRIEF expander, and unread reports carry a pulsing green dot.
 */

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { seenReports } from "@/components/app/ReportsBadge";
import { ShareLinksPanel } from "@/components/app/ShareLinks";
import ViewToggle from "@/components/app/ViewToggle";
import CardMenu, { MENU_ICONS } from "@/components/app/CardMenu";
import StarButton from "@/components/app/StarButton";
import { mergePrefs, toggleId } from "@/lib/prefs";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };
const PAGE = 12;

export interface ReportRow {
  id: string;
  sim_id: string;
  version: number;
  /** display name: spec.name (user rename) → the sim's name/title → null */
  name?: string | null;
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

export default function ReportsClient({ initialRows, initialStarred = [] }: { initialRows: ReportRow[]; initialStarred?: string[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[]>(initialRows);
  const [q, setQ] = useState("");
  const [tone, setTone] = useState<string>("all");
  const [view, setView] = useState<"grouped" | "flat">("grouped"); // flat = every version, one row each
  const [page, setPage] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // FULL BRIEF open per card
  const [renaming, setRenaming] = useState<string | null>(null); // sim_id being renamed
  const [nameDraft, setNameDraft] = useState("");
  const [seen, setSeen] = useState<Set<string> | null>(null); // unread dots (client-only)
  const [linksFor, setLinksFor] = useState<string | null>(null); // magic-links panel (sim_id)
  // favorites (1b): stars key by sim_id — a report set shares one star
  const [starred, setStarred] = useState<Set<string>>(new Set(initialStarred));
  const [favOnly, setFavOnly] = useState(false);
  const toggleStar = (simId: string) => {
    setStarred((prev) => {
      const next = toggleId([...prev], simId);
      void mergePrefs({ starred_reports: next });
      return new Set(next);
    });
  };
  const menuRef = useRef<HTMLDivElement>(null);

  // "seen" lives in localStorage — read after mount (no hydration mismatch),
  // refresh when a report is opened in this tab
  useEffect(() => {
    const read = () => setSeen(seenReports());
    read();
    window.addEventListener("mc-reports-seen", read);
    window.addEventListener("focus", read);
    return () => { window.removeEventListener("mc-reports-seen", read); window.removeEventListener("focus", read); };
  }, []);

  // ONE name, owned by the simulation (field fix): renaming a report renames
  // its sim, so the dashboard card, every report version, and the open
  // report all agree — no per-version copies to drift
  const saveName = async (simId: string) => {
    const name = nameDraft.trim().slice(0, 80);
    setRenaming(null);
    if (!name) return;
    setRows((prev) => prev.map((r) => (r.sim_id === simId ? { ...r, name } : r)));
    await fetch(`/api/simulations/${simId}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

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
      .sort((a, b) =>
        // favorites float first, newest within each band
        (Number(starred.has(b.latest.sim_id)) - Number(starred.has(a.latest.sim_id)))
        || (+new Date(b.latest.created_at) - +new Date(a.latest.created_at)));
  }, [rows, starred]);

  const needle = q.trim().toLowerCase();
  const matches = (r: ReportRow) => !needle || `${r.name ?? ""} ${r.problem} ${r.headline} ${r.label}`.toLowerCase().includes(needle);
  const visible = grouped.filter((g) => {
    if (favOnly && !starred.has(g.latest.sim_id)) return false;
    if (tone !== "all" && bucketOf(g.latest) !== tone) return false;
    return matches(g.latest);
  });
  // FLAT: every version is its own row, newest first
  const flatRows = useMemo(() =>
    [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .filter((r) => (!favOnly || starred.has(r.sim_id)) && (tone === "all" || bucketOf(r) === tone) && matches(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, tone, needle, favOnly, starred]);
  const countFor = (t: string) => view === "flat"
    ? (t === "all" ? rows.length : rows.filter((r) => bucketOf(r) === t).length)
    : (t === "all" ? grouped.length : grouped.filter((g) => bucketOf(g.latest) === t).length);
  const perPage = view === "flat" ? 20 : PAGE;
  const total = view === "flat" ? flatRows.length : visible.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const pageRows = visible.slice(page * PAGE, page * PAGE + PAGE);
  const pageFlat = flatRows.slice(page * perPage, page * perPage + perPage);
  useEffect(() => { setPage(0); }, [q, tone, view, favOnly]);

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
      {/* the toolbar (field fix): search, tone filters, favorites, and the
          grouped/all-versions view toggle in ONE cohesive bar */}
      <div style={{
        display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        padding: "9px 14px", background: "var(--sf)", border: "1px solid var(--ln3)", borderRadius: 14,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: 1, minWidth: 190 }}>
          <span style={{ color: "var(--t6)", fontSize: 14, flex: "none" }}>⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reports…"
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontFamily: "var(--font-sans), sans-serif", fontSize: 13, color: "var(--t1)", padding: "6px 0" }}
          />
        </span>
        <span aria-hidden style={{ width: 1, height: 20, background: "var(--ln3)", flex: "none" }} />
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
        <StarButton alwaysVisible on={favOnly} onToggle={() => setFavOnly((v) => !v)} style={{ flex: "none" }} />
        <span aria-hidden style={{ width: 1, height: 20, background: "var(--ln3)", flex: "none" }} />
        <ViewToggle
          value={view}
          onChange={setView}
          options={[
            { key: "grouped" as const, icon: "▦", title: "One card per simulation — latest version leads" },
            { key: "flat" as const, icon: "☰", title: "Every version as its own row" },
          ]}
        />
      </div>

      {view === "flat" && (
        <div style={{ marginTop: 18, border: "1px solid var(--ln3)", borderRadius: 14, background: "var(--sf)", overflow: "hidden" }}>
          {pageFlat.map((r, i) => (
            <Link
              key={r.id}
              href={`/sim/${r.sim_id}/report?v=${r.version}`}
              className="rowGo"
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "13px 20px",
                borderTop: i === 0 ? "none" : "1px solid var(--ln1)",
              }}
            >
              {/* unread dot leads the row, LEFT of the version chip — the slot
                  is always reserved so read/unread rows stay aligned */}
              <span
                title={seen !== null && !seen.has(r.id) ? "New — you haven't opened this version" : undefined}
                style={{
                  width: 7, height: 7, borderRadius: "50%", flex: "none",
                  background: seen !== null && !seen.has(r.id) ? "var(--acc)" : "transparent",
                  ...(seen !== null && !seen.has(r.id) ? { animation: "pulseDot 1.6s ease infinite" } : {}),
                }}
              />
              <StarButton alwaysVisible on={starred.has(r.sim_id)} onToggle={() => toggleStar(r.sim_id)} style={{ flex: "none", width: 20, height: 20 }} />
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--acc)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "3px 10px", flex: "none" }}>
                V{r.version}
              </span>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", flex: "none", padding: "3px 10px", borderRadius: 100, border: `1px solid ${bucketOf(r) === "insight" ? "var(--acc)" : toneColor(r.tone)}`, color: bucketOf(r) === "insight" ? "var(--acc)" : toneColor(r.tone), maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {bucketOf(r) === "insight" ? (r.leadMetric ?? "KEY FINDING") : r.label}
              </span>
              <span style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.name ?? r.problem}
              </span>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", flex: "none" }}>
                {r.mode.toUpperCase()} · {r.posts} POSTS
              </span>
              <span style={{ ...mono, fontSize: 8.5, color: "var(--t7)", flex: "none" }}>
                {new Date(r.created_at).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div style={{ display: view === "grouped" ? "grid" : "none", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, marginTop: 18 }}>
        {pageRows.map((g) => {
          const r = g.latest;
          const menuOpen = menuFor === r.id;
          const isOpen = expanded.has(r.sim_id);
          // the card dot means ANY version of this report is unread — an
          // unopened V1 keeps signaling even after the latest was read
          const unreadOf = (id: string) => seen !== null && !seen.has(id);
          const unread = g.all.some((v) => unreadOf(v.id));
          const clamp = (n: number): CSSProperties => ({ display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", overflow: "hidden" });
          const collapsible = Boolean(r.name) || r.problem.length > 220;
          return (
            <div key={r.id} className="card simCard" style={{ position: "relative", display: "flex", flexDirection: "column", opacity: deleting === r.sim_id ? 0.4 : 1, transition: "opacity .2s" }}>
              <Link href={`/sim/${r.sim_id}/report`} style={{ display: "block", padding: "22px 24px", flex: 1, boxSizing: "border-box" }}>
                <div style={{ ...mono, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, letterSpacing: ".07em", color: "var(--t6)", paddingRight: 22 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {unread && (
                      <span title="New — you haven't opened this report" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.6s ease infinite", flex: "none" }} />
                    )}
                    {bucketOf(r) === "insight" ? (
                      <span style={{ fontSize: 9, letterSpacing: ".08em", padding: "4px 12px", borderRadius: 100, border: "1px solid var(--acc)", color: "var(--acc)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.leadMetric ?? "KEY FINDING"}
                      </span>
                    ) : (
                      <span style={{ fontSize: 9, letterSpacing: ".08em", padding: "4px 12px", borderRadius: 100, border: `1px solid ${toneColor(r.tone)}`, color: toneColor(r.tone), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.label}
                      </span>
                    )}
                  </span>
                  <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {starred.has(r.sim_id) && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleStar(r.sim_id); }}
                        title="Starred — click to remove from favorites"
                        aria-label="Remove from favorites"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--acc)", display: "inline-flex" }}
                      >
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                      </button>
                    )}
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
                {renaming === r.sim_id ? (
                  <input
                    autoFocus
                    value={nameDraft}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void saveName(r.sim_id); }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => void saveName(r.sim_id)}
                    maxLength={80}
                    placeholder="Name this report"
                    style={{
                      width: "100%", boxSizing: "border-box", margin: "12px 0 0", padding: "4px 0",
                      background: "transparent", border: "none", borderBottom: "1px solid var(--acc)",
                      outline: "none", fontFamily: "var(--font-sans), sans-serif",
                      fontSize: 14.5, fontWeight: 600, color: "var(--t0)", caretColor: "var(--acc)",
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.4, margin: "12px 0 8px", color: "var(--t1)", ...clamp(r.name ? 2 : 3) }}>
                    {r.name ?? r.problem}
                  </div>
                )}
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t5)", ...clamp(3) }}>
                  {r.headline}
                </div>
                {collapsible && (
                  <>
                    <button
                      onClick={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.sim_id)) next.delete(r.sim_id); else next.add(r.sim_id);
                          return next;
                        });
                      }}
                      style={{ ...mono, display: "block", marginTop: 10, fontSize: 8.5, letterSpacing: ".1em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0 }}
                    >
                      {isOpen ? "▴ HIDE FULL BRIEF" : "▾ FULL BRIEF"}
                    </button>
                    {isOpen && (
                      <p style={{ margin: "8px 0 0", fontSize: 11.5, lineHeight: 1.6, color: "var(--t5)", maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", animation: "fadeUp .2s ease both" }}>
                        {r.problem}
                      </p>
                    )}
                  </>
                )}
                <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t7)", marginTop: 12 }}>
                  V{r.version}{g.versions > 1 ? ` OF ${g.versions}` : ""} · {r.mode.toUpperCase()} · {r.posts} POSTS · {r.dissents} DISSENT{r.dissents === 1 ? "" : "S"}
                </div>
              </Link>
              {/* every version is one click away — chips through 6, a picker beyond */}
              {g.versions > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", padding: "0 24px 16px" }}>
                  {g.versions <= 6 ? (
                    [...g.all].sort((a, b) => b.version - a.version).map((v) => (
                      <Link
                        key={v.id}
                        href={`/sim/${v.sim_id}/report?v=${v.version}`}
                        title={`${v.label} · ${new Date(v.created_at).toLocaleDateString()}${unreadOf(v.id) ? " · UNREAD" : ""}`}
                        style={{
                          ...mono, position: "relative", fontSize: 8, letterSpacing: ".05em", padding: "3px 9px", borderRadius: 100,
                          border: `1px solid ${v.version === r.version ? "var(--acc)" : "var(--ln4)"}`,
                          color: v.version === r.version ? "var(--acc)" : "var(--t6)",
                          background: v.version === r.version ? "var(--acc-dim)" : "transparent",
                        }}
                      >
                        V{v.version}
                        {/* per-version unread: an unopened V1 carries its own dot */}
                        {unreadOf(v.id) && (
                          <span style={{ position: "absolute", top: -2, right: -2, width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.6s ease infinite" }} />
                        )}
                      </Link>
                    ))
                  ) : (
                    <select
                      value={r.version}
                      onChange={(e) => router.push(`/sim/${r.sim_id}/report?v=${e.target.value}`)}
                      aria-label="Open a report version"
                      style={{ ...mono, fontSize: 9, letterSpacing: ".05em", padding: "4px 8px", borderRadius: 8, background: "var(--sf2)", border: "1px solid var(--ln4)", color: "var(--t3)", cursor: "pointer" }}
                    >
                      {[...g.all].sort((a, b) => b.version - a.version).map((v) => (
                        <option key={v.id} value={v.version}>
                          {unreadOf(v.id) ? "● " : ""}V{v.version} · {v.mode.toUpperCase()} · {new Date(v.created_at).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {linksFor === r.sim_id && (
                <div style={{ position: "absolute", top: 42, right: 12, zIndex: 45 }}>
                  <ShareLinksPanel simId={r.sim_id} onClose={() => setLinksFor(null)} />
                </div>
              )}
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
                <div ref={menuRef} style={{ position: "absolute", top: 42, right: 12, zIndex: 40 }}>
                  <CardMenu
                    header={`REPORT · V${r.version}${g.versions > 1 ? ` OF ${g.versions}` : ""}`}
                    entries={[
                      { key: "open", label: "Open the report", icon: MENU_ICONS.open, href: `/sim/${r.sim_id}/report` },
                      { key: "run", label: "View the run", icon: MENU_ICONS.run, href: `/sim/${r.sim_id}/run` },
                      { key: "star", label: starred.has(r.sim_id) ? "Remove from favorites" : "Add to favorites", icon: MENU_ICONS.star, onClick: () => { toggleStar(r.sim_id); setMenuFor(null); } },
                      { key: "share", label: "Share links…", icon: MENU_ICONS.share, onClick: () => { setLinksFor(r.sim_id); setMenuFor(null); } },
                      { key: "rename", label: "Rename", icon: MENU_ICONS.rename, onClick: () => { setNameDraft(r.name ?? ""); setRenaming(r.sim_id); setMenuFor(null); } },
                      {
                        key: "del", danger: true, icon: MENU_ICONS.trash, emphasized: confirmFor === r.id,
                        label: confirmFor === r.id ? `Really delete V${r.version}? The run stays` : `Delete V${r.version}${g.versions > 1 ? " (latest)" : ""}`,
                        onClick: () => (confirmFor === r.id ? void remove(r, false) : setConfirmFor(r.id)),
                      },
                      ...(g.versions > 1 ? [{
                        key: "delall", danger: true, icon: MENU_ICONS.trash, emphasized: confirmFor === `${r.id}-all`,
                        label: confirmFor === `${r.id}-all` ? `Really delete all ${g.versions}?` : `Delete all ${g.versions} versions`,
                        onClick: () => (confirmFor === `${r.id}-all` ? void remove(r, true) : setConfirmFor(`${r.id}-all`)),
                      }] : []),
                    ]}
                  />
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
            PAGE {page + 1}/{pages} · {total} {view === "flat" ? "VERSION" : "REPORT"}{total === 1 ? "" : "S"}
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
