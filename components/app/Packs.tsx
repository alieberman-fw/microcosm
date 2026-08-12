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
import PersonaProfile from "@/components/app/PersonaProfile";
import PersonaEditor from "@/components/app/PersonaEditor";
import CastingTheater from "@/components/app/CastingTheater";
import Orb from "@/components/app/Orb";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface PackMemberRow { id: string; kind: string; spec: PersonaSpec; source?: "library" | "custom" }

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

export function PacksSection({ orgId, onCount, createNonce = 0 }: {
  orgId: string;
  onCount?: (n: number) => void;
  /** the page header's "+ New pack" bumps this to open the create card */
  createNonce?: number;
}) {
  const [packs, setPacks] = useState<PackSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<PackKind>("panel");
  const [open, setOpen] = useState<PackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | PackKind>("all");
  // describe-to-cast (the Pack Director)
  const [castPrompt, setCastPrompt] = useState("");
  const [castKind, setCastKind] = useState<PackKind | "auto">("auto");
  const [casting, setCasting] = useState<null | {
    status: string; name?: string; kind?: string; count?: number;
    clamped?: boolean; requested?: number;
    landed: { name: string; provenance: string }[];
  }>(null);

  // the page header's "+ New pack" opens the create card
  useEffect(() => { if (createNonce > 0) { setCreating(true); setError(null); } }, [createNonce]);

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

  /** the Pack Director: describe the roster, watch members land live */
  const castPack = async () => {
    const prompt = castPrompt.trim();
    if (!prompt || casting) return;
    setError(null);
    setCasting({ status: "PLANNING THE ROSTER…", landed: [] });
    try {
      const res = await fetch("/api/packs/cast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, kind: castKind === "auto" ? undefined : castKind }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Casting failed");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let packId: string | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type?: string; name?: string; kind?: string; count?: number; clamped?: boolean; requested?: number; provenance?: string; member?: PackMemberRow; role?: string; packId?: string; error?: string } = {};
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === "plan") {
            setCasting((c) => c && ({ ...c, status: "MATCHING & GENERATING…", name: evt.name, kind: evt.kind, count: evt.count, clamped: evt.clamped, requested: evt.requested }));
          }
          if (evt.type === "member") {
            const name = evt.member?.spec?.name ?? evt.role ?? "…";
            setCasting((c) => c && ({ ...c, landed: [...c.landed, { name, provenance: evt.provenance ?? "library" }] }));
          }
          if (evt.type === "error") throw new Error(evt.error ?? "Casting failed");
          if (evt.type === "done" && evt.packId) packId = evt.packId;
        }
      }
      const data = await (await fetch("/api/packs")).json();
      const list: PackSummary[] = data.packs ?? [];
      setPacks(list);
      onCount?.(list.length);
      setCasting(null);
      setCastPrompt("");
      setCreating(false);
      const fresh = list.find((p) => p.id === packId);
      if (fresh) setOpen(fresh);
    } catch (e) {
      setCasting(null);
      setError(e instanceof Error ? e.message : "Casting failed");
    }
  };

  const shown = (packs ?? []).filter((p) => kindFilter === "all" || p.kind === kindFilter);
  const countOf = (k: PackKind) => (packs ?? []).filter((p) => p.kind === k).length;

  return (
    <div style={{ marginTop: 24 }}>
      {/* toolbar: what packs are + the kind filter */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--t5)", maxWidth: 560, flex: "1 1 380px" }}>
          Packs are reusable rosters. A <span style={{ color: "var(--t3)" }}>panel pack</span> drops into a simulation as lead seats or a group chat as participants;
          a <span style={{ color: "var(--t3)" }}>crowd pack</span> seeds the polled crowd. Build once — &ldquo;Phoenix data-center diligence panel&rdquo; — reuse everywhere.
        </p>
        <span style={{ display: "inline-flex", gap: 6, flex: "none", paddingTop: 2 }}>
          {([["all", `ALL · ${(packs ?? []).length}`], ["panel", `PANEL · ${countOf("panel")}`], ["crowd", `CROWD · ${countOf("crowd")}`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKindFilter(k)} style={{
              ...mono, fontSize: 9, letterSpacing: ".06em", padding: "6px 13px", borderRadius: 100, cursor: "pointer",
              border: `1px solid ${kindFilter === k ? "var(--acc)" : "var(--ln5)"}`,
              background: kindFilter === k ? "var(--acc-dim)" : "transparent",
              color: kindFilter === k ? "var(--acc)" : "var(--t5)",
            }}>
              {label}
            </button>
          ))}
        </span>
      </div>

      {creating && !casting && (
        <div className="card" style={{ marginTop: 20, padding: "24px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="kicker">New pack</div>
            <div style={{ marginTop: 8, fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em" }}>Describe it — the director casts the whole roster</div>
          </div>
          <textarea
            autoFocus
            value={castPrompt}
            onChange={(e) => setCastPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void castPack(); } if (e.key === "Escape") setCreating(false); }}
            rows={3}
            placeholder="A team of 25 investors focused on REITs, autonomous vehicles, and urban infill land…"
            style={{ width: "100%", boxSizing: "border-box", resize: "none", background: "var(--sf2)", border: "1px solid var(--ln4)", borderRadius: 14, padding: "13px 16px", fontSize: 14, lineHeight: 1.55, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln4)")}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", flex: "none" }}>KIND</span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {(["auto", "panel", "crowd"] as const).map((k) => (
                <button key={k} onClick={() => setCastKind(k)} title={k === "auto" ? "Let the director decide from the description" : k === "panel" ? "Named professionals who deliberate (≤20)" : "A population polled for sentiment (≤200)"} style={{
                  ...mono, fontSize: 9, letterSpacing: ".06em", padding: "6px 13px", borderRadius: 100, cursor: "pointer",
                  border: `1px solid ${castKind === k ? "var(--acc)" : "var(--ln5)"}`,
                  background: castKind === k ? "var(--acc-dim)" : "transparent",
                  color: castKind === k ? "var(--acc)" : "var(--t5)",
                }}>
                  {k.toUpperCase()}
                </button>
              ))}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setCreating(false)} style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer" }}>
              CANCEL
            </button>
            <button onClick={() => void castPack()} disabled={!castPrompt.trim()} className="btnAcc" style={{ padding: "10px 24px", fontSize: 13.5, opacity: castPrompt.trim() ? 1 : 0.5 }}>
              Cast the pack
            </button>
          </div>

          {/* the quiet path: an empty pack, filled by hand */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 14, borderTop: "1px solid var(--ln2)" }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", flex: "none" }}>OR START EMPTY</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
              placeholder="Pack name…"
              style={{ flex: 1, minWidth: 200, background: "var(--sf2)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "8px 15px", fontSize: 12.5, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
            />
            <span style={{ display: "inline-flex", gap: 4, flex: "none" }}>
              {(["panel", "crowd"] as const).map((k) => (
                <button key={k} onClick={() => setNewKind(k)} style={{
                  ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "5px 11px", borderRadius: 100, cursor: "pointer",
                  border: `1px solid ${newKind === k ? "var(--acc)" : "var(--ln5)"}`,
                  background: newKind === k ? "var(--acc-dim)" : "transparent",
                  color: newKind === k ? "var(--acc)" : "var(--t6)",
                }}>
                  {k.toUpperCase()}
                </button>
              ))}
            </span>
            <button onClick={() => void create()} disabled={!newName.trim()} style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "7px 15px", borderRadius: 100, border: "1px solid var(--ln6)", background: "transparent", color: newName.trim() ? "var(--t3)" : "var(--t6)", cursor: newName.trim() ? "pointer" : "default", flex: "none" }}>
              CREATE
            </button>
          </div>
        </div>
      )}

      {/* the casting theater — the §5 node/pulse grammar plays while the
          director works; members land as chips beneath it */}
      {casting && (
        <div className="card" style={{ marginTop: 20, padding: "22px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.2s ease infinite", flex: "none" }} />
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--acc)" }}>{casting.status}</span>
            {casting.name && (
              <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t4)" }}>
                {casting.name.toUpperCase()} · {String(casting.kind).toUpperCase()} · {casting.landed.length}/{casting.count}
              </span>
            )}
            {casting.clamped && (
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--warn)" }}>
                ASKED FOR {casting.requested} — CASTING CAPS AT {casting.count}; ADD MORE BY SEARCH
              </span>
            )}
          </div>
          <CastingTheater compact height={150} label="THE PACK DIRECTOR IS CASTING" />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {casting.landed.map((m, i) => (
              <span key={i} style={{
                ...mono, fontSize: 8.5, letterSpacing: ".04em", padding: "4px 11px", borderRadius: 100,
                border: `1px solid ${m.provenance === "generated" ? "var(--acc)" : m.provenance === "failed" ? "var(--warn)" : "var(--ln5)"}`,
                background: m.provenance === "generated" ? "var(--acc-dim)" : "var(--sf2)",
                color: m.provenance === "failed" ? "var(--warn)" : m.provenance === "generated" ? "var(--acc)" : "var(--t4)",
                animation: "fadeUp .25s ease both",
              }}>
                {m.name.toUpperCase()}{m.provenance === "generated" ? " · NEW" : m.provenance === "yours" ? " · YOURS" : ""}
              </span>
            ))}
          </div>
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
      {packs !== null && packs.length > 0 && shown.length === 0 && (
        <div style={{ ...mono, marginTop: 24, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
          NO {kindFilter.toUpperCase()} PACKS YET
        </div>
      )}

      <div className="grid3" style={{ marginTop: 22 }}>
        {shown.map((p) => (
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
          orgId={orgId}
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

function PackModal({ pack, orgId, onClose, onChanged, onDeleted }: {
  pack: PackSummary;
  orgId: string;
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
  // one-liner member draft + member profile/editor
  const [addMode, setAddMode] = useState<"search" | "describe">("search");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [profileM, setProfileM] = useState<PackMemberRow | null>(null);
  const [editing, setEditing] = useState<{ member: PackMemberRow; mode: "edit" | "remix" } | null>(null);

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

  /** one-liner draft: the model writes a NEW persona and the server appends
   *  it to the pack — no PATCH here (the draft route already saved it) */
  const draftMember = async () => {
    const prompt = draftPrompt.trim();
    if (!prompt || drafting || full) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch(`/api/packs/${pack.id}/draft`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Draft failed");
      const member = data.member as PackMemberRow;
      const next = [...membersRef.current, member];
      membersRef.current = next;
      setMembers(next);
      setDraftPrompt("");
      onChanged({ ...pack, count: next.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setDrafting(false);
    }
  };

  /** editor save: edits update the member in place; remixes of library
   *  personas SWAP the pack to the new editable copy */
  const onEditorSaved = (row: { id: string; kind: string; spec: PersonaSpec }) => {
    if (!editing) return;
    const next = editing.mode === "remix"
      ? membersRef.current.map((m) => (m.id === editing.member.id ? { id: row.id, kind: row.kind, spec: row.spec, source: "custom" as const } : m))
      : membersRef.current.map((m) => (m.id === row.id ? { ...m, kind: row.kind, spec: row.spec } : m));
    if (editing.mode === "remix") commitMembers(next);
    else { membersRef.current = next; setMembers(next); }
    setEditing(null);
    setProfileM(null);
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
                {/* field report: the click-to-rename was invisible — nobody
                    found it staring straight at it. The pencil says it's live. */}
                <span aria-hidden style={{ ...mono, fontSize: 12, color: "var(--t6)", marginLeft: 8, fontWeight: 400 }}>✎</span>
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
              {/* a member is being written — the pending slot shimmers */}
              {drafting && (
                <div style={{ display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--acc)", borderRadius: 10, padding: "8px 11px", background: "var(--acc-dim)" }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", flex: "none", background: "linear-gradient(90deg, var(--sf2) 25%, var(--ln3) 50%, var(--sf2) 75%)", backgroundSize: "200px 100%", animation: "shim 1.1s linear infinite" }} />
                  <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ height: 10, width: "62%", borderRadius: 5, background: "linear-gradient(90deg, var(--sf2) 25%, var(--ln3) 50%, var(--sf2) 75%)", backgroundSize: "200px 100%", animation: "shim 1.1s linear infinite" }} />
                    <span style={{ height: 8, width: "84%", borderRadius: 5, background: "linear-gradient(90deg, var(--sf2) 25%, var(--ln3) 50%, var(--sf2) 75%)", backgroundSize: "200px 100%", animation: "shim 1.1s linear infinite" }} />
                  </span>
                  <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".08em", color: "var(--acc)", flex: "none" }}>WRITING…</span>
                </div>
              )}
              {(members ?? []).map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--ln3)", borderRadius: 10, padding: "8px 11px", background: "var(--sf2)" }}>
                  <span style={{ ...mono, width: 26, height: 26, borderRadius: "50%", flex: "none", background: m.source === "custom" ? "var(--acc-dim)" : "var(--sf)", border: `1px solid ${m.source === "custom" ? "var(--acc)" : "var(--ln5)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: m.source === "custom" ? "var(--acc)" : "var(--t4)" }}>
                    {m.spec.initials}
                  </span>
                  <button
                    onClick={() => setProfileM(m)}
                    title="View profile"
                    style={{ minWidth: 0, flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                  >
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sans), sans-serif" }}>{m.spec.name}</span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-sans), sans-serif" }}>{m.spec.role}</span>
                  </button>
                  <button
                    onClick={() => setEditing({ member: m, mode: m.source === "custom" ? "edit" : "remix" })}
                    title={m.source === "custom" ? "Edit this persona" : "Edit — library personas fork into your editable copy"}
                    aria-label={`Edit ${m.spec.name}`}
                    style={{ flex: "none", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 11.5, lineHeight: 1, padding: "0 2px" }}
                  >
                    ✎
                  </button>
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
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
                ADD PEOPLE{full ? " · PACK FULL" : ""}
              </span>
              {/* one control, two ways in: find someone, or write someone */}
              <span style={{ display: "inline-flex", gap: 0, border: "1px solid var(--ln4)", borderRadius: 100, padding: 2 }}>
                {([["search", "SEARCH THE LIBRARY"], ["describe", "DESCRIBE SOMEONE NEW"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setAddMode(k)} style={{
                    ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "5px 13px", borderRadius: 100, cursor: "pointer", border: "none",
                    background: addMode === k ? "var(--acc)" : "transparent",
                    color: addMode === k ? "var(--acc-c)" : "var(--t5)",
                    transition: "background .15s, color .15s",
                  }}>
                    {label}
                  </button>
                ))}
              </span>
            </div>
            {addMode === "search" ? (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your personas and the library — “grid engineer”, “under-40 renter”…"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "10px 16px", fontSize: 13, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln4)")}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void draftMember(); }}
                  disabled={drafting || full}
                  placeholder="A land-use attorney who's fought three data-center CUPs…"
                  style={{ flex: 1, minWidth: 0, boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "10px 16px", fontSize: 13, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif", opacity: full ? 0.5 : 1 }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln4)")}
                />
                <button
                  onClick={() => void draftMember()}
                  disabled={!draftPrompt.trim() || drafting || full}
                  className="btnAcc"
                  style={{ flex: "none", padding: "9px 20px", fontSize: 12.5, opacity: draftPrompt.trim() && !drafting && !full ? 1 : 0.5 }}
                >
                  {drafting ? "Writing…" : "Generate"}
                </button>
              </div>
            )}
            {addMode === "search" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8, marginTop: 12 }}>
                  {mineFiltered.slice(0, 6).map((r) => <ResultRow key={r.id} r={r} />)}
                  {libResults.map((r) => <ResultRow key={r.id} r={r} />)}
                </div>
                {query.trim() && !searching && libResults.length === 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--t6)" }}>No library matches for “{query}”.</div>
                )}
                {searching && (
                  <div style={{ ...mono, marginTop: 10, fontSize: 9, letterSpacing: ".07em", color: "var(--t6)", display: "flex", alignItems: "center", gap: 8 }}>
                    <Orb state="searching" size={20} aria-label="Searching the library" /> SEARCHING…
                  </div>
                )}
              </>
            )}
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
            title={(members?.length ?? 0) > 20 ? "Rooms cap at 20 — the first 20 join" : "Open a group chat with this pack"}
            style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, cursor: (members?.length ?? 0) ? "pointer" : "default", border: "1px solid var(--ln6)", background: "transparent", color: (members?.length ?? 0) ? "var(--t3)" : "var(--t6)" }}
          >
            USE IN A CHAT →
          </button>
          {/* every change already persisted — this closes with that promise */}
          <button onClick={onClose} className="btnAcc" style={{ padding: "9px 24px", fontSize: 13 }}>
            Save pack
          </button>
        </div>
      </div>

      {/* member profile + editor — edits update in place, remixes swap the
          pack to the new editable copy */}
      {profileM && !editing && (
        <PersonaProfile
          kind={profileM.kind}
          spec={profileM.spec}
          chatKey={profileM.id}
          source={profileM.source ?? "library"}
          showChatCta={false}
          onClose={() => setProfileM(null)}
          onRemix={() => setEditing({ member: profileM, mode: profileM.source === "custom" ? "edit" : "remix" })}
        />
      )}
      {editing && (
        <PersonaEditor
          orgId={orgId}
          mode={editing.mode}
          source={editing.mode === "edit"
            ? { id: editing.member.id, kind: editing.member.kind, spec: editing.member.spec }
            : { key: editing.member.id, kind: editing.member.kind, spec: editing.member.spec }}
          onClose={() => setEditing(null)}
          onSaved={onEditorSaved}
        />
      )}
    </div>
  );
}
