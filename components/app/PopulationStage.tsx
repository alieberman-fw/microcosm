"use client";

/**
 * Stage 3 — Population (CLAUDE.md §3 Stage 3, demo Stage 02 reference).
 * The whole population lives here: the ≤20 deliberation LEADS as cards, and
 * the full-run CROWD as a dot-field band with editable counts (experts
 * 4-500 · residents 0-1000, §4.1) — instantiated by the engine at run time.
 * The §3 composition selector is the first control: AUTO lets the Casting
 * Director decide; EXPERTS / RESIDENTS / MIXED force it (pre-cast, or
 * re-cast to apply after). The seven interaction modes are selectable and
 * persist; the readout distinguishes YOURS from RECOMMENDED. Guidance runs
 * as RE-CAST ALL or ADD MORE; filters review the panel by kind and source.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PersonaProfile from "@/components/app/PersonaProfile";
import CastingTheater, { CrowdBand, MiniSwarm } from "@/components/app/CastingTheater";
import CrowdRoster from "@/components/app/CrowdRoster";
import SeatPicker from "@/components/app/SeatPicker";
import { CROWD_SAMPLE_CAP, FrozenSpec, MAX_SEATS, PANEL_SIZES, SIM_MODES } from "@/lib/casting";
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
  user_set?: { mode?: boolean; scale?: boolean };
  crowd?: { generated: number; sample?: number; sampled_of: number };
}

type Composition = "experts" | "consumers" | "mixed";

interface PendingSeat { key: string; role: string; discipline: string; kind: string }

const PROVENANCE_LABEL: Record<string, string> = {
  yours: "YOUR LIBRARY",
  library: "LIBRARY MATCH",
  generated: "GENERATED · SAVED TO YOUR LIBRARY",
};

const COMPOSITIONS: { key: Composition; label: string }[] = [
  { key: "experts", label: "EXPERTS ONLY" },
  { key: "consumers", label: "RESIDENTS · CONSUMERS" },
  { key: "mixed", label: "MIXED PANEL" },
];

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
  initialCrowd = [],
  initialCasting,
  onCountChange,
}: {
  simId: string;
  initialSeats: WorkspaceSeat[];
  initialCrowd?: WorkspaceSeat[];
  initialCasting: CastingInfo | null;
  onCountChange?: (n: number) => void;
}) {
  const router = useRouter();
  const [seats, setSeats] = useState<WorkspaceSeat[]>(initialSeats);
  const [crowd, setCrowd] = useState<WorkspaceSeat[]>(initialCrowd);
  const [crowdGen, setCrowdGen] = useState(false);
  const [crowdSample, setCrowdSample] = useState<number | null>(null); // target of the in-flight generation
  const [rosterOpen, setRosterOpen] = useState(false);
  const [pending, setPending] = useState<PendingSeat[]>([]);
  const [castingInfo, setCastingInfo] = useState<CastingInfo | null>(initialCasting);
  const [casting, setCasting] = useState(false);
  const [planReady, setPlanReady] = useState(false); // plan arrived → theater gives way to cards
  const [castMode, setCastMode] = useState<"recast" | "add">("recast");
  const [scouting, setScouting] = useState(false); // add-plan in flight, seat count unknown
  const [guidance, setGuidance] = useState("");
  const [guidanceMode, setGuidanceMode] = useState<"recast" | "add">("recast");
  const [panelSize, setPanelSize] = useState<number>(10);
  const [preComp, setPreComp] = useState<"auto" | Composition>("auto");
  const [pendingComp, setPendingComp] = useState<Composition | null>(null);
  const [expertsDraft, setExpertsDraft] = useState<string | null>(null);
  const [residentsDraft, setResidentsDraft] = useState<string | null>(null);
  const [scaleSaved, setScaleSaved] = useState(false); // brief SAVED ✓ flash after a commit
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<WorkspaceSeat | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { onCountChange?.(seats.length); }, [seats.length, onCountChange]);

  const cast = async (mode: "recast" | "add" = "recast", composition?: Composition) => {
    if (casting) return;
    const g = guidance.trim();
    if (mode === "add" && !g) { setError("Describe who to add — e.g. “more pool engineering experts”"); return; }
    setCasting(true);
    setCastMode(mode);
    setPlanReady(mode === "add"); // adding keeps the grid visible; recast opens the theater
    setScouting(mode === "add"); // scouting card until the add-plan names the seats
    setError(null);
    setPending([]);
    setPendingComp(null);
    if (mode === "recast") { setSeats([]); setCrowd([]); } // re-cast clears the whole population
    try {
      const res = await fetch(`/api/simulations/${simId}/cast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(g ? { guidance: g } : {}),
          mode,
          seats: panelSize,
          ...(composition ? { composition } : {}),
        }),
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
            setExpertsDraft(null);
            setResidentsDraft(null);
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

  const patchConfig = async (patch: { scale?: { experts: number; residents: number }; mode?: string }) => {
    setCastingInfo((prev) => prev ? {
      ...prev,
      ...(patch.scale ? { scale: patch.scale } : {}),
      ...(patch.mode ? { mode: patch.mode } : {}),
      user_set: {
        ...prev.user_set,
        ...(patch.scale ? { scale: true } : {}),
        ...(patch.mode ? { mode: true } : {}),
      },
    } : prev);
    await fetch(`/api/simulations/${simId}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  const commitScale = () => {
    if (!castingInfo) return;
    const experts = Math.min(Math.max(parseInt(expertsDraft ?? String(castingInfo.scale.experts), 10) || 4, 4), 500);
    const residents = Math.min(Math.max(parseInt(residentsDraft ?? String(castingInfo.scale.residents), 10) || 0, 0), 1000);
    setExpertsDraft(null);
    setResidentsDraft(null);
    if (experts !== castingInfo.scale.experts || residents !== castingInfo.scale.residents) {
      void patchConfig({ scale: { experts, residents } });
      setScaleSaved(true);
      setTimeout(() => setScaleSaved(false), 2200);
    }
  };

  const removeSeat = async (key: string) => {
    setSeats((prev) => prev.filter((s) => s.key !== key));
    await fetch(`/api/simulations/${simId}/agents/${encodeURIComponent(key)}`, { method: "DELETE" });
  };

  const removeCrowdMember = async (key: string) => {
    setCrowd((prev) => prev.filter((s) => s.key !== key));
    await fetch(`/api/simulations/${simId}/agents/${encodeURIComponent(key)}`, { method: "DELETE" });
  };

  // materialize the crowd: Haiku-batched compact personas streamed in as they
  // land. Batches arrive ~25 at a time; a drain queue reveals them one-by-one
  // so the counter ticks and the band dots light member-by-member.
  const arrivalQueue = useRef<WorkspaceSeat[]>([]);
  const revealDelay = useRef(140);
  const generateCrowd = async () => {
    if (crowdGen || casting) return;
    setCrowdGen(true);
    setCrowd([]);
    setError(null);
    arrivalQueue.current = [];
    // reveal pace scales with crowd size: small crowds tick slowly enough to
    // watch (1, 2, 3…); big crowds stay brisk so 300 doesn't take minutes
    let drainStopped = false;
    const tick = () => {
      if (drainStopped) return;
      const next = arrivalQueue.current.shift();
      if (next) setCrowd((prev) => [...prev, next]);
      setTimeout(tick, revealDelay.current);
    };
    tick();
    const drain = { stop: () => { drainStopped = true; } };
    try {
      const res = await fetch(`/api/simulations/${simId}/crowd`, { method: "POST" });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Crowd generation failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneEvt: { generated: number; sampled_of: number } | null = null;
      const handle = (evt: Record<string, unknown>) => {
        if (evt.type === "start") {
          const s = Number(evt.sample) || 0;
          setCrowdSample(s || null);
          revealDelay.current = s <= 40 ? 170 : s <= 120 ? 90 : 45;
        } else if (evt.type === "members") {
          const members = (evt.members as { key: string; spec: FrozenSpec }[] | undefined) ?? [];
          arrivalQueue.current.push(...members.map((m) => ({ key: m.key, provenance: "generated" as const, spec: m.spec })));
        } else if (evt.type === "error") {
          setError(String(evt.error ?? "Crowd generation failed"));
        } else if (evt.type === "done") {
          doneEvt = { generated: Number(evt.generated) || 0, sampled_of: Number(evt.target) || 0 };
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
      // let the reveal finish before flipping out of the materializing state
      while (arrivalQueue.current.length > 0) {
        await new Promise((r) => setTimeout(r, 80));
      }
      if (doneEvt) {
        const crowdMeta = doneEvt;
        setCastingInfo((prev) => prev ? { ...prev, crowd: crowdMeta } : prev);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Crowd generation failed");
    } finally {
      drain.stop();
      setCrowd((prev) => arrivalQueue.current.length ? [...prev, ...arrivalQueue.current.splice(0)] : prev);
      setCrowdGen(false);
      setCrowdSample(null);
    }
  };

  const onAdded = (added: { key: string; provenance: "yours" | "library"; spec: PersonaSpec & { seat?: unknown } }[]) => {
    setSeats((prev) => [...prev, ...added.map((a) => ({ key: a.key, provenance: a.provenance, spec: a.spec as FrozenSpec }))]);
    router.refresh();
  };

  const label: CSSProperties = { ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" };
  const hasCast = seats.length > 0 || pending.length > 0;
  const showTheater = casting && !planReady;
  const remaining = Math.max(0, MAX_SEATS - seats.length);

  // the crowd is the population BEHIND the leads: scale minus who's already seated
  const residentLeads = seats.filter((s) => s.spec.kind === "consumer" || s.spec.kind === "resident").length;
  const expertLeads = seats.length - residentLeads;
  const crowdExpertsTarget = castingInfo ? Math.max(castingInfo.scale.experts - expertLeads, 0) : 0;
  const crowdResidentsTarget = castingInfo ? Math.max(castingInfo.scale.residents - residentLeads, 0) : 0;
  const crowdTarget = crowdExpertsTarget + crowdResidentsTarget;
  const crowdExpertsLit = crowd.filter((s) => s.spec.kind !== "consumer" && s.spec.kind !== "resident").length;
  const crowdResidentsLit = crowd.length - crowdExpertsLit;
  // counts edited after materialization → the sample no longer matches
  const crowdStale = crowd.length > 0 && !crowdGen && !!castingInfo?.crowd && castingInfo.crowd.sampled_of !== crowdTarget;

  // live math for the POPULATION row: what the drafts mean BEFORE they're applied
  const draftExperts = Math.min(Math.max(parseInt(expertsDraft ?? String(castingInfo?.scale.experts ?? 0), 10) || 0, 0), 500);
  const draftResidents = castingInfo?.composition === "experts"
    ? 0
    : Math.min(Math.max(parseInt(residentsDraft ?? String(castingInfo?.scale.residents ?? 0), 10) || 0, 0), 1000);
  const draftCrowd = Math.max(draftExperts - expertLeads, 0) + Math.max(draftResidents - residentLeads, 0);
  const scaleDirty =
    (expertsDraft !== null && draftExperts !== (castingInfo?.scale.experts ?? 0)) ||
    (residentsDraft !== null && draftResidents !== (castingInfo?.scale.residents ?? 0));

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

  const FilterPill = ({ on, count, children, onClick, warn }: { on: boolean; count?: number; children: React.ReactNode; onClick: () => void; warn?: boolean }) => (
    <button
      onClick={onClick}
      style={{
        ...mono, fontSize: 9, letterSpacing: ".05em", padding: "5px 11px", borderRadius: 100,
        cursor: "pointer", transition: "all .15s",
        background: on ? (warn ? "var(--warn-dim)" : "var(--acc-dim)") : "transparent",
        border: `1px solid ${on ? (warn ? "var(--warn)" : "var(--acc)") : "var(--ln4)"}`,
        color: on ? (warn ? "var(--warn)" : "var(--acc)") : "var(--t6)",
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
          {crowdTarget > 0 && ` + ${crowdTarget.toLocaleString()} CROWD`}
        </div>
        {castingInfo && (
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", textAlign: "right", lineHeight: 1.9 }}>
            <div>
              <span style={{ color: "var(--acc)" }}>{castingInfo.composition.toUpperCase()}</span>
              {" · MODE "}
              <span style={{ color: "var(--acc)" }}>{castingInfo.mode.toUpperCase()}</span>
              {" "}({castingInfo.user_set?.mode ? "YOURS" : "RECOMMENDED"})
            </div>
          </div>
        )}
      </div>
      {castingInfo?.rationale && (
        <div style={{ margin: "10px 0 0", maxWidth: 860, display: "flex", flexDirection: "column", gap: 7 }}>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: "var(--t5)" }}>
            <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--acc)" }}>WHY THIS PANEL · </span>
            {castingInfo.rationale}
          </p>
          {!castingInfo.user_set?.mode && castingInfo.modeRationale && (
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: "var(--t5)" }}>
              <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--acc)" }}>WHY {castingInfo.mode.toUpperCase()} · </span>
              {castingInfo.modeRationale}
            </p>
          )}
          {castingInfo.user_set?.mode && (
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: "var(--t6)" }}>
              <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--acc)" }}>MODE {castingInfo.mode.toUpperCase()} · </span>
              Set by you — the recommendation was based on the brief; change it back any time below.
            </p>
          )}
        </div>
      )}

      {/* the §3 composition + mode + crowd controls */}
      {castingInfo && hasCast && !showTheater && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16, padding: "14px 16px", border: "1px solid var(--ln2)", borderRadius: 12, background: "var(--sf2)" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", width: 92, flex: "none" }}>COMPOSITION</span>
            {COMPOSITIONS.map((c) => (
              <FilterPill
                key={c.key}
                on={(pendingComp ?? castingInfo.composition) === c.key}
                onClick={() => setPendingComp(c.key === castingInfo.composition ? null : c.key)}
              >
                {c.label}
              </FilterPill>
            ))}
            {pendingComp && pendingComp !== castingInfo.composition && (
              <button
                onClick={() => void cast("recast", pendingComp)}
                style={{
                  ...mono, fontSize: 9, letterSpacing: ".06em", padding: "5px 12px", borderRadius: 100,
                  background: "var(--acc)", color: "var(--acc-c)", border: "none", cursor: "pointer",
                }}
              >
                RE-CAST AS {COMPOSITIONS.find((c) => c.key === pendingComp)?.label} →
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", width: 92, flex: "none" }}>MODE</span>
            {SIM_MODES.map((m) => (
              <FilterPill key={m} on={castingInfo.mode === m} onClick={() => { if (castingInfo.mode !== m) void patchConfig({ mode: m }); }}>
                {m.toUpperCase()}
              </FilterPill>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", width: 92, flex: "none" }}>POPULATION</span>
              <label style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--t5)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                TOTAL EXPERTS
                <input
                  type="number" min={4} max={500}
                  value={expertsDraft ?? String(castingInfo.scale.experts)}
                  onChange={(e) => setExpertsDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitScale(); }}
                  onWheel={(e) => (e.target as HTMLInputElement).blur()} // page scroll must never nudge the count
                  style={{ ...mono, width: 62, padding: "5px 8px", fontSize: 10.5, background: "var(--sf)", border: `1px solid ${scaleDirty ? "var(--acc)" : "var(--ln4)"}`, borderRadius: 8, color: "var(--t1)", outline: "none" }}
                />
              </label>
              {castingInfo.composition !== "experts" && (
                <label style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--t5)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  TOTAL RESIDENTS
                  <input
                    type="number" min={0} max={1000}
                    value={residentsDraft ?? String(castingInfo.scale.residents)}
                    onChange={(e) => setResidentsDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitScale(); }}
                    onWheel={(e) => (e.target as HTMLInputElement).blur()} // page scroll must never nudge the count
                    style={{ ...mono, width: 62, padding: "5px 8px", fontSize: 10.5, background: "var(--sf)", border: `1px solid ${scaleDirty ? "var(--acc)" : "var(--ln4)"}`, borderRadius: 8, color: "var(--t1)", outline: "none" }}
                  />
                </label>
              )}
              {/* the same math everywhere: totals include the leads; the rest is the crowd */}
              <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: scaleDirty ? "var(--t3)" : "var(--t6)" }}>
                = {seats.length} LEAD{seats.length === 1 ? "" : "S"} + {draftCrowd.toLocaleString()} CROWD
              </span>
              {scaleDirty && (
                <button
                  onClick={commitScale}
                  style={{
                    ...mono, fontSize: 9, letterSpacing: ".06em", padding: "5px 14px", borderRadius: 100,
                    background: "var(--acc)", color: "var(--acc-c)", border: "none", cursor: "pointer",
                  }}
                >
                  APPLY
                </button>
              )}
              {scaleSaved && !scaleDirty && (
                <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--acc)", animation: "fadeUp .2s ease both" }}>
                  SAVED ✓
                </span>
              )}
            </div>
            <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)", paddingLeft: 102 }}>
              {castingInfo.user_set?.scale ? "SET BY YOU" : "RECOMMENDED"} · TOTALS INCLUDE THE LEADS ABOVE — THE REST IS THE CROWD, GENERATED IN THE PANEL BELOW · EXPERTS 4–500 · RESIDENTS 0–1,000
            </div>
          </div>
        </div>
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
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>COMPOSITION ·</span>
              {([{ key: "auto", label: "AUTO" }, ...COMPOSITIONS] as { key: "auto" | Composition; label: string }[]).map((c) => (
                <button
                  key={c.key}
                  onClick={() => setPreComp(c.key)}
                  style={{
                    ...mono, fontSize: 9, letterSpacing: ".05em", padding: "4px 10px", borderRadius: 100,
                    cursor: "pointer",
                    background: preComp === c.key ? "var(--acc)" : "transparent",
                    border: `1px solid ${preComp === c.key ? "var(--acc)" : "var(--ln5)"}`,
                    color: preComp === c.key ? "var(--acc-c)" : "var(--t5)",
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
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
              LEADS ONLY — THE FULL-RUN CROWD IS SIZED BELOW ONCE CAST (EDITABLE, UP TO 500 + 1,000)
            </div>
            <button
              onClick={() => void cast("recast", preComp === "auto" ? undefined : preComp)}
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

      {/* the leads: who they are (kind) is separate from how they participate (tier) */}
      {hasCast && !showTheater && (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginTop: 18 }}>
          <span style={{ ...mono, fontSize: 10, letterSpacing: ".09em", color: "var(--acc)" }}>
            THE LEADS · {seats.length} OF {MAX_SEATS}{castingInfo ? ` — ${expertLeads} EXPERT-SIDE · ${residentLeads} RESIDENT-SIDE` : ""}
          </span>
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)" }}>
            THE VOICES THAT SPEAK IN THE FORUM — EXPERTS, RESIDENTS, OR BOTH · CLICK A CARD FOR THE FULL PROFILE
          </span>
        </div>
      )}

      {/* review filters — by kind and by where each seat came from */}
      {seats.length > 3 && !showTheater && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
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

      {/* the full-run crowd — real members, generated + browsable right here */}
      {castingInfo && hasCast && !showTheater && crowdTarget > 0 && (
        <div style={{ marginTop: 16, border: "1px solid var(--ln2)", borderRadius: 12, padding: "12px 16px 12px" }}>
          <div style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--t6)", lineHeight: 1.9 }}>
            THE CROWD · <span style={{ color: "var(--acc)" }}>{crowdExpertsTarget.toLocaleString()}</span> EXPERTS
            <span style={{ color: "var(--t7)" }}> ({castingInfo.scale.experts} TOTAL − {expertLeads} EXPERT-SIDE LEAD{expertLeads === 1 ? "" : "S"})</span>
            {crowdResidentsTarget > 0 && <>
              {" · "}<span style={{ color: "var(--acc)" }}>{crowdResidentsTarget.toLocaleString()}</span> RESIDENTS
              <span style={{ color: "var(--t7)" }}> ({castingInfo.scale.residents} TOTAL − {residentLeads} RESIDENT-SIDE LEAD{residentLeads === 1 ? "" : "S"} · NARRATIVE, ACS PUMS SOON)</span>
            </>}
            <span style={{ color: "var(--t7)" }}> — SAMPLED & POLLED AT RUN</span>
          </div>
          <CrowdBand
            experts={crowdExpertsTarget}
            residents={crowdResidentsTarget}
            litExperts={crowdExpertsLit}
            litResidents={crowdResidentsLit}
            active={crowdGen}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
            {crowdGen ? (
              <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--acc)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.1s ease infinite" }} />
                MATERIALIZING · {crowd.length}/{crowdSample ?? "…"}{crowd.length === 0 ? " · FIRST BATCH DRAFTING…" : " · HAIKU SWARM ×3"}
              </span>
            ) : crowd.length === 0 ? (
              <>
                <button
                  onClick={() => void generateCrowd()}
                  style={{
                    ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100,
                    background: "var(--acc)", color: "var(--acc-c)", border: "none", cursor: "pointer",
                  }}
                >
                  {crowdTarget > CROWD_SAMPLE_CAP
                    ? `GENERATE A ${CROWD_SAMPLE_CAP}-MEMBER SAMPLE OF ${crowdTarget.toLocaleString()} →`
                    : `GENERATE THE CROWD · ${crowdTarget.toLocaleString()} MEMBERS →`}
                </button>
                <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)" }}>
                  COMPACT PERSONAS · HAIKU TIER · BROWSE & EDIT EVERY MEMBER AFTER
                </span>
              </>
            ) : (
              <>
                <button
                  onClick={() => setRosterOpen(true)}
                  style={{
                    ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100,
                    background: "var(--acc-dim)", color: "var(--acc)", border: "1px solid var(--acc)", cursor: "pointer",
                  }}
                >
                  BROWSE THE CROWD ({crowd.length.toLocaleString()}) →
                </button>
                <button
                  onClick={() => void generateCrowd()}
                  style={{
                    ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "8px 16px", borderRadius: 100,
                    background: "transparent", color: "var(--t5)", border: "1px solid var(--ln5)", cursor: "pointer",
                  }}
                >
                  REGENERATE
                </button>
                {crowdStale && (
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--warn)" }}>
                    COUNTS CHANGED — REGENERATE TO MATCH
                  </span>
                )}
                {!crowdStale && castingInfo.crowd && castingInfo.crowd.sampled_of > (castingInfo.crowd.sample ?? castingInfo.crowd.sampled_of) && (
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)" }}>
                    {(castingInfo.crowd.sample ?? 0).toLocaleString()}-MEMBER SAMPLE OF {castingInfo.crowd.sampled_of.toLocaleString()} — FULL SCALE AT RUN
                  </span>
                )}
                {!crowdStale && castingInfo.crowd && crowd.length < (castingInfo.crowd.sample ?? castingInfo.crowd.sampled_of) && (
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)" }}>
                    {crowd.length} OF {(castingInfo.crowd.sample ?? castingInfo.crowd.sampled_of).toLocaleString()} — A FEW DUPLICATES DROPPED; REGENERATE TO TOP UP
                  </span>
                )}
              </>
            )}
          </div>
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
                {m === "recast" ? "RE-CAST ALL" : "ADD LEADS"}
              </button>
            ))}
          </div>
          <textarea
            value={guidance}
            rows={1}
            onChange={(e) => {
              setGuidance(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void cast(guidanceMode); } }}
            placeholder={guidanceMode === "add"
              ? "Add leads — “a school-board voice”"
              : "Re-cast everyone — “more first-time buyers”"}
            maxLength={500}
            style={{
              flex: 1, minWidth: 200, padding: "11px 16px", background: "var(--sf2)",
              border: "1px solid var(--ln3)", borderRadius: 16, resize: "none", overflow: "hidden",
              fontFamily: "var(--font-sans), sans-serif", fontSize: 13, lineHeight: 1.5, color: "var(--t1)", outline: "none",
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
            {casting && castMode === "add" ? "ADDING…" : guidanceMode === "recast" ? "RE-CAST" : `ADD (${remaining} LEAD SEATS LEFT)`}
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

      {rosterOpen && (
        <CrowdRoster
          members={crowd}
          note={
            castingInfo?.crowd && castingInfo.crowd.sampled_of > (castingInfo.crowd.sample ?? castingInfo.crowd.sampled_of)
              ? `SAMPLE OF ${castingInfo.crowd.sampled_of.toLocaleString()} — FULL SCALE AT RUN`
              : castingInfo?.crowd && crowd.length < (castingInfo.crowd.sample ?? castingInfo.crowd.sampled_of)
              ? `${crowd.length} OF ${(castingInfo.crowd.sample ?? castingInfo.crowd.sampled_of).toLocaleString()} — DUPLICATES DROPPED`
              : undefined
          }
          onRemove={(key) => void removeCrowdMember(key)}
          onProfile={(m) => setProfile(m)}
          onClose={() => setRosterOpen(false)}
        />
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
