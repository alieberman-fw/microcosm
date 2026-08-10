"use client";

/**
 * Hand-pick seats for a simulation panel (CLAUDE.md §3.2C) — no model calls.
 * Your custom personas filter instantly; the global library streams in via
 * the same smart search that powers /personas. Search-select leads, or
 * apply PACKS with explicit control: every pack offers + AS LEADS and
 * + AS CROWD (its kind highlights the natural one), expands to show its
 * members, and everything you've picked is visible and removable in the
 * YOUR SELECTION tray before anything is committed
 * (POST /api/simulations/[id]/agents).
 */

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { PersonaSpec } from "@/lib/personas";
import Orb from "@/components/app/Orb";
import { PackMemberRow } from "@/components/app/Packs";
import { PACK_CAPS, PackSummary } from "@/lib/packs";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

interface Row { id: string; kind: string; spec: PersonaSpec }
type Tier = "lead" | "crowd";

export default function SeatPicker({
  simId,
  remaining,
  onClose,
  onAdded,
}: {
  simId: string;
  remaining: number;
  onClose: () => void;
  onAdded: (
    seats: { key: string; provenance: "yours" | "library"; spec: PersonaSpec & { seat?: unknown } }[],
    crowdSeats: { key: string; spec: PersonaSpec & { seat?: unknown } }[],
  ) => void;
}) {
  const [mine, setMine] = useState<Row[]>([]);
  const [libResults, setLibResults] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Map<string, Row>>(new Map());
  const [crowdPicked, setCrowdPicked] = useState<Map<string, Row>>(new Map());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // packs: cards with explicit lead/crowd application + expandable members
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [packMembers, setPackMembers] = useState<Map<string, PackMemberRow[]>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [packNote, setPackNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/personas/mine").then((r) => r.json()).then((d) => setMine(d.personas ?? [])).catch(() => {});
    fetch("/api/packs").then((r) => r.json()).then((d) => setPacks(d.packs ?? [])).catch(() => {});
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

  const leadRoom = remaining - picked.size;
  const crowdRoom = PACK_CAPS.crowd - crowdPicked.size;

  // sync refs: state updaters run at render time, so an "added" count read
  // right after setState is always 0 (fired a bogus "ADDED 0 OF N" note in
  // the field) — and rapid clicks must see each other
  const pickedRef = useRef(picked);
  const crowdRef = useRef(crowdPicked);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  useEffect(() => { crowdRef.current = crowdPicked; }, [crowdPicked]);

  /** add rows to a tier, respecting caps and cross-tier dedupe — returns
   *  how many actually landed */
  const addAs = (rows: (Row | PackMemberRow)[], tier: Tier): number => {
    const cur = tier === "lead" ? pickedRef.current : crowdRef.current;
    const other = tier === "lead" ? crowdRef.current : pickedRef.current;
    const cap = tier === "lead" ? remaining : PACK_CAPS.crowd;
    const next = new Map(cur);
    let added = 0;
    for (const r of rows) {
      if (next.size >= cap) break;
      if (next.has(r.id) || other.has(r.id)) continue;
      next.set(r.id, r);
      added++;
    }
    if (added === 0) return 0;
    if (tier === "lead") { pickedRef.current = next; setPicked(next); }
    else { crowdRef.current = next; setCrowdPicked(next); }
    return added;
  };

  const removePick = (id: string) => {
    const p = new Map(pickedRef.current); p.delete(id); pickedRef.current = p; setPicked(p);
    const c = new Map(crowdRef.current); c.delete(id); crowdRef.current = c; setCrowdPicked(c);
  };

  const toggle = (r: Row) => {
    if (picked.has(r.id) || crowdPicked.has(r.id)) removePick(r.id);
    else addAs([r], "lead");
  };

  const membersOf = async (packId: string): Promise<PackMemberRow[]> => {
    const cached = packMembers.get(packId);
    if (cached) return cached;
    setLoadingPack(packId);
    try {
      const res = await fetch(`/api/packs/${packId}`);
      const data = await res.json();
      const members = (data.members ?? []) as PackMemberRow[];
      setPackMembers((prev) => new Map(prev).set(packId, members));
      return members;
    } catch {
      return [];
    } finally {
      setLoadingPack(null);
    }
  };

  const applyPack = async (pack: PackSummary, tier: Tier) => {
    setPackNote(null);
    const members = await membersOf(pack.id);
    const added = addAs(members, tier);
    if (added < members.length) {
      const reason = added === 0
        ? "ALL ARE ALREADY PICKED OR THE GROUP IS FULL"
        : tier === "lead" ? `LEAD SEATS CAP AT ${remaining}` : `CROWD CAPS AT ${PACK_CAPS.crowd}`;
      setPackNote(`${pack.name.toUpperCase()} — ADDED ${added} OF ${members.length} AS ${tier === "lead" ? "LEADS" : "CROWD"} (${reason})`);
    }
  };

  const add = async () => {
    if ((picked.size === 0 && crowdPicked.size === 0) || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/simulations/${simId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaIds: [...picked.keys()], crowdPersonaIds: [...crowdPicked.keys()] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add");
      onAdded(data.seats ?? [], data.crowdSeats ?? []);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add");
      setAdding(false);
    }
  };

  /* ------------------------------------------------------ small pieces */

  const MemberChip = ({ r, tier }: { r: Row | PackMemberRow; tier: Tier }) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 6px 5px 6px", borderRadius: 100,
      border: `1px solid ${tier === "lead" ? "var(--acc)" : "var(--ln5)"}`,
      background: tier === "lead" ? "var(--acc-dim)" : "var(--sf2)", maxWidth: 230,
    }}>
      <span style={{ ...mono, width: 20, height: 20, borderRadius: "50%", flex: "none", background: "var(--sf)", border: "1px solid var(--ln4)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, color: "var(--t4)" }}>
        {r.spec.initials}
      </span>
      <span style={{ minWidth: 0, fontSize: 11.5, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {r.spec.name}
      </span>
      <button
        onClick={() => removePick(r.id)}
        aria-label={`Remove ${r.spec.name}`}
        style={{ flex: "none", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: "0 3px" }}
      >
        ×
      </button>
    </span>
  );

  const TierButton = ({ pack, tier }: { pack: PackSummary; tier: Tier }) => {
    const natural = (pack.kind === "panel") === (tier === "lead");
    const room = tier === "lead" ? leadRoom : crowdRoom;
    return (
      <button
        onClick={() => void applyPack(pack, tier)}
        disabled={room <= 0 || loadingPack === pack.id}
        title={tier === "lead" ? "Leads speak in the deliberation" : "Crowd members are polled every round"}
        style={{
          ...mono, fontSize: 8.5, letterSpacing: ".05em", padding: "6px 12px", borderRadius: 100,
          cursor: room > 0 ? "pointer" : "default", opacity: room > 0 ? 1 : 0.4,
          border: `1px solid ${natural ? "var(--acc)" : "var(--ln5)"}`,
          background: natural ? "var(--acc-dim)" : "transparent",
          color: natural ? "var(--acc)" : "var(--t5)",
        }}
      >
        + AS {tier === "lead" ? "LEADS" : "CROWD"}
      </button>
    );
  };

  const Card = ({ r }: { r: Row }) => {
    const on = picked.has(r.id);
    const asCrowd = crowdPicked.has(r.id);
    const full = !on && !asCrowd && picked.size >= remaining;
    return (
      <button
        onClick={() => toggle(r)}
        disabled={full}
        title={asCrowd ? "Selected for the crowd — click to remove" : undefined}
        style={{
          textAlign: "left", border: `1px solid ${on ? "var(--acc)" : asCrowd ? "var(--ln6)" : "var(--ln3)"}`, borderRadius: 12,
          padding: "13px 15px", background: on ? "var(--acc-dim)" : asCrowd ? "var(--sf2)" : "var(--sf)",
          cursor: full ? "default" : "pointer", opacity: full ? 0.45 : 1, transition: "all .15s", position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 10, color: "var(--t3)", flex: "none" }}>
            {r.spec.initials}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2, minWidth: 0 }}>{r.spec.name}</span>
          {on && <span style={{ marginLeft: "auto", color: "var(--acc)", fontSize: 13 }}>✓</span>}
          {asCrowd && <span style={{ ...mono, marginLeft: "auto", fontSize: 7.5, letterSpacing: ".06em", color: "var(--t5)" }}>CROWD ✓</span>}
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

  const crowdList = [...crowdPicked.values()];

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadeUp .2s ease both" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(880px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, overflow: "hidden" }}
      >
        <div style={{ padding: "22px 26px 16px", borderBottom: "1px solid var(--ln3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>
              HAND-PICK THE PANEL · <span style={{ color: picked.size ? "var(--acc)" : "var(--t6)" }}>{picked.size}/{remaining} LEADS</span>
              {crowdPicked.size > 0 && <span style={{ color: "var(--t4)" }}> · {crowdPicked.size} CROWD</span>}
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
              <a href={`/sim/${simId}/cast`} style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--acc)" }}>
                BROWSE ALL WITH FILTERS →
              </a>
              <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--t5)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
            </span>
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
          {/* the selection tray — everything picked, visible and removable */}
          {(picked.size > 0 || crowdPicked.size > 0) && (
            <div style={{ border: "1px solid var(--ln3)", borderRadius: 14, background: "var(--sf2)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              {picked.size > 0 && (
                <div>
                  <div style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--acc)", marginBottom: 8 }}>
                    LEADS · {picked.size} — SPEAK IN THE DELIBERATION
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[...picked.values()].map((r) => <MemberChip key={r.id} r={r} tier="lead" />)}
                  </div>
                </div>
              )}
              {crowdPicked.size > 0 && (
                <div>
                  <div style={{ ...mono, display: "flex", alignItems: "center", gap: 10, fontSize: 9, letterSpacing: ".08em", color: "var(--t5)", marginBottom: 8 }}>
                    CROWD · {crowdPicked.size} — POLLED EVERY ROUND, NEVER SPEAK
                    <button onClick={() => setCrowdPicked(new Map())} style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0 }}>
                      CLEAR
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {crowdList.slice(0, 14).map((r) => <MemberChip key={r.id} r={r} tier="crowd" />)}
                    {crowdList.length > 14 && (
                      <span style={{ ...mono, alignSelf: "center", fontSize: 9, color: "var(--t6)" }}>+{crowdList.length - 14} MORE</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* packs — explicit lead/crowd application + expandable members */}
          {packs.length > 0 && (
            <div>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", marginBottom: 10 }}>YOUR PACKS · {packs.length}</div>
              {packNote && <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--warn)", marginBottom: 10 }}>{packNote}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {packs.map((p) => {
                  const isOpen = expanded === p.id;
                  const members = packMembers.get(p.id);
                  return (
                    <div key={p.id} style={{ border: "1px solid var(--ln3)", borderRadius: 12, background: "var(--sf)", padding: "11px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{
                          ...mono, fontSize: 8, letterSpacing: ".08em", padding: "3px 9px", borderRadius: 100, flex: "none",
                          border: `1px solid ${p.kind === "panel" ? "var(--acc)" : "var(--ln6)"}`,
                          background: p.kind === "panel" ? "var(--acc-dim)" : "var(--sf2)",
                          color: p.kind === "panel" ? "var(--acc)" : "var(--t5)",
                        }}>
                          {p.kind === "panel" ? "PANEL" : "CROWD"}
                        </span>
                        <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <span style={{ ...mono, fontSize: 8.5, color: "var(--t6)", flex: "none" }}>{p.count}</span>
                        <span style={{ flex: 1 }} />
                        <TierButton pack={p} tier="lead" />
                        <TierButton pack={p} tier="crowd" />
                        <button
                          onClick={() => { if (isOpen) setExpanded(null); else { setExpanded(p.id); void membersOf(p.id); } }}
                          style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", padding: "6px 10px", borderRadius: 100, border: "1px solid var(--ln4)", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
                        >
                          {isOpen ? "HIDE ▴" : "MEMBERS ▾"}
                        </button>
                      </div>
                      {isOpen && (
                        <div style={{ marginTop: 10, borderTop: "1px solid var(--ln2)", paddingTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 6 }}>
                          {!members && <span style={{ ...mono, fontSize: 9, color: "var(--t6)" }}>LOADING…</span>}
                          {(members ?? []).map((m) => {
                            const inLeads = picked.has(m.id);
                            const inCrowd = crowdPicked.has(m.id);
                            return (
                              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 9, background: inLeads || inCrowd ? "var(--acc-dim)" : "var(--sf2)", border: `1px solid ${inLeads || inCrowd ? "var(--acc)" : "var(--ln2)"}` }}>
                                <span style={{ ...mono, width: 22, height: 22, borderRadius: "50%", flex: "none", background: "var(--sf)", border: "1px solid var(--ln4)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "var(--t4)" }}>
                                  {m.spec.initials}
                                </span>
                                <span style={{ minWidth: 0, flex: 1 }}>
                                  <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.spec.name}</span>
                                  <span style={{ display: "block", fontSize: 9.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.spec.role}</span>
                                </span>
                                {inLeads || inCrowd ? (
                                  <button onClick={() => removePick(m.id)} style={{ ...mono, flex: "none", fontSize: 8, letterSpacing: ".04em", padding: "3px 8px", borderRadius: 100, border: "1px solid var(--acc)", background: "transparent", color: "var(--acc)", cursor: "pointer" }}>
                                    {inLeads ? "LEAD ×" : "CROWD ×"}
                                  </button>
                                ) : (
                                  <span style={{ display: "inline-flex", gap: 3, flex: "none" }}>
                                    <button onClick={() => addAs([m], "lead")} disabled={leadRoom <= 0} style={{ ...mono, fontSize: 8, letterSpacing: ".04em", padding: "3px 7px", borderRadius: 100, border: "1px solid var(--ln4)", background: "transparent", color: leadRoom > 0 ? "var(--t4)" : "var(--t7)", cursor: leadRoom > 0 ? "pointer" : "default" }}>
                                      +LEAD
                                    </button>
                                    <button onClick={() => addAs([m], "crowd")} disabled={crowdRoom <= 0} style={{ ...mono, fontSize: 8, letterSpacing: ".04em", padding: "3px 7px", borderRadius: 100, border: "1px solid var(--ln4)", background: "transparent", color: crowdRoom > 0 ? "var(--t4)" : "var(--t7)", cursor: crowdRoom > 0 ? "pointer" : "default" }}>
                                      +CROWD
                                    </button>
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {filteredMine.length > 0 && (
            <div>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--acc)", marginBottom: 12 }}>YOUR PERSONAS · {filteredMine.length}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
                {filteredMine.map((r) => <Card key={r.id} r={r} />)}
              </div>
            </div>
          )}
          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              LIBRARY{searching ? " · SEARCHING…" : libResults.length ? ` · ${libResults.length}` : ""}
              {searching && <Orb state="searching" size={20} aria-label="Searching the library" />}
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
            disabled={(picked.size === 0 && crowdPicked.size === 0) || adding}
            style={{
              marginLeft: "auto", background: picked.size || crowdPicked.size ? "var(--acc)" : "var(--sf2)", color: picked.size || crowdPicked.size ? "var(--acc-c)" : "var(--t6)",
              fontWeight: 600, fontSize: 13.5, padding: "11px 24px", borderRadius: 100, border: "none",
              cursor: (picked.size || crowdPicked.size) && !adding ? "pointer" : "default", fontFamily: "var(--font-sans), sans-serif",
            }}
          >
            {adding
              ? "Adding…"
              : picked.size || crowdPicked.size
                ? `Add ${[picked.size ? `${picked.size} lead${picked.size === 1 ? "" : "s"}` : "", crowdPicked.size ? `${crowdPicked.size} crowd` : ""].filter(Boolean).join(" + ")}`
                : "Select personas"}
          </button>
        </div>
      </div>
    </div>
  );
}
