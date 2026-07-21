"use client";

/**
 * Full persona editor — create a custom persona, edit an existing one, or
 * REMIX any persona (library or custom) into your own library. Exposes every
 * field the generated library carries: identity, story, demographics, and
 * behavioral traits. Remixes carry spec.lineage — the chain of ancestors —
 * so a remix of a remix keeps its full history.
 */

import { CSSProperties, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PersonaSpec } from "@/lib/personas";
import { US_CITIES, US_STATES } from "@/lib/us-cities";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--sf2)",
  border: "1px solid var(--ln5)", borderRadius: 10, padding: "10px 13px",
  fontSize: 13.5, color: "var(--t1)", outline: "none", fontFamily: "inherit",
};

const label: CSSProperties = { ...mono, display: "block", fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)", marginBottom: 6, textTransform: "uppercase" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)", textTransform: "uppercase", paddingBottom: 10, borderBottom: "1px solid var(--ln2)", marginBottom: 16 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Trait({ name, value, onChange }: { name: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>{name}</span>
        <span style={{ ...mono, fontSize: 9.5, color: "var(--acc)" }}>{value}</span>
      </div>
      <input
        type="range" min={0} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--acc)", height: 4 }}
      />
    </div>
  );
}

export interface EditorSource {
  id?: string;          // set when editing an existing custom persona
  key?: string;         // library id / custom id of the remix source
  kind: string;
  spec: PersonaSpec;
}

