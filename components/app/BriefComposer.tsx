"use client";

/**
 * Stage 1 — the brief composer (CLAUDE.md §2, demo.html Stage 01 reference).
 * One clear problem statement, questions-to-resolve (AI-suggested chip +
 * one-line framing; each becomes a required report section), and success
 * criteria. The decision SHAPE is inferred by the suggest pass and shown as
 * an editable "READS AS" hint — never a form field the user must fill.
 * Used full-page on /sim/new (create) and inline on /sim/[id] (edit).
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefQuestion, DECISION_SHAPES } from "@/lib/corpus";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface Brief {
  problem: string;
  questions: BriefQuestion[];
  template: string;
  success: string;
}

export default function BriefComposer({
  mode,
  simId,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  simId?: string;
  initial?: Partial<Brief>;
  onSaved?: (brief: Brief) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState(initial?.problem ?? "");
  const [questions, setQuestions] = useState<BriefQuestion[]>(initial?.questions ?? []);
  const [shape, setShape] = useState(initial?.template ?? "Custom");
  const [shapeOpen, setShapeOpen] = useState(false);
  const [success, setSuccess] = useState(initial?.success ?? "");
  const [qDraft, setQDraft] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problemRef = useRef<HTMLTextAreaElement>(null);

  const autosize = () => {
    const el = problemRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  };
  useEffect(autosize, [problem]);

  const addQuestion = (raw: string) => {
    const label = raw.trim().toUpperCase().slice(0, 40);
    if (!label || questions.some((q) => q.label === label) || questions.length >= 12) return;
    setQuestions((prev) => [...prev, { label }]);
  };

  const suggest = async () => {
    if (!problem.trim() || suggesting) return;
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/brief/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Suggestion failed");
      setQuestions((prev) => {
        const merged = [...prev];
        for (const q of (data.questions ?? []) as BriefQuestion[]) {
          if (!merged.some((m) => m.label === q.label) && merged.length < 12) merged.push(q);
        }
        return merged;
      });
      if (data.template) setShape(data.template);
      if (data.composition) {
        const label = data.composition === "experts" ? "EXPERTS ONLY" : data.composition === "consumers" ? "CONSUMERS / RESIDENTS" : "MIXED PANEL";
        setHint(`CASTING HINT · ${label}${data.rationale ? ` — ${data.rationale}` : ""}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    const p = problem.trim();
    if (!p || saving) return;
    setSaving(true);
    setError(null);
    const brief: Brief = { problem: p, questions, template: shape, success: success.trim() };
    try {
      if (mode === "create") {
        const res = await fetch("/api/simulations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(brief),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not create simulation");
        router.push(`/sim/${data.id}`);
      } else {
        const res = await fetch(`/api/simulations/${simId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(brief),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not save brief");
        onSaved?.(brief);
        setSaving(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  };

  const label: CSSProperties = { ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" };

  return (
    <div style={{ animation: "fadeUp .5s ease both" }}>
      {mode === "create" && (
        <div style={{ ...mono, fontSize: 12, letterSpacing: ".14em", color: "var(--acc)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 2.2s infinite" }} />
          The problem · new run
        </div>
      )}

      <textarea
        ref={problemRef}
        value={problem}
        onChange={(e) => setProblem(e.target.value)}
        placeholder="Is ±212 acres at Signal Butte & Pecos suitable for a 300MW data center campus?"
        rows={2}
        maxLength={2000}
        style={{
          width: "100%", boxSizing: "border-box", marginTop: mode === "create" ? 18 : 0,
          background: "transparent", border: "none", outline: "none", resize: "none",
          fontFamily: "var(--font-sans), sans-serif", fontWeight: 600,
          fontSize: "clamp(22px, 2.8vw, 34px)", lineHeight: 1.22, letterSpacing: "-.03em",
          color: "var(--t0)", caretColor: "var(--acc)", overflow: "hidden",
        }}
      />

      <div className="card" style={{ padding: "24px 28px", marginTop: 18 }}>
        {/* inferred decision shape — editable hint, not a form field */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={label}>
            READS AS · <span style={{ color: "var(--acc)" }}>{shape.toUpperCase()}</span>
          </div>
          <button
            onClick={() => setShapeOpen(!shapeOpen)}
            style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            {shapeOpen ? "CLOSE" : "CHANGE"}
          </button>
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t7)" }}>
            SETS THE REPORT&apos;S LEAD VISUAL — SECTIONS COME FROM YOUR QUESTIONS
          </span>
        </div>
        {shapeOpen && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, animation: "fadeUp .25s ease both" }}>
            {DECISION_SHAPES.map((t) => {
              const on = shape === t;
              return (
                <button
                  key={t}
                  onClick={() => { setShape(t); setShapeOpen(false); }}
                  style={{
                    ...mono, fontSize: 10.5, letterSpacing: ".04em", padding: "7px 14px", borderRadius: 100,
                    cursor: "pointer", transition: "all .15s",
                    background: on ? "var(--acc-dim)" : "transparent",
                    border: `1px solid ${on ? "var(--acc)" : "var(--ln5)"}`,
                    color: on ? "var(--acc)" : "var(--t5)",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 26, flexWrap: "wrap" }}>
          <div style={label}>QUESTIONS TO RESOLVE</div>
          <button
            onClick={suggest}
            disabled={!problem.trim() || suggesting}
            style={{
              ...mono, fontSize: 10, letterSpacing: ".08em", padding: "5px 12px", borderRadius: 100,
              background: "transparent", border: "1px solid var(--ln6)", color: problem.trim() ? "var(--acc)" : "var(--t7)",
              cursor: problem.trim() && !suggesting ? "pointer" : "default",
            }}
          >
            {suggesting ? "SUGGESTING…" : "✦ SUGGEST WITH AI"}
          </button>
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t7)" }}>
            EACH BECOMES A REQUIRED SECTION OF YOUR REPORT
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 13 }}>
          {questions.map((q) => (
            <div key={q.label} style={{ display: "flex", alignItems: "center", gap: 12, animation: "fadeUp .3s ease both" }}>
              <span
                style={{
                  ...mono, fontSize: 11, padding: "6px 14px", borderRadius: 100, flex: "none",
                  background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)",
                }}
              >
                {q.label}
              </span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--t5)", minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {q.detail ?? ""}
              </span>
              <button
                onClick={() => setQuestions((prev) => prev.filter((x) => x.label !== q.label))}
                aria-label={`Remove ${q.label}`}
                style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1, flex: "none" }}
              >
                ×
              </button>
            </div>
          ))}
          {suggesting && [0, 1, 2].map((i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ width: 120, height: 27, borderRadius: 100, background: "var(--sf2)", animation: "shim 1.2s ease infinite", flex: "none" }} />
              <span style={{ height: 10, borderRadius: 100, background: "var(--sf2)", animation: "shim 1.2s ease infinite", width: `${60 - i * 12}%` }} />
            </div>
          ))}
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addQuestion(qDraft); setQDraft(""); }
            }}
            placeholder="+ ADD A QUESTION"
            style={{
              ...mono, fontSize: 11, letterSpacing: ".04em", padding: "7px 14px", borderRadius: 100,
              background: "transparent", border: "1px dashed var(--ln5)", color: "var(--t3)",
              outline: "none", width: 150, alignSelf: "flex-start",
            }}
          />
        </div>
        {hint && (
          <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".04em", color: "var(--t5)", marginTop: 14, animation: "fadeUp .3s ease both" }}>
            {hint}
          </div>
        )}

        <div style={{ ...label, marginTop: 26 }}>SUCCESS CRITERIA · WHAT A DECISION-GRADE ANSWER LOOKS LIKE</div>
        <textarea
          value={success}
          onChange={(e) => setSuccess(e.target.value)}
          placeholder="A go/no-go with conditions, a defensible price band, and the three risks that would kill the deal."
          rows={2}
          maxLength={2000}
          style={{
            width: "100%", boxSizing: "border-box", marginTop: 12, padding: "12px 14px",
            background: "var(--sf2)", border: "1px solid var(--ln3)", borderRadius: 10,
            fontFamily: "var(--font-sans), sans-serif", fontSize: 13.5, lineHeight: 1.6,
            color: "var(--t2)", outline: "none", resize: "vertical",
          }}
        />
      </div>

      {error && (
        <div style={{ ...mono, fontSize: 11, color: "var(--warn)", marginTop: 14 }}>{error}</div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 26, flexWrap: "wrap" }}>
        <button
          onClick={save}
          disabled={!problem.trim() || saving}
          style={{
            background: problem.trim() ? "var(--acc)" : "var(--sf2)",
            color: problem.trim() ? "var(--acc-c)" : "var(--t6)",
            fontWeight: 600, fontSize: 14.5, padding: "13px 28px", borderRadius: 100, border: "none",
            cursor: problem.trim() && !saving ? "pointer" : "default",
            fontFamily: "var(--font-sans), sans-serif",
          }}
        >
          {saving ? "Saving…" : mode === "create" ? "Create & attach documents →" : "Save brief"}
        </button>
        {mode === "edit" && (
          <button
            onClick={onCancel}
            style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer" }}
          >
            CANCEL
          </button>
        )}
        {mode === "create" && (
          <span style={{ ...mono, fontSize: 11, color: "var(--t6)" }}>
            NEXT · UPLOAD DILIGENCE MATERIALS
          </span>
        )}
      </div>
    </div>
  );
}
