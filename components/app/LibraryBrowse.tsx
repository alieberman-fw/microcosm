"use client";

/**
 * Shared library-browsing machinery: filter rail (kind · category · age ·
 * tenure · sort with facet counts), and the two-phase search hook (instant
 * FTS pass upgraded by the LLM pass, parse cached across pages). Used by the
 * Agent Library page and the new-conversation participant browser.
 */

import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { PersonaSpec } from "@/lib/personas";
import { cleanCategory } from "@/components/app/PersonaProfile";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface LibraryRow {
  id: string;
  kind: string;
  spec: PersonaSpec;
}

/** facet counts for the filter rail (from the library_facets RPC) */
export interface LibraryFacets {
  total: number;
  kinds: { kind: string; n: number }[];
  categories: { cat: string; n: number }[];
}

export const PAGE_SIZE = 24;

export const AGE_BANDS: Record<string, { label: string; min?: number; max?: number }> = {
  u30: { label: "UNDER 30", max: 29 },
  b3044: { label: "30–44", min: 30, max: 44 },
  b4559: { label: "45–59", min: 45, max: 59 },
  o60: { label: "60+", min: 60 },
};

export const SORT_LABELS: Record<string, string> = {
  relevance: "BEST MATCH", name: "NAME A–Z", age_asc: "AGE ↑", age_desc: "AGE ↓", newest: "NEWEST",
};

export interface Filters {
  kind: string | null;
  cat: string | null;
  age: string | null;
  tenure: string | null;
  sort: string;
}

export const NO_FILTERS: Filters = { kind: null, cat: null, age: null, tenure: null, sort: "relevance" };

/** One pill in the filter rail: label + current value, opens a dropdown. */
export function FilterPill({
  label, value, open, onToggle, children,
}: {
  label: string; value: string | null; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const active = value !== null;
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      <button
        onClick={onToggle}
        style={{
          ...mono, fontSize: 9.5, letterSpacing: ".05em", display: "flex", alignItems: "center", gap: 6,
          padding: "7px 13px", borderRadius: 100, cursor: "pointer",
          border: `1px solid ${active || open ? "var(--acc)" : "var(--ln5)"}`,
          background: active ? "var(--acc-dim)" : "var(--sf2)",
          color: active || open ? "var(--acc)" : "var(--t5)",
          maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {label}{value ? ` · ${value}` : ""} <span style={{ fontSize: 7, color: active || open ? "var(--acc)" : "var(--t7)" }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 55, minWidth: 210, maxWidth: 320, maxHeight: 320, overflowY: "auto", background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 14, padding: 5, boxShadow: "0 18px 44px rgba(0,0,0,.35)", animation: "fadeUp .15s ease both" }}>
          {children}
        </div>
      )}
    </span>
  );
}

export function FilterOption({
  label, count, selected, onPick,
}: {
  label: string; count?: number; selected: boolean; onPick: () => void;
}) {
  return (
    <button className="menuItem" onClick={onPick} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: selected ? "var(--acc)" : "var(--t2)" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ ...mono, flex: "none", fontSize: 9, color: selected ? "var(--acc)" : "var(--t7)" }}>{selected ? "✓" : count ?? ""}</span>
    </button>
  );
}

