"use client";

/**
 * The report AI analyst (pre-5a feature batch) — the ✻ dock on the report.
 * Closed: a floating accent circle, bottom-right. Open: the screen splits —
 * the report keeps scrolling on the left, the analyst chat on the right,
 * with a draggable divider. One thread surface, two voices: no mention →
 * THE ANALYST (neutral, full-substrate, cites [seq] chips that jump the
 * report's transcript); @mentions → leads or crowd members in character.
 * Threads persist per sim: NEW CONVERSATION starts fresh context, the
 * history menu reopens any prior thread with its memory. Never rendered on
 * shared (magic-link) views.
 */

import { CSSProperties, Fragment, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "@/components/app/Markdown";
import Orb from "@/components/app/Orb";
import { CHAT_MODELS } from "@/lib/chat-models";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

interface CastEntry { key: string; name: string; role: string; tier: "lead" | "crowd" }
interface ThreadMeta { id: string; title: string; updated_at: string }
interface ArtifactMeta { id: string; name: string; created_at?: string; updated_at?: string }
interface ArtifactRef { id: string; name: string; action: "created" | "updated" | "deleted" }
interface Msg { role: "user" | "agent"; key?: string; name?: string; agentRole?: string; content: string; artifacts?: ArtifactRef[] }

const MIN_W = 340;
const DEFAULT_W = 460;

/** [seq] citations render as INLINE chips via the cite-aware Markdown —
 *  splitting the text around chips at the block level broke paragraphs
 *  (orphaned commas, chips on their own lines — field report) */
/** field report: artifact documents render [N] cite pills that did nothing —
 *  the viewer iframe is script-dead by design. This injects ONE bridge script
 *  (the sandbox stays same-origin-less, so it can only postMessage) that makes
 *  .cite pills clickable and reports the seq to the parent, which drives the
 *  same transcript jump the chat's chips use. */
function injectCiteBridge(html: string): string {
  const bridge = `<style>.cite{cursor:pointer}</style><script>document.addEventListener("click",function(e){var el=e.target&&e.target.closest?e.target.closest(".cite"):null;if(!el)return;var n=parseInt((el.textContent||"").replace(/[^0-9]/g,""),10);if(n>0)parent.postMessage({__mc_cite:n},"*");});</scr` + `ipt>`;
  return html.includes("</body>") ? html.replace("</body>", `${bridge}</body>`) : html + bridge;
}

function CitedText({ content, onCite }: { content: string; onCite: (seq: number) => void }) {
  return <Markdown text={content} onCite={onCite} />;
}

export default function AnalystDock({ simId, onWidthChange, onCite }: {
  simId: string;
  /** the report pads right by this much while the panel is open */
  onWidthChange: (w: number) => void;
  onCite: (seq: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_W);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [cast, setCast] = useState<CastEntry[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("claude-sonnet-5");
  const [modelOpen, setModelOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  // artifacts — the analyst's generated documents (report-only section)
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [viewing, setViewing] = useState<ArtifactMeta | null>(null);
  const [viewDoc, setViewDoc] = useState<string | null>(null);
  // artifact cite pills bridge here (see injectCiteBridge)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const seq = (e.data as { __mc_cite?: unknown } | null)?.__mc_cite;
      if (typeof seq === "number" && seq > 0) onCite(seq);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onCite]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const pendingRefs = useRef<ArtifactRef[]>([]);
  // @mention typeahead
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const mentionKeys = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragging = useRef(false);

  // bootstrap: threads + cast, once per open
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch(`/api/simulations/${simId}/analyst`);
        const data = await res.json();
        if (res.ok) { setThreads(data.threads); setCast(data.cast); setArtifacts(data.artifacts ?? []); }
      } catch { /* the panel still works — threads just start empty */ }
    })();
  }, [open, simId]);

  useEffect(() => { onWidthChange(open ? width : 0); }, [open, width, onWidthChange]);
  useEffect(() => () => onWidthChange(0), [onWidthChange]);

  // divider drag
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const w = Math.min(Math.max(window.innerWidth - e.clientX, MIN_W), Math.floor(window.innerWidth * 0.72));
      setWidth(w);
    };
    const up = () => { dragging.current = false; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, typing]);

  const openThread = useCallback(async (id: string) => {
    setThreadId(id);
    setHistoryOpen(false);
    setMsgs([]);
    try {
      const res = await fetch(`/api/analyst/${id}`);
      const data = await res.json();
      if (res.ok) {
        setMsgs((data.messages as { role: string; agent_key?: string; agent_name?: string; content: string; attachments?: (ArtifactRef & { kind?: string })[] }[]).map((m) => ({
          role: m.role === "user" ? "user" : "agent",
          key: m.agent_key ?? undefined,
          name: m.agent_name ?? "Analyst",
          content: m.content,
          artifacts: (m.attachments ?? []).filter((a) => a.kind === "artifact"),
        })));
      }
    } catch { setError("Could not load the thread"); }
  }, []);

  // ---- artifact actions (the documents section) ----
  // documents render through our own /html route (Storage serves text/html
  // as text/plain by design) — fetched here, then srcdoc'd into a fully
  // sandboxed iframe: script-dead, and a deleted document gets a clean
  // error instead of raw JSON in the frame
  const openArtifact = useCallback(async (a: { id: string; name: string }) => {
    setDocsOpen(true);
    setViewing({ id: a.id, name: a.name });
    setViewDoc(null);
    try {
      const res = await fetch(`/api/artifacts/${a.id}/html`);
      if (!res.ok) {
        setViewing(null);
        setArtifacts((prev) => prev.filter((x) => x.id !== a.id));
        setError(res.status === 404 ? "That document was deleted" : "Could not open the document");
        return;
      }
      setViewDoc(injectCiteBridge(await res.text()));
    } catch {
      setViewing(null);
      setError("Could not open the document");
    }
  }, []);

  const openArtifactTab = useCallback((a: { id: string }) => {
    window.open(`/api/artifacts/${a.id}/html`, "_blank", "noopener");
  }, []);

  const renameArtifact = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    setRenamingId(null);
    if (!trimmed) return;
    setArtifacts((prev) => prev.map((x) => (x.id === id ? { ...x, name: trimmed } : x)));
    setViewing((v) => (v && v.id === id ? { ...v, name: trimmed } : v));
    await fetch(`/api/artifacts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }),
    });
  }, []);

  const deleteArtifact = useCallback(async (id: string) => {
    setConfirmDel(null);
    setArtifacts((prev) => prev.filter((x) => x.id !== id));
    setViewing((v) => (v && v.id === id ? null : v));
    await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
  }, []);

  const freshThread = () => { setThreadId(null); setMsgs([]); setError(null); mentionKeys.current.clear(); };

  const send = async () => {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setMsgs((prev) => [...prev, { role: "user", content }]);
    // only keys whose names still appear in the message count as mentions
    const mk = [...mentionKeys.current].filter((k) => {
      const c = cast.find((x) => x.key === k);
      return c && content.toLowerCase().includes(`@${c.name.toLowerCase()}`);
    });
    mentionKeys.current.clear();
    try {
      const res = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simId, conversationId: threadId, content, mentionKeys: mk, model, webSearch }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "The analyst is unavailable");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type?: string; id?: string; key?: string; name?: string; role?: string; content?: string; error?: string; action?: string; artifact?: ArtifactMeta } = {};
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === "thread" && evt.id) {
            setThreadId(evt.id);
            setThreads((prev) => (prev.some((t) => t.id === evt.id) ? prev : [{ id: evt.id!, title: content.slice(0, 64), updated_at: new Date().toISOString() }, ...prev]));
          }
          if (evt.type === "typing") setTyping(evt.name ?? "Analyst");
          if (evt.type === "artifact" && evt.artifact) {
            const a = evt.artifact;
            const action = (evt.action ?? "created") as ArtifactRef["action"];
            pendingRefs.current.push({ id: a.id, name: a.name, action });
            setArtifacts((prev) => {
              if (action === "deleted") return prev.filter((x) => x.id !== a.id);
              if (action === "created") return [a, ...prev.filter((x) => x.id !== a.id)];
              return prev.map((x) => (x.id === a.id ? { ...x, ...a } : x));
            });
          }
          if (evt.type === "message") {
            setTyping(null);
            const refs = pendingRefs.current.splice(0);
            setMsgs((prev) => [...prev, { role: "agent", key: evt.key, name: evt.name ?? "Analyst", agentRole: evt.role, content: evt.content ?? "", artifacts: refs }]);
          }
          if (evt.type === "error") { setTyping(null); setError(evt.error ?? "Reply failed"); }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analyst is unavailable");
    } finally {
      setTyping(null);
      setBusy(false);
    }
  };

  // @ typeahead over the cast (leads first — the bootstrap pre-sorts)
  const onInput = (v: string) => {
    setInput(v);
    const m = v.slice(0, inputRef.current?.selectionStart ?? v.length).match(/@([\w .'-]{0,24})$/);
    setMentionQ(m ? m[1].toLowerCase() : null);
  };
  const mentionHits = mentionQ === null ? [] : cast
    .filter((c) => `${c.name} ${c.role}`.toLowerCase().includes(mentionQ))
    .slice(0, 7);
  const pickMention = (c: CastEntry) => {
    mentionKeys.current.add(c.key);
    setInput((v) => {
      const pos = inputRef.current?.selectionStart ?? v.length;
      const before = v.slice(0, pos).replace(/@([\w .'-]{0,24})$/, `@${c.name} `);
      return before + v.slice(pos);
    });
    setMentionQ(null);
    inputRef.current?.focus();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open the report analyst"
        title="Ask the analyst — or any panel member — about this report"
        style={{
          position: "fixed", right: 26, bottom: 26, zIndex: 70,
          width: 52, height: 52, borderRadius: "50%", border: "1px solid var(--acc)",
          background: "var(--acc)", color: "var(--acc-c)", cursor: "pointer",
          fontSize: 21, fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,.35)",
          animation: "fadeUp .3s ease both",
        }}
      >
        ✻
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width, zIndex: 65,
        display: "flex", flexDirection: "column",
        background: "var(--sf)", borderLeft: "1px solid var(--ln4)",
        boxShadow: "-18px 0 44px rgba(0,0,0,.25)", animation: "fadeUp .2s ease both",
      }}
    >
      {/* drag handle */}
      <div
        onPointerDown={() => { dragging.current = true; document.body.style.userSelect = "none"; }}
        title="Drag to resize"
        style={{ position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize" }}
      />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--ln3)", flex: "none" }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--acc)", color: "var(--acc-c)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none" }}>✻</span>
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--t3)", flex: "none" }}>ANALYST</span>

        <span style={{ position: "relative", minWidth: 0, flex: 1, display: "inline-flex", gap: 6 }}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            title="Conversations on this report"
            style={{ ...mono, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9, letterSpacing: ".05em", padding: "5px 12px", borderRadius: 100, border: "1px solid var(--ln5)", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
          >
            {threadId ? (threads.find((t) => t.id === threadId)?.title ?? "THREAD") : "NEW CONVERSATION"} ▾
          </button>
          <button
            onClick={freshThread}
            title="Start a fresh conversation (clean context)"
            style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".05em", padding: "5px 11px", borderRadius: 100, border: "1px solid var(--acc)", background: "var(--acc-dim)", color: "var(--acc)", cursor: "pointer" }}
          >
            + NEW
          </button>
          {historyOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 80, width: 300, maxHeight: 280, overflowY: "auto", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 6, boxShadow: "0 12px 32px rgba(0,0,0,.35)" }}>
              {threads.length === 0 && <div style={{ ...mono, fontSize: 9, color: "var(--t6)", padding: "10px 10px" }}>NO CONVERSATIONS YET</div>}
              {threads.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => void openThread(t.id)}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: t.id === threadId ? "var(--acc)" : "var(--t2)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-sans), sans-serif" }}
                  >
                    {t.title}
                  </button>
                  <button
                    onClick={() => { void fetch(`/api/analyst/${t.id}`, { method: "DELETE" }); setThreads((prev) => prev.filter((x) => x.id !== t.id)); if (t.id === threadId) freshThread(); }}
                    aria-label={`Delete thread ${t.title}`}
                    style={{ flex: "none", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 12, padding: "0 6px" }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </span>

        {/* tier + web search + close */}
        <span style={{ position: "relative", flex: "none" }}>
          <button
            onClick={() => setModelOpen((v) => !v)}
            title="The analyst's model tier"
            style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", padding: "5px 10px", borderRadius: 100, border: "1px solid var(--ln5)", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
          >
            {CHAT_MODELS.find((m) => m.id === model)?.short ?? model} ▾
          </button>
          {modelOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 80, width: 200, background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 6, boxShadow: "0 12px 32px rgba(0,0,0,.35)" }}>
              {CHAT_MODELS.map((m) => (
                <button key={m.id} onClick={() => { setModel(m.id); setModelOpen(false); }}
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: m.id === model ? "var(--acc)" : "var(--t2)", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif" }}>
                  {m.name} <span style={{ color: "var(--t6)", fontSize: 11 }}>— {m.desc}</span>
                </button>
              ))}
            </div>
          )}
        </span>
        <button
          onClick={() => setWebSearch((v) => !v)}
          title={webSearch ? "Web search ON — the analyst may search for current facts" : "Web search OFF — answers come from the run and documents only"}
          style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", padding: "5px 10px", borderRadius: 100, border: `1px solid ${webSearch ? "var(--acc)" : "var(--ln5)"}`, background: webSearch ? "var(--acc-dim)" : "transparent", color: webSearch ? "var(--acc)" : "var(--t6)", cursor: "pointer" }}
        >
          ⚒ WEB {webSearch ? "ON" : "OFF"}
        </button>
        <button
          onClick={() => { setDocsOpen((v) => !v); setViewing(null); setViewDoc(null); }}
          title={docsOpen ? "Back to the chat" : "Documents the analyst has generated for this report"}
          style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", padding: "5px 10px", borderRadius: 100, border: `1px solid ${docsOpen ? "var(--acc)" : "var(--ln5)"}`, background: docsOpen ? "var(--acc)" : "transparent", color: docsOpen ? "var(--acc-c)" : artifacts.length ? "var(--acc)" : "var(--t6)", cursor: "pointer" }}
        >
          ⧉ {artifacts.length || "DOCS"}
        </button>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close the analyst"
          style={{ flex: "none", width: 26, height: 26, borderRadius: 8, background: "none", border: "none", color: "var(--t5)", cursor: "pointer", fontSize: 15 }}
        >
          ×
        </button>
      </div>

      {/* documents section — list + inline viewer (replaces the chat while open) */}
      {docsOpen && viewing && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: "1px solid var(--ln2)", flex: "none" }}>
            <button
              onClick={() => { setViewing(null); setViewDoc(null); }}
              style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", padding: "5px 10px", borderRadius: 100, border: "1px solid var(--ln5)", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
            >
              ‹ ALL DOCS
            </button>
            {renamingId === viewing.id ? (
              <input
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void renameArtifact(viewing.id, renameVal); if (e.key === "Escape") setRenamingId(null); }}
                onBlur={() => void renameArtifact(viewing.id, renameVal)}
                style={{ flex: 1, minWidth: 0, background: "var(--sf2)", border: "1px solid var(--acc)", borderRadius: 8, padding: "4px 9px", fontSize: 12.5, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
              />
            ) : (
              <button
                onClick={() => { setRenamingId(viewing.id); setRenameVal(viewing.name); }}
                title="Rename this document"
                style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 600, color: "var(--t1)", cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-sans), sans-serif" }}
              >
                {viewing.name}
              </button>
            )}
            <button
              onClick={() => void openArtifactTab(viewing)}
              title="Open in a new tab"
              style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", padding: "5px 10px", borderRadius: 100, border: "1px solid var(--ln5)", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
            >
              ⤓ TAB
            </button>
            <button
              onClick={() => (confirmDel === viewing.id ? void deleteArtifact(viewing.id) : setConfirmDel(viewing.id))}
              onBlur={() => setConfirmDel(null)}
              title="Delete this document"
              style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", padding: "5px 10px", borderRadius: 100, border: `1px solid ${confirmDel === viewing.id ? "var(--warn)" : "var(--ln5)"}`, background: confirmDel === viewing.id ? "var(--warn-dim)" : "transparent", color: confirmDel === viewing.id ? "var(--warn)" : "var(--t6)", cursor: "pointer" }}
            >
              {confirmDel === viewing.id ? "SURE?" : "×"}
            </button>
          </div>
          {viewDoc ? (
            <iframe title={viewing.name} srcDoc={viewDoc} sandbox="allow-scripts" style={{ flex: 1, width: "100%", border: "none", background: "var(--bg)" }} />
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Orb state="working" size={20} tone="quiet" aria-label="Opening the document" />
              <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>OPENING…</span>
            </div>
          )}
        </div>
      )}
      {docsOpen && !viewing && (
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 16px" }}>
          <div style={{ ...mono, fontSize: 9, letterSpacing: ".1em", color: "var(--acc)", margin: "4px 2px 12px" }}>
            ⧉ GENERATED DOCUMENTS · {artifacts.length}
          </div>
          {error && <div style={{ ...mono, fontSize: 9.5, color: "var(--warn)", margin: "0 2px 12px" }}>{error.toUpperCase().slice(0, 140)}</div>}
          {artifacts.length === 0 && (
            <div style={{ padding: "10px 4px", fontSize: 13, lineHeight: 1.7, color: "var(--t5)" }}>
              Nothing here yet. Ask the analyst for a document and it lands in this section —
              <span style={{ color: "var(--t3)" }}> &ldquo;write a one-page memo on the water risk&rdquo;</span>,
              <span style={{ color: "var(--t3)" }}> &ldquo;re-cut the report for my investment committee&rdquo;</span>.
              Documents are styled like the report and open right here.
            </div>
          )}
          {artifacts.map((a) => (
            <div
              key={a.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", marginBottom: 8, borderRadius: 12, border: "1px solid var(--ln3)", background: "var(--sf2)" }}
            >
              <span style={{ flex: "none", width: 30, height: 30, borderRadius: 9, background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⧉</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {renamingId === a.id ? (
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void renameArtifact(a.id, renameVal); if (e.key === "Escape") setRenamingId(null); }}
                    onBlur={() => void renameArtifact(a.id, renameVal)}
                    style={{ width: "100%", boxSizing: "border-box", background: "var(--sf)", border: "1px solid var(--acc)", borderRadius: 8, padding: "3px 8px", fontSize: 12.5, color: "var(--t1)", outline: "none", fontFamily: "var(--font-sans), sans-serif" }}
                  />
                ) : (
                  <button
                    onClick={() => void openArtifact(a)}
                    title="Open this document"
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600, color: "var(--t1)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-sans), sans-serif" }}
                  >
                    {a.name}
                  </button>
                )}
                <div style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t6)", marginTop: 3 }}>
                  {String(a.updated_at ?? a.created_at ?? "").slice(0, 10)}
                </div>
              </div>
              <button
                onClick={() => { setRenamingId(a.id); setRenameVal(a.name); }}
                title="Rename"
                aria-label={`Rename ${a.name}`}
                style={{ flex: "none", background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}
              >
                ✎
              </button>
              <button
                onClick={() => (confirmDel === a.id ? void deleteArtifact(a.id) : setConfirmDel(a.id))}
                onBlur={() => setConfirmDel(null)}
                title="Delete"
                aria-label={`Delete ${a.name}`}
                style={{ ...mono, flex: "none", background: confirmDel === a.id ? "var(--warn-dim)" : "none", border: confirmDel === a.id ? "1px solid var(--warn)" : "none", borderRadius: 100, color: confirmDel === a.id ? "var(--warn)" : "var(--t6)", cursor: "pointer", fontSize: confirmDel === a.id ? 8 : 13, padding: confirmDel === a.id ? "4px 8px" : "2px 4px", letterSpacing: ".05em" }}
              >
                {confirmDel === a.id ? "SURE?" : "×"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: docsOpen ? "none" : undefined }}>
        {msgs.length === 0 && (
          <div style={{ padding: "18px 6px", fontSize: 13, lineHeight: 1.7, color: "var(--t5)" }}>
            <div style={{ ...mono, fontSize: 9, letterSpacing: ".1em", color: "var(--acc)", marginBottom: 10 }}>✻ THE ANALYST KNOWS THIS RUN COLD</div>
            Ask anything — summarize a section simply, compare crowd polls across rounds, trace who flipped and why, or push past the report.
            <span style={{ color: "var(--t3)" }}> @mention any panel or crowd member</span> to hear from them directly, in character.
            This chat never enters the run record.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ margin: "0 0 14px", display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            {m.role === "agent" && (
              <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: m.key === "analyst" ? "var(--acc)" : "var(--t5)", marginBottom: 4 }}>
                {m.key === "analyst" ? "✻ ANALYST" : `${(m.name ?? "").toUpperCase()}${m.agentRole ? ` · ${m.agentRole.toUpperCase().slice(0, 34)}` : ""}`}
              </div>
            )}
            {m.content && (
              <div style={{
                maxWidth: "92%", padding: "10px 14px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.6,
                background: m.role === "user" ? "var(--acc-dim)" : "var(--sf2)",
                border: `1px solid ${m.role === "user" ? "var(--acc)" : "var(--ln3)"}`,
                color: "var(--t2)", overflowWrap: "anywhere",
              }}>
                {m.role === "user" ? m.content : <CitedText content={m.content} onCite={onCite} />}
              </div>
            )}
            {/* document cards — one per artifact this reply touched */}
            {(m.artifacts ?? []).map((a, ai) => (
              <button
                key={ai}
                onClick={() => a.action !== "deleted" && void openArtifact(a)}
                disabled={a.action === "deleted"}
                title={a.action === "deleted" ? "This document was deleted" : "Open this document"}
                style={{
                  display: "flex", alignItems: "center", gap: 10, maxWidth: "92%", marginTop: 8,
                  padding: "10px 13px", borderRadius: 12, textAlign: "left",
                  border: `1px solid ${a.action === "deleted" ? "var(--ln3)" : "var(--acc)"}`,
                  background: a.action === "deleted" ? "var(--sf2)" : "var(--acc-dim)",
                  cursor: a.action === "deleted" ? "default" : "pointer",
                  opacity: a.action === "deleted" ? 0.65 : 1, fontFamily: "var(--font-sans), sans-serif",
                }}
              >
                <span style={{ flex: "none", width: 28, height: 28, borderRadius: 8, background: a.action === "deleted" ? "transparent" : "var(--acc)", border: `1px solid ${a.action === "deleted" ? "var(--ln4)" : "var(--acc)"}`, color: a.action === "deleted" ? "var(--t6)" : "var(--acc-c)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>⧉</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: a.action === "deleted" ? "line-through" : "none" }}>{a.name}</span>
                  <span style={{ ...mono, display: "block", fontSize: 7.5, letterSpacing: ".08em", color: a.action === "deleted" ? "var(--t6)" : "var(--acc)", marginTop: 2 }}>
                    {a.action.toUpperCase()}{a.action !== "deleted" ? " · OPEN →" : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
        {typing && (
          <div style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--t6)", display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px" }}>
            {/* the orb says WHAT kind of thinking: reasoning vs web search */}
            <Orb state={typing === "Analyst" && webSearch ? "searching" : "solving"} size={20} aria-label="Thinking" />
            {typing.toUpperCase()} IS {typing === "Analyst" && webSearch ? "SEARCHING" : "THINKING"}…
          </div>
        )}
        {error && <div style={{ ...mono, fontSize: 9.5, color: "var(--warn)", margin: "4px 0 12px" }}>{error.toUpperCase().slice(0, 140)}</div>}
      </div>

      {/* composer */}
      <div style={{ flex: "none", padding: "10px 14px 14px", borderTop: "1px solid var(--ln3)", position: "relative", display: docsOpen ? "none" : undefined }}>
        {mentionHits.length > 0 && (
          <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 14, right: 14, zIndex: 80, background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 6, boxShadow: "0 12px 32px rgba(0,0,0,.35)", maxHeight: 220, overflowY: "auto" }}>
            {mentionHits.map((c) => (
              <button key={c.key} onClick={() => pickMention(c)}
                style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "baseline", gap: 8, background: "none", border: "none", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif" }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t1)" }}>{c.name}</span>
                <span style={{ ...mono, fontSize: 8, letterSpacing: ".05em", color: c.tier === "lead" ? "var(--acc)" : "var(--t6)" }}>
                  {c.tier.toUpperCase()} · {c.role.toUpperCase().slice(0, 32)}
                </span>
              </button>
            ))}
          </div>
        )}
        {/* the composer (field fix): one input window with the send plane
            INSIDE it — no detached Ask button */}
        <div style={{ position: "relative" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && mentionHits.length === 0) { e.preventDefault(); void send(); }
              if (e.key === "Enter" && mentionHits.length > 0) { e.preventDefault(); pickMention(mentionHits[0]); }
              if (e.key === "Escape") setMentionQ(null);
            }}
            rows={2}
            placeholder="Ask the analyst — @mention a panel or crowd member to hear from them"
            style={{
              width: "100%", resize: "none", boxSizing: "border-box",
              background: "var(--sf2)", border: "1px solid var(--ln4)", borderRadius: 14,
              padding: "10px 52px 10px 13px", fontSize: 13, lineHeight: 1.5, color: "var(--t1)", outline: "none",
              fontFamily: "var(--font-sans), sans-serif",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln4)")}
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            aria-label="Send"
            title="Send (Enter)"
            style={{
              position: "absolute", right: 9, bottom: 12, width: 32, height: 32, borderRadius: "50%",
              border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: busy || !input.trim() ? "var(--ln3)" : "var(--acc)",
              color: busy || !input.trim() ? "var(--t6)" : "var(--acc-c)",
              cursor: busy || !input.trim() ? "default" : "pointer", transition: "background .15s",
            }}
          >
            {busy ? (
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", animation: "pulseDot 1s ease infinite" }} />
            ) : (
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
