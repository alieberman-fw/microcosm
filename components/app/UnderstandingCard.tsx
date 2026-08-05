"use client";

/**
 * WHAT I UNDERSTOOD (next-level-plan §6a/6b) — the Understanding Mirror card.
 * Renders the Brief Contract as a smart colleague's restatement: intent +
 * audience pills, the mirror prose, population hints (extracted from the
 * prompt when the user described who to simulate), per-document roles,
 * the report shape, one-tap clarifiers, and a collapsed BREAKDOWN of
 * sub-asks / entities / constraints / criteria — every group labeled with
 * what it drives. Edits mutate the CONTRACT (the truth) via PATCH
 * /understand; a brief edit marks it stale and the card offers RE-DERIVE.
 * Design goal #1: the 80% case never NEEDS to open this card.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { BriefContract, DOC_ROLES, DocRole, SubAsk } from "@/lib/understand";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };
const label: CSSProperties = { ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--t6)" };
const drives: CSSProperties = { ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--t7)" };

const ROLE_LABEL: Record<DocRole["role"], string> = {
  evidence: "EVIDENCE",
  framework: "FRAMEWORK",
  "question-source": "QUESTION SOURCE",
  reference: "REFERENCE",
};
const ROLE_HINT: Record<DocRole["role"], string> = {
  evidence: "agents argue from it and cite it",
  framework: "its instructions/standards shape the panel and the report outline",
  "question-source": "the brief itself lives in this document",
  reference: "background context only",
};
const TYPE_LABEL: Record<string, string> = {
  ranked_list: "RANKED LIST", matrix: "MATRIX", comparison: "COMPARISON", verdict: "VERDICT",
  range: "RANGE", odds: "ODDS", timeline: "TIMELINE", narrative: "NARRATIVE",
};

export default function UnderstandingCard({
  simId,
  hasProblem,
  initialContract,
  parsedDocNames,
  onPhase,
}: {
  simId: string;
  hasProblem: boolean;
  initialContract: BriefContract | null;
  parsedDocNames: string[];
  /** the workspace choreographs around the pass: population + run config
   *  reveal only after the contract lands (or the pass errors out) */
  onPhase?: (phase: "idle" | "deriving" | "ready" | "error") => void;
}) {
  const [contract, setContract] = useState<BriefContract | null>(initialContract);
  const [deriving, setDeriving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [askDraft, setAskDraft] = useState("");
  const [entityDraft, setEntityDraft] = useState("");
  const autoRan = useRef(false);
  const [scanStep, setScanStep] = useState(0);

  // the understanding theater: what the pass is actually doing, narrated
  const scanLines = [
    "READING YOUR BRIEF…",
    ...parsedDocNames.slice(0, 3).map((n) => `READING ${n.toUpperCase().slice(0, 34)}…`),
    "DECOMPOSING THE ASK INTO SUB-QUESTIONS…",
    "MAPPING THE SHAPE OF THE ANSWER…",
    "LOOKING FOR A DESCRIBED POPULATION…",
    "CLASSIFYING DOCUMENT ROLES…",
  ];
  useEffect(() => {
    if (!deriving) { setScanStep(0); return; }
    const t = setInterval(() => setScanStep((s) => Math.min(s + 1, scanLines.length - 1)), 2100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deriving]);

  useEffect(() => {
    onPhase?.(deriving ? "deriving" : contract ? "ready" : error ? "error" : "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deriving, contract, error]);

  // a brief edit refreshed the page — pick up the (possibly stale-flagged)
  // contract without clobbering an in-flight derive
  useEffect(() => {
    if (!deriving && initialContract) setContract(initialContract);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContract]);

  const derive = async () => {
    if (deriving) return;
    setDeriving(true);
    setError(null);
    try {
      const res = await fetch(`/api/simulations/${simId}/understand`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Understanding pass failed");
      setContract(data.contract as BriefContract);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Understanding pass failed");
    } finally {
      setDeriving(false);
    }
  };

  // the pass is the DEFAULT behavior for a written brief — auto-derive once
  // when no contract exists (strict-mode double-mount guarded)
  useEffect(() => {
    if (autoRan.current || contract || !hasProblem) return;
    autoRan.current = true;
    void derive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (next: BriefContract) => {
    const prev = contract;
    setContract(next); // optimistic — the normalizer round-trip lands after
    try {
      const res = await fetch(`/api/simulations/${simId}/understand`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setContract(data.contract as BriefContract);
    } catch (e) {
      setContract(prev);
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  if (!hasProblem) return null;

  // the understanding theater — the ONLY thing on screen below the brief
  // while the pass reads (the workspace holds population/config back)
  if (!contract) {
    return (
      <div className="card" style={{ padding: "26px 30px", marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".12em", color: "var(--acc)" }}>✻ UNDERSTANDING YOUR BRIEF</span>
          {!deriving && error && (
            <>
              <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--warn)" }}>{error.toUpperCase().slice(0, 80)}</span>
              <button onClick={() => void derive()} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", padding: "4px 12px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln6)", color: "var(--acc)", cursor: "pointer" }}>
                RETRY
              </button>
            </>
          )}
        </div>
        {deriving && (
          <div style={{ marginTop: 18 }}>
            {/* narrated progress: a pulsing dot + the current step, with a
                stepped bar that fills as the theater advances */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite", flex: "none" }} />
              <span key={scanStep} style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: "var(--t3)", animation: "fadeUp .3s ease both" }}>
                {scanLines[scanStep]}
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 100, background: "var(--sf2)", marginTop: 14, overflow: "hidden" }}>
              <div style={{ height: 4, borderRadius: 100, background: "var(--acc)", width: `${Math.round(((scanStep + 1) / (scanLines.length + 1)) * 100)}%`, transition: "width 2s ease", animation: "shim 1.2s ease infinite" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
              {scanLines.map((l, i) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 9, opacity: i <= scanStep ? 1 : 0.35, transition: "opacity .4s" }}>
                  <span style={{ ...mono, fontSize: 9, color: i < scanStep ? "var(--acc)" : "var(--t7)", width: 10, flex: "none" }}>
                    {i < scanStep ? "✓" : i === scanStep ? "·" : ""}
                  </span>
                  <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: i < scanStep ? "var(--t5)" : "var(--t7)" }}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--t7)", marginTop: 14 }}>
              THE POPULATION & RUN SETUP APPEAR WHEN THE READING LANDS — EVERYTHING IT CAPTURES IS EDITABLE
            </div>
          </div>
        )}
      </div>
    );
  }

  const c = contract;
  const newDocs = parsedDocNames.filter((n) => !c.doc_roles.some((d) => d.name === n));
  const ph = c.population_hints;

  const chip = (border: string, color: string, bg = "transparent"): CSSProperties => ({
    ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "4px 11px", borderRadius: 100,
    border: `1px solid ${border}`, color, background: bg, whiteSpace: "nowrap",
  });

  return (
    <div className="card" style={{ padding: "24px 30px", marginTop: 20, animation: "fadeUp .4s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".12em", color: "var(--acc)" }}>✻ WHAT I UNDERSTOOD</span>
        <span style={chip("var(--acc)", "var(--acc)", "var(--acc-dim)")}>{c.intent.toUpperCase()}</span>
        <span style={chip("var(--ln5)", "var(--t5)")} title="Which voice leads the report — the deliberation stays technical either way">
          {c.audience.toUpperCase()} READ
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => void derive()}
          disabled={deriving}
          title="Re-run the Understanding pass over the current brief + documents"
          style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", padding: "4px 12px", borderRadius: 100, background: "transparent", border: `1px solid ${c.stale || newDocs.length ? "var(--warn)" : "var(--ln6)"}`, color: c.stale || newDocs.length ? "var(--warn)" : "var(--t5)", cursor: deriving ? "default" : "pointer" }}
        >
          {deriving ? "RE-DERIVING…" : "↻ RE-DERIVE"}
        </button>
      </div>

      {(c.stale || newDocs.length > 0) && (
        <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--warn)", marginTop: 12 }}>
          {c.stale ? "THE BRIEF CHANGED SINCE THIS READING" : `${newDocs.length} NEW DOC${newDocs.length > 1 ? "S" : ""} SINCE THIS READING`} — RE-DERIVE TO REFRESH
        </div>
      )}

      {c.mirror && (
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--t2)", margin: "14px 0 0", maxWidth: 860 }}>{c.mirror}</p>
      )}

      {/* population — the prompt described who to simulate, or the director decides */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <span style={label}>POPULATION</span>
        {ph.described && ph.cohorts.length ? (
          <>
            {ph.cohorts.map((co) => (
              <span key={co.desc} style={chip("var(--acc)", "var(--acc)", "var(--acc-dim)")}>
                {co.desc.toUpperCase()}{co.geography ? ` · ${co.geography.toUpperCase()}` : ""}
              </span>
            ))}
            {ph.composition && <span style={chip("var(--ln5)", "var(--t5)")}>{ph.composition.toUpperCase()}</span>}
            <span style={drives}>→ CASTING HONORS THIS</span>
          </>
        ) : (
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)" }}>
            NOT DESCRIBED IN THE PROMPT — THE CASTING DIRECTOR DECIDES
          </span>
        )}
      </div>

      {/* report shape — every listed artifact IS in the report; the first
          one LEADS it (field fix: bare pills read as selected-vs-not) */}
      {c.output_contracts.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <span style={label}>THE REPORT YOU’LL GET</span>
          {c.output_contracts.map((o, i) => (
            <span
              key={o.type}
              style={chip(i === 0 ? "var(--acc)" : "var(--ln5)", i === 0 ? "var(--acc)" : "var(--t4)", i === 0 ? "var(--acc-dim)" : "transparent")}
              title={i === 0 ? "The report opens with this artifact" : "Also in the report, after the lead"}
            >
              {i === 0 ? "OPENS WITH · " : "+ "}{TYPE_LABEL[o.type] ?? o.type.toUpperCase()}
            </span>
          ))}
          <span style={drives}>→ ALL OF THESE, IN THIS ORDER</span>
        </div>
      )}

      {/* the poll plan (§6d) — angles per run phase, or NO POLL stated plainly */}
      {c.poll_plan !== undefined && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <span style={label}>POLL PLAN</span>
          {c.poll_plan.length === 0 ? (
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)" }}>
              NO CROWD POLL — THIS BRIEF HAS NO SENTIMENT SURFACE (A DECISION, NOT AN OMISSION)
            </span>
          ) : (
            <>
              {c.poll_plan.map((p) => (
                <span key={p.angle} title={`${p.question}${p.options?.length ? ` — options: ${p.options.join(" · ")}` : ""}`} style={{ ...chip("var(--ln5)", "var(--t4)"), cursor: "help" }}>
                  {p.phase.toUpperCase()} · {p.angle.toUpperCase()} · {p.instrument === "choice" ? "PICK ONE" : "SUPPORT/OPPOSE"}
                </span>
              ))}
              <span style={drives}>→ THE CROWD'S QUESTION CHANGES WITH THE RUN'S ARC</span>
            </>
          )}
        </div>
      )}

      {/* files with roles — mis-roled docs are the silent failure mode */}
      {c.doc_roles.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={label}>YOUR FILES, WITH ROLES</span>
            <span style={drives}>→ HOW AGENTS USE EACH DOCUMENT · CLICK A ROLE TO CHANGE IT</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 9 }}>
            {c.doc_roles.map((d) => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ ...mono, fontSize: 10.5, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>{d.name}</span>
                <button
                  onClick={() => {
                    const next = DOC_ROLES[(DOC_ROLES.indexOf(d.role) + 1) % DOC_ROLES.length];
                    void save({ ...c, doc_roles: c.doc_roles.map((x) => (x.name === d.name ? { ...x, role: next } : x)) });
                  }}
                  title={ROLE_HINT[d.role]}
                  style={{ ...chip(d.role === "framework" ? "var(--warn)" : "var(--ln5)", d.role === "framework" ? "var(--warn)" : "var(--t4)", d.role === "framework" ? "var(--warn-dim)" : "transparent"), cursor: "pointer" }}
                >
                  {ROLE_LABEL[d.role]}
                </button>
                {d.note && <span style={{ fontSize: 11.5, color: "var(--t6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{d.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* one-tap clarifiers — the pass's own doubt, never blocking */}
      {c.flags.map((f) => (
        <div key={f.question} style={{ marginTop: 14, borderLeft: "3px solid var(--warn)", background: "var(--warn-dim)", borderRadius: "4px 10px 10px 4px", padding: "12px 16px" }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--t2)" }}>{f.question}</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 9 }}>
            {f.options.map((o) => {
              const active = (f.answer ?? f.default) === o && (f.answer || o === f.default);
              const chosen = f.answer === o;
              return (
                <button
                  key={o}
                  onClick={() => void save({ ...c, flags: c.flags.map((x) => (x.question === f.question ? { ...x, answer: o } : x)) })}
                  style={{
                    ...mono, fontSize: 9.5, letterSpacing: ".05em", padding: "5px 13px", borderRadius: 100, cursor: "pointer",
                    border: `1px solid ${chosen ? "var(--acc)" : "var(--ln6)"}`,
                    background: chosen ? "var(--acc-dim)" : "transparent",
                    color: chosen ? "var(--acc)" : active ? "var(--t3)" : "var(--t5)",
                  }}
                >
                  {o.toUpperCase()}{!f.answer && o === f.default ? " · DEFAULT" : ""}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* the breakdown — collapsed by default; the card must scan in seconds */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ ...mono, display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 9.5, letterSpacing: ".1em", background: "none", border: "none", color: "var(--t5)", cursor: "pointer", padding: 0 }}
      >
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        THE BREAKDOWN · {c.sub_asks.length} SUB-ASK{c.sub_asks.length > 1 ? "S" : ""}
        {c.entities.length > 0 && ` · ${c.entities.length} ENTIT${c.entities.length > 1 ? "IES" : "Y"}`}
        {c.constraints.length > 0 && ` · ${c.constraints.length} CONSTRAINT${c.constraints.length > 1 ? "S" : ""}`}
      </button>

      {open && (
        <div style={{ marginTop: 14, animation: "fadeUp .25s ease both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={label}>SUB-ASKS</span>
            <span style={drives}>→ EACH GETS AN OWNER SEAT + A REPORT SECTION</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            {c.sub_asks.map((s: SubAsk, i: number) => (
              <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "8px 2px", borderBottom: "1px solid var(--ln2)" }}>
                <span style={{ ...mono, fontSize: 9.5, color: "var(--t7)", flex: "none", paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t2)", minWidth: 0, flex: 1 }}>
                  {s.ask}
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t6)", marginLeft: 9 }}>
                    {s.kind.toUpperCase()} · {s.evidence.toUpperCase()}
                  </span>
                </span>
                {c.sub_asks.length > 1 && (
                  <button
                    onClick={() => void save({ ...c, sub_asks: c.sub_asks.filter((x) => x.id !== s.id) })}
                    aria-label={`Remove sub-ask ${i + 1}`}
                    style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1, flex: "none" }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <input
              value={askDraft}
              onChange={(e) => setAskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const ask = askDraft.trim();
                if (!ask || c.sub_asks.length >= 8) return;
                void save({ ...c, sub_asks: [...c.sub_asks, { id: `a${c.sub_asks.length + 1}`, ask, kind: "other", evidence: "plain judgment" }] });
                setAskDraft("");
              }}
              placeholder="+ Add a sub-ask the panel must answer, press Enter"
              style={{ background: "transparent", border: "none", outline: "none", fontFamily: "var(--font-sans), sans-serif", fontSize: 12.5, color: "var(--t3)", caretColor: "var(--acc)", padding: "9px 2px 2px 26px" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 14 }}>
              <span style={label}>ENTITIES</span>
              <span style={drives}>→ SEED DISCIPLINES & RANKED-LIST ITEMS</span>
              {c.entities.map((en) => (
                <span key={en} style={{ ...chip("var(--ln5)", "var(--t3)"), display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {en.toUpperCase()}
                  <button
                    onClick={() => void save({ ...c, entities: c.entities.filter((x) => x !== en) })}
                    aria-label={`Remove ${en}`}
                    style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, fontSize: 11, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={entityDraft}
                onChange={(e) => setEntityDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const en = entityDraft.trim();
                  if (!en || c.entities.includes(en) || c.entities.length >= 12) return;
                  void save({ ...c, entities: [...c.entities, en] });
                  setEntityDraft("");
                }}
                placeholder="+ ADD"
                style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", padding: "4px 10px", borderRadius: 100, background: "transparent", border: "1px dashed var(--ln5)", color: "var(--t4)", outline: "none", width: 64 }}
              />
            </div>

          {c.constraints.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span style={label}>CONSTRAINTS</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 7 }}>
                {c.constraints.map((x) => (
                  <div key={x} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 1, background: "var(--warn)", transform: "rotate(45deg)", flex: "none", position: "relative", top: -1 }} />
                    <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--t4)" }}>{x}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {c.success_criteria.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={label}>WHAT A DECISION-GRADE ANSWER DELIVERS</span>
                <span style={drives}>→ THE REPORT IS HELD TO EVERY LINE</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 7 }}>
                {c.success_criteria.map((x) => (
                  <div key={x} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 1, background: "var(--acc)", transform: "rotate(45deg)", flex: "none", position: "relative", top: -1 }} />
                    <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--t4)" }}>{x}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ ...mono, fontSize: 10, color: "var(--warn)", marginTop: 12 }}>{error.toUpperCase().slice(0, 100)}</div>}
    </div>
  );
}
