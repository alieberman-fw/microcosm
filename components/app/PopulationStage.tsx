"use client";

/**
 * Stage 3 — Population (CLAUDE.md §3.2A, demo Stage 02 reference).
 * "Cast the population" streams the Casting Director: a plan (composition ·
 * scale · recommended mode) followed by seat cards resolving one by one —
 * matched from the org's own personas first, then the global library, with
 * true gaps generated fresh and saved back to the org's custom library.
 * Cards open the full persona profile; any seat can be removed; a guidance
 * line re-casts the panel ("more first-time buyers; add a school-board voice").
 */

import { CSSProperties, useState } from "react";
import { useRouter } from "next/navigation";
import PersonaProfile from "@/components/app/PersonaProfile";
import CastingTheater from "@/components/app/CastingTheater";
import SeatPicker from "@/components/app/SeatPicker";
import { FrozenSpec, MAX_SEATS } from "@/lib/casting";
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
  const [guidance, setGuidance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<WorkspaceSeat | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const setCount = (list: WorkspaceSeat[]) => onCountChange?.(list.length);

  const cast = async () => {
    if (casting) return;
    setCasting(true);
    setPlanReady(false);
    setError(null);
    setSeats([]);
    setCount([]);
    setPending([]);
    const g = guidance.trim();
    try {
      const res = await fetch(`/api/simulations/${simId}/cast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(g ? { guidance: g } : {}),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Casting failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const resolvedSeats: WorkspaceSeat[] = [];
      const handle = (evt: Record<string, unknown>) => {
        if (evt.type === "plan") {
          const p = evt as unknown as CastingInfo & { seats: PendingSeat[] };
          setCastingInfo({ composition: p.composition, rationale: p.rationale, scale: p.scale, mode: p.mode, modeRationale: p.modeRationale });
          setPending((p.seats ?? []).map((s) => ({ key: s.key, role: s.role, discipline: s.discipline, kind: s.kind })));
          setPlanReady(true); // swap the theater for the resolving card grid
        } else if (evt.type === "seat") {
          const key = String(evt.key);
          if (evt.provenance === "failed" || !evt.spec) {
            setPending((prev) => prev.filter((s) => s.key !== key));
            return;
          }
          const seat: WorkspaceSeat = { key, provenance: evt.provenance as WorkspaceSeat["provenance"], spec: evt.spec as FrozenSpec };
          resolvedSeats.push(seat);
          setSeats((prev) => [...prev, seat]);
          setPending((prev) => prev.filter((s) => s.key !== key));
        } else if (evt.type === "error") {
          setError(String(evt.error ?? "Casting failed"));
        } else if (evt.type === "done") {
          setCount(resolvedSeats);
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
      setCasting(false);
    }
  };

  const removeSeat = async (key: string) => {
    setSeats((prev) => {
      const next = prev.filter((s) => s.key !== key);
      setCount(next);
      return next;
    });
    await fetch(`/api/simulations/${simId}/agents/${encodeURIComponent(key)}`, { method: "DELETE" });
  };

  const onAdded = (added: { key: string; provenance: "yours" | "library"; spec: PersonaSpec & { seat?: unknown } }[]) => {
    setSeats((prev) => {
      const next = [...prev, ...added.map((a) => ({ key: a.key, provenance: a.provenance, spec: a.spec as FrozenSpec }))];
      setCount(next);
      return next;
    });
    router.refresh();
  };

  const label: CSSProperties = { ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" };
  const hasCast = seats.length > 0 || pending.length > 0;
  const showTheater = casting && !planReady;
  const remaining = Math.max(0, MAX_SEATS - seats.length);

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
              {" · RECOMMENDED SCALE "}
              <span style={{ color: "var(--acc)" }}>{castingInfo.scale.experts}</span> EXPERTS
              {castingInfo.scale.residents > 0 && <> · <span style={{ color: "var(--acc)" }}>{castingInfo.scale.residents}</span> RESIDENTS <span style={{ color: "var(--t7)" }}>(PUMS SOON)</span></>}
            </div>
            <div>MODE · <span style={{ color: "var(--acc)" }}>{castingInfo.mode.toUpperCase()}</span> (RECOMMENDED)</div>
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
            <button
              onClick={() => void cast()}
              style={{
                marginTop: 16, background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600,
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

      {(hasCast || (casting && planReady)) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 14, marginTop: 20 }}>
          {seats.map((s) => {
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
          {pending.map((p) => (
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
          ))}
        </div>
      )}

      {error && <div style={{ ...mono, fontSize: 11, color: "var(--warn)", marginTop: 16 }}>{error}</div>}

      {hasCast && !casting && (
        <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void cast(); }}
            placeholder="Re-cast with guidance — “more first-time buyers; add a school-board voice”"
            maxLength={500}
            style={{
              flex: 1, minWidth: 220, padding: "11px 16px", background: "var(--sf2)",
              border: "1px solid var(--ln3)", borderRadius: 100,
              fontFamily: "var(--font-sans), sans-serif", fontSize: 13, color: "var(--t1)", outline: "none",
            }}
          />
          <button
            onClick={() => void cast()}
            style={{
              ...mono, fontSize: 10.5, letterSpacing: ".06em", padding: "11px 20px", borderRadius: 100,
              background: "transparent", border: "1px solid var(--ln7)", color: "var(--t3)", cursor: "pointer",
            }}
          >
            RE-CAST
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
