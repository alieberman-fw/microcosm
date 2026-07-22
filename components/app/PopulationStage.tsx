"use client";

/**
 * Stage 3 — Population (CLAUDE.md §3.2A, demo Stage 02 reference).
 * Auto-cast streams the Casting Director (theater → plan → resolving cards);
 * hand-pick assembles seats with zero model calls. The guidance line runs in
 * two modes — RE-CAST ALL (replace the panel) or ADD MORE ("add more pool
 * engineering experts" appends without touching existing seats). The panel
 * is reviewable by kind and provenance filter pills, and the grid caps at
 * ~3 rows with its own scroll so big panels never stretch the page.
 */

import { CSSProperties, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PersonaProfile from "@/components/app/PersonaProfile";
import CastingTheater, { MiniSwarm } from "@/components/app/CastingTheater";
import SeatPicker from "@/components/app/SeatPicker";
import { FrozenSpec, MAX_SEATS, PANEL_SIZES } from "@/lib/casting";
import { PersonaSpec } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface WorkspaceSeat {
  key: string;
  provenance: "yours" | "library" | "generated";
  spec: FrozenSpec;
}

export interface CastingInfo {
  composition: string;
  rationale: string;
  scale: { experts: number; residents: number };
  mode: string;
  modeRationale: string;
}

interface PendingSeat { key: string; role: string; discipline: string; kind: string }

const PROVENANCE_LABEL: Record<string, string> = {
  yours: "YOUR LIBRARY",
  library: "LIBRARY MATCH",
  generated: "GENERATED · SAVED TO YOUR LIBRARY",
};

const KIND_FILTERS = [
  { key: "all", label: "ALL" },
  { key: "expert", label: "EXPERTS" },
  { key: "consumer", label: "CONSUMERS · RESIDENTS" },
  { key: "stakeholder", label: "STAKEHOLDERS" },
  { key: "adversarial", label: "ADVERSARIAL" },
] as const;

const SOURCE_FILTERS = [
  { key: "all", label: "ALL SOURCES" },
  { key: "yours", label: "YOUR LIBRARY" },
  { key: "library", label: "LIBRARY" },
  { key: "generated", label: "NEW · GENERATED" },
] as const;

function seatKindGroup(s: WorkspaceSeat): string {
  if (s.spec.seat?.adversarial || s.spec.kind === "adversarial") return "adversarial";
  if (s.spec.kind === "consumer" || s.spec.kind === "resident") return "consumer";
  if (s.spec.kind === "stakeholder") return "stakeholder";
  return "expert";
}

export default function PopulationStage({
  simId,
  initialSeats,
  initialCasting,
  onCountChange,
}: {
  simId: string;
  initialSeats: WorkspaceSeat[];
  initialCasting: CastingInfo | null;
  onCountChange?: (n: number) => void;
}) {
  const router = useRouter();
  const [seats, setSeats] = useState<WorkspaceSeat[]>(initialSeats);
  const [pending, setPending] = useState<PendingSeat[]>([]);
  const [castingInfo, setCastingInfo] = useState<CastingInfo | null>(initialCasting);
  const [casting, setCasting] = useState(false);
  const [planReady, setPlanReady] = useState(false); // plan arrived → theater gives way to cards
  const [castMode, setCastMode] = useState<"recast" | "add">("recast");
  const [scouting, setScouting] = useState(false); // add-plan in flight, seat count unknown
  const [guidance, setGuidance] = useState("");
  const [guidanceMode, setGuidanceMode] = useState<"recast" | "add">("recast");
  const [panelSize, setPanelSize] = useState<number>(10);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<WorkspaceSeat | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { onCountChange?.(seats.length); }, [seats.length, onCountChange]);

  const cast = async (mode: "recast" | "add" = "recast") => {
    if (casting) return;
    const g = guidance.trim();
    if (mode === "add" && !g) { setError("Describe who to add — e.g. “more pool engineering experts”"); return; }
    setCasting(true);
    setCastMode(mode);
    setPlanReady(mode === "add"); // adding keeps the grid visible; recast opens the theater
    setScouting(mode === "add"); // scouting card until the add-plan names the seats
    setError(null);
    setPending([]);
    if (mode === "recast") setSeats([]);
    try {
      const res = await fetch(`/api/simulations/${simId}/cast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(g ? { guidance: g } : {}), mode, seats: panelSize }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Casting failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (evt: Record<string, unknown>) => {
        if (evt.type === "plan") {
          const p = evt as unknown as CastingInfo & { seats: PendingSeat[]; add?: boolean };
          if (!p.add) {
            setCastingInfo({ composition: p.composition, rationale: p.rationale, scale: p.scale, mode: p.mode, modeRationale: p.modeRationale });
          }
          setPending((p.seats ?? []).map((s) => ({ key: s.key, role: s.role, discipline: s.discipline, kind: s.kind })));
          setPlanReady(true);
          setScouting(false);
        } else if (evt.type === "seat") {
          const key = String(evt.key);
          if (evt.provenance === "failed" || !evt.spec) {
            setPending((prev) => prev.filter((s) => s.key !== key));
            return;
          }
          const seat: WorkspaceSeat = { key, provenance: evt.provenance as WorkspaceSeat["provenance"], spec: evt.spec as FrozenSpec };
          setSeats((prev) => [...prev, seat]);
          setPending((prev) => prev.filter((s) => s.key !== key));
        } else if (evt.type === "error") {
          setError(String(evt.error ?? "Casting failed"));
        } else if (evt.type === "done") {
          setGuidance("");
          router.refresh();
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) handle(JSON.parse(line));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Casting failed");
    } finally {
      setPending([]);
      setScouting(false);
      setCasting(false);
    }
  };

  const removeSeat = async (key: string) => {
    setSeats((prev) => prev.filter((s) => s.key !== key));
    await fetch(`/api/simulations/${simId}/agents/${encodeURIComponent(key)}`, { method: "DELETE" });
  };

  const onAdded = (added: { key: string; provenance: "yours" | "library"; spec: PersonaSpec & { seat?: unknown } }[]) => {
    setSeats((prev) => [...prev, ...added.map((a) => ({ key: a.key, provenance: a.provenance, spec: a.spec as FrozenSpec }))]);
    router.refresh();
  };

  const label: CSSProperties = { ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" };
  const hasCast = seats.length > 0 || pending.length > 0;
  const showTheater = casting && !planReady;
  const remaining = Math.max(0, MAX_SEATS - seats.length);

  const kindCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const s of seats) {
    kindCounts.set(seatKindGroup(s), (kindCounts.get(seatKindGroup(s)) ?? 0) + 1);
    sourceCounts.set(s.provenance, (sourceCounts.get(s.provenance) ?? 0) + 1);
  }
  const visibleSeats = seats.filter((s) =>
    (kindFilter === "all" || seatKindGroup(s) === kindFilter) &&
    (sourceFilter === "all" || s.provenance === sourceFilter)
  );

  const FilterPill = ({ on, count, children, onClick }: { on: boolean; count?: number; children: React.ReactNode; onClick: () => void }) => (
    <button
      onClick={onClick}
      style={{
        ...mono, fontSize: 9, letterSpacing: ".05em", padding: "5px 11px", borderRadius: 100,
        cursor: "pointer", transition: "all .15s",
        background: on ? "var(--acc-dim)" : "transparent",
        border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`,
        color: on ? "var(--acc)" : "var(--t6)",
      }}
    >
      {children}{typeof count === "number" ? ` ${count}` : ""}
    </button>
  );

  return (
    <div id="stage-population" className="card" style={{ padding: "26px 30px", marginTop: 20, scrollMarginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={label}>
          THE POPULATION{seats.length > 0 && ` · ${seats.length} LEAD${seats.length > 1 ? "S" : ""}`}
        </div>
        {castingInfo && (
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", textAlign: "right", lineHeight: 1.9 }}>
            <div>
              <span style={{ color: "var(--acc)" }}>{castingInfo.composition.toUpperCase()}</span>
              {" · MODE "}
              <span style={{ color: "var(--acc)" }}>{castingInfo.mode.toUpperCase()}</span> (RECOMMENDED)
            </div>
            <div title="The cards below are the deliberation leads (up to 20). The full-run crowd is instantiated at run config — experts up to 500, residents up to 1,000 via census seeding.">
              FULL-RUN CROWD · <span style={{ color: "var(--acc)" }}>{castingInfo.scale.experts}</span> EXPERTS
              {castingInfo.scale.residents > 0 && <> · <span style={{ color: "var(--acc)" }}>{castingInfo.scale.residents}</span> RESIDENTS</>}
              {" "}<span style={{ color: "var(--t7)" }}>— SET AT RUN CONFIG (SOON)</span>
            </div>
          </div>
        )}
      </div>
      {castingInfo?.rationale && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t5)", maxWidth: 760 }}>
          {castingInfo.rationale}
          {castingInfo.modeRationale ? <span style={{ color: "var(--t6)" }}> {castingInfo.modeRationale}</span> : null}
        </p>
      )}

      {/* pre-cast: choose how to build the panel */}
      {!hasCast && !casting && (
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
          <div className="card" style={{ padding: "22px 24px", border: "1px solid var(--acc)", background: "var(--acc-dim)" }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--acc)" }}>✦ AUTO-CAST</div>
            <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--t4)" }}>
              The Casting Director reads your brief and documents, drafts the seats the problem needs,
              fills them from your personas and the 1,800-strong library, generates only the true gaps,
              and seeds a skeptic. Editable after.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>PANEL SIZE ·</span>
              {PANEL_SIZES.map((p) => (
                <button
                  key={p.seats}
                  onClick={() => setPanelSize(p.seats)}
                  title={p.desc}
                  style={{
                    ...mono, fontSize: 9, letterSpacing: ".05em", padding: "4px 10px", borderRadius: 100,
                    cursor: "pointer",
                    background: panelSize === p.seats ? "var(--acc)" : "transparent",
                    border: `1px solid ${panelSize === p.seats ? "var(--acc)" : "var(--ln5)"}`,
                    color: panelSize === p.seats ? "var(--acc-c)" : "var(--t5)",
                  }}
                >
                  {p.label} {p.seats}
                </button>
              ))}
            </div>
            <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)", marginTop: 8 }}>
              LEADS ONLY — THE FULL-RUN CROWD (UP TO 500 EXPERTS · 1,000 RESIDENTS) IS SET AT RUN CONFIG
            </div>
            <button
              onClick={() => void cast("recast")}
              style={{
                marginTop: 14, background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600,
                fontSize: 14, padding: "12px 24px", borderRadius: 100, border: "none", cursor: "pointer",
                fontFamily: "var(--font-sans), sans-serif",
              }}
            >
              Cast the population →
            </button>
          </div>
          <div className="card" style={{ padding: "22px 24px" }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--t5)" }}>✎ HAND-PICK</div>
            <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--t5)" }}>
              Know exactly who you want in the room? Assemble the panel yourself from your personas and
              the library — no AI, no tokens spent. You can still auto-cast or add more later.
            </p>
            <button
              onClick={() => setPickerOpen(true)}
              style={{
                marginTop: 16, background: "transparent", color: "var(--t2)", fontWeight: 600,
                fontSize: 14, padding: "12px 24px", borderRadius: 100, border: "1px solid var(--ln7)", cursor: "pointer",
                fontFamily: "var(--font-sans), sans-serif",
              }}
            >
              Pick from the library →
            </button>
          </div>
        </div>
      )}

      {showTheater && <CastingTheater />}

      {/* review filters — by kind and by where each seat came from */}
      {seats.length > 3 && !showTheater && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 18 }}>
          {KIND_FILTERS.map((f) => {
            const count = f.key === "all" ? seats.length : kindCounts.get(f.key) ?? 0;
            if (f.key !== "all" && count === 0) return null;
            return (
              <FilterPill key={f.key} on={kindFilter === f.key} count={count} onClick={() => setKindFilter(f.key)}>
                {f.label}
              </FilterPill>
            );
          })}
          <span style={{ width: 1, height: 16, background: "var(--ln4)", margin: "0 4px" }} />
          {SOURCE_FILTERS.map((f) => {
            const count = f.key === "all" ? seats.length : sourceCounts.get(f.key) ?? 0;
            if (f.key !== "all" && count === 0) return null;
            return (
              <FilterPill key={f.key} on={sourceFilter === f.key} count={count} onClick={() => setSourceFilter(f.key)}>
                {f.label}
              </FilterPill>
            );
          })}
        </div>
      )}

      {(hasCast || (casting && planReady)) && (
        <div
          style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 14, marginTop: 16,
            // big panels scroll inside the card instead of stretching the page
            ...(seats.length + pending.length > 12 ? { maxHeight: 560, overflowY: "auto", paddingRight: 6 } : {}),
          }}
        >
          {visibleSeats.map((s) => {
            const adversarial = s.spec.seat?.adversarial || s.spec.kind === "adversarial";
            return (
              <div
                key={s.key}
                className="seat-card"
                onClick={() => setProfile(s)}
                style={{
                  border: `1px solid ${adversarial ? "var(--warn)" : "var(--ln3)"}`, borderRadius: 14,
                  padding: "20px 20px", background: "var(--sf)", cursor: "pointer", position: "relative",
                  animation: "fadeUp .4s ease both", transition: "border-color .2s",
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); void removeSeat(s.key); }}
                  aria-label={`Remove ${s.spec.name}`}
                  style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", color: "var(--t7)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 }}
                >
                  ×
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 11, color: "var(--t3)", flex: "none" }}>
                    {s.spec.initials}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.25, minWidth: 0 }}>{s.spec.name}</div>
                </div>
                <div style={{ marginTop: 11, fontSize: 12.5, fontWeight: 600, color: "var(--t3)" }}>
                  {s.spec.seat?.role ?? s.spec.role}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.55, color: "var(--t5)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {s.spec.tagline ?? s.spec.seat?.why ?? ""}
                </div>
                <div style={{ marginTop: 12, ...mono, fontSize: 9, letterSpacing: ".06em", color: adversarial ? "var(--warn)" : s.provenance === "library" ? "var(--t6)" : "var(--acc)" }}>
                  {adversarial ? "ADVERSARIAL SEED" : PROVENANCE_LABEL[s.provenance]}
                  {s.spec.seat?.discipline ? ` · ${s.spec.seat.discipline}` : ""}
                </div>
              </div>
            );
          })}
          {scouting && (
            <MiniSwarm label={`SCOUTING ADDITIONS${guidance.trim() ? ` · ${guidance.trim().slice(0, 34).toUpperCase()}` : ""}…`} />
          )}
          {pending.map((p) => (
            castMode === "add" ? (
              <MiniSwarm key={p.key} label={`INCOMING · ${p.role.slice(0, 30).toUpperCase()}`} />
            ) : (
            <div key={p.key} style={{ border: "1px solid var(--ln3)", borderRadius: 14, padding: "20px 20px", background: "var(--sf)", minHeight: 148, boxSizing: "border-box" }}>
              <div style={{ animation: "shim 1.2s ease infinite" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--sf2)", flex: "none" }} />
                  <div style={{ height: 12, borderRadius: 100, background: "var(--sf2)", width: "70%" }} />
                </div>
                <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600, color: "var(--t4)" }}>{p.role}</div>
                <div style={{ marginTop: 9, height: 9, borderRadius: 100, background: "var(--sf2)", width: "60%" }} />
                <div style={{ marginTop: 16, ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t7)" }}>
                  MATCHING · DRAFTING BACKSTORY…
                </div>
              </div>
            </div>
            )
          ))}
          {visibleSeats.length === 0 && pending.length === 0 && seats.length > 0 && (
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--t6)", padding: "18px 4px" }}>
              NO SEATS MATCH THESE FILTERS
            </div>
          )}
        </div>
      )}

      {error && <div style={{ ...mono, fontSize: 11, color: "var(--warn)", marginTop: 16 }}>{error}</div>}

      {hasCast && !casting && (
        <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", border: "1px solid var(--ln4)", borderRadius: 100, overflow: "hidden", flex: "none" }}>
            {(["recast", "add"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setGuidanceMode(m)}
                style={{
                  ...mono, fontSize: 9, letterSpacing: ".06em", padding: "9px 13px", border: "none", cursor: "pointer",
                  background: guidanceMode === m ? "var(--acc-dim)" : "transparent",
                  color: guidanceMode === m ? "var(--acc)" : "var(--t6)",
                }}
              >
                {m === "recast" ? "RE-CAST ALL" : "ADD MORE"}
              </button>
            ))}
          </div>
          <input
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void cast(guidanceMode); }}
            placeholder={guidanceMode === "add"
              ? "Who else? — “add more pool engineering experts”, “a school-board voice”"
              : "Re-cast the whole panel — “more first-time buyers; heavier on capital”"}
            maxLength={500}
            style={{
              flex: 1, minWidth: 200, padding: "11px 16px", background: "var(--sf2)",
              border: "1px solid var(--ln3)", borderRadius: 100,
              fontFamily: "var(--font-sans), sans-serif", fontSize: 13, color: "var(--t1)", outline: "none",
            }}
          />
          <button
            onClick={() => void cast(guidanceMode)}
            disabled={guidanceMode === "add" && (!guidance.trim() || remaining === 0)}
            style={{
              ...mono, fontSize: 10.5, letterSpacing: ".06em", padding: "11px 20px", borderRadius: 100,
              background: "transparent", border: "1px solid var(--ln7)",
              color: guidanceMode === "add" && (!guidance.trim() || remaining === 0) ? "var(--t7)" : "var(--t3)",
              cursor: guidanceMode === "add" && (!guidance.trim() || remaining === 0) ? "default" : "pointer",
            }}
          >
            {casting && castMode === "add" ? "ADDING…" : guidanceMode === "recast" ? "RE-CAST" : `ADD (${remaining} SEATS LEFT)`}
          </button>
          <button
            onClick={() => setPickerOpen(true)}
            disabled={remaining === 0}
            style={{
              ...mono, fontSize: 10.5, letterSpacing: ".06em", padding: "11px 20px", borderRadius: 100,
              background: "transparent", border: "1px solid var(--ln7)", color: remaining ? "var(--acc)" : "var(--t7)",
              cursor: remaining ? "pointer" : "default",
            }}
          >
            + ADD FROM LIBRARY
          </button>
        </div>
      )}

      {pickerOpen && (
        <SeatPicker
          simId={simId}
          remaining={remaining || MAX_SEATS}
          onClose={() => setPickerOpen(false)}
          onAdded={onAdded}
        />
      )}

      {profile && (
        <PersonaProfile
          kind={profile.spec.kind}
          spec={profile.spec}
          chatKey={profile.key}
          source={profile.provenance === "library" ? "library" : "custom"}
          showChatCta={false}
          onClose={() => setProfile(null)}
        />
      )}
    </div>
  );
}
