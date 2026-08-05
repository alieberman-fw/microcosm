"use client";

/**
 * Stage 1 — the brief composer (CLAUDE.md §2, demo.html Stage 01 reference).
 * One clear problem statement, questions-to-resolve (AI-suggested chip +
 * one-line framing; each becomes a required report section), and success
 * criteria as a bulleted list. The decision shape is classified SILENTLY by
 * the suggest pass (stored in brief.template for the report engine) — there
 * is deliberately no template/shape control in the UI. Re-suggesting after
 * editing the problem replaces prior AI chips but never the user's own.
 * Used full-page on /sim/new (create) and inline on /sim/[id] (edit).
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefQuestion, MAX_DOC_BYTES } from "@/lib/corpus";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface Brief {
  problem: string;
  questions: BriefQuestion[];
  template: string; // internal decision shape — set by the suggest pass, never a UI control
  success: string[];
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
  const [success, setSuccess] = useState<string[]>(initial?.success ?? []);
  const [qDraft, setQDraft] = useState("");
  const [sDraft, setSDraft] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const problemRef = useRef<HTMLTextAreaElement>(null);
  // 6-PR1 — files upload WITH the brief (one gesture, same corpus pipeline);
  // held client-side until create, then pushed through /api/documents
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const createdId = useRef<string | null>(null); // upload retries never re-create the sim

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const oversize = incoming.filter((f) => f.size > MAX_DOC_BYTES);
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of incoming) {
        if (f.size > MAX_DOC_BYTES) continue;
        if (!merged.some((x) => x.name === f.name && x.size === f.size)) merged.push(f);
      }
      return merged.slice(0, 12);
    });
    if (oversize.length) setError(`Over the 50MB limit: ${oversize.map((f) => f.name).join(", ")}`);
  };

  // leaving /sim/new mid-setup must never lose work: the create-mode composer
  // keeps a localStorage draft, restored on return, cleared on create
  const DRAFT_KEY = "mc-sim-draft";
  useEffect(() => {
    if (mode !== "create") return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<Brief>;
      if (!d.problem && !(d.questions ?? []).length && !(d.success ?? []).length) return;
      setProblem(d.problem ?? "");
      setQuestions(d.questions ?? []);
      setShape(d.template ?? "Custom");
      setSuccess(d.success ?? []);
      setDraftRestored(true);
    } catch {
      /* corrupt draft — start clean */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (mode !== "create") return;
    const t = setTimeout(() => {
      if (!problem.trim() && questions.length === 0 && success.length === 0) {
        localStorage.removeItem(DRAFT_KEY);
      } else {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ problem, questions, template: shape, success }));
      }
    }, 400);
    return () => clearTimeout(t);
  }, [mode, problem, questions, shape, success]);

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setProblem("");
    setQuestions([]);
    setShape("Custom");
    setSuccess([]);
    setHint(null);
    setDraftRestored(false);
  };

  // grow to fit — never clip: the page scrolls, long statements drop a size
  const autosize = () => {
    const el = problemRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autosize, [problem]);
  const longProblem = problem.length > 280;

  // typed questions keep their FULL text as the framing; the chip label is
  // AI-SUMMARIZED into the same 2-4 word grammar the suggestions use. The
  // chip lands instantly with a word-boundary label, then the summary
  // patches in — a failed call just keeps the provisional label.
  const addQuestion = (raw: string) => {
    const full = raw.trim();
    if (!full) return;
    let label = full.toUpperCase();
    if (label.length > 40) {
      const cut = label.slice(0, 40);
      label = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim();
    }
    if (!label || questions.some((q) => q.label === label) || questions.length >= 12) return;
    const provisional = label;
    setQuestions((prev) => [...prev, { label: provisional, ...(full.length > 20 ? { detail: full } : {}) }]);
    if (full.length > 20) {
      void fetch("/api/brief/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: full }),
      })
        .then((r) => r.json())
        .then((d: { label?: string }) => {
          const smart = (d.label ?? "").trim();
          if (!smart) return;
          setQuestions((prev) =>
            prev.some((q) => q.label === smart)
              ? prev // summary collides with an existing chip — keep the provisional
              : prev.map((q) => (q.label === provisional && q.detail === full ? { ...q, label: smart } : q)),
          );
        })
        .catch(() => {});
    }
  };

  const addCriterion = (raw: string) => {
    const item = raw.replace(/^[\s•\-–—*✓◆]+/, "").trim().slice(0, 200);
    if (!item || success.includes(item) || success.length >= 8) return;
    setSuccess((prev) => [...prev, item]);
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
      // fresh AI chips replace the previous AI chips; hand-added ones stay
      setQuestions((prev) => {
        const manual = prev.filter((q) => !q.ai);
        const merged = [...manual];
        for (const q of (data.questions ?? []) as BriefQuestion[]) {
          if (!merged.some((m) => m.label === q.label) && merged.length < 12) {
            merged.push({ ...q, ai: true });
          }
        }
        return merged;
      });
      if (data.template) setShape(data.template); // silent classification
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
    // a criterion typed but not yet Entered still counts
    const draft = sDraft.replace(/^[\s•\-–—*✓◆]+/, "").trim().slice(0, 200);
    const criteria = draft && !success.includes(draft) ? [...success, draft].slice(0, 8) : success;
    const brief: Brief = { problem: p, questions, template: shape, success: criteria };
    try {
      if (mode === "create") {
        // create exactly once — a retry after a failed upload PATCHes the
        // brief instead of minting a second simulation
        if (!createdId.current) {
          const res = await fetch("/api/simulations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(brief),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Could not create simulation");
          createdId.current = data.id as string;
        } else {
          await fetch(`/api/simulations/${createdId.current}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(brief),
          });
        }

        // push the attached files through the same corpus pipeline, 3 at a
        // time; failures stay in the tray so nothing silently disappears
        if (files.length) {
          const failed: File[] = [];
          let done = 0;
          setUploadNote(`UPLOADING FILES · 0/${files.length}`);
          let next = 0;
          const queue = [...files];
          const worker = async () => {
            while (next < queue.length) {
              const f = queue[next++];
              const form = new FormData();
              form.set("simId", createdId.current!);
              form.set("file", f);
              try {
                const res = await fetch("/api/documents", { method: "POST", body: form });
                if (!res.ok) throw new Error();
                done++;
              } catch {
                failed.push(f);
              }
              setUploadNote(`UPLOADING FILES · ${done}/${files.length}`);
            }
          };
          await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
          setUploadNote(null);
          if (failed.length) {
            setFiles(failed);
            setError(`${failed.length} file${failed.length > 1 ? "s" : ""} failed to upload — try again, or remove ${failed.length > 1 ? "them" : "it"} to continue (you can re-attach in the workspace)`);
            setSaving(false);
            return;
          }
        }

        localStorage.removeItem(DRAFT_KEY);
        router.push(`/sim/${createdId.current}`);
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
        <div style={{ ...mono, fontSize: 12, letterSpacing: ".14em", color: "var(--acc)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 2.2s infinite" }} />
          The problem · new run
          {draftRestored && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
              <span style={{ fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "3px 9px" }}>
                DRAFT RESTORED
              </span>
              <button
                onClick={discardDraft}
                style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, textDecoration: "underline", textUnderlineOffset: 3, textTransform: "uppercase" }}
              >
                Discard
              </button>
            </span>
          )}
        </div>
      )}

      <textarea
        ref={problemRef}
        value={problem}
        onChange={(e) => setProblem(e.target.value)}
        placeholder={mode === "create"
          ? "Write everything you want the simulation to cover, answer, or research — multi-part and messy welcome. e.g. Is ±212 acres at Signal Butte & Pecos suitable for a 300MW data center campus?"
          : "Is ±212 acres at Signal Butte & Pecos suitable for a 300MW data center campus?"}
        rows={2}
        maxLength={6000}
        style={{
          width: "100%", boxSizing: "border-box", marginTop: mode === "create" ? 18 : 0,
          background: "transparent", border: "none", outline: "none", resize: "none",
          fontFamily: "var(--font-sans), sans-serif", fontWeight: 600,
          fontSize: longProblem ? "clamp(18px, 2vw, 24px)" : "clamp(22px, 2.8vw, 34px)", lineHeight: longProblem ? 1.4 : 1.22, letterSpacing: "-.03em",
          color: "var(--t0)", caretColor: "var(--acc)", overflow: "hidden",
        }}
      />

      {/* 6-PR1 — files travel WITH the prompt: one gesture, same corpus pipeline */}
      {mode === "create" && (
        <div
          onClick={() => pickRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          style={{
            marginTop: 14, border: `1px dashed ${dragOver ? "var(--acc)" : "var(--ln4)"}`,
            background: dragOver ? "var(--acc-dim)" : "transparent",
            borderRadius: 10, padding: files.length ? "12px 14px" : "14px 16px", cursor: "pointer", transition: "all .15s",
          }}
        >
          {files.length === 0 ? (
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".07em", color: dragOver ? "var(--acc)" : "var(--t6)", textAlign: "center" }}>
              + DROP YOUR DILIGENCE FILES WITH THE PROMPT — PDF · TXT/MD · CSV · HTML · GEOJSON · IMAGES (OPTIONAL)
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {files.map((f) => (
                <span
                  key={`${f.name}-${f.size}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 9.5, letterSpacing: ".04em", padding: "5px 11px", borderRadius: 100, border: "1px solid var(--ln5)", color: "var(--t3)", cursor: "default" }}
                >
                  📄 {f.name.length > 34 ? `${f.name.slice(0, 32)}…` : f.name}
                  <button
                    onClick={(e) => { e.stopPropagation(); setFiles((prev) => prev.filter((x) => !(x.name === f.name && x.size === f.size))); }}
                    aria-label={`Remove ${f.name}`}
                    style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t6)" }}>+ ADD MORE</span>
            </div>
          )}
          <input
            ref={pickRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.csv,.html,.json,.geojson,image/*,application/pdf,text/plain,text/markdown,text/csv,text/html"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
            style={{ display: "none" }}
          />
        </div>
      )}

      <div className="card" style={{ padding: "24px 28px", marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
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
            <div key={q.label} style={{ display: "flex", alignItems: "flex-start", gap: 14, animation: "fadeUp .3s ease both" }}>
              {/* fixed label column — every framing sentence starts at the same x */}
              <span style={{ width: 208, flex: "none", display: "flex" }}>
                <span
                  title={q.label}
                  style={{
                    ...mono, fontSize: 10.5, padding: "6px 13px", borderRadius: 100,
                    background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)",
                    maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {q.label}
                </span>
              </span>
              {/* the framing must be READABLE — wrap, never ellipsize */}
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--t5)", minWidth: 0, flex: 1, paddingTop: 6 }}>
                {q.detail ?? ""}
              </span>
              <button
                onClick={() => setQuestions((prev) => prev.filter((x) => x.label !== q.label))}
                aria-label={`Remove ${q.label}`}
                style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, marginTop: 6, fontSize: 14, lineHeight: 1, flex: "none" }}
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

        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 26, flexWrap: "wrap" }}>
          <div style={label}>SUCCESS CRITERIA</div>
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t7)" }}>
            WHAT A DECISION-GRADE ANSWER MUST DELIVER — THE REPORT IS HELD TO THIS
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
          {success.map((s) => (
            <div
              key={s}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "9px 2px",
                borderBottom: "1px solid var(--ln2)", animation: "fadeUp .3s ease both",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 1.5, background: "var(--acc)", transform: "rotate(45deg)", flex: "none" }} />
              <span style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)", minWidth: 0, flex: 1 }}>{s}</span>
              <button
                onClick={() => setSuccess((prev) => prev.filter((x) => x !== s))}
                aria-label="Remove criterion"
                style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1, flex: "none" }}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 2px" }}>
            <span style={{ width: 6, height: 6, borderRadius: 1.5, border: "1px solid var(--ln7)", transform: "rotate(45deg)", flex: "none", boxSizing: "border-box" }} />
            <input
              value={sDraft}
              onChange={(e) => setSDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addCriterion(sDraft); setSDraft(""); }
              }}
              placeholder={success.length ? "Add another criterion and press Enter" : "A go/no-go with conditions… press Enter to add each criterion"}
              maxLength={200}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                fontFamily: "var(--font-sans), sans-serif", fontSize: 13.5, color: "var(--t2)",
                caretColor: "var(--acc)", padding: 0,
              }}
            />
          </div>
        </div>
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
          {saving ? (uploadNote ? "Uploading…" : "Saving…") : mode === "create" ? (files.length ? `Create with ${files.length} file${files.length > 1 ? "s" : ""} →` : "Create simulation →") : "Save brief"}
        </button>
        {uploadNote && (
          <span style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--acc)", animation: "shim 1.2s ease infinite" }}>{uploadNote}</span>
        )}
        {mode === "edit" && (
          <button
            onClick={onCancel}
            style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer" }}
          >
            CANCEL
          </button>
        )}
        {mode === "create" && !uploadNote && (
          <span style={{ ...mono, fontSize: 11, color: "var(--t6)" }}>
            NEXT · THE SYSTEM READS YOUR BRIEF{files.length > 0 ? " + FILES" : ""} AND SHOWS WHAT IT UNDERSTOOD
          </span>
        )}
      </div>
    </div>
  );
}
