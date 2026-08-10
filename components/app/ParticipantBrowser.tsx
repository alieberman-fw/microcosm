"use client";

/**
 * Full-page participant browser — the answer to "the little dialog can't do
 * justice to 1,800+ personas." Same smart search + filter rail + pagination
 * as the Agent Library, plus multi-select cards and a sticky launch bar.
 * Two homes: starting a CONVERSATION (default), and hand-picking a
 * simulation PANEL (`panel` prop — seats the picks via the agents API).
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
import { PackChipStrip, PackMemberRow } from "@/components/app/Packs";
import type { PackSummary } from "@/lib/packs";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const MAX_PARTICIPANTS = 20;

export interface BrowserCustomRow {
  id: string;
  kind: string;
  spec: PersonaSpec;
}

interface Pick_ {
  key: string;
  name: string;
  initials: string;
  role: string;
  kind: string;
  source: string;
  spec: PersonaSpec;
  /** panel mode: does this pick speak (lead) or get polled (crowd)? */
  tier: "lead" | "crowd";
}

const MAX_MANUAL_CROWD = 200;

function demoLine(spec: PersonaSpec) {
  const d = spec.demographics;
  if (!d) return null;
  const place = [d.metro, d.state].filter(Boolean).join(", ");
  return [d.age, place].filter(Boolean).join(" · ") || null;
}

