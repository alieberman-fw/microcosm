"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PersonaSpec } from "@/lib/personas";
import PersonaProfile, { kindChip } from "@/components/app/PersonaProfile";
import PersonaEditor, { EditorSource } from "@/components/app/PersonaEditor";
import {
  LibraryRow, LibraryFacets, Filters, NO_FILTERS, AGE_BANDS, PAGE_SIZE,
  FilterRail, useLibrarySearch,
} from "@/components/app/LibraryBrowse";

// re-exported for existing imports (personas/page.tsx)
export type { LibraryRow, LibraryFacets } from "@/components/app/LibraryBrowse";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface CustomPersonaRow {
  id: string;
  kind: string;
  spec: PersonaSpec;
  source: string;
  created_at: string;
}

/** One demographic line for cards: "54 · Columbus, OH". */
function demoLine(spec: PersonaSpec) {
  const d = spec.demographics;
  if (!d) return null;
  const place = [d.metro, d.state].filter(Boolean).join(", ");
  return [d.age, place].filter(Boolean).join(" · ") || null;
}

function ShimCard() {
  return (
    <div className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 12 }}>
      {[38, 16, 12, 12].map((h, i) => (
        <div key={i} style={{
          height: h, width: i === 0 ? 38 : `${88 - i * 16}%`, borderRadius: i === 0 ? "50%" : 6,
          background: "linear-gradient(90deg, var(--sf2) 25%, var(--ln2) 50%, var(--sf2) 75%)",
          backgroundSize: "400px 100%", animation: "shim 1.2s linear infinite",
        }} />
      ))}
    </div>
  );
}

