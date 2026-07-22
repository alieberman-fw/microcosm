"use client";

/**
 * The simulation workspace (/sim/[id]) — stages 1–2 live (brief + corpus),
 * stages 3–5 marked SOON. Corpus rows mirror the demo's "ATTACHING DILIGENCE
 * MATERIALS" grammar; "Test the corpus" proves the grounding path: whole
 * documents in context via Files API ids, native citations, cached prefix.
 */

import { CSSProperties, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BriefComposer, { Brief } from "@/components/app/BriefComposer";
import Markdown from "@/components/app/Markdown";
import { DIRECT_CONTEXT_BUDGET, MAX_DOC_BYTES } from "@/lib/corpus";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface DocRow {
  id: string;
  name: string;
  size_bytes: number | null;
  mime: string | null;
  parse_status: string;
  parse_error?: string | null;
  token_estimate: number | null;
  page_count: number | null;
  created_at: string;
}

interface PendingUpload { key: string; name: string; size: number; error?: string }

interface Cite { title: string; pageStart?: number; pageEnd?: number; quote: string }
interface Answer {
  question: string;
  segments: { text: string; cites: Cite[] }[];
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  groundedIn: number;
}

const fmtBytes = (n: number | null) => {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtTokens = (n: number | null | undefined) => {
  if (!n) return null;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n);
};

const STAGES = ["BRIEF", "CORPUS", "POPULATION", "RUN", "REPORT"] as const;

export default function SimWorkspace({
  sim,
  initialDocs,
}: {
  sim: { id: string; status: string; brief: Brief; created_at: string };
  initialDocs: DocRow[];
}) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief>(sim.brief);
  const [editing, setEditing] = useState(false);
  const [docs, setDocs] = useState<DocRow[]>(initialDocs);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [askError, setAskError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsedDocs = docs.filter((d) => d.parse_status === "parsed");
  const totalTokens = parsedDocs.reduce((s, d) => s + (d.token_estimate ?? 0), 0);
  const stageDone = [true, parsedDocs.length > 0, false, false, false];

  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      if (file.size > MAX_DOC_BYTES) {
        setPending((prev) => [...prev, { key, name: file.name, size: file.size, error: "Over the 50MB limit" }]);
        continue;
      }
      setPending((prev) => [...prev, { key, name: file.name, size: file.size }]);
      const form = new FormData();
      form.set("simId", sim.id);
      form.set("file", file);
      try {
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        setDocs((prev) => [...prev, data.document as DocRow]);
        setPending((prev) => prev.filter((p) => p.key !== key));
      } catch (e) {
        setPending((prev) => prev.map((p) => p.key === key ? { ...p, error: e instanceof Error ? e.message : "Upload failed" } : p));
      }
    }
  };

  const removeDoc = async (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
  };

  const openDoc = async (id: string) => {
    const res = await fetch(`/api/documents/${id}`);
    const data = await res.json();
    if (res.ok && data.url) window.open(data.url, "_blank", "noopener");
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || asking || parsedDocs.length === 0) return;
    setAsking(true);
    setAskError(null);
    try {
      const res = await fetch(`/api/simulations/${sim.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ask failed");
      setAnswers((prev) => [{ question: q, ...data } as Answer, ...prev]);
      setQuestion("");
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  };

  const label: CSSProperties = { ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 40px 90px" }}>
      {/* stage rail */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {STAGES.map((s, i) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                ...mono, fontSize: 10, letterSpacing: ".1em",
                color: stageDone[i] ? "var(--acc)" : i <= 1 ? "var(--t4)" : "var(--t7)",
              }}
            >
              {String(i + 1).padStart(2, "0")} {s}
              {stageDone[i] && " ✓"}
              {i > 1 && <span style={{ marginLeft: 6, border: "1px solid var(--ln4)", borderRadius: 100, padding: "1px 6px", fontSize: 8, color: "var(--t7)" }}>SOON</span>}
            </span>
            {i < STAGES.length - 1 && <span style={{ width: 18, height: 1, background: "var(--ln4)" }} />}
          </span>
        ))}
      </div>

      {/* brief */}
      {editing ? (
        <div style={{ marginTop: 34 }}>
          <BriefComposer
            mode="edit"
            simId={sim.id}
            initial={brief}
            onSaved={(b) => { setBrief(b); setEditing(false); router.refresh(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div style={{ marginTop: 34, animation: "fadeUp .4s ease both" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
            <h1 style={{ margin: 0, fontSize: "clamp(24px,3vw,36px)", fontWeight: 600, lineHeight: 1.22, letterSpacing: "-.03em", maxWidth: 760 }}>
              {brief.problem}
            </h1>
            <button
              onClick={() => setEditing(true)}
              style={{ ...mono, flex: "none", fontSize: 10, letterSpacing: ".08em", padding: "7px 14px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln6)", color: "var(--t5)", cursor: "pointer" }}
            >
              EDIT BRIEF
            </button>
          </div>
          <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".07em", color: "var(--t6)", marginTop: 14 }}>
            {brief.template?.toUpperCase() ?? "CUSTOM"} · CREATED {new Date(sim.created_at).toLocaleDateString()} · {sim.status.toUpperCase()}
          </div>
          {brief.questions?.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              {brief.questions.map((q) => (
                <span
                  key={q.label}
                  title={q.detail}
                  style={{ ...mono, fontSize: 11, padding: "7px 14px", borderRadius: 100, background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)", cursor: q.detail ? "help" : "default" }}
                >
                  {q.label}
                </span>
              ))}
            </div>
          )}
          {brief.success && (
            <p style={{ margin: "16px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "var(--t5)", maxWidth: 720 }}>
              <span style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>SUCCESS · </span>
              {brief.success}
            </p>
          )}
        </div>
      )}

      {/* corpus */}
      <div className="card" style={{ padding: "26px 30px", marginTop: 36 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={label}>
            DILIGENCE MATERIALS{parsedDocs.length > 0 && ` · ${parsedDocs.length} DOC${parsedDocs.length > 1 ? "S" : ""} · ~${fmtTokens(totalTokens)} TOKENS`}
          </div>
          {parsedDocs.length > 0 && (
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: totalTokens > DIRECT_CONTEXT_BUDGET ? "var(--warn)" : "var(--acc)" }}>
              {totalTokens > DIRECT_CONTEXT_BUDGET ? "LARGE CORPUS · 1M-CONTEXT TIER" : "GROUNDING · FULL DOCUMENTS IN CONTEXT"}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16 }}>
          {docs.map((d) => (
            <div
              key={d.id}
              className="doc-row"
              style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--ln3)", borderRadius: 10, padding: "11px 16px", animation: "fadeUp .35s ease both" }}
            >
              <svg width="14" height="16" viewBox="0 0 14 17" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ color: "var(--t6)", flex: "none" }}>
                <path d="M2 1h7l4 4v10.5H2z" /><path d="M9 1v4h4M4.5 9h5M4.5 12h5" />
              </svg>
              <button
                onClick={() => openDoc(d.id)}
                title="Open the original"
                style={{ ...mono, fontSize: 11, color: "var(--t3)", background: "none", border: "none", cursor: "pointer", padding: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}
              >
                {d.name}
              </button>
              <span style={{ ...mono, fontSize: 10, color: "var(--t7)", flex: "none" }}>{fmtBytes(d.size_bytes)}</span>
              <span style={{ flex: 1 }} />
              {(d.page_count || d.token_estimate) && (
                <span style={{ ...mono, fontSize: 10, color: "var(--t6)", flex: "none" }}>
                  {d.page_count ? `${d.page_count}P · ` : ""}{fmtTokens(d.token_estimate)} TOK
                </span>
              )}
              {d.parse_status === "parsed" ? (
                <span style={{ ...mono, fontSize: 10, color: "var(--acc)", flex: "none" }}>PARSED ✓</span>
              ) : d.parse_status === "error" ? (
                <span title={d.parse_error ?? undefined} style={{ ...mono, fontSize: 10, color: "var(--warn)", flex: "none" }}>ERROR</span>
              ) : (
                <span style={{ ...mono, fontSize: 10, color: "var(--t6)", flex: "none", animation: "shim 1.2s ease infinite" }}>PARSING…</span>
              )}
              <button
                onClick={() => removeDoc(d.id)}
                aria-label={`Remove ${d.name}`}
                style={{ background: "none", border: "none", color: "var(--t7)", cursor: "pointer", padding: "0 0 0 4px", fontSize: 14, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}

          {pending.map((p) => (
            <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--ln3)", borderRadius: 10, padding: "11px 16px" }}>
              <svg width="14" height="16" viewBox="0 0 14 17" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ color: "var(--t6)", flex: "none" }}>
                <path d="M2 1h7l4 4v10.5H2z" /><path d="M9 1v4h4M4.5 9h5M4.5 12h5" />
              </svg>
              <span style={{ ...mono, fontSize: 11, color: "var(--t3)" }}>{p.name}</span>
              <span style={{ ...mono, fontSize: 10, color: "var(--t7)", flex: "none" }}>{fmtBytes(p.size)}</span>
              {p.error ? (
                <>
                  <span style={{ flex: 1 }} />
                  <span style={{ ...mono, fontSize: 10, color: "var(--warn)" }}>{p.error.toUpperCase().slice(0, 60)}</span>
                  <button onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))} style={{ background: "none", border: "none", color: "var(--t7)", cursor: "pointer", padding: 0, fontSize: 14 }}>×</button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, height: 3, borderRadius: 100, background: "var(--sf2)", overflow: "hidden" }}>
                    <div style={{ height: 3, width: "60%", borderRadius: 100, background: "var(--acc)", animation: "shim 1.2s ease infinite" }} />
                  </div>
                  <span style={{ ...mono, fontSize: 10, color: "var(--t6)", flex: "none" }}>PARSING · UPLOADING TO CONTEXT…</span>
                </>
              )}
            </div>
          ))}
        </div>

        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files); }}
          style={{
            marginTop: 14, border: `1px dashed ${dragOver ? "var(--acc)" : "var(--ln5)"}`,
            background: dragOver ? "var(--acc-dim)" : "transparent",
            borderRadius: 10, padding: "22px 16px", textAlign: "center", cursor: "pointer", transition: "all .15s",
          }}
        >
          <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: dragOver ? "var(--acc)" : "var(--t6)" }}>
            + DROP FILES OR CLICK — PDF · TXT/MD · CSV · HTML · GEOJSON · IMAGES
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.csv,.html,.json,.geojson,image/*,application/pdf,text/plain,text/markdown,text/csv,text/html"
            onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = ""; }}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* test the corpus */}
      <div className="card" style={{ padding: "26px 30px", marginTop: 20 }}>
        <div style={label}>TEST THE CORPUS · ASK A QUESTION, GET A CITED ANSWER</div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
            placeholder={parsedDocs.length ? "What does the survey say about the utility easement?" : "Upload a document first"}
            disabled={parsedDocs.length === 0}
            style={{
              flex: 1, padding: "12px 16px", background: "var(--sf2)", border: "1px solid var(--ln3)",
              borderRadius: 10, fontFamily: "var(--font-sans), sans-serif", fontSize: 13.5,
              color: "var(--t1)", outline: "none",
            }}
          />
          <button
            onClick={() => void ask()}
            disabled={!question.trim() || asking || parsedDocs.length === 0}
            style={{
              background: question.trim() && !asking ? "var(--acc)" : "var(--sf2)",
              color: question.trim() && !asking ? "var(--acc-c)" : "var(--t6)",
              fontWeight: 600, fontSize: 13.5, padding: "0 22px", borderRadius: 100, border: "none",
              cursor: question.trim() && !asking ? "pointer" : "default", fontFamily: "var(--font-sans), sans-serif",
            }}
          >
            {asking ? "Reading…" : "Ask"}
          </button>
        </div>
        {askError && <div style={{ ...mono, fontSize: 11, color: "var(--warn)", marginTop: 12 }}>{askError}</div>}
        {asking && (
          <div style={{ marginTop: 18 }}>
            <div style={{ height: 10, borderRadius: 100, background: "var(--sf2)", width: "80%", animation: "shim 1.2s ease infinite" }} />
            <div style={{ height: 10, borderRadius: 100, background: "var(--sf2)", width: "60%", marginTop: 8, animation: "shim 1.2s ease infinite" }} />
          </div>
        )}

        {answers.map((a, i) => (
          <div key={i} style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--ln2)", animation: "fadeUp .35s ease both" }}>
            <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".05em", color: "var(--t5)" }}>Q · {a.question}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--t2)", marginTop: 10 }}>
              {a.segments.map((s, j) => (
                <span key={j}>
                  <Markdown text={s.text} />
                  {s.cites.map((c, k) => (
                    <span
                      key={k}
                      title={c.quote}
                      style={{
                        ...mono, fontSize: 9, letterSpacing: ".04em", color: "var(--acc)",
                        border: "1px solid var(--acc)", background: "var(--acc-dim)",
                        borderRadius: 100, padding: "2px 8px", margin: "0 4px", whiteSpace: "nowrap",
                        verticalAlign: "2px", cursor: "help",
                      }}
                    >
                      {c.title.toUpperCase().slice(0, 28)}{c.pageStart ? ` · P.${c.pageStart}${c.pageEnd && c.pageEnd > c.pageStart ? `–${c.pageEnd}` : ""}` : ""}
                    </span>
                  ))}
                </span>
              ))}
            </div>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", marginTop: 12 }}>
              GROUNDED IN {a.groundedIn} DOC{a.groundedIn > 1 ? "S" : ""} · IN {fmtTokens(a.usage.input + a.usage.cacheRead + a.usage.cacheWrite)}
              {a.usage.cacheRead > 0 && ` (${fmtTokens(a.usage.cacheRead)} CACHED)`} · OUT {fmtTokens(a.usage.output)} · {a.model.toUpperCase()}
            </div>
          </div>
        ))}
      </div>

      {/* next stage */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 30 }}>
        <button
          disabled
          style={{
            background: "var(--sf2)", color: "var(--t6)", fontWeight: 600, fontSize: 14.5,
            padding: "13px 28px", borderRadius: 100, border: "1px solid var(--ln4)", cursor: "default",
            fontFamily: "var(--font-sans), sans-serif",
          }}
        >
          Cast the population →
        </button>
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t7)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "3px 9px" }}>
          NEXT BUILD · CASTING DIRECTOR
        </span>
      </div>
    </div>
  );
}
