"use client";

/**
 * Full-page participant browser for starting a conversation — the answer to
 * "the little dialog can't do justice to 1,800+ personas." Same smart search
 * + filter rail + pagination as the Agent Library, plus multi-select cards
 * and a sticky bar that launches the room (up to 20 voices).
 */

import { CSSProperties, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PersonaSpec } from "@/lib/personas";
import PersonaProfile, { kindChip } from "@/components/app/PersonaProfile";
import {
  LibraryRow, LibraryFacets, Filters, NO_FILTERS, AGE_BANDS, PAGE_SIZE,
  FilterRail, useLibrarySearch,
} from "@/components/app/LibraryBrowse";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const MAX_PARTICIPANTS = 20;

export interface BrowserCustomRow {
  id: string;
  kind: string;
  spec: PersonaSpec;
}

interface Pick_ { key: string; name: string; initials: string }

function demoLine(spec: PersonaSpec) {
  const d = spec.demographics;
  if (!d) return null;
  const place = [d.metro, d.state].filter(Boolean).join(", ");
  return [d.age, place].filter(Boolean).join(" · ") || null;
}

export default function ParticipantBrowser({
  custom, library, libraryCount, facets,
}: {
  custom: BrowserCustomRow[];
  library: LibraryRow[];
  libraryCount: number;
  facets: LibraryFacets;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [picks, setPicks] = useState<Pick_[]>([]);
  const [profile, setProfile] = useState<{ kind: string; spec: PersonaSpec; chatKey: string; source: string } | null>(null);
  const [launching, setLaunching] = useState(false);

  const q = search.trim();
  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOpenFilter(null);
    setPage(0);
  };
  useEffect(() => { setPage(0); }, [q]);

  const { rows, total, smart, searching, pristine } = useLibrarySearch({
    active: true, q, filters, page, initialRows: library, initialCount: libraryCount,
  });

  // custom personas ride along, filtered client-side, pinned before library rows
  const ql = q.toLowerCase();
  const band = filters.age ? AGE_BANDS[filters.age] : null;
  const customFiltered = custom
    .filter((c) => !ql || [c.spec.name, c.spec.role, c.spec.backstory].join(" ").toLowerCase().includes(ql))
    .filter((c) => !filters.kind || c.kind === filters.kind)
    .filter((c) => !filters.cat)
    .filter((c) => {
      if (!band) return true;
      const age = c.spec.demographics?.age;
      return typeof age === "number" && age >= (band.min ?? 0) && age <= (band.max ?? 200);
    })
    .filter((c) => !filters.tenure || (c.spec.demographics?.tenure ?? "").toLowerCase().includes(filters.tenure));

  const cards: { key: string; kind: string; spec: PersonaSpec; source: string }[] = [
    ...(page === 0 ? customFiltered.map((c) => ({ key: c.id, kind: c.kind, spec: c.spec, source: "custom" })) : []),
    ...rows.map((r) => ({ key: r.id, kind: r.kind, spec: r.spec, source: "library" })),
  ];

  const picked = (key: string) => picks.some((p) => p.key === key);
  const toggle = (c: { key: string; spec: PersonaSpec }) => {
    setPicks((ps) => {
      if (ps.some((p) => p.key === c.key)) return ps.filter((p) => p.key !== c.key);
      if (ps.length >= MAX_PARTICIPANTS) return ps;
      return [...ps, { key: c.key, name: c.spec.name, initials: c.spec.initials }];
    });
  };

  const start = () => {
    if (!picks.length || launching) return;
    setLaunching(true);
    router.push(`/conversations?draft=${picks.map((p) => p.key).join(",")}`);
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 140px" }}>
      <Link href="/conversations" style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
        ← CONVERSATIONS
      </Link>
      <div style={{ marginTop: 18 }}>
        <div className="kicker">New conversation</div>
        <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>Build the room</h1>
        <p style={{ margin: "12px 0 0", maxWidth: 620, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
          Pick anyone from {libraryCount.toLocaleString()} personas — one expert or a room of {MAX_PARTICIPANTS}. Search in plain language, filter, click cards to add them, then start the conversation.
        </p>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Try “looking to build a data center” or “under 40 homeowner”…"
        autoFocus
        style={{ width: "100%", boxSizing: "border-box", marginTop: 26, background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "12px 20px", fontSize: 14, color: "var(--t1)", outline: "none" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
      />

      <FilterRail facets={facets} filters={filters} openFilter={openFilter} setOpenFilter={setOpenFilter} onFilter={setFilter} />

      {(q || !pristine) && !searching && (
        <div style={{ ...mono, marginTop: 14, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
          {total === 0 && customFiltered.length === 0 ? "NO MATCHES — TRY BROADER LANGUAGE OR CLEAR A FILTER" : `${(total + (q || filters.kind || filters.age || filters.tenure ? customFiltered.length : 0)).toLocaleString()} MATCH${total === 1 ? "" : "ES"}`}
          {smart && <span style={{ color: "var(--acc)" }}> · AI-MATCHED</span>}
        </div>
      )}

      <div className="grid3" style={{ marginTop: 24 }}>
        {cards.map((c) => {
          const on = picked(c.key);
          const dl = demoLine(c.spec);
          const isCustom = c.source === "custom";
          return (
            <div
              key={c.key}
              className="card cardHoverQuiet"
              onClick={() => toggle(c)}
              style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10, cursor: "pointer", ...(on ? { borderColor: "var(--acc)", background: "var(--acc-dim)" } : {}), opacity: searching ? 0.55 : 1, transition: "opacity .2s" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...mono, width: 38, height: 38, borderRadius: "50%", background: isCustom ? "var(--acc-dim)" : "var(--sf2)", border: `1px solid ${isCustom ? "var(--acc)" : "var(--ln5)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: isCustom ? "var(--acc)" : "var(--t2)", flex: "none" }}>
                  {c.spec.initials}
                </span>
                <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {isCustom && <span style={{ ...kindChip(false), color: "var(--acc)", borderColor: "var(--acc)" }}>YOURS</span>}
                  <span style={kindChip(c.kind === "adversarial")}>{c.kind === "adversarial" ? "ADVERSARIAL" : c.spec.discipline ?? c.kind}</span>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", flex: "none", border: `1px solid ${on ? "var(--acc)" : "var(--ln6)"}`, background: on ? "var(--acc)" : "transparent", color: "var(--acc-c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                    {on ? "✓" : ""}
                  </span>
                </span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{c.spec.name}</h3>
                <div style={{ fontSize: 12.5, color: "var(--t5)", marginTop: 3 }}>{c.spec.role}</div>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--t6)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {c.spec.tagline || c.spec.backstory}
              </p>
              <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setProfile({ kind: c.kind, spec: c.spec, chatKey: c.key, source: c.source }); }}
                  style={{ ...mono, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 10.5, letterSpacing: ".06em", color: "var(--acc)" }}
                >
                  VIEW PROFILE →
                </button>
                {dl && <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".04em", color: "var(--t7)" }}>{dl}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{ ...mono, fontSize: 10, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, cursor: page === 0 ? "default" : "pointer", border: "1px solid var(--ln5)", background: "var(--sf2)", color: page === 0 ? "var(--t7)" : "var(--t3)", opacity: page === 0 ? 0.45 : 1 }}
          >
            ‹ PREV
          </button>
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>
            PAGE {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} · {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} OF {total.toLocaleString()}
          </span>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            style={{ ...mono, fontSize: 10, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, cursor: (page + 1) * PAGE_SIZE >= total ? "default" : "pointer", border: "1px solid var(--ln5)", background: "var(--sf2)", color: (page + 1) * PAGE_SIZE >= total ? "var(--t7)" : "var(--t3)", opacity: (page + 1) * PAGE_SIZE >= total ? 0.45 : 1 }}
          >
            NEXT ›
          </button>
        </div>
      )}

      {/* sticky launch bar — selections persist across pages and searches */}
      {picks.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 70, background: "var(--navbg)", backdropFilter: "blur(14px)", borderTop: "1px solid var(--ln3)" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 40px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "flex" }}>
              {picks.slice(0, 8).map((p, i) => (
                <span key={p.key} title={p.name} style={{ ...mono, width: 30, height: 30, borderRadius: "50%", background: "var(--acc-dim)", border: "1px solid var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, color: "var(--acc)", marginLeft: i ? -8 : 0, position: "relative", zIndex: 8 - i }}>
                  {p.initials}
                </span>
              ))}
              {picks.length > 8 && (
                <span style={{ ...mono, alignSelf: "center", marginLeft: 8, fontSize: 10, color: "var(--t5)" }}>+{picks.length - 8}</span>
              )}
            </span>
            <span style={{ ...mono, fontSize: 10, letterSpacing: ".07em", color: "var(--t5)" }}>
              {picks.length} / {MAX_PARTICIPANTS} IN THE ROOM
            </span>
            <button onClick={() => setPicks([])} style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer" }}>
              CLEAR
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={start} disabled={launching} className="btnAcc" style={{ padding: "12px 26px", fontSize: 14, opacity: launching ? 0.6 : 1 }}>
              {launching ? "Opening…" : picks.length === 1 ? `Start with ${picks[0].name.split(" ")[0]}` : `Start group with ${picks.length}`}
            </button>
          </div>
        </div>
      )}

      {profile && (
        <PersonaProfile {...profile} onClose={() => setProfile(null)} showChatCta={false} />
      )}
    </div>
  );
}