export default function PersonaEditor({
  orgId, mode, source, onClose, onSaved,
}: {
  orgId: string;
  mode: "create" | "edit" | "remix";
  source?: EditorSource | null;
  onClose: () => void;
  onSaved: (row: { id: string; kind: string; spec: PersonaSpec; source: string; created_at: string }) => void;
}) {
  const supabase = createClient();
  const s = source?.spec;
  const d = s?.demographics ?? {};
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // legacy specs embedded the state in the metro ("Kansas City, MO") — split
  // it so CITY and STATE stay separate fields
  const rawMetro = d.metro ?? "";
  const legacy = rawMetro.match(/^(.*?),\s*([A-Z]{2})(?:[–—-][A-Z]{2})*\s*$/);

  const [f, setF] = useState({
    name: mode === "remix" ? "" : s?.name ?? "",
    kind: source?.kind ?? "expert",
    role: s?.role ?? "",
    tagline: s?.tagline ?? "",
    discipline: s?.discipline ?? "",
    backstory: s?.backstory ?? "",
    stances: (s?.stances ?? []).join("\n"),
    skills: (s?.skills ?? []).join(", "),
    age: d.age ? String(d.age) : "",
    gender: d.gender ?? "",
    metro: legacy ? legacy[1] : rawMetro,
    state: d.state ?? (legacy ? legacy[2] : ""),
    years_experience: d.years_experience ? String(d.years_experience) : "",
    credentials: d.credentials ?? "",
    occupation: d.occupation ?? "",
    household: d.household ?? "",
    income_band: d.income_band ?? "",
    tenure: d.tenure ?? "",
    risk: Math.round((s?.traits?.risk_tolerance ?? 0.5) * 100),
    agree: Math.round((s?.traits?.agreeableness ?? 0.5) * 100),
    verbosity: Math.round((s?.traits?.verbosity ?? 0.5) * 100),
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  // verifiable city typeahead
  const [cityOpen, setCityOpen] = useState(false);
  const cityQ = f.metro.trim().toLowerCase();
  const citySuggestions = cityQ.length >= 2
    ? US_CITIES.filter((x) => x.c.toLowerCase().startsWith(cityQ)).slice(0, 8)
    : [];
  const cityVerified = US_CITIES.some(
    (x) => x.c.toLowerCase() === cityQ && (!f.state || x.s === f.state)
  );

  const save = async () => {
    if (!f.name.trim() || !f.role.trim() || !f.backstory.trim()) {
      setErr("Name, role, and backstory are required."); return;
    }
    setBusy(true); setErr(null);
    const demographics = Object.fromEntries(
      Object.entries({
        age: f.age ? Number(f.age) : undefined,
        gender: f.gender || undefined,
        metro: f.metro || undefined,
        state: f.state || undefined,
        years_experience: f.years_experience ? Number(f.years_experience) : undefined,
        credentials: f.credentials || undefined,
        occupation: f.occupation || undefined,
        household: f.household || undefined,
        income_band: f.income_band || undefined,
        tenure: f.tenure || undefined,
      }).filter(([, v]) => v !== undefined)
    );
    // remix lineage: ancestors oldest-first, ending with the direct source
    const lineage = mode === "remix" && source
      ? [...(s?.lineage ?? []), { key: source.key ?? source.id ?? "", name: s?.name ?? "" }]
      : s?.lineage;

    // if the name changed but the story still references the old first name,
    // rewrite those references so the persona stays coherent
    const oldFirst = s?.name?.split(/\s+/)[0];
    const newFirst = f.name.trim().split(/\s+/)[0];
    const renamed = oldFirst && newFirst && oldFirst !== newFirst;
    const fixRefs = (t: string) =>
      renamed ? t.replace(new RegExp(`\\b${oldFirst!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), newFirst) : t;
    const spec: PersonaSpec = {
      ...(mode === "edit" ? s : {}),           // preserve unknown fields on edit
      name: f.name.trim(),
      initials: f.name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
      kind: f.kind as PersonaSpec["kind"],
      role: f.role.trim(),
      tagline: fixRefs(f.tagline.trim()) || undefined,
      discipline: f.discipline.trim().toUpperCase() || undefined,
      backstory: fixRefs(f.backstory.trim()),
      stances: f.stances.split("\n").map((x) => fixRefs(x.trim())).filter(Boolean),
      skills: f.skills.split(",").map((x) => x.trim()).filter(Boolean),
      traits: { risk_tolerance: f.risk / 100, agreeableness: f.agree / 100, verbosity: f.verbosity / 100 },
      demographics,
      ...(lineage?.length ? { lineage } : {}),
    } as PersonaSpec;

    if (mode === "edit" && source?.id) {
      const { data, error } = await supabase!
        .from("personas").update({ kind: spec.kind, spec }).eq("id", source.id)
        .select("id, kind, spec, source, created_at").single();
      setBusy(false);
      if (error) { setErr(error.message); return; }
      onSaved(data as Parameters<typeof onSaved>[0]);
    } else {
      const { data, error } = await supabase!
        .from("personas").insert({ org_id: orgId, kind: spec.kind, spec, source: "manual" })
        .select("id, kind, spec, source, created_at").single();
      setBusy(false);
      if (error) { setErr(error.message); return; }
      onSaved(data as Parameters<typeof onSaved>[0]);
    }
  };

  const title = mode === "edit" ? "Edit persona" : mode === "remix" ? `Remix ${s?.name}` : "New persona";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 97, background: "rgba(10,11,12,.66)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true"
        style={{ background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: "30px 34px 34px", animation: "fadeUp .25s ease both" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h3>
            {mode === "remix" && (
              <span style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".08em", color: "var(--acc)", border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 100, padding: "3px 10px" }}>
                REMIX
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ flex: "none", border: "1px solid var(--ln6)", background: "transparent", color: "var(--t4)", width: 30, height: 30, borderRadius: "50%", cursor: "pointer" }}>×</button>
        </div>
        {mode === "remix" && (
          <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t5)" }}>
            Start from {s?.name} and make them yours — every field is editable. The remix keeps a link back to the original.
          </p>
        )}

        <Section title="Identity">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={label}>Name</label>
              <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={mode === "remix" ? `e.g. a new name — was ${s?.name}` : "Dana K."} style={inputStyle} />
            </div>
            <div>
              <label style={label}>Kind</label>
              <select value={f.kind} onChange={(e) => set({ kind: e.target.value })} style={{ ...inputStyle, appearance: "none" }}>
                {["expert", "consumer", "resident", "stakeholder", "adversarial"].map((k) => (
                  <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Discipline tag</label>
              <input value={f.discipline} onChange={(e) => set({ discipline: e.target.value })} placeholder="CAPITAL, WATER…" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={label}>Role</label>
            <input value={f.role} onChange={(e) => set({ role: e.target.value })} placeholder="Land-use attorney, 20 yrs in Maricopa County" style={inputStyle} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={label}>Tagline — the card one-liner</label>
            <input value={f.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="18 yrs CMBS desks · prices the exit before the entry" style={inputStyle} />
          </div>
        </Section>

        <Section title="Story & positions">
          <div>
            <label style={label}>Backstory</label>
            <textarea value={f.backstory} onChange={(e) => set({ backstory: e.target.value })} rows={5} placeholder="Their career, what they've seen work and fail, what they optimize for…" style={{ ...inputStyle, borderRadius: 12, resize: "vertical" }} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={label}>Standing positions — one per line</label>
            <textarea value={f.stances} onChange={(e) => set({ stances: e.target.value })} rows={3} placeholder={"Distrusts unpriced entitlement risk\nBelieves comps beat models"} style={{ ...inputStyle, borderRadius: 12, resize: "vertical" }} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={label}>Skills — comma separated</label>
            <input value={f.skills} onChange={(e) => set({ skills: e.target.value })} placeholder="CUP hearings, water rights, CEQA strategy" style={inputStyle} />
          </div>
        </Section>

        <Section title="Demographics">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <label style={label}>Age</label>
              <input value={f.age} onChange={(e) => set({ age: e.target.value.replace(/\D/g, "") })} placeholder="41" style={inputStyle} />
            </div>
            <div>
              <label style={label}>Gender</label>
              <select value={f.gender} onChange={(e) => set({ gender: e.target.value })} style={{ ...inputStyle, appearance: "none" }}>
                <option value="">—</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="nonbinary">Nonbinary</option>
              </select>
            </div>
            <div style={{ position: "relative" }}>
              <label style={label}>
                City{" "}
                {f.metro.trim() && (
                  <span style={{ color: cityVerified ? "var(--acc)" : "var(--t7)", letterSpacing: ".05em" }}>
                    {cityVerified ? "· ✓ VERIFIED" : "· UNLISTED"}
                  </span>
                )}
              </label>
              <input
                value={f.metro}
                onChange={(e) => { set({ metro: e.target.value }); setCityOpen(true); }}
                onFocus={() => setCityOpen(true)}
                onBlur={() => setTimeout(() => setCityOpen(false), 150)}
                placeholder="Phoenix"
                style={inputStyle}
              />
              {cityOpen && citySuggestions.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 60, background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 4, maxHeight: 220, overflowY: "auto", boxShadow: "0 14px 34px rgba(0,0,0,.35)", animation: "fadeUp .12s ease both" }}>
                  {citySuggestions.map((x) => (
                    <button
                      key={`${x.c}-${x.s}`}
                      onMouseDown={(e) => { e.preventDefault(); set({ metro: x.c, state: x.s }); setCityOpen(false); }}
                      className="menuItem"
                      style={{ display: "flex", justifyContent: "space-between", gap: 10 }}
                    >
                      <span>{x.c}</span>
                      <span style={{ ...mono, fontSize: 9.5, color: "var(--t6)" }}>{x.s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={label}>State</label>
              <select value={f.state} onChange={(e) => set({ state: e.target.value })} style={{ ...inputStyle, appearance: "none" }}>
                <option value="">—</option>
                {US_STATES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Yrs experience</label>
              <input value={f.years_experience} onChange={(e) => set({ years_experience: e.target.value.replace(/\D/g, "") })} placeholder="15" style={inputStyle} />
            </div>
            <div>
              <label style={label}>Credentials</label>
              <input value={f.credentials} onChange={(e) => set({ credentials: e.target.value })} placeholder="PE, AICP…" style={inputStyle} />
            </div>
            <div>
              <label style={label}>Occupation</label>
              <input value={f.occupation} onChange={(e) => set({ occupation: e.target.value })} placeholder="K-12 teacher" style={inputStyle} />
            </div>
            <div>
              <label style={label}>Tenure</label>
              <select value={f.tenure} onChange={(e) => set({ tenure: e.target.value })} style={{ ...inputStyle, appearance: "none" }}>
                <option value="">—</option>
                <option value="owner">Owner</option>
                <option value="renter">Renter</option>
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={label}>Household</label>
              <input value={f.household} onChange={(e) => set({ household: e.target.value })} placeholder="married, 2 children" style={inputStyle} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={label}>Income band</label>
              <input value={f.income_band} onChange={(e) => set({ income_band: e.target.value })} placeholder="$95–120K" style={inputStyle} />
            </div>
          </div>
        </Section>

        <Section title="Voice & temperament">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            <Trait name="RISK TOLERANCE" value={f.risk} onChange={(v) => set({ risk: v })} />
            <Trait name="AGREEABLENESS" value={f.agree} onChange={(v) => set({ agree: v })} />
            <Trait name="VERBOSITY" value={f.verbosity} onChange={(v) => set({ verbosity: v })} />
          </div>
        </Section>

        {err && (
          <div className="mono" style={{ marginTop: 18, fontSize: 11, borderRadius: 10, padding: "10px 14px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)" }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <button onClick={onClose} className="btnGhost" style={{ padding: "12px 22px", fontSize: 14, borderRadius: 100 }}>Cancel</button>
          <button onClick={save} disabled={busy} className="btnAcc" style={{ padding: "12px 26px", fontSize: 14, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Saving…" : mode === "edit" ? "Save changes" : mode === "remix" ? "Create remix" : "Create persona"}
          </button>
        </div>
      </div>
    </div>
  );
}
