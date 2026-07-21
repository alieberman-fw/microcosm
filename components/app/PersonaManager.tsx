"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PersonaSpec } from "@/lib/personas";
import PersonaProfile, { kindChip } from "@/components/app/PersonaProfile";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface CustomPersonaRow {
  id: string;
  kind: string;
  spec: PersonaSpec;
  source: string;
  created_at: string;
}

/** A global library persona row (org_id null, source 'library'). */
export interface LibraryRow {
  id: string;
  kind: string;
  spec: PersonaSpec;
}

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--sf2)",
  border: "1px solid var(--ln5)", borderRadius: 10, padding: "11px 14px",
  fontSize: 14, color: "var(--t1)", outline: "none", fontFamily: "inherit",
};

const label: CSSProperties = { ...mono, display: "block", fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", marginBottom: 6, textTransform: "uppercase" };

/** One demographic line for cards: "54 · Columbus, OH". */
function demoLine(spec: PersonaSpec) {
  const d = spec.demographics;
  if (!d) return null;
  return [d.age, d.metro].filter(Boolean).join(" · ") || null;
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
  orgId, initial, library, libraryCount,
}: {
  orgId: string; initial: CustomPersonaRow[]; library: LibraryRow[]; libraryCount: number;
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<"library" | "custom">("library");
  const [custom, setCustom] = useState<CustomPersonaRow[]>(initial);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", role: "", kind: "expert", backstory: "", stances: "" });

  const [search, setSearch] = useState("");
  const [libRows, setLibRows] = useState<LibraryRow[]>(library);
  const [searching, setSearching] = useState(false);
  const [smart, setSmart] = useState(false);
  const [profile, setProfile] = useState<{ kind: string; spec: PersonaSpec; chatKey: string; source: string } | null>(null);
  const reqSeq = useRef(0);

  const q = search.trim();

  // library search: debounced call to the smart-search endpoint
  useEffect(() => {
    if (tab !== "library") return;
    if (!q) { setLibRows(library); setSmart(false); setSearching(false); return; }
    setSearching(true);
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/personas/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, limit: 60 }),
        });
        const json = await res.json();
        if (seq !== reqSeq.current) return; // a newer query superseded this one
        if (res.ok) { setLibRows(json.personas as LibraryRow[]); setSmart(Boolean(json.smart)); }
      } finally {
        if (seq === reqSeq.current) setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [q, tab, library]);

  const ql = q.toLowerCase();
  const customFiltered = ql
    ? custom.filter((c) => [c.spec.name, c.spec.role, c.spec.backstory].join(" ").toLowerCase().includes(ql))
    : custom;

  const create = async () => {
    if (!form.name.trim() || !form.role.trim() || !form.backstory.trim()) {
      setErr("Name, role, and backstory are required."); return;
    }
    setBusy(true); setErr(null);
    const spec: PersonaSpec = {
      name: form.name.trim(),
      initials: form.name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
      role: form.role.trim(),
      kind: form.kind as PersonaSpec["kind"],
      backstory: form.backstory.trim(),
      stances: form.stances.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    const { data, error } = await supabase!
      .from("personas")
      .insert({ org_id: orgId, kind: spec.kind, spec, source: "manual" })
      .select("id, kind, spec, source, created_at")
      .single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setCustom([data as CustomPersonaRow, ...custom]);
    setForm({ name: "", role: "", kind: "expert", backstory: "", stances: "" });
    setCreating(false);
    setTab("custom");
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
        <button onClick={() => { setCreating(true); setErr(null); }} className="btnAcc" style={{ padding: "11px 22px", fontSize: 14 }}>
          + New persona
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 30, alignItems: "center", flexWrap: "wrap" }}>
        {(["library", "custom"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...mono, fontSize: 11, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100, cursor: "pointer",
              border: `1px solid ${tab === t ? "var(--acc)" : "var(--ln6)"}`,
              background: tab === t ? "var(--acc-dim)" : "transparent",
              color: tab === t ? "var(--acc)" : "var(--t5)",
            }}
          >
            {t === "library" ? `LIBRARY · ${(q ? libRows.length : libraryCount).toLocaleString()}` : `CUSTOM · ${customFiltered.length}`}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === "library" ? "Try “looking to build a data center” or “under 40 homeowner”…" : "Search your personas…"}
          style={{ flex: 1, minWidth: 260, boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "9px 18px", fontSize: 13, color: "var(--t1)", outline: "none" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
        />
      </div>

      {tab === "library" && q && !searching && (
        <div style={{ ...mono, marginTop: 14, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
          {libRows.length === 0 ? "NO MATCHES — TRY BROADER LANGUAGE" : `${libRows.length} MATCH${libRows.length === 1 ? "" : "ES"}`}
          {smart && <span style={{ color: "var(--acc)" }}> · AI-MATCHED</span>}
        </div>
      )}

      {err && (
        <div className="mono" style={{ marginTop: 16, fontSize: 11, borderRadius: 10, padding: "10px 14px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)" }}>
          {err}
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
          customFiltered.map((c) => (
            <div
              key={c.id}
              className="card cardHoverQuiet"
              onClick={() => setProfile({ kind: c.kind, spec: c.spec, chatKey: c.id, source: "custom" })}
              style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10, cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ ...mono, width: 38, height: 38, borderRadius: "50%", background: "var(--acc-dim)", border: "1px solid var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--acc)" }}>
                  {c.spec.initials}
                </span>
                <span style={kindChip(false)}>{c.kind}</span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{c.spec.name}</h3>
                <div style={{ fontSize: 12.5, color: "var(--t5)", marginTop: 3 }}>{c.spec.role}</div>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--t6)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {c.spec.backstory}
              </p>
              <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--acc)" }}>VIEW PROFILE →</span>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(c.id); }}
                  style={{ ...mono, background: "none", border: "none", cursor: "pointer", fontSize: 10, letterSpacing: ".05em", color: "var(--t7)" }}
                >
                  DELETE
                </button>
              </div>
            </div>
          ))}
      </div>

      {tab === "library" && !q && libraryCount > libRows.length && (
        <div style={{ ...mono, marginTop: 26, fontSize: 10, letterSpacing: ".08em", color: "var(--t7)", textAlign: "center" }}>
          SHOWING {libRows.length} OF {libraryCount.toLocaleString()} — SEARCH TO FIND ANYONE
        </div>
      )}

      {profile && <PersonaProfile {...profile} onClose={() => setProfile(null)} />}

      {/* create dialog */}
      {creating && (
        <div
          onClick={() => setCreating(false)}
          style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(10,11,12,.66)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true"
            style={{ background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, maxWidth: 560, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: "30px 32px", animation: "fadeUp .25s ease both" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>New persona</h3>
              <button onClick={() => setCreating(false)} aria-label="Close" style={{ border: "1px solid var(--ln6)", background: "transparent", color: "var(--t4)", width: 30, height: 30, borderRadius: "50%", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={label}>Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dana K." style={inputStyle} />
                </div>
                <div>
                  <label style={label}>Kind</label>
                  <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={{ ...inputStyle, appearance: "none" }}>
                    <option value="expert">Expert</option>
                    <option value="consumer">Consumer</option>
                    <option value="resident">Resident</option>
                    <option value="stakeholder">Stakeholder</option>
                    <option value="adversarial">Adversarial</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={label}>Role</label>
                <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Land-use attorney, 20 yrs in Maricopa County" style={inputStyle} />
              </div>
              <div>
                <label style={label}>Backstory</label>
                <textarea value={form.backstory} onChange={(e) => setForm({ ...form, backstory: e.target.value })} rows={5} placeholder="Their career, what they've seen work and fail, what they optimize for…" style={{ ...inputStyle, borderRadius: 12, resize: "vertical" }} />
              </div>
              <div>
                <label style={label}>Stances — one per line</label>
                <textarea value={form.stances} onChange={(e) => setForm({ ...form, stances: e.target.value })} rows={3} placeholder={"Distrusts unpriced entitlement risk\nBelieves comps beat models"} style={{ ...inputStyle, borderRadius: 12, resize: "vertical" }} />
              </div>
              <button onClick={create} disabled={busy} className="btnAcc" style={{ padding: "12px 24px", fontSize: 14.5, opacity: busy ? 0.6 : 1 }}>
                {busy ? "Creating…" : "Create persona"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