/** The full rail: KIND · CATEGORY · AGE · TENURE · CLEAR · SORT (+backdrop). */
export function FilterRail({
  facets, filters, openFilter, setOpenFilter, onFilter, extra,
}: {
  facets: LibraryFacets;
  filters: Filters;
  openFilter: string | null;
  setOpenFilter: (v: string | null) => void;
  onFilter: (patch: Partial<Filters>) => void;
  extra?: ReactNode;
}) {
  const anyFilter = Boolean(filters.kind || filters.cat || filters.age || filters.tenure);
  return (
    <>
      <div style={{ display: "flex", gap: 7, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".12em", color: "var(--t7)" }}>FILTER</span>
        <FilterPill label="KIND" value={filters.kind ? filters.kind.toUpperCase() : null} open={openFilter === "kind"} onToggle={() => setOpenFilter(openFilter === "kind" ? null : "kind")}>
          <FilterOption label="All kinds" selected={!filters.kind} onPick={() => onFilter({ kind: null })} />
          {facets.kinds.map((k) => (
            <FilterOption key={k.kind} label={k.kind[0].toUpperCase() + k.kind.slice(1)} count={k.n} selected={filters.kind === k.kind} onPick={() => onFilter({ kind: k.kind })} />
          ))}
        </FilterPill>
        <FilterPill label="CATEGORY" value={filters.cat ? (cleanCategory(filters.cat) ?? "").toUpperCase().slice(0, 26) : null} open={openFilter === "cat"} onToggle={() => setOpenFilter(openFilter === "cat" ? null : "cat")}>
          <FilterOption label="All categories" selected={!filters.cat} onPick={() => onFilter({ cat: null })} />
          {facets.categories.map((c) => (
            <FilterOption key={c.cat} label={cleanCategory(c.cat) ?? c.cat} count={c.n} selected={filters.cat === c.cat} onPick={() => onFilter({ cat: c.cat })} />
          ))}
        </FilterPill>
        <FilterPill label="AGE" value={filters.age ? AGE_BANDS[filters.age].label : null} open={openFilter === "age"} onToggle={() => setOpenFilter(openFilter === "age" ? null : "age")}>
          <FilterOption label="Any age" selected={!filters.age} onPick={() => onFilter({ age: null })} />
          {Object.entries(AGE_BANDS).map(([key, b]) => (
            <FilterOption key={key} label={b.label} selected={filters.age === key} onPick={() => onFilter({ age: key })} />
          ))}
        </FilterPill>
        <FilterPill label="TENURE" value={filters.tenure ? filters.tenure.toUpperCase() : null} open={openFilter === "tenure"} onToggle={() => setOpenFilter(openFilter === "tenure" ? null : "tenure")}>
          <FilterOption label="Any tenure" selected={!filters.tenure} onPick={() => onFilter({ tenure: null })} />
          <FilterOption label="Owner" selected={filters.tenure === "owner"} onPick={() => onFilter({ tenure: "owner" })} />
          <FilterOption label="Renter" selected={filters.tenure === "renter"} onPick={() => onFilter({ tenure: "renter" })} />
        </FilterPill>
        <span style={{ flex: 1 }} />
        {anyFilter && (
          <button onClick={() => onFilter({ ...NO_FILTERS, sort: filters.sort })} style={{ ...mono, fontSize: 9, letterSpacing: ".08em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer" }}>
            CLEAR ✕
          </button>
        )}
        <FilterPill label="SORT" value={filters.sort === "relevance" ? null : SORT_LABELS[filters.sort]} open={openFilter === "sort"} onToggle={() => setOpenFilter(openFilter === "sort" ? null : "sort")}>
          {Object.entries(SORT_LABELS).map(([key, label]) => (
            <FilterOption key={key} label={label} selected={filters.sort === key} onPick={() => onFilter({ sort: key })} />
          ))}
        </FilterPill>
        {extra}
      </div>
      {openFilter && <div onClick={() => setOpenFilter(null)} style={{ position: "fixed", inset: 0, zIndex: 50 }} />}
    </>
  );
}

/**
 * Unified library fetch: pristine → server-provided first page; browse with
 * filters → single plain fetch; fresh query → two-phase (instant FTS, AI
 * upgrade); paging/knob turns on the same query → single pass reusing the
 * cached LLM parse (no extra model calls).
 */
export function useLibrarySearch({
  active, q, filters, page, initialRows, initialCount,
}: {
  active: boolean;
  q: string;
  filters: Filters;
  page: number;
  initialRows: LibraryRow[];
  initialCount: number;
}) {
  const [rows, setRows] = useState<LibraryRow[]>(initialRows);
  const [total, setTotal] = useState(initialCount);
  const [smart, setSmart] = useState(false);
  const [searching, setSearching] = useState(false);
  const reqSeq = useRef(0);
  const parsedCache = useRef<{ q: string; parsed: unknown } | null>(null);

  const anyFilter = Boolean(filters.kind || filters.cat || filters.age || filters.tenure);
  const pristine = !q && !anyFilter && page === 0 && filters.sort === "relevance";

  useEffect(() => {
    if (!active) return;
    if (pristine) { setRows(initialRows); setTotal(initialCount); setSmart(false); setSearching(false); return; }
    setSearching(true);
    const seq = ++reqSeq.current;
    let smartDone = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const band = filters.age ? AGE_BANDS[filters.age] : null;
    const baseBody = {
      q, limit: PAGE_SIZE, offset: page * PAGE_SIZE, sort: filters.sort,
      kinds: filters.kind ? [filters.kind] : [],
      cats: filters.cat ? [filters.cat] : [],
      ageMin: band?.min, ageMax: band?.max,
      tenure: filters.tenure ?? undefined,
    };
    const cachedParse = q && parsedCache.current?.q === q ? parsedCache.current.parsed : null;
    const run = (smartPass: boolean, delay: number, bodyExtra: Record<string, unknown> = {}) => {
      timers.push(setTimeout(async () => {
        try {
          const res = await fetch("/api/personas/search", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...baseBody, smart: smartPass, ...bodyExtra }),
          });
          const json = await res.json();
          if (seq !== reqSeq.current || !res.ok) return;
          if (smartPass) {
            smartDone = true;
            if (json.parsed && q) parsedCache.current = { q, parsed: json.parsed };
            setRows(json.personas as LibraryRow[]);
            setTotal(json.total ?? 0);
            setSmart(Boolean(json.smart));
            setSearching(false);
          } else if (!smartDone) {
            setRows(json.personas as LibraryRow[]);
            setTotal(json.total ?? 0);
            setSmart(false);
            setSearching(false);
          }
        } catch {
          if (seq === reqSeq.current && smartPass) setSearching(false);
        }
      }, delay));
    };
    if (!q) run(false, 0);
    else if (cachedParse) run(true, 0, { parsed: cachedParse });
    else { run(false, 120); run(true, 400); }
    return () => timers.forEach(clearTimeout);
  }, [active, q, filters, page, pristine, initialRows, initialCount]);

  return { rows, total, smart, searching, pristine, anyFilter };
}
