"use client";

/**
 * The simulation workspace (/sim/[id]). Files ride WITH the brief as a
 * compact circle cluster (details expand on demand); the Understanding pass
 * reads the brief + docs first — population and run config reveal only
 * after WHAT I UNDERSTOOD lands, so the loading state tells one story.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BriefComposer, { Brief } from "@/components/app/BriefComposer";
import PopulationStage, { CastingInfo, WorkspaceSeat } from "@/components/app/PopulationStage";
import RunConfigStage from "@/components/app/RunConfigStage";
import UnderstandingCard from "@/components/app/UnderstandingCard";
import StageRail from "@/components/app/StageRail";
import { BriefContract } from "@/lib/understand";
import { RunConfig } from "@/lib/run";
import { DIRECT_CONTEXT_BUDGET, MAX_DOC_BYTES, imageOrdinalsSafe } from "@/lib/corpus";
import { REPORTS_REFRESH_EVENT } from "@/lib/report-state";

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

const fmtTokens = (n: number | null | undefined) => {
  if (!n) return null;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n);
};

const STAGES = ["BRIEF", "CORPUS", "POPULATION", "RUN", "REPORT"] as const;

export default function SimWorkspace({
  sim,
  initialDocs,
  initialSeats,
  initialCrowd = [],
  initialCasting,
  initialContract = null,
  initialRun = null,
  initialTools = [],
  hasRun = false,
  hasReport = false,
  synthesizing = false,
}: {
  sim: { id: string; status: string; brief: Brief; created_at: string };
  initialDocs: DocRow[];
  initialSeats: WorkspaceSeat[];
  initialCrowd?: WorkspaceSeat[];
  initialCasting: CastingInfo | null;
  /** 6-PR1 — the Brief Contract (brief.contract) for the understanding card */
  initialContract?: BriefContract | null;
  initialRun?: Partial<RunConfig> | null;
  /** 3d — saved agent-tools allowlist (config.tools) */
  initialTools?: string[];
  hasRun?: boolean;
  hasReport?: boolean;
  /** PR D / field fix (2026-08-06): a report synthesis is live for this sim */
  synthesizing?: boolean;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief>(sim.brief);
  const [editing, setEditing] = useState(false);
  const [populationCount, setPopulationCount] = useState(initialSeats.length);

  // PR D / field fix (2026-08-06): while a synthesis is live, keep the
  // workspace honest with a soft server refresh — the `synthesizing` prop
  // recomputes each pass, the banner clears itself when the report lands,
  // and the unread badge is told the moment we watch it finish.
  const sawSynth = useRef(false);
  useEffect(() => {
    if (synthesizing) {
      sawSynth.current = true;
      const t = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, 8_000);
      return () => clearInterval(t);
    }
    if (sawSynth.current) {
      sawSynth.current = false;
      window.dispatchEvent(new Event(REPORTS_REFRESH_EVENT));
    }
  }, [synthesizing, router]);
  const [castingBusy, setCastingBusy] = useState(false);
  // the mode is CHOSEN in run config; a fresh cast re-seeds it to the director's pick
  const [modeSel, setModeSel] = useState<string | null>(initialCasting?.mode ?? null);
  const [docs, setDocs] = useState<DocRow[]>(initialDocs);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [hoverDoc, setHoverDoc] = useState<string | null>(null); // circle hover → the "−" remove badge
  const [dragOver, setDragOver] = useState(false);
  // understanding-first choreography: population + run config stay hidden
  // while the pass reads a fresh brief, so the loading state is ONE story
  const [understanding, setUnderstanding] = useState<"idle" | "deriving" | "ready" | "error">("idle");
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // notes become a real corpus document — same parse/chunk/Files-API pipeline
  const saveNotes = () => {
    const body = noteText.trim();
    if (!body) return;
    const title = noteTitle.trim() || "untitled";
    const file = new File(
      [`FIELD NOTES — ${title.toUpperCase()}\n\n${body}\n`],
      `Field notes — ${title.slice(0, 60)}.txt`,
      { type: "text/plain" },
    );
    void uploadFiles([file]);
    setNotesOpen(false);
    setNoteTitle("");
    setNoteText("");
  };

  const parsedDocs = docs.filter((d) => d.parse_status === "parsed");
  // C6: "IMAGE n" = position among parsed images in corpus order (created_at
  // asc — the docs array's order) — EXACTLY the label agents see in context.
  // Field report 3: ordinals are suppressed when any image filename contains
  // a digit (1.jpg as "IMAGE 2" is worse than no number at all).
  const imageOrdinals = new Map<string, number>();
  const parsedImages = parsedDocs.filter((d) => (d.mime ?? "").startsWith("image/"));
  if (imageOrdinalsSafe(parsedImages.map((d) => d.name))) {
    parsedImages.forEach((d, i) => imageOrdinals.set(d.id, i + 1));
  }
  const totalTokens = parsedDocs.reduce((s, d) => s + (d.token_estimate ?? 0), 0);
  // a stage is DONE when its artifact exists: parsed docs, a cast panel,
  // persisted run posts, a synthesized report — never mere saved config
  // Corpus is optional — a run happening at all proves that stage was passed
  // (field fix: doc-less sims showed a gray CORPUS on fully-complete runs).
  const stageDone = [true, parsedDocs.length > 0 || hasRun, populationCount > 0, hasRun, hasReport];

  // you-are-here (field fix): the rail highlights the SECTION currently in
  // view — brief/corpus/population/run-config are scroll positions on this
  // page, so the pill follows the scroll (report lives on its own page)
  const [activeStage, setActiveStage] = useState(0);
  useEffect(() => {
    const ids = ["stage-brief", "stage-corpus", "stage-population", "stage-run"];
    // classic scroll-spy: the LAST section whose top has crossed the reading
    // line (just under the rail) is where the user is — one section active
    // at a time, brief wins at the very top. The app scrolls inside <main>,
    // so listen in capture (scroll doesn't bubble).
    const pick = () => {
      let active = 0;
      for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && el.getBoundingClientRect().top <= 170) active = i;
      }
      setActiveStage(active);
    };
    pick();
    document.addEventListener("scroll", pick, true);
    window.addEventListener("resize", pick);
    // belt-and-braces: sections also move without scroll events (content
    // loading in, casting landing, collapse/expand) — a slow poll keeps the
    // pill honest; setState with an unchanged value is a React no-op
    const t = setInterval(pick, 600);
    return () => { document.removeEventListener("scroll", pick, true); window.removeEventListener("resize", pick); clearInterval(t); };
  }, []);

  // bulk drops: every file queues visibly at once, then uploads 3 at a time —
  // a strictly serial loop made 5-file drops look like only the first landed
  const uploadFiles = async (files: FileList | File[]) => {
    const entries = Array.from(files).map((file) => ({ file, key: `${file.name}-${Date.now()}-${Math.random()}` }));
    const oversize = entries.filter((e) => e.file.size > MAX_DOC_BYTES);
    const queue = entries.filter((e) => e.file.size <= MAX_DOC_BYTES);
    setPending((prev) => [
      ...prev,
      ...oversize.map((e) => ({ key: e.key, name: e.file.name, size: e.file.size, error: "Over the 50MB limit" })),
      ...queue.map((e) => ({ key: e.key, name: e.file.name, size: e.file.size })),
    ]);
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const e = queue[next++];
        const form = new FormData();
        form.set("simId", sim.id);
        form.set("file", e.file);
        try {
          const res = await fetch("/api/documents", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Upload failed");
          setDocs((prev) => [...prev, data.document as DocRow]);
          setPending((prev) => prev.filter((p) => p.key !== e.key));
        } catch (err) {
          setPending((prev) => prev.map((p) => p.key === e.key ? { ...p, error: err instanceof Error ? err.message : "Upload failed" } : p));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
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

  // PR-A — image uploads get THUMBNAILS on their rows and a click-to-view
  // lightbox, so "which file is 4.jpg" is answerable at a glance
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => {
    const imageDocs = docs.filter((d) => (d.mime ?? "").startsWith("image/") && d.parse_status === "parsed" && !thumbs[d.id]);
    if (!imageDocs.length) return;
    void (async () => {
      const entries: [string, string][] = [];
      for (const d of imageDocs) {
        try {
          const res = await fetch(`/api/documents/${d.id}`);
          const data = await res.json();
          if (res.ok && data.url) entries.push([d.id, data.url as string]);
        } catch { /* row falls back to the file icon */ }
      }
      if (entries.length) setThumbs((t) => ({ ...t, ...Object.fromEntries(entries) }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  const label: CSSProperties = { ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" };

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto", padding: "40px 40px 90px" }}>
      {/* stage rail — live stages jump to their section; the you-are-here
          pill follows the section in view (scroll-spy above) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <StageRail
          stages={STAGES.map((s, i) => {
            const target = ["stage-brief", "stage-corpus", "stage-population", "stage-run"][i];
            const reportStage = i === 4;
            return {
              label: s,
              done: stageDone[i],
              current: !reportStage && activeStage === i,
              onClick: () => {
                if (reportStage) {
                  if (synthesizing) { router.push(`/sim/${sim.id}/run`); return; } // watch the ticker live
                  if (hasReport) router.push(`/sim/${sim.id}/report`);
                  return;
                }
                if (i === 3 && hasRun) { router.push(`/sim/${sim.id}/run`); return; }
                if (target) document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
              },
              title: reportStage
                ? (synthesizing ? "Synthesizing now — watch it on the run screen" : hasReport ? "Open the report" : "Synthesize on the run screen after a run")
                : i === 3 && hasRun ? "Open the run" : target ? `Jump to ${s.toLowerCase()}` : undefined,
            };
          })}
        />
      </div>

      {/* PR D / field fix (2026-08-06): a report synthesizing right now shows
          its status HERE too — leaving the run screen mid-synthesis used to
          leave the workspace claiming there was no report activity at all */}
      {synthesizing && sim.status !== "running" && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 12, padding: "12px 18px", marginTop: 22, flexWrap: "wrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite", flex: "none" }} />
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--acc)", minWidth: 0, flex: 1 }}>
            THE REPORT IS SYNTHESIZING — IT KEEPS GOING IF YOU LEAVE, AND THE REPORTS TAB LIGHTS UP WHEN IT LANDS
          </span>
          <button
            onClick={() => router.push(`/sim/${sim.id}/run`)}
            style={{ background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 13, padding: "9px 20px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif", flex: "none" }}
          >
            Watch it live →
          </button>
        </div>
      )}

      {/* field fix: while a run is LIVE the whole workspace is read-only —
          brief, files, understanding, population AND config (the server
          already 409s run-touching changes; this makes the freeze visible
          everywhere) — and the primary action becomes VIEW LIVE RUN */}
      {sim.status === "running" && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--warn)", background: "var(--warn-dim)", borderRadius: 12, padding: "12px 18px", marginTop: 22, flexWrap: "wrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--warn)", animation: "pulseDot 1.4s ease infinite", flex: "none" }} />
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--warn)", minWidth: 0, flex: 1 }}>
            A SIMULATION IS RUNNING — THE BRIEF, FILES, POPULATION & SETTINGS ARE LOCKED UNTIL IT FINISHES (OR YOU STOP IT)
          </span>
          <button
            onClick={() => router.push(`/sim/${sim.id}/run`)}
            style={{ background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 13, padding: "9px 20px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif", flex: "none" }}
          >
            View live run →
          </button>
        </div>
      )}

      <div style={sim.status === "running" ? { opacity: 0.45, pointerEvents: "none", userSelect: "none" } : undefined} aria-disabled={sim.status === "running"}>
      {/* brief */}
      {editing ? (
        <div id="stage-brief" style={{ marginTop: 34, scrollMarginTop: 20 }}>
          <BriefComposer
            mode="edit"
            simId={sim.id}
            initial={brief}
            onSaved={(b) => { setBrief(b); setEditing(false); router.refresh(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div id="stage-brief" style={{ marginTop: 34, animation: "fadeUp .4s ease both", scrollMarginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
            {/* free-form asks run long — step the headline down so a
                multi-paragraph brief reads as prose, not a wall of display type */}
            <h1
              style={
                brief.problem.length > 300
                  ? { margin: 0, fontSize: "clamp(15px,1.6vw,18px)", fontWeight: 500, lineHeight: 1.6, letterSpacing: "-.01em", maxWidth: 820, color: "var(--t1)", whiteSpace: "pre-wrap" }
                  : { margin: 0, fontSize: "clamp(24px,3vw,36px)", fontWeight: 600, lineHeight: 1.22, letterSpacing: "-.03em", maxWidth: 760 }
              }
            >
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
            CREATED {new Date(sim.created_at).toLocaleDateString()} · {sim.status.toUpperCase()}
          </div>

          {/* files ride WITH the brief — overlapping circles + "+"; hover a
              circle for the "−" remove badge (field fix: deletion used to
              hide inside a details panel that no longer exists) */}
          <div id="stage-corpus" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap", scrollMarginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {docs.slice(0, 7).map((d, i) => {
                const ext = (d.name.split(".").pop() ?? "").toUpperCase().slice(0, 4);
                const hovered = hoverDoc === d.id;
                return (
                  <span
                    key={d.id}
                    onMouseEnter={() => setHoverDoc(d.id)}
                    onMouseLeave={() => setHoverDoc((h) => (h === d.id ? null : h))}
                    style={{ position: "relative", display: "inline-flex", marginLeft: i ? -9 : 0, zIndex: hovered ? 20 : 7 - i, flex: "none" }}
                  >
                    <button
                      title={`${d.name}${imageOrdinals.has(d.id) ? ` · IMAGE ${imageOrdinals.get(d.id)} to the panel` : ""}${d.parse_status === "parsed" ? "" : d.parse_status === "error" ? " — PARSE ERROR" : " — parsing…"}`}
                      onClick={() => (thumbs[d.id] ? setLightbox({ url: thumbs[d.id], name: d.name }) : void openDoc(d.id))}
                      style={{
                        width: 32, height: 32, borderRadius: "50%", padding: 0,
                        border: `1px solid ${d.parse_status === "error" ? "var(--warn)" : hovered ? "var(--ln7)" : "var(--ln5)"}`,
                        background: "var(--sf2)", cursor: "pointer", overflow: "hidden", flex: "none",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {thumbs[d.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                        <img src={thumbs[d.id]} alt={d.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : d.name.startsWith("Field notes") ? (
                        <span style={{ color: "var(--acc)", fontSize: 12, lineHeight: 1 }}>✎</span>
                      ) : (
                        <span style={{ ...mono, fontSize: 7, letterSpacing: ".04em", color: d.parse_status === "parsed" ? "var(--t4)" : "var(--t6)" }}>{ext || "DOC"}</span>
                      )}
                    </button>
                    {hovered && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setHoverDoc(null); void removeDoc(d.id); }}
                        title={`Remove ${d.name} from the corpus`}
                        aria-label={`Remove ${d.name}`}
                        style={{
                          position: "absolute", top: -5, right: -5, width: 15, height: 15, borderRadius: "50%",
                          border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)",
                          fontSize: 11, lineHeight: "12px", padding: 0, cursor: "pointer", fontWeight: 600,
                        }}
                      >
                        −
                      </button>
                    )}
                  </span>
                );
              })}
              {docs.length > 7 && (
                <span style={{ ...mono, width: 32, height: 32, borderRadius: "50%", marginLeft: -9, border: "1px solid var(--ln5)", background: "var(--sf2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, color: "var(--t5)", flex: "none" }}>
                  +{docs.length - 7}
                </span>
              )}
              {pending.filter((p) => !p.error).map((p) => (
                <span key={p.key} title={`${p.name} — uploading…`} style={{ width: 32, height: 32, borderRadius: "50%", marginLeft: docs.length ? -9 : 0, border: "1px dashed var(--ln6)", background: "var(--sf2)", animation: "shim 1.2s ease infinite", flex: "none" }} />
              ))}
              <button
                onClick={() => fileRef.current?.click()}
                title="Add files — same corpus pipeline; the panel cites them by name"
                aria-label="Add files"
                style={{
                  width: 32, height: 32, borderRadius: "50%", marginLeft: docs.length || pending.length ? 8 : 0,
                  border: "1px dashed var(--ln6)", background: "transparent", color: "var(--acc)",
                  cursor: "pointer", fontSize: 15, lineHeight: 1, flex: "none",
                }}
              >
                +
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,.csv,.html,.json,.geojson,image/*,application/pdf,text/plain,text/markdown,text/csv,text/html"
                onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = ""; }}
                style={{ display: "none" }}
              />
            </div>
            <span style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--t7)" }}>
              {docs.length > 0
                ? `${parsedDocs.length} DOC${parsedDocs.length === 1 ? "" : "S"} IN CONTEXT${totalTokens ? ` · ~${fmtTokens(totalTokens)} TOK` : ""}${totalTokens > DIRECT_CONTEXT_BUDGET ? " · LARGE CORPUS — 1M-CONTEXT TIER" : ""} · HOVER A FILE TO REMOVE`
                : "ATTACH DILIGENCE FILES — AGENTS CITE THEM BY NAME"}
              {" · "}
              <button onClick={() => setNotesOpen(true)} style={{ ...mono, fontSize: 9, letterSpacing: ".07em", background: "none", border: "none", color: "var(--acc)", cursor: "pointer", padding: 0 }}>
                ✎ WRITE WHAT YOU KNOW
              </button>
            </span>
            {pending.filter((p) => p.error).map((p) => (
              <span key={p.key} style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--warn)" }}>
                {p.name.toUpperCase().slice(0, 28)}: {p.error!.toUpperCase().slice(0, 40)}
                <button onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))} aria-label="Dismiss" style={{ background: "none", border: "none", color: "var(--warn)", cursor: "pointer", padding: "0 0 0 6px", fontSize: 11 }}>×</button>
              </span>
            ))}
          </div>
          {brief.questions?.length > 0 && (
            brief.questions.some((q) => q.detail) ? (
              // any question carrying a framing renders as readable rows — a
              // FIXED label column so every framing starts at the same x
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16, maxWidth: 920 }}>
                {brief.questions.map((q) => (
                  <div key={q.label} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <span style={{ width: 208, flex: "none", display: "flex" }}>
                      <span title={q.label} style={{ ...mono, fontSize: 10.5, padding: "6px 13px", borderRadius: 100, background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {q.label}
                      </span>
                    </span>
                    {q.detail && <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--t5)", minWidth: 0, flex: 1, paddingTop: 6 }}>{q.detail}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {brief.questions.map((q) => (
                  <span key={q.label} style={{ ...mono, fontSize: 11, padding: "7px 14px", borderRadius: 100, background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)" }}>
                    {q.label}
                  </span>
                ))}
              </div>
            )
          )}
          {brief.success.length > 0 && (
            <div style={{ marginTop: 18, maxWidth: 720 }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>SUCCESS CRITERIA</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9 }}>
                {brief.success.map((s) => (
                  <div key={s} style={{ display: "flex", alignItems: "baseline", gap: 11 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 1, background: "var(--acc)", transform: "rotate(45deg)", flex: "none", position: "relative", top: -1 }} />
                    <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t4)" }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* the understanding mirror — WHAT I UNDERSTOOD (6-PR1) */}
      <UnderstandingCard
        simId={sim.id}
        hasProblem={Boolean(brief.problem.trim())}
        initialContract={initialContract}
        parsedDocNames={parsedDocs.map((d) => d.name)}
        onPhase={setUnderstanding}
      />

      {/* field notes — a standalone editor (the diligence card is gone:
          the brief's circles + hover-remove carry all file management) */}
      {notesOpen && (
        <div
          style={{
            marginTop: 16, borderLeft: "3px solid var(--acc)", borderTop: "1px solid var(--ln3)",
            borderRight: "1px solid var(--ln3)", borderBottom: "1px solid var(--ln3)",
            borderRadius: "4px 12px 12px 4px", background: "var(--sf2)", padding: "18px 20px",
            animation: "fadeUp .3s ease both",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)" }}>✎ FIELD NOTES</span>
            <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--t7)" }}>
              PARSED, CHUNKED & CITED LIKE ANY UPLOADED DOCUMENT
            </span>
          </div>
          <input
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            placeholder="WHAT THE BROKER TOLD US ON THE SITE WALK"
            maxLength={60}
            style={{
              ...mono, width: "100%", boxSizing: "border-box", marginTop: 12, fontSize: 11.5,
              letterSpacing: ".05em", background: "transparent", border: "none",
              borderBottom: "1px solid var(--ln4)", padding: "6px 0", color: "var(--t1)",
              outline: "none", caretColor: "var(--acc)", textTransform: "uppercase",
            }}
          />
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={"Everything you know that isn't in a document yet — seller motivation, verbal quotes, site-walk observations, neighborhood chatter, deal history.\n\nAgents will treat these notes as evidence and cite them by name."}
            rows={6}
            maxLength={20000}
            style={{
              width: "100%", boxSizing: "border-box", marginTop: 10, background: "transparent",
              border: "none", outline: "none", resize: "vertical", minHeight: 130,
              fontFamily: "var(--font-sans), sans-serif", fontSize: 13.5, lineHeight: 1.65,
              color: "var(--t2)", caretColor: "var(--acc)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
            <button
              onClick={saveNotes}
              disabled={!noteText.trim()}
              style={{
                background: noteText.trim() ? "var(--acc)" : "var(--sf)", color: noteText.trim() ? "var(--acc-c)" : "var(--t6)",
                fontWeight: 600, fontSize: 12.5, padding: "9px 20px", borderRadius: 100, border: "none",
                cursor: noteText.trim() ? "pointer" : "default", fontFamily: "var(--font-sans), sans-serif",
              }}
            >
              Save to corpus
            </button>
            <button
              onClick={() => setNotesOpen(false)}
              style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", background: "none", border: "none", color: "var(--t6)", cursor: "pointer" }}
            >
              CANCEL
            </button>
            <span style={{ ...mono, marginLeft: "auto", fontSize: 9, color: "var(--t7)" }}>
              {noteText.length.toLocaleString()} / 20,000
            </span>
          </div>
        </div>
      )}

      {/* PR-A — image lightbox for uploaded photos */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 96, background: "rgba(10,11,12,.82)", backdropFilter: "blur(6px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 32, cursor: "zoom-out" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "88vw", maxHeight: "80vh", borderRadius: 14, border: "1px solid var(--ln5)" }} />
          <span style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t3)" }}>{lightbox.name.toUpperCase()} · CLICK ANYWHERE TO CLOSE</span>
        </div>
      )}

      {/* the population — Casting Director. Understanding-first choreography:
          while the pass reads a FRESH brief (nothing cast yet), the stages
          below stay hidden — one loading story, then the reveal */}
      {!(understanding === "deriving" && populationCount === 0) && (
      <>
      <PopulationStage
        simId={sim.id}
        initialSeats={initialSeats}
        initialCrowd={initialCrowd}
        initialCasting={initialCasting}
        onCountChange={setPopulationCount}
        onCastingChange={setCastingBusy}
        onModeChange={setModeSel}
      />

      {/* stage 4 — run configuration (§4.1); LAUNCH activates with the engine */}
      {populationCount > 0 && !castingBusy && (() => {
        const residentSide = initialSeats.filter((x) => x.spec.kind === "consumer" || x.spec.kind === "resident").length;
        const expertSide = initialSeats.length - residentSide;
        const scale = initialCasting?.scale ?? { experts: expertSide, residents: residentSide };
        const crowd = Math.max(scale.experts - expertSide, 0) + Math.max(scale.residents - residentSide, 0);
        return (
          // the whole workspace is already dimmed while a run is live (the
          // wrapper above); the server-side 409 remains the hard gate
          <RunConfigStage
            key={`${modeSel ?? "none"}-${initialSeats.length}`}
            simId={sim.id}
            mode={modeSel}
            recommendedMode={initialCasting?.recommended_mode ?? (initialCasting?.user_set?.mode ? null : initialCasting?.mode ?? null)}
            leads={initialSeats.length}
            expertSide={expertSide}
            residentSide={residentSide}
            crowd={crowd}
            initialRun={initialRun}
            initialTools={initialTools}
          />
        );
      })()}
      </>
      )}
      </div>

      {/* the bottom action while live (field fix: the lone centered button
          read as an orphan) — a full-width live-run bar matching the top
          banner's grammar, same destination as the RUN breadcrumb */}
      {sim.status === "running" && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
            marginTop: 26, padding: "18px 24px", borderRadius: 14,
            border: "1px solid var(--warn)", background: "var(--warn-dim)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, flex: "none" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite" }} />
            <span style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--warn)" }}>RUN IN PROGRESS</span>
          </span>
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--t4)", flex: 1, minWidth: 220 }}>
            The workspace is locked while the panel deliberates — every post persists, and the report synthesizes from the run screen.
          </span>
          <button
            onClick={() => router.push(`/sim/${sim.id}/run`)}
            style={{ background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 14, padding: "12px 26px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif", flex: "none" }}
          >
            View live run →
          </button>
        </div>
      )}
    </div>
  );
}