export default function ParticipantBrowser({
  custom, library, libraryCount, facets, panel = null,
}: {
  custom: BrowserCustomRow[];
  library: LibraryRow[];
  libraryCount: number;
  facets: LibraryFacets;
  /** hand-pick a simulation panel instead of starting a conversation */
  panel?: { simId: string; seated: number } | null;
}) {
  const router = useRouter();
  const maxPicks = panel ? Math.max(0, MAX_PARTICIPANTS - panel.seated) : MAX_PARTICIPANTS;
  const [error, setError] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(true);
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
  const leadPicks = picks.filter((p) => p.tier === "lead");
  const crowdPicks = picks.filter((p) => p.tier === "crowd");
  const toggle = (c: { key: string; kind: string; source: string; spec: PersonaSpec }) => {
    setPicks((ps) => {
      if (ps.some((p) => p.key === c.key)) return ps.filter((p) => p.key !== c.key);
      const leads = ps.filter((p) => p.tier === "lead").length;
      // new picks land as LEADS while capacity lasts, then flow into the crowd
      const tier: Pick_["tier"] = !panel || leads < maxPicks ? "lead" : "crowd";
      if (!panel && ps.length >= maxPicks) return ps;
      if (panel && tier === "crowd" && ps.length - leads >= MAX_MANUAL_CROWD) return ps;
      return [...ps, { key: c.key, name: c.spec.name, initials: c.spec.initials, role: c.spec.role, kind: c.kind, source: c.source, spec: c.spec, tier }];
    });
  };
  const setTier = (key: string, tier: Pick_["tier"]) => {
    setPicks((ps) => {
      if (tier === "lead" && ps.filter((p) => p.tier === "lead").length >= maxPicks) return ps;
      return ps.map((p) => (p.key === key ? { ...p, tier } : p));
    });
  };

  // one click applies a whole pack: panel members → leads (overflow rules
  // as above), crowd-pack members → crowd (panel mode) or participants
  const [packNote, setPackNote] = useState<string | null>(null);
  const applyPack = (pack: PackSummary, members: PackMemberRow[]) => {
    setPackNote(null);
    setPicks((ps) => {
      const next = [...ps];
      let added = 0;
      for (const m of members) {
        if (next.some((p) => p.key === m.id)) continue;
        const leads = next.filter((p) => p.tier === "lead").length;
        const crowds = next.length - leads;
        let tier: Pick_["tier"];
        if (!panel) {
          if (next.length >= maxPicks) break;
          tier = "lead";
        } else if (pack.kind === "crowd") {
          if (crowds >= MAX_MANUAL_CROWD) break;
          tier = "crowd";
        } else {
          tier = leads < maxPicks ? "lead" : "crowd";
          if (tier === "crowd" && crowds >= MAX_MANUAL_CROWD) break;
        }
        next.push({ key: m.id, name: m.spec.name, initials: m.spec.initials, role: m.spec.role, kind: m.kind, source: "library", spec: m.spec, tier });
        added++;
      }
      if (added < members.length) {
        setPackNote(`${pack.name.toUpperCase()} — ADDED ${added} OF ${members.length}${!panel ? ` (ROOMS CAP AT ${MAX_PARTICIPANTS})` : ""}`);
      }
      return next;
    });
  };

  const start = async () => {
    if (!picks.length || launching) return;
    setLaunching(true);
    if (!panel) {
      router.push(`/conversations?draft=${picks.map((p) => p.key).join(",")}`);
      return;
    }
    try {
      const res = await fetch(`/api/simulations/${panel.simId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaIds: leadPicks.map((p) => p.key),
          crowdPersonaIds: crowdPicks.map((p) => p.key),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not seat the panel");
      router.refresh();
      router.push(`/sim/${panel.simId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not seat the panel");
      setLaunching(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 140px" }}>
      <Link href={panel ? `/sim/${panel.simId}` : "/conversations"} style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
        {panel ? "← BACK TO THE SIMULATION" : "← CONVERSATIONS"}
      </Link>
      <div style={{ marginTop: 18 }}>
        <div className="kicker">{panel ? "Hand-pick the panel" : "New conversation"}</div>
        <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>{panel ? "Cast the room yourself" : "Build the room"}</h1>
        <p style={{ margin: "12px 0 0", maxWidth: 620, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
          {panel
            ? <>Pick lead seats from {libraryCount.toLocaleString()} personas — search in plain language, filter, click cards to select, then seat them on the panel. {panel.seated > 0 ? `${panel.seated} already seated · ` : ""}up to {maxPicks} more. No model calls.</>
            : <>Pick anyone from {libraryCount.toLocaleString()} personas — one expert or a room of {MAX_PARTICIPANTS}. Search in plain language, filter, click cards to add them, then start the conversation.</>}
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

      <div style={{ marginTop: 16 }}>
        <PackChipStrip label="YOUR PACKS" onApply={applyPack} />
        {packNote && <div style={{ ...mono, marginTop: 8, fontSize: 9, letterSpacing: ".06em", color: "var(--warn)" }}>{packNote}</div>}
      </div>

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
              {panel
                ? `${leadPicks.length}/${maxPicks} LEADS${crowdPicks.length ? ` · ${crowdPicks.length} CROWD` : ""}`
                : `${picks.length} / ${maxPicks} IN THE ROOM`}
            </span>
            <button
              onClick={() => setRosterOpen((v) => !v)}
              style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", background: "none", border: "1px solid var(--ln5)", borderRadius: 100, padding: "4px 12px", color: rosterOpen ? "var(--acc)" : "var(--t5)", cursor: "pointer" }}
            >
              {rosterOpen ? "HIDE ROSTER →" : "← SHOW ROSTER"}
            </button>
            <button onClick={() => setPicks([])} style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer" }}>
              CLEAR
            </button>
            {error && <span style={{ ...mono, fontSize: 9.5, color: "var(--warn)" }}>{error.toUpperCase().slice(0, 80)}</span>}
            <span style={{ flex: 1 }} />
            <button onClick={() => void start()} disabled={launching} className="btnAcc" style={{ padding: "12px 26px", fontSize: 14, opacity: launching ? 0.6 : 1 }}>
              {launching
                ? panel ? "Seating…" : "Opening…"
                : panel
                ? `Seat ${leadPicks.length} lead${leadPicks.length === 1 ? "" : "s"}${crowdPicks.length ? ` + ${crowdPicks.length} crowd` : ""} →`
                : picks.length === 1 ? `Start with ${picks[0].name.split(" ")[0]}` : `Start group with ${picks.length}`}
            </button>
          </div>
        </div>
      )}

      {/* collapsible selected-roster rail: everyone you've picked, clickable
          for the full profile; panel mode adds the LEAD / CROWD assignment */}
      {picks.length > 0 && rosterOpen && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: picks.length > 0 ? 72 : 0, zIndex: 65, width: 300,
          background: "var(--sf)", borderLeft: "1px solid var(--ln3)", display: "flex", flexDirection: "column",
          animation: "fadeUp .2s ease both",
        }}>
          <div style={{ padding: "18px 20px 12px", borderBottom: "1px solid var(--ln2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--t6)" }}>
              YOUR SELECTION · {picks.length}
            </span>
            <button onClick={() => setRosterOpen(false)} aria-label="Collapse roster" style={{ background: "none", border: "none", color: "var(--t5)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>→</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
            {panel && (
              <div style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)", lineHeight: 1.7, padding: "4px 6px 10px" }}>
                LEADS SPEAK IN THE DELIBERATION · CROWD MEMBERS ARE POLLED FOR SENTIMENT EVERY ROUND
              </div>
            )}
            {picks.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 6px", borderBottom: "1px solid var(--ln2)" }}>
                <span style={{ ...mono, width: 28, height: 28, borderRadius: "50%", flex: "none", background: p.tier === "crowd" ? "var(--sf2)" : "var(--acc-dim)", border: `1px solid ${p.tier === "crowd" ? "var(--ln5)" : "var(--acc)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, color: p.tier === "crowd" ? "var(--t4)" : "var(--acc)" }}>
                  {p.initials}
                </span>
                <button
                  onClick={() => setProfile({ kind: p.kind, spec: p.spec, chatKey: p.key, source: p.source })}
                  style={{ minWidth: 0, flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  title="View profile"
                >
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sans), sans-serif" }}>{p.name}</span>
                  <span style={{ display: "block", fontSize: 10, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sans), sans-serif" }}>{p.role}</span>
                </button>
                {panel && (
                  <span style={{ display: "inline-flex", gap: 3, flex: "none" }}>
                    {(["lead", "crowd"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTier(p.key, t)}
                        title={t === "lead" ? "Speaks in the deliberation" : "Polled for sentiment"}
                        style={{
                          ...mono, fontSize: 7.5, letterSpacing: ".04em", padding: "2px 7px", borderRadius: 100, cursor: "pointer",
                          background: p.tier === t ? "var(--acc-dim)" : "transparent",
                          border: `1px solid ${p.tier === t ? "var(--acc)" : "var(--ln4)"}`,
                          color: p.tier === t ? "var(--acc)" : "var(--t6)",
                        }}
                      >
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </span>
                )}
                <button
                  onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))}
                  aria-label={`Remove ${p.name}`}
                  style={{ background: "none", border: "none", color: "var(--t7)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0, flex: "none" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile && (
        <PersonaProfile {...profile} onClose={() => setProfile(null)} showChatCta={false} />
      )}
    </div>
  );
}
