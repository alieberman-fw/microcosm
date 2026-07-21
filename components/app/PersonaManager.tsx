"use client";

import { CSSProperties, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LIBRARY_PERSONAS, PersonaSpec } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface CustomPersonaRow {
  id: string;
  kind: string;
  spec: PersonaSpec;
  source: string;
  created_at: string;
}

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--sf2)",
  border: "1px solid var(--ln5)", borderRadius: 10, padding: "11px 14px",
  fontSize: 14, color: "var(--t1)", outline: "none", fontFamily: "inherit",
};

const label: CSSProperties = { ...mono, display: "block", fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", marginBottom: 6, textTransform: "uppercase" };

export default function PersonaManager({ orgId, initial }: { orgId: string; initial: CustomPersonaRow[] }) {
  const supabase = createClient();
  const [tab, setTab] = useState<"library" | "custom">("library");
  const [custom, setCustom] = useState<CustomPersonaRow[]>(initial);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", role: "", kind: "expert", backstory: "", stances: "" });
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const libFiltered = q
    ? LIBRARY_PERSONAS.filter((p) => [p.name, p.role, p.tagline ?? "", p.backstory, p.discipline ?? ""].join(" ").toLowerCase().includes(q))
    : LIBRARY_PERSONAS;
  const customFiltered = q
    ? custom.filter((c) => [c.spec.name, c.spec.role, c.spec.backstory].join(" ").toLowerCase().includes(q))
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
          <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>Your personas</h1>
          <p style={{ margin: "12px 0 0", maxWidth: 560, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
            Library personas ship with Microcosm; custom personas are yours — reusable in simulations and available in Conversations.
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
            {t === "library" ? `LIBRARY · ${libFiltered.length}` : `CUSTOM · ${customFiltered.length}`}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, role, or background…"
          style={{ flex: 1, minWidth: 220, boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "9px 18px", fontSize: 13, color: "var(--t1)", outline: "none" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
        />
      </div>

      {err && (
        <div className="mono" style={{ marginTop: 16, fontSize: 11, borderRadius: 10, padding: "10px 14px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)" }}>
          {err}
        </div>
      )}

      <div className="grid3" style={{ marginTop: 24 }}>
        {tab === "library" &&
          libFiltered.map((p) => (
            <div key={p.key} className="card cardHoverQuiet" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ ...mono, width: 38, height: 38, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--t2)" }}>
                  {p.initials}
                </span>
                <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: p.kind === "adversarial" ? "var(--warn)" : "var(--t7)", border: `1px solid ${p.kind === "adversarial" ? "var(--warn)" : "var(--ln5)"}`, borderRadius: 100, padding: "3px 9px" }}>
                  {p.kind === "adversarial" ? "ADVERSARIAL" : p.discipline}
                </span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{p.name}</h3>
                <div style={{ fontSize: 12.5, color: "var(--t5)", marginTop: 3 }}>{p.role}</div>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--t6)" }}>{p.tagline}</p>
              <div style={{ marginTop: "auto", paddingTop: 8 }}>
                <Link href={`/conversations?with=${p.key}`} style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--acc)" }}>
                  START A CONVERSATION →
                </Link>
              </div>
            </div>
          ))}

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
            <div key={c.id} className="card cardHoverQuiet" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ ...mono, width: 38, height: 38, borderRadius: "50%", background: "var(--acc-dim)", border: "1px solid var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--acc)" }}>
                  {c.spec.initials}
                </span>
                <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t7)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "3px 9px" }}>
                  {c.kind.toUpperCase()}
                </span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{c.spec.name}</h3>
                <div style={{ fontSize: 12.5, color: "var(--t5)", marginTop: 3 }}>{c.spec.role}</div>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--t6)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {c.spec.backstory}
              </p>
              <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Link href={`/conversations?with=${c.id}`} style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--acc)" }}>
                  CHAT →
                </Link>
                <button onClick={() => remove(c.id)} style={{ ...mono, background: "none", border: "none", cursor: "pointer", fontSize: 10, letterSpacing: ".05em", color: "var(--t7)" }}>
                  DELETE
                </button>
              </div>
            </div>
          ))}
      </div>

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
