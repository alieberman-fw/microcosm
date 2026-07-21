"use client";

import { CSSProperties } from "react";
import Link from "next/link";
import { PersonaSpec } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const kindChip = (accent: boolean): CSSProperties => ({
  ...mono, fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase",
  color: accent ? "var(--warn)" : "var(--t7)",
  border: `1px solid ${accent ? "var(--warn)" : "var(--ln5)"}`,
  borderRadius: 100, padding: "3px 9px", whiteSpace: "nowrap",
});

export function cleanCategory(c?: string) {
  return c ? c.replace(/^[A-Z]?\d+\.\s*/, "") : undefined;
}

function TraitBar({ name, value }: { name: string; value?: number }) {
  if (typeof value !== "number") return null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>{name}</span>
        <span style={{ ...mono, fontSize: 9.5, color: "var(--t5)" }}>{Math.round(value * 100)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 100, background: "var(--sf2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, borderRadius: 100, background: "var(--acc)", transformOrigin: "left", animation: "grow .6s ease both" }} />
      </div>
    </div>
  );
}

/**
 * Full-profile modal for any persona — used by the Agent Library and the
 * Conversations roster. Renders whatever fields the spec carries.
 */
export default function PersonaProfile({
  kind, spec, chatKey, source, onClose, showChatCta = true, onRemix, onOpenAncestor,
}: {
  kind: string; spec: PersonaSpec; chatKey: string; source: string;
  onClose: () => void; showChatCta?: boolean;
  /** offer a "Remix" action (Agent Library passes this) */
  onRemix?: () => void;
  /** make lineage ancestors clickable (opens their profile) */
  onOpenAncestor?: (key: string) => void;
}) {
  const d = spec.demographics ?? {};
  const facts: [string, string][] = (
    [
      ["Age", d.age ? String(d.age) : null],
      ["Location", [d.metro, d.state].filter(Boolean).join(", ") || null],
      ["Experience", d.years_experience ? `${d.years_experience} yrs` : null],
      ["Credentials", d.credentials ?? null],
      ["Occupation", d.occupation ?? null],
      ["Household", d.household ?? null],
      ["Income", d.income_band ?? null],
      ["Tenure", d.tenure ?? null],
    ] as [string, string | null][]
  ).filter((f): f is [string, string] => Boolean(f[1]));
  const adversarial = kind === "adversarial";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(10,11,12,.66)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true"
        style={{ background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto", animation: "fadeUp .25s ease both" }}
      >
        <div style={{ padding: "30px 34px 0" }}>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
            <span style={{ ...mono, flex: "none", width: 58, height: 58, borderRadius: "50%", background: adversarial ? "var(--warn-dim)" : "var(--acc-dim)", border: `1px solid ${adversarial ? "var(--warn)" : "var(--acc)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: adversarial ? "var(--warn)" : "var(--acc)" }}>
              {spec.initials}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 23, fontWeight: 600, letterSpacing: "-.02em" }}>{spec.name}</h2>
              <div style={{ fontSize: 14, color: "var(--t4)", marginTop: 3 }}>{spec.role}</div>
              {spec.tagline && (
                <div style={{ ...mono, fontSize: 11, letterSpacing: ".04em", color: "var(--t6)", marginTop: 7 }}>{spec.tagline}</div>
              )}
            </div>
            <span style={{ flex: "none", display: "flex", gap: 8 }}>
              {onRemix && (
                <button
                  onClick={onRemix}
                  aria-label="Remix this persona"
                  title="Remix — copy into your library and make them yours"
                  style={{ border: "1px solid var(--acc)", background: "var(--acc-dim)", color: "var(--acc)", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
                >
                  ⑂
                </button>
              )}
              <button onClick={onClose} aria-label="Close" style={{ border: "1px solid var(--ln6)", background: "transparent", color: "var(--t4)", width: 30, height: 30, borderRadius: "50%", cursor: "pointer" }}>×</button>
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
            <span style={kindChip(adversarial)}>{kind}</span>
            {spec.discipline && <span style={kindChip(false)}>{spec.discipline}</span>}
            {cleanCategory(spec.category) && <span style={kindChip(false)}>{cleanCategory(spec.category)}</span>}
            {(spec.lineage?.length ?? 0) > 0 && (
              <span style={{ ...kindChip(false), color: "var(--acc)", borderColor: "var(--acc)", background: "var(--acc-dim)" }}>REMIX</span>
            )}
          </div>
          {(spec.lineage?.length ?? 0) > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12, border: "1px dashed var(--ln4)", borderRadius: 12, padding: "9px 13px" }}>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t7)" }}>LINEAGE</span>
              {spec.lineage!.map((a, i) => (
                <span key={`${a.key}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {onOpenAncestor ? (
                    <button
                      onClick={() => onOpenAncestor(a.key)}
                      style={{ ...mono, fontSize: 10.5, letterSpacing: ".03em", color: "var(--acc)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}
                    >
                      {a.name}
                    </button>
                  ) : (
                    <span style={{ ...mono, fontSize: 10.5, color: "var(--t4)" }}>{a.name}</span>
                  )}
                  <span style={{ color: "var(--t7)", fontSize: 11 }}>→</span>
                </span>
              ))}
              <span style={{ ...mono, fontSize: 10.5, fontWeight: 700, color: "var(--t2)" }}>{spec.name}</span>
            </div>
          )}
        </div>

        {facts.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, padding: "20px 34px 0" }}>
            {facts.map(([k, v]) => (
              <div key={k} style={{ border: "1px solid var(--ln3)", borderRadius: 12, padding: "10px 13px", background: "var(--sf2)" }}>
                <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t7)", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 4, lineHeight: 1.4 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: "24px 34px 0" }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)", textTransform: "uppercase" }}>Backstory</div>
          <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.7, color: "var(--t4)" }}>{spec.backstory}</p>
        </div>

        {(spec.stances?.length ?? 0) > 0 && (
          <div style={{ padding: "24px 34px 0" }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)", textTransform: "uppercase" }}>Standing positions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {spec.stances.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.6, color: "var(--t4)" }}>
                  <span style={{ color: /^instructed to oppose/i.test(s) ? "var(--warn)" : "var(--acc)", flex: "none" }}>—</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(spec.skills?.length ?? 0) > 0 && (
          <div style={{ padding: "24px 34px 0" }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)", textTransform: "uppercase" }}>Skills</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {spec.skills!.map((s) => (
                <span key={s} style={{ ...mono, fontSize: 10, letterSpacing: ".03em", color: "var(--t5)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "5px 12px" }}>{s}</span>
              ))}
            </div>
          </div>
        )}

        {spec.traits && Object.keys(spec.traits).length > 0 && (
          <div style={{ padding: "24px 34px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
            <TraitBar name="RISK TOLERANCE" value={spec.traits.risk_tolerance} />
            <TraitBar name="AGREEABLENESS" value={spec.traits.agreeableness} />
            <TraitBar name="VERBOSITY" value={spec.traits.verbosity} />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "26px 34px 30px", marginTop: 8, borderTop: "1px solid var(--ln2)" }}>
          <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t7)" }}>
            {source.toUpperCase()} PERSONA · V{(spec as { version?: number }).version ?? 1} · SYNTHETIC COMPOSITE — NO REAL INDIVIDUAL
          </span>
          {showChatCta && (
            <Link href={`/conversations?with=${chatKey}`} className="btnAcc" style={{ padding: "11px 22px", fontSize: 13.5 }}>
              Start a conversation
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