export default function PersonaManager({
  orgId, initial, library, libraryCount, facets,
}: {
  orgId: string; initial: CustomPersonaRow[]; library: LibraryRow[]; libraryCount: number; facets: LibraryFacets;
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<"library" | "custom">("library");
  const [custom, setCustom] = useState<CustomPersonaRow[]>(initial);
  const [editor, setEditor] = useState<{ mode: "create" | "edit" | "remix"; source?: EditorSource | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // custom-card ⋮ menu + subtle bulk selection
  const [cardMenu, setCardMenu] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const exitSelect = () => { setSelectMode(false); setSelected([]); setConfirmBulk(false); };

  const toggleSel = (id: string) => {
    setConfirmBulk(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const bulkDelete = async () => {
    const ids = selected;
    if (!ids.length) return;
    setCustom((cs) => cs.filter((c) => !ids.includes(c.id)));
    exitSelect();
    const { error } = await supabase!.from("personas").delete().in("id", ids);
    if (error) setErr(error.message);
  };

  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState<{ kind: string; spec: PersonaSpec; chatKey: string; source: string } | null>(null);

  // filter rail + pagination — composes with the tab AND the search query
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const q = search.trim();

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOpenFilter(null);
    setPage(0);
  };

  // reset to page 0 whenever the query changes
  useEffect(() => { setPage(0); }, [q]);

  const { rows: libRows, total, smart, searching, pristine, anyFilter } = useLibrarySearch({
    active: tab === "library", q, filters, page, initialRows: library, initialCount: libraryCount,
  });

  // custom tab: same rail, applied client-side (category doesn't apply —
  // custom personas aren't taxonomy-classified)
  const ql = q.toLowerCase();
  const band = filters.age ? AGE_BANDS[filters.age] : null;
  const customFiltered = custom
    .filter((c) => !ql || [c.spec.name, c.spec.role, c.spec.backstory].join(" ").toLowerCase().includes(ql))
    .filter((c) => !filters.kind || c.kind === filters.kind)
    .filter((c) => {
      if (!band) return true;
      const age = c.spec.demographics?.age;
      return typeof age === "number" && age >= (band.min ?? 0) && age <= (band.max ?? 200);
    })
    .filter((c) => !filters.tenure || (c.spec.demographics?.tenure ?? "").toLowerCase().includes(filters.tenure))
    .sort((a, b) => {
      const ageOf = (r: CustomPersonaRow) => r.spec.demographics?.age ?? 999;
      switch (filters.sort) {
        case "age_asc": return ageOf(a) - ageOf(b);
        case "age_desc": return ageOf(b) - ageOf(a);
        case "newest": return b.created_at.localeCompare(a.created_at);
        case "name": return a.spec.name.localeCompare(b.spec.name);
        default: return 0;
      }
    });

  const handleSaved = (row: CustomPersonaRow) => {
    setCustom((cs) => {
      const ix = cs.findIndex((c) => c.id === row.id);
      if (ix >= 0) { const next = [...cs]; next[ix] = row; return next; }
      return [row, ...cs];
    });
    setEditor(null);
    setProfile(null);
    setTab("custom");
  };

  // lineage ancestors are clickable — open their profile (library or custom)
  const openAncestor = async (key: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(key)) return;
    const { data } = await supabase!.from("personas").select("id, kind, spec, source").eq("id", key).maybeSingle();
    if (data) {
      setProfile({ kind: data.kind as string, spec: data.spec as PersonaSpec, chatKey: data.id as string, source: (data.source as string) === "library" ? "library" : "custom" });
    } else {
      setErr("That ancestor is no longer in the library.");
    }
  };

  const remove = async (id: string) => {
    const prev = custom;
    setCustom(custom.filter((c) => c.id !== id));
    const { error } = await supabase!.from("personas").delete().eq("id", id);
    if (error) { setCustom(prev); setErr(error.message); }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="kicker">Agent Library</div>
          <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>The people in the room</h1>
          <p style={{ margin: "12px 0 0", maxWidth: 620, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
            {libraryCount.toLocaleString()} synthetic experts, consumers, residents, and stakeholders across the built world — each with a real career, real demographics, and real opinions. Search in plain language: a problem (&ldquo;looking to build a data center&rdquo;) or a person (&ldquo;under 40 homeowner&rdquo;).
          </p>
        </div>
        <button onClick={() => { setEditor({ mode: "create" }); setErr(null); }} className="btnAcc" style={{ padding: "11px 22px", fontSize: 14 }}>
          + New persona
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 30, alignItems: "center", flexWrap: "wrap" }}>
        {(["library", "custom"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); exitSelect(); setCardMenu(null); }}
            style={{
              ...mono, fontSize: 11, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, cursor: "pointer",
              border: `1px solid ${tab === t ? "var(--acc)" : "var(--ln6)"}`,
              background: tab === t ? "var(--acc-dim)" : "transparent",
              color: tab === t ? "var(--acc)" : "var(--t5)",
            }}
          >
            {t === "library" ? `LIBRARY · ${(pristine ? libraryCount : total).toLocaleString()}` : `CUSTOM · ${customFiltered.length}`}
          </button>
        ))}
        {tab === "custom" && custom.length > 0 && !selectMode && (
          <button
            onClick={() => setSelectMode(true)}
            title="Select personas for bulk actions"
            style={{ ...mono, fontSize: 9, letterSpacing: ".08em", background: "none", border: "none", color: "var(--t7)", cursor: "pointer", padding: "0 2px" }}
          >
            SELECT
          </button>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === "library" ? "Try “looking to build a data center” or “under 40 homeowner”…" : "Search your personas…"}
          style={{ flex: 1, minWidth: 260, boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "9px 18px", fontSize: 13, color: "var(--t1)", outline: "none" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
        />
      </div>

      {/* filter rail — composes with the active tab and the search query */}
      <FilterRail facets={facets} filters={filters} openFilter={openFilter} setOpenFilter={setOpenFilter} onFilter={setFilter} />

      {tab === "library" && (q || anyFilter) && !searching && (
        <div style={{ ...mono, marginTop: 14, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
          {total === 0 ? "NO MATCHES — TRY BROADER LANGUAGE OR CLEAR A FILTER" : `${total.toLocaleString()} MATCH${total === 1 ? "" : "ES"}`}
          {smart && <span style={{ color: "var(--acc)" }}> · AI-MATCHED</span>}
        </div>
      )}

      {err && (
        <div className="mono" style={{ marginTop: 16, fontSize: 11, borderRadius: 10, padding: "10px 14px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)" }}>
          {err}
        </div>
      )}

      {/* quiet bulk-select bar */}
      {tab === "custom" && selectMode && (
        <div style={{ ...mono, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginTop: 14, fontSize: 9.5, letterSpacing: ".07em", color: "var(--t6)" }}>
          <span>{selected.length} SELECTED</span>
          <button onClick={() => { setConfirmBulk(false); setSelected(customFiltered.map((c) => c.id)); }} style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", background: "none", border: "none", color: "var(--t5)", cursor: "pointer", padding: 0 }}>
            SELECT ALL ({customFiltered.length})
          </button>
          <button onClick={() => { setSelected([]); setConfirmBulk(false); }} style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0 }}>
            CLEAR
          </button>
          {selected.length > 0 && (
            <button
              onClick={() => (confirmBulk ? bulkDelete() : setConfirmBulk(true))}
              style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", background: confirmBulk ? "var(--warn-dim)" : "none", border: confirmBulk ? "1px solid var(--warn)" : "none", borderRadius: 100, color: "var(--warn)", cursor: "pointer", padding: confirmBulk ? "4px 12px" : 0 }}
            >
              {confirmBulk ? `CONFIRM — DELETE ${selected.length}?` : "DELETE SELECTED"}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={exitSelect} style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", background: "none", border: "none", color: "var(--acc)", cursor: "pointer", padding: 0 }}>
            DONE
          </button>
        </div>
      )}

      <div className="grid3" style={{ marginTop: 24 }}>
        {tab === "library" && searching && libRows.length === 0 &&
          Array.from({ length: 6 }, (_, i) => <ShimCard key={i} />)}

        {tab === "library" &&
          libRows.map((p) => {
            const adversarial = p.kind === "adversarial";
            const dl = demoLine(p.spec);
            return (
              <div
                key={p.id}
                className="card cardHoverQuiet"
                onClick={() => setProfile({ kind: p.kind, spec: p.spec, chatKey: p.id, source: "library" })}
                style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10, cursor: "pointer", opacity: searching ? 0.55 : 1, transition: "opacity .2s" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ ...mono, width: 38, height: 38, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--t2)", flex: "none" }}>
                    {p.spec.initials}
                  </span>
                  <span style={kindChip(adversarial)}>{adversarial ? "ADVERSARIAL" : p.spec.discipline}</span>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{p.spec.name}</h3>
                  <div style={{ fontSize: 12.5, color: "var(--t5)", marginTop: 3 }}>{p.spec.role}</div>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--t6)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {p.spec.tagline || p.spec.backstory}
                </p>
                <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--acc)" }}>VIEW PROFILE →</span>
                  {dl && <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".04em", color: "var(--t7)" }}>{dl}</span>}
                </div>
              </div>
            );
          })}

        {tab === "custom" && customFiltered.length === 0 && (
          <div className="card" style={{ padding: "34px 28px", border: "1px dashed var(--ln6)", textAlign: "center", gridColumn: "1 / -1" }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".07em", color: "var(--t6)" }}>NO CUSTOM PERSONAS YET</div>
            <p style={{ margin: "10px auto 0", maxWidth: 420, fontSize: 13.5, lineHeight: 1.6, color: "var(--t5)" }}>
              Write your own expert — a person whose judgment you want in the room. They become available in simulations and Conversations.
            </p>
          </div>
        )}

        {tab === "custom" &&
          customFiltered.map((c) => {
            const sel = selected.includes(c.id);
            return (
            <div
              key={c.id}
              className="card cardHoverQuiet convRow"
              onClick={() => (selectMode ? toggleSel(c.id) : setProfile({ kind: c.kind, spec: c.spec, chatKey: c.id, source: "custom" }))}
              style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10, cursor: "pointer", ...(sel ? { borderColor: "var(--acc)", background: "var(--acc-dim)" } : {}) }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...mono, width: 38, height: 38, borderRadius: "50%", background: "var(--acc-dim)", border: "1px solid var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--acc)", flex: "none" }}>
                  {c.spec.initials}
                </span>
                <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {(c.spec.lineage?.length ?? 0) > 0 && (
                    <span style={{ ...kindChip(false), color: "var(--acc)", borderColor: "var(--acc)", background: "var(--acc-dim)" }}>⑂ REMIX</span>
                  )}
                  <span style={kindChip(false)}>{c.kind}</span>
                  {selectMode && (
                    <span style={{ width: 18, height: 18, borderRadius: "50%", flex: "none", border: `1px solid ${sel ? "var(--acc)" : "var(--ln6)"}`, background: sel ? "var(--acc)" : "transparent", color: "var(--acc-c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                      {sel ? "✓" : ""}
                    </span>
                  )}
                </span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{c.spec.name}</h3>
                <div style={{ fontSize: 12.5, color: "var(--t5)", marginTop: 3 }}>{c.spec.role}</div>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--t6)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {c.spec.backstory}
              </p>
              <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--acc)" }}>VIEW PROFILE →</span>
                {!selectMode && (
                  <span className="rowActions" style={{ position: "relative" }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setCardMenu(cardMenu === c.id ? null : c.id); }}
                      aria-label="Persona options"
                      style={{ ...mono, background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 6px" }}
                    >
                      ⋮
                    </button>
                    {cardMenu === c.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: "absolute", right: 0, bottom: "calc(100% + 4px)", zIndex: 45, minWidth: 132, background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 5, boxShadow: "0 14px 34px rgba(0,0,0,.35)", animation: "fadeUp .15s ease both" }}
                      >
                        <button className="menuItem" onClick={() => { setCardMenu(null); setEditor({ mode: "edit", source: { id: c.id, kind: c.kind, spec: c.spec } }); }}>Edit</button>
                        <button className="menuItem" style={{ color: "var(--warn)" }} onClick={() => { setCardMenu(null); remove(c.id); }}>Delete</button>
                      </div>
                    )}
                  </span>
                )}
              </div>
            </div>
            );
          })}
      </div>

      {tab === "library" && total > PAGE_SIZE && (
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

      {cardMenu && <div onClick={() => setCardMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />}

      {profile && (
        <PersonaProfile
          {...profile}
          onClose={() => setProfile(null)}
          onRemix={() => setEditor({ mode: "remix", source: { key: profile.chatKey, kind: profile.kind, spec: profile.spec } })}
          onOpenAncestor={openAncestor}
        />
      )}

      {editor && (
        <PersonaEditor
          orgId={orgId}
          mode={editor.mode}
          source={editor.source}
          onClose={() => setEditor(null)}
          onSaved={(row) => handleSaved(row as CustomPersonaRow)}
        />
      )}
    </div>
  );
}
