"use client";

/**
 * Dashboard simulation cards with a hover ⋮ menu (same pattern as custom
 * persona cards): Edit brief → the workspace; Delete → two-step confirm →
 * DELETE /api/simulations/[id] (documents, chunks, storage, Files API
 * objects, cast — everything goes).
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import CardMenu, { MENU_ICONS } from "@/components/app/CardMenu";
import StarButton from "@/components/app/StarButton";
import { mergePrefs, toggleId } from "@/lib/prefs";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface SimCardRow {
  id: string;
  status: string;
  created_at: string;
  problem: string;
  /** display name: the user's rename, else the understanding pass's title */
  name?: string | null;
  /** the contract's mirror prose — the card's summary line */
  summary?: string | null;
  questionCount: number;
  docCount: number;
  /** lead seats only — crowd members are counted separately */
  seatCount: number;
  crowdCount?: number;
  mode?: string | null;
  runPosts?: number | null;
  reportCount?: number;
}

const PAGE = 12;

export default function SimCards({ initialSims, initialStarred = [] }: { initialSims: SimCardRow[]; initialStarred?: string[] }) {
  const router = useRouter();
  const [sims, setSims] = useState(initialSims);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "ran" | "draft" | "reported">("all");
  const [page, setPage] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // FULL BRIEF open per card
  const [renaming, setRenaming] = useState<string | null>(null);
  // favorites + view + sort (1b)
  const [starred, setStarred] = useState<Set<string>>(new Set(initialStarred));
  const [favOnly, setFavOnly] = useState(false);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [sort, setSort] = useState<"newest" | "name">("newest");
  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = toggleId([...prev], id);
      void mergePrefs({ starred_sims: next });
      return new Set(next);
    });
  };
  const [nameDraft, setNameDraft] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const saveName = async (id: string) => {
    const name = nameDraft.trim().slice(0, 80);
    setRenaming(null);
    setSims((prev) => prev.map((s) => (s.id === id ? { ...s, name: name || null } : s)));
    await fetch(`/api/simulations/${id}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFor(null);
        setConfirmFor(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const remove = async (id: string) => {
    setDeleting(id);
    const res = await fetch(`/api/simulations/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSims((prev) => prev.filter((s) => s.id !== id));
      router.refresh();
    }
    setDeleting(null);
    setMenuFor(null);
    setConfirmFor(null);
  };

  const visible = sims.filter((s) => {
    if (favOnly && !starred.has(s.id)) return false;
    if (q.trim() && !`${s.name ?? ""} ${s.problem}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === "ran") return !!s.runPosts;
    if (filter === "draft") return !s.runPosts;
    if (filter === "reported") return (s.reportCount ?? 0) > 0;
    return true;
  }).sort((a, b) =>
    (Number(starred.has(b.id)) - Number(starred.has(a.id)))
    || (sort === "name"
      ? (a.name ?? a.problem).localeCompare(b.name ?? b.problem)
      : +new Date(b.created_at) - +new Date(a.created_at)));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const pageRows = visible.slice(page * PAGE, (page + 1) * PAGE);
  const pill = (on: boolean): CSSProperties => ({
    fontFamily: "var(--font-mono), monospace", fontSize: 9, letterSpacing: ".05em", padding: "5px 12px",
    borderRadius: 100, cursor: "pointer", background: on ? "var(--acc-dim)" : "transparent",
    border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`, color: on ? "var(--acc)" : "var(--t6)",
  });

  return (
    <>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 26 }}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setPage(0); }}
        placeholder="Search simulations…"
        style={{ flex: 1, minWidth: 220, maxWidth: 380, padding: "10px 16px", background: "var(--sf)", border: "1px solid var(--ln3)", borderRadius: 100, fontFamily: "var(--font-sans), sans-serif", fontSize: 13, color: "var(--t1)", outline: "none" }}
      />
      {([["all", "ALL"], ["ran", "RAN"], ["draft", "NOT RUN"], ["reported", "HAS REPORT"]] as const).map(([k, l]) => (
        <button key={k} onClick={() => { setFilter(k); setPage(0); }} style={pill(filter === k)}>
          {l} {k === "all" ? sims.length : sims.filter((x) => (k === "ran" ? !!x.runPosts : k === "draft" ? !x.runPosts : (x.reportCount ?? 0) > 0)).length}
        </button>
      ))}
      <button onClick={() => { setFavOnly((v) => !v); setPage(0); }} title="Show only starred simulations" style={pill(favOnly)}>
        ★ FAVORITES{favOnly ? ` ${starred.size}` : ""}
      </button>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
        <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>SORT</span>
        {([["newest", "NEWEST"], ["name", "NAME"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} style={pill(sort === k)}>{l}</button>
        ))}
        {([["cards", "▦ CARDS"], ["list", "☰ LIST"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setView(k); setPage(0); }} title={k === "cards" ? "Card grid" : "Compact rows"} style={pill(view === k)}>{l}</button>
        ))}
      </span>
    </div>
    {/* ☰ LIST (1b): compact rows, same data — favorites float first */}
    {view === "list" && (
      <div style={{ marginTop: 22, border: "1px solid var(--ln3)", borderRadius: 14, background: "var(--sf)", overflow: "hidden" }}>
        {pageRows.map((s, i) => (
          <Link
            key={s.id}
            href={`/sim/${s.id}`}
            className="rowGo"
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid var(--ln1)" }}
          >
            {s.status === "running" ? (
              <span title="Run in progress" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite", flex: "none" }} />
            ) : (
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.status === "complete" ? "var(--acc)" : "var(--ln5)", flex: "none" }} />
            )}
            <StarButton alwaysVisible on={starred.has(s.id)} onToggle={() => toggleStar(s.id)} style={{ flex: "none", width: 20, height: 20 }} />
            <span style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.name ?? s.problem}
            </span>
            {s.runPosts ? (
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--acc)", border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 100, padding: "2px 9px", flex: "none" }}>
                RAN · {(s.mode ?? "AGORA").toUpperCase()} · {s.runPosts} POSTS
              </span>
            ) : (
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "2px 9px", flex: "none" }}>
                NOT RUN
              </span>
            )}
            {(s.reportCount ?? 0) > 0 && (
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t4)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "2px 9px", flex: "none" }}>
                {s.reportCount} REPORT{(s.reportCount ?? 0) > 1 ? "S" : ""}
              </span>
            )}
            <span style={{ ...mono, fontSize: 8.5, color: "var(--t7)", flex: "none" }}>{new Date(s.created_at).toLocaleDateString()}</span>
          </Link>
        ))}
        {pageRows.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--t6)", padding: "16px 18px" }}>Nothing matches these filters.</p>
        )}
      </div>
    )}

    <div className="grid3" style={{ marginTop: 22, display: view === "cards" ? undefined : "none" }}>
      {pageRows.map((s) => {
        const meta = [
          s.questionCount ? `${s.questionCount} QUESTIONS` : null,
          s.docCount ? `${s.docCount} DOC${s.docCount > 1 ? "S" : ""}` : null,
          s.seatCount ? `${s.seatCount} LEADS` : null,
          s.crowdCount ? `${s.crowdCount} CROWD` : null,
        ].filter(Boolean).join(" · ") || "BRIEF ONLY";
        const menuOpen = menuFor === s.id;
        const isOpen = expanded.has(s.id);
        const title = s.name ?? null;
        // no name and a long free-form brief → clamp the problem; a name (or
        // a short problem) reads as the headline and the full ask collapses
        const clamp = (n: number): CSSProperties => ({ display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", overflow: "hidden" });
        const collapsible = Boolean(title) || s.problem.length > 220;
        return (
          <div key={s.id} className="card simCard" style={{ position: "relative", opacity: deleting === s.id ? 0.4 : 1, transition: "opacity .2s" }}>
            <Link href={`/sim/${s.id}`} style={{ display: "block", padding: "26px 28px" }}>
              <div style={{ ...mono, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, letterSpacing: ".07em", color: "var(--t6)", paddingRight: 22 }}>
                <span>{new Date(s.created_at).toLocaleDateString()}</span>
                {s.status === "running" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--acc)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite" }} />
                    LIVE
                  </span>
                ) : (
                  <span style={{ color: s.status === "complete" ? "var(--acc)" : "var(--t5)" }}>{s.status.toUpperCase()}</span>
                )}
              </div>
              {renaming === s.id ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void saveName(s.id); }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => void saveName(s.id)}
                  maxLength={80}
                  placeholder="Name this simulation"
                  style={{
                    width: "100%", boxSizing: "border-box", margin: "14px 0 0", padding: "4px 0",
                    background: "transparent", border: "none", borderBottom: "1px solid var(--acc)",
                    outline: "none", fontFamily: "var(--font-sans), sans-serif",
                    fontSize: 16.5, fontWeight: 600, color: "var(--t0)", caretColor: "var(--acc)",
                  }}
                />
              ) : (
                <h3 style={{ margin: "14px 0 0", fontSize: 16.5, fontWeight: 600, lineHeight: 1.35, color: "var(--t1)", ...(title ? {} : clamp(4)) }}>
                  {title ?? s.problem}
                </h3>
              )}
              {title && (
                <p style={{ margin: "9px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--t5)", ...clamp(3) }}>
                  {s.summary ?? s.problem}
                </p>
              )}
              {collapsible && (
                <>
                  <button
                    onClick={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                        return next;
                      });
                    }}
                    style={{ ...mono, display: "block", marginTop: 10, fontSize: 8.5, letterSpacing: ".1em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0 }}
                  >
                    {isOpen ? "▴ HIDE FULL BRIEF" : "▾ FULL BRIEF"}
                  </button>
                  {isOpen && (
                    <p style={{ margin: "8px 0 0", fontSize: 11.5, lineHeight: 1.6, color: "var(--t5)", maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", animation: "fadeUp .2s ease both" }}>
                      {s.problem}
                    </p>
                  )}
                </>
              )}
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", marginTop: 14 }}>{meta}</div>
              {(s.runPosts || (s.reportCount ?? 0) > 0) && (
                <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {s.runPosts ? (
                    <span style={{ color: "var(--acc)", border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 100, padding: "2px 9px" }}>
                      RAN · {s.mode?.toUpperCase() ?? "AGORA"} · {s.runPosts} POSTS
                    </span>
                  ) : null}
                  {(s.reportCount ?? 0) > 0 && (
                    <span style={{ color: "var(--t4)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "2px 9px" }}>
                      {s.reportCount} REPORT{(s.reportCount ?? 0) > 1 ? "S" : ""} · V{s.reportCount}
                    </span>
                  )}
                </div>
              )}
            </Link>

            <StarButton
              on={starred.has(s.id)}
              onToggle={() => toggleStar(s.id)}
              style={{ position: "absolute", top: 14, right: 42 }}
            />
            {/* hover ⋮ */}
            <button
              className="rowActions"
              onClick={(e) => { e.preventDefault(); setMenuFor(menuOpen ? null : s.id); setConfirmFor(null); }}
              aria-label="Simulation actions"
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
                  header={`SIMULATION · ${s.status.toUpperCase()}`}
                  entries={[
                    { key: "edit", label: "Edit brief & setup", icon: MENU_ICONS.open, href: `/sim/${s.id}` },
                    ...(s.runPosts ? [{ key: "run", label: "Open the run", icon: MENU_ICONS.run, href: `/sim/${s.id}/run` }] : []),
                    ...((s.reportCount ?? 0) > 0 ? [{ key: "report", label: `View report${(s.reportCount ?? 0) > 1 ? "s" : ""}`, icon: MENU_ICONS.open, href: `/sim/${s.id}/report` }] : []),
                    { key: "star", label: starred.has(s.id) ? "Remove from favorites" : "Add to favorites", icon: MENU_ICONS.star, onClick: () => { toggleStar(s.id); setMenuFor(null); } },
                    { key: "rename", label: "Rename", icon: MENU_ICONS.rename, onClick: () => { setRenaming(s.id); setNameDraft(s.name ?? ""); setMenuFor(null); } },
                    {
                      key: "del", danger: true, icon: MENU_ICONS.trash, emphasized: confirmFor === s.id,
                      label: confirmFor === s.id ? "Really delete? This removes everything" : "Delete simulation",
                      onClick: () => (confirmFor === s.id ? void remove(s.id) : setConfirmFor(s.id)),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* field fix: no duplicate "+ NEW SIMULATION" card — the header button
          owns creation. Only an EMPTY dashboard gets a pointer. */}
      {visible.length === 0 && (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--t6)", gridColumn: "1 / -1", padding: "18px 4px" }}>
          Nothing yet — hit <Link href="/sim/new" style={{ color: "var(--acc)" }}>New simulation</Link> above to state your first hard question and cast the room.
        </p>
      )}

    </div>
    {pages > 1 && (
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, fontFamily: "var(--font-mono), monospace", fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)" }}>
        <button disabled={page === 0} onClick={() => setPage((x) => Math.max(0, x - 1))} style={{ ...pill(false), cursor: page === 0 ? "default" : "pointer", color: page === 0 ? "var(--t7)" : "var(--t4)" }}>← PREV</button>
        <span>PAGE {page + 1} / {pages} · {visible.length} SIMULATIONS</span>
        <button disabled={page >= pages - 1} onClick={() => setPage((x) => Math.min(pages - 1, x + 1))} style={{ ...pill(false), cursor: page >= pages - 1 ? "default" : "pointer", color: page >= pages - 1 ? "var(--t7)" : "var(--t4)" }}>NEXT →</button>
      </div>
    )}
    </>
  );
}
