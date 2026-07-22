"use client";

/**
 * Hand-pick seats for a simulation panel (CLAUDE.md §3.2C) — no model calls.
 * Your custom personas filter instantly; the global library streams in via
 * the same smart search that powers /personas. Multi-select, then add the
 * picked personas to the cast (POST /api/simulations/[id]/agents).
 */

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { PersonaSpec } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

interface Row { id: string; kind: string; spec: PersonaSpec }

export default function SeatPicker({
  simId,
  remaining,
  onClose,
  onAdded,
}: {
  simId: string;
  remaining: number;
  onClose: () => void;
  onAdded: (seats: { key: string; provenance: "yours" | "library"; spec: PersonaSpec & { seat?: unknown } }[]) => void;
}) {
  const [mine, setMine] = useState<Row[]>([]);
  const [libResults, setLibResults] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Map<string, Row>>(new Map());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/personas/mine").then((r) => r.json()).then((d) => setMine(d.personas ?? [])).catch(() => {});
  }, []);

  // library smart search (debounced)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setLibResults([]); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/personas/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, smart: true, limit: 24 }),
        });
        const data = await res.json();
        setLibResults((data.personas ?? []) as Row[]);
      } catch {
        setLibResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  const filteredMine = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return mine;
    return mine.filter((r) => `${r.spec.name} ${r.spec.role} ${(r.spec.skills ?? []).join(" ")}`.toLowerCase().includes(q));
  }, [mine, query]);

  const toggle = (r: Row) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(r.id)) next.delete(r.id);
      else if (next.size < remaining) next.set(r.id, r);
      return next;
    });
  };

  const add = async () => {
    if (picked.size === 0 || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/simulations/${simId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaIds: [...picked.keys()] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add");
      onAdded(data.seats ?? []);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add");
      setAdding(false);
    }
  };

  const Card = ({ r }: { r: Row }) => {
    const on = picked.has(r.id);
    const full = !on && picked.size >= remaining;
    return (
      <button
        onClick={() => toggle(r)}
        disabled={full}
        style={{
          textAlign: "left", border: `1px solid ${on ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 12,
          padding: "13px 15px", background: on ? "var(--acc-dim)" : "var(--sf)",
          cursor: full ? "default" : "pointer", opacity: full ? 0.45 : 1, transition: "all .15s", position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 10, color: "var(--t3)", flex: "none" }}>
            {r.spec.initials}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, minWidth: 0 }}>{r.spec.name}</span>
          {on && <span style={{ marginLeft: "auto", color: "var(--acc)", fontSize: 13 }}>✓</span>}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--t4)", fontWeight: 600 }}>{r.spec.role}</div>
        {r.spec.tagline && (
          <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.45, color: "var(--t6)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {r.spec.tagline}
          </div>
        )}
      </button>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadeUp .2s ease both" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(860px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, overflow: "hidden" }}
      >
        <div style={{ padding: "22px 26px 16px", borderBottom: "1px solid var(--ln3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>
              HAND-PICK THE PANEL · {picked.size}/{remaining} SELECTED
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--t5)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your personas and the 1,800-strong library — “grid engineer”, “under-40 renter”…"
            style={{
              width: "100%", boxSizing: "border-box", marginTop: 14, padding: "11px 16px", background: "var(--sf2)",
              border: "1px solid var(--ln3)", borderRadius: 100, fontFamily: "var(--font-sans), sans-serif",
              fontSize: 13.5, color: "var(--t1)", outline: "none",
            }}
          />
        </div>

        <div style={{ overflowY: "auto", padding: "18px 26px", display: "flex", flexDirection: "column", gap: 20 }}>
          {filteredMine.length > 0 && (
            <div>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--acc)", marginBottom: 12 }}>YOUR PERSONAS · {filteredMine.length}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
                {filteredMine.map((r) => <Card key={r.id} r={r} />)}
              </div>
            </div>
          )}
          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", marginBottom: 12 }}>
              LIBRARY{searching ? " · SEARCHING…" : libResults.length ? ` · ${libResults.length}` : ""}
            </div>
            {!query.trim() ? (
              <div style={{ fontSize: 12.5, color: "var(--t6)", lineHeight: 1.6 }}>Type above to search 1,800 built-world personas.</div>
            ) : libResults.length === 0 && !searching ? (
              <div style={{ fontSize: 12.5, color: "var(--t6)" }}>No library matches for “{query}”.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
                {libResults.map((r) => <Card key={r.id} r={r} />)}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 26px", borderTop: "1px solid var(--ln3)", display: "flex", alignItems: "center", gap: 16 }}>
          {error && <span style={{ ...mono, fontSize: 11, color: "var(--warn)" }}>{error}</span>}
          <button
            onClick={add}
            disabled={picked.size === 0 || adding}
            style={{
              marginLeft: "auto", background: picked.size ? "var(--acc)" : "var(--sf2)", color: picked.size ? "var(--acc-c)" : "var(--t6)",
              fontWeight: 600, fontSize: 13.5, padding: "11px 24px", borderRadius: 100, border: "none",
              cursor: picked.size && !adding ? "pointer" : "default", fontFamily: "var(--font-sans), sans-serif",
            }}
          >
            {adding ? "Adding…" : picked.size ? `Add ${picked.size} to the panel` : "Select personas"}
          </button>
        </div>
      </div>
    </div>
  );
}
