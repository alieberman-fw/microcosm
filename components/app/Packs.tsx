"use client";

/**
 * Panel & crowd packs (§3.4 persona sets) — the aggregator UI.
 * - PacksSection: the Agent Library's PACKS tab — pack cards, create flow,
 *   and the pack modal (rename, describe, add/remove members, delete,
 *   use in a chat).
 * - PackChipStrip: the compact strip pickers mount (SeatPicker, the full
 *   cast browser, the Conversations quick picker) — click a pack to apply
 *   its whole membership in one move.
 */

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PersonaSpec } from "@/lib/personas";
import { PACK_CAPS, PackKind, PackSummary } from "@/lib/packs";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface PackMemberRow { id: string; kind: string; spec: PersonaSpec }

/* ---------------------------------------------------------------- strip */

export function PackChipStrip({ label = "PACKS", kinds, onApply }: {
  label?: string;
  /** limit which pack kinds show (default: both) */
  kinds?: PackKind[];
  onApply: (pack: PackSummary, members: PackMemberRow[]) => void;
}) {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/packs").then((r) => r.json()).then((d) => setPacks(d.packs ?? [])).catch(() => {});
  }, []);

  const shown = packs.filter((p) => !kinds || kinds.includes(p.kind));
  if (shown.length === 0) return null;

  const apply = async (p: PackSummary) => {
    if (busy) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/packs/${p.id}`);
      const data = await res.json();
      if (res.ok) onApply(p, (data.members ?? []) as PackMemberRow[]);
    } catch { /* strip stays quiet — the pick surface shows its own errors */ }
    setBusy(null);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t7)", flex: "none" }}>{label}</span>
      {shown.map((p) => {
        const panel = p.kind === "panel";
        return (
          <button
            key={p.id}
            onClick={() => void apply(p)}
            title={`${panel ? "Panel pack" : "Crowd pack"} · ${p.count} member${p.count === 1 ? "" : "s"} — click to add all`}
            style={{
              ...mono, fontSize: 9, letterSpacing: ".05em", padding: "5px 12px", borderRadius: 100, cursor: "pointer",
              border: `1px solid ${panel ? "var(--acc)" : "var(--ln6)"}`,
              background: panel ? "var(--acc-dim)" : "var(--sf2)",
              color: panel ? "var(--acc)" : "var(--t4)",
              opacity: busy && busy !== p.id ? 0.6 : 1,
            }}
          >
            ⛁ {p.name.toUpperCase().slice(0, 28)} · {p.count}{p.kind === "crowd" ? " CROWD" : ""}
            {busy === p.id ? " …" : ""}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- section */

function kindPill(kind: PackKind) {
  const panel = kind === "panel";
  return (
    <span style={{
      ...mono, fontSize: 8.5, letterSpacing: ".08em", padding: "3px 10px", borderRadius: 100, flex: "none",
      border: `1px solid ${panel ? "var(--acc)" : "var(--ln6)"}`,
      background: panel ? "var(--acc-dim)" : "var(--sf2)",
      color: panel ? "var(--acc)" : "var(--t5)",
    }}>
      {panel ? "PANEL PACK" : "CROWD PACK"}
    </span>
  );
}

function AvatarStack({ preview, count }: { preview: PackSummary["preview"]; count: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {preview.map((m, i) => (
        <span key={m.id} title={`${m.name} — ${m.role}`} style={{
          ...mono, width: 26, height: 26, borderRadius: "50%", marginLeft: i ? -8 : 0,
          background: "var(--sf2)", border: "1px solid var(--ln5)", display: "inline-flex",
          alignItems: "center", justifyContent: "center", fontSize: 8.5, color: "var(--t4)",
        }}>
          {m.initials}
        </span>
      ))}
      {count > preview.length && (
        <span style={{ ...mono, marginLeft: 6, fontSize: 9, color: "var(--t6)" }}>+{count - preview.length}</span>
      )}
    </span>
  );
}

export function PacksSection({ onCount }: { onCount?: (n: number) => void }) {
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<PackKind>("panel");
  const [open, setOpen] = useState<PackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/packs");
      const data = await res.json();
      if (res.ok) { setPacks(data.packs ?? []); onCount?.((data.packs ?? []).length); }
    } catch { setPacks([]); }
  }, [onCount]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await fetch("/api/packs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: newKind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not create the pack");
      setCreating(false);
      setNewName("");
      setPacks((prev) => [data.pack, ...(prev ?? [])]);
      onCount?.((packs?.length ?? 0) + 1);
      setOpen(data.pack); // straight into adding members
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the pack");
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--t5)", maxWidth: 640 }}>
          Packs are reusable rosters. A <span style={{ color: "var(--t3)" }}>panel pack</span> drops into a simulation as lead seats or a group chat as participants;
          a <span style={{ color: "var(--t3)" }}>crowd pack</span> seeds the polled crowd. Build once — &ldquo;Phoenix data-center diligence panel&rdquo; — reuse everywhere.
        </p>
        <span style={{ flex: 1 }} />
        {!creating && (
          <button onClick={() => { setCreating(true); setError(null); }} className="btnAcc" style={{ padding: "9px 18px", fontSize: 13, flex: "none" }}>
            + New pack
          </button>
        )}
      </div>

      {creating && (
        <div className="card" style={{ marginTop: 18, padding: "18px 22px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }}
            placeholder="Pack name — “Phoenix DC diligence panel”, “ZIP 85212 renters”…"
            style={{ flex: 1, minWidth: 240, background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "10px 18px", fontSize: 13.5, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
          />
          <span style={{ display: "inline-flex", gap: 4, flex: "none" }}>
            {(["panel", "crowd"] as const).map((k) => (
              <button key={k} onClick={() => setNewKind(k)} style={{
                ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "7px 14px", borderRadius: 100, cursor: "pointer",
                border: `1px solid ${newKind === k ? "var(--acc)" : "var(--ln5)"}`,
                background: newKind === k ? "var(--acc-dim)" : "transparent",
                color: newKind === k ? "var(--acc)" : "var(--t5)",
              }}>
                {k.toUpperCase()}
              </button>
            ))}
          </span>
          <button onClick={() => void create()} disabled={!newName.trim()} className="btnAcc" style={{ padding: "9px 20px", fontSize: 13, flex: "none", opacity: newName.trim() ? 1 : 0.5 }}>
            Create
          </button>
          <button onClick={() => setCreating(false)} style={{ ...mono, fontSize: 9.5, background: "none", border: "none", color: "var(--t6)", cursor: "pointer", flex: "none" }}>
            CANCEL
          </button>
        </div>
      )}

      {error && (
        <div className="mono" style={{ marginTop: 14, fontSize: 11, borderRadius: 10, padding: "10px 14px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)" }}>
          {error}
        </div>
      )}

      {packs !== null && packs.length === 0 && !creating && (
        <div style={{ marginTop: 26, padding: "30px 26px", border: "1px dashed var(--ln4)", borderRadius: 16, fontSize: 13.5, lineHeight: 1.7, color: "var(--t5)", maxWidth: 640 }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--acc)", marginBottom: 10 }}>⛁ NO PACKS YET</div>
          Create your first pack, add people from the library, then apply it anywhere personas are picked:
          hand-pick casting on a simulation, the full cast browser, or a new conversation.
        </div>
      )}

      <div className="grid3" style={{ marginTop: 22 }}>
        {(packs ?? []).map((p) => (
          <div
            key={p.id}
            className="card cardHoverQuiet"
            onClick={() => setOpen(p)}
            style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12, cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {kindPill(p.kind)}
              <span style={{ flex: 1 }} />
              <AvatarStack preview={p.preview} count={p.count} />
            </div>
            <div style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.25 }}>{p.name}</div>
            {p.description && (
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--t5)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {p.description}
              </div>
            )}
            <div style={{ ...mono, marginTop: "auto", fontSize: 9, letterSpacing: ".07em", color: "var(--t6)" }}>
              {p.count} MEMBER{p.count === 1 ? "" : "S"} · UPDATED {String(p.updated_at).slice(0, 10)}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <PackModal
          pack={open}
          onClose={() => setOpen(null)}
          onChanged={(updated) => {
            setOpen(updated);
            setPacks((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
          }}
          onDeleted={(id) => {
            setOpen(null);
            setPacks((prev) => { const next = (prev ?? []).filter((x) => x.id !== id); onCount?.(next.length); return next; });
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- modal */

function PackModal({ pack, onClose, onChanged, onDeleted }: {
  pack: PackSummary;
  onClose: () => void;
  onChanged: (p: PackSummary) => void;
  onDeleted: (id: string) => void;
}) {
  const router = useRouter();
  const cap = PACK_CAPS[pack.kind];
  const [members, setMembers] = useState<PackMemberRow[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState(pack.name);
  const [descEditing, setDescEditing] = useState(false);
  const [descVal, setDescVal] = useState(pack.description ?? "");
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // add-people picker
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState<PackMemberRow[]>([]);
  const [libResults, setLibResults] = useState<PackMemberRow[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/packs/${pack.id}`);
        const data = await res.json();
        if (res.ok) setMembers((data.members ?? []) as PackMemberRow[]);
      } catch { setMembers([]); }
    })();
    fetch("/api/personas/mine").then((r) => r.json()).then((d) => setMine(d.personas ?? [])).catch(() => {});
  }, [pack.id]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setLibResults([]); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/personas/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, smart: true, limit: 18 }),
        });
        const data = await res.json();
        setLibResults((data.personas ?? []) as PackMemberRow[]);
      } catch { setLibResults([]); } finally { setSearching(false); }
    }, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`/api/packs/${pack.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save");
      onChanged(data.pack as PackSummary);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      return false;
    }
  };

  // rapid clicks must see each other: state alone is stale between renders
  // (two quick adds would clobber), so commits go through a sync ref
  const membersRef = useRef<PackMemberRow[]>([]);
  useEffect(() => { membersRef.current = members ?? []; }, [members]);

  const commitMembers = (next: PackMemberRow[]) => {
    membersRef.current = next;
    setMembers(next);
    void patch({ personaIds: next.map((m) => m.id) });
  };

  const saveMembers = (next: PackMemberRow[]) => commitMembers(next);

  const addMember = (r: PackMemberRow) => {
    const cur = membersRef.current;
    if (members === null || cur.some((m) => m.id === r.id) || cur.length >= cap) return;
    commitMembers([...cur, r]);
  };

  const has = (id: string) => Boolean(members?.some((m) => m.id === id));
  const full = (members?.length ?? 0) >= cap;

  const mineFiltered = query.trim()
    ? mine.filter((r) => `${r.spec.name} ${r.spec.role}`.toLowerCase().includes(query.trim().toLowerCase()))
    : mine;

  const ResultRow = ({ r }: { r: PackMemberRow }) => {
    const on = has(r.id);
    return (
      <button
        onClick={() => (on ? saveMembers(membersRef.current.filter((m) => m.id !== r.id)) : addMember(r))}
        disabled={!on && full}
        style={{
          display: "flex", alignItems: "center", gap: 9, textAlign: "left", width: "100%", boxSizing: "border-box",
          border: `1px solid ${on ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 10, padding: "8px 11px",
          background: on ? "var(--acc-dim)" : "transparent", cursor: !on && full ? "default" : "pointer",
          opacity: !on && full ? 0.45 : 1,
        }}
      >
        <span style={{ ...mono, width: 26, height: 26, borderRadius: "50%", flex: "none", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--t4)" }}>
          {r.spec.initials}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sans), sans-serif" }}>{r.spec.name}</span>
          <span style={{ display: "block", fontSize: 10.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sans), sans-serif" }}>{r.spec.role}</span>
        </span>
        {on && <span style={{ color: "var(--acc)", fontSize: 12, flex: "none" }}>✓</span>}
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
        style={{ width: "min(880px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, overflow: "hidden" }}
      >
        <div style={{ padding: "20px 26px 16px", borderBottom: "1px solid var(--ln3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {kindPill(pack.kind)}
            {renaming ? (
              <input
                autoFocus
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setRenaming(false); void patch({ name: nameVal }); } if (e.key === "Escape") setRenaming(false); }}
                onBlur={() => { setRenaming(false); void patch({ name: nameVal }); }}
                style={{ flex: 1, minWidth: 200, background: "var(--sf2)", border: "1px solid var(--acc)", borderRadius: 10, padding: "6px 12px", fontSize: 17, fontWeight: 600, color: "var(--t0)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
              />
            ) : (
              <button
                onClick={() => { setNameVal(pack.name); setRenaming(true); }}
                title="Rename this pack"
                style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-.01em", color: "var(--t0)", cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-sans), sans-serif" }}
              >
                {pack.name}
              </button>
            )}
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: full ? "var(--warn)" : "var(--t6)", flex: "none" }}>
              {members?.length ?? pack.count}/{cap}
            </span>
            <button onClick={onClose} aria-label="Close" style={{ flex: "none", background: "none", border: "none", color: "var(--t5)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          {descEditing ? (
            <input
              autoFocus
              value={descVal}
              onChange={(e) => setDescVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setDescEditing(false); void patch({ description: descVal }); } if (e.key === "Escape") setDescEditing(false); }}
              onBlur={() => { setDescEditing(false); void patch({ description: descVal }); }}
              placeholder="What is this pack for?"
              style={{ width: "100%", boxSizing: "border-box", marginTop: 10, background: "var(--sf2)", border: "1px solid var(--acc)", borderRadius: 10, padding: "7px 12px", fontSize: 12.5, color: "var(--t2)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
            />
          ) : (
            <button
              onClick={() => { setDescVal(pack.description ?? ""); setDescEditing(true); }}
              title="Edit the description"
              style={{ display: "block", marginTop: 10, textAlign: "left", background: "none", border: "none", padding: 0, fontSize: 12.5, lineHeight: 1.5, color: pack.description ? "var(--t5)" : "var(--t7)", cursor: "text", fontFamily: "var(--font-sans), sans-serif" }}
            >
              {pack.description || "Add a description…"}
            </button>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", padding: "16px 26px", gap: 18 }}>
          {/* members */}
          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--acc)", marginBottom: 10 }}>
              MEMBERS · {members === null ? "…" : members.length}
            </div>
            {members !== null && members.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--t6)", lineHeight: 1.6 }}>Empty pack — search below to add people.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
              {(members ?? []).map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--ln3)", borderRadius: 10, padding: "8px 11px", background: "var(--sf2)" }}>
                  <span style={{ ...mono, width: 26, height: 26, borderRadius: "50%", flex: "none", background: "var(--sf)", border: "1px solid var(--ln5)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--t4)" }}>
                    {m.spec.initials}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.spec.name}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.spec.role}</span>
                  </span>
                  <button
                    onClick={() => saveMembers(membersRef.current.filter((x) => x.id !== m.id))}
                    aria-label={`Remove ${m.spec.name}`}
                    style={{ flex: "none", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* add people */}
          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", marginBottom: 10 }}>
              ADD PEOPLE{full ? " · PACK FULL" : ""}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your personas and the library — “grid engineer”, “under-40 renter”…"
              style={{ width: "100%", boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "10px 16px", fontSize: 13, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln4)")}
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8, marginTop: 12 }}>
              {mineFiltered.slice(0, 6).map((r) => <ResultRow key={r.id} r={r} />)}
              {libResults.map((r) => <ResultRow key={r.id} r={r} />)}
            </div>
            {query.trim() && !searching && libResults.length === 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--t6)" }}>No library matches for “{query}”.</div>
            )}
            {searching && <div style={{ ...mono, marginTop: 10, fontSize: 9, letterSpacing: ".07em", color: "var(--t6)" }}>SEARCHING…</div>}
          </div>
        </div>

        <div style={{ padding: "14px 26px", borderTop: "1px solid var(--ln3)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {error && <span style={{ ...mono, fontSize: 10, color: "var(--warn)" }}>{error.toUpperCase().slice(0, 90)}</span>}
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t7)" }}>
            {pack.kind === "panel"
              ? "SEATS LEADS IN A SIMULATION · JOINS GROUP CHATS"
              : "SEEDS THE POLLED CROWD IN A SIMULATION"}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => (confirmDel
              ? void fetch(`/api/packs/${pack.id}`, { method: "DELETE" }).then(() => onDeleted(pack.id))
              : setConfirmDel(true))}
            onBlur={() => setConfirmDel(false)}
            style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, cursor: "pointer", border: `1px solid ${confirmDel ? "var(--warn)" : "var(--ln5)"}`, background: confirmDel ? "var(--warn-dim)" : "transparent", color: confirmDel ? "var(--warn)" : "var(--t6)" }}
          >
            {confirmDel ? "CONFIRM — DELETE PACK?" : "DELETE PACK"}
          </button>
          <button
            onClick={() => {
              const ids = (members ?? []).map((m) => m.id).slice(0, 20);
              if (ids.length) router.push(`/conversations?draft=${ids.join(",")}`);
            }}
            disabled={(members?.length ?? 0) === 0}
            className="btnAcc"
            style={{ padding: "9px 20px", fontSize: 13, opacity: (members?.length ?? 0) ? 1 : 0.5 }}
          >
            {(members?.length ?? 0) > 20 ? "Chat with the first 20 →" : "Use in a chat →"}
          </button>
        </div>
      </div>
    </div>
  );
}
