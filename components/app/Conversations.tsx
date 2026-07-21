"use client";

/**
 * Conversations: persistent 1:1 and group chats with personas.
 * iMessage-style UX — conversation list left, thread right, @mentions to
 * direct questions, fresh threads any time, file attachments (image/PDF)
 * that the experts genuinely analyze, searchable participant picker.
 */

import { CSSProperties, Fragment, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LibraryPersona } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface ConversationRow {
  id: string;
  title: string;
  participant_keys: string[];
  updated_at: string;
}

export interface Attachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}

interface Msg {
  id?: number;
  role: "user" | "agent";
  agent_key?: string | null;
  agent_name?: string | null;
  content: string;
  attachments?: Attachment[];
}

type Pending = Attachment & { preview?: string };
type Draft = { participantKeys: string[] };

const MAX_ATTACH = 8;
const MAX_BYTES = 5 * 1024 * 1024;
/** combined cap keeps the base64-inflated request under Claude's 32MB API limit */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function AvatarStack({ personas, size = 30 }: { personas: LibraryPersona[]; size?: number }) {
  const shown = personas.slice(0, 3);
  return (
    <div style={{ display: "flex", flex: "none" }}>
      {shown.map((p, i) => (
        <span
          key={p.key}
          style={{
            ...mono, width: size, height: size, borderRadius: "50%",
            background: p.source === "custom" ? "var(--acc-dim)" : "var(--sf2)",
            border: `1px solid ${p.source === "custom" ? "var(--acc)" : "var(--ln5)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: size * 0.32, color: p.source === "custom" ? "var(--acc)" : "var(--t3)",
            marginLeft: i > 0 ? -size * 0.3 : 0, position: "relative", zIndex: shown.length - i,
          }}
        >
          {p.initials}
        </span>
      ))}
      {personas.length > 3 && (
        <span style={{ ...mono, fontSize: 10, color: "var(--t6)", alignSelf: "center", marginLeft: 5 }}>
          +{personas.length - 3}
        </span>
      )}
    </div>
  );
}

/** highlight @mentions of participants in message text */
function Highlighted({ text, participants }: { text: string; participants: LibraryPersona[] }) {
  const names = participants.flatMap((p) => [p.name, p.name.split(/\s+/)[0]]);
  if (names.length === 0) return <>{text}</>;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <span key={i} style={{ color: "var(--acc)", fontWeight: 600 }}>{part}</span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

/**
 * Attachment chips pinned to a message bubble.
 * ≤3 files: overlapping circles. >3 files: two chips + a "+N" expander;
 * expanded, all chips spread across the message top with a "−" to collapse.
 */
function Chip({
  a, urls, onOpen, overlap, z,
}: {
  a: Attachment; urls: Record<string, string>; onOpen: (a: Attachment) => void; overlap: boolean; z: number;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(a); }}
      title={a.name}
      style={{
        width: 27, height: 27, borderRadius: "50%", padding: 0, cursor: "pointer",
        border: "1.5px solid var(--acc)", background: "var(--sf2)", overflow: "hidden",
        marginLeft: overlap ? -9 : 0, position: "relative", zIndex: z, flex: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {a.mime.startsWith("image/") && urls[a.path] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urls[a.path]} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ ...mono, fontSize: 6.5, letterSpacing: ".03em", color: "var(--acc)" }}>
          {a.mime === "application/pdf" ? "PDF" : "FILE"}
        </span>
      )}
    </button>
  );
}

function ToggleChip({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        ...mono, width: 27, height: 27, borderRadius: "50%", padding: 0, cursor: "pointer",
        border: "1.5px solid var(--acc)", background: "var(--acc-dim)", color: "var(--acc)",
        fontSize: label.length > 2 ? 8 : 11, fontWeight: 700, flex: "none",
        display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 0,
      }}
    >
      {label}
    </button>
  );
}

function AttachmentChips({
  attachments, urls, onOpen,
}: {
  attachments: Attachment[];
  urls: Record<string, string>;
  onOpen: (a: Attachment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const many = attachments.length > 3;
  const shown = many && !expanded ? attachments.slice(0, 2) : attachments;
  const spread = many && expanded;
  return (
    <div style={{ position: "absolute", top: -13, right: 10, display: "flex", zIndex: 3, gap: spread ? 4 : 0, maxWidth: "calc(100% + 60px)" }}>
      {shown.map((a, i) => (
        <Chip key={a.path} a={a} urls={urls} onOpen={onOpen} overlap={!spread && i > 0} z={shown.length - i} />
      ))}
      {many && !expanded && (
        <span style={{ marginLeft: -9, position: "relative", zIndex: 0, display: "flex" }}>
          <ToggleChip label={`+${attachments.length - 2}`} title={`Show all ${attachments.length} files`} onClick={() => setExpanded(true)} />
        </span>
      )}
      {spread && <ToggleChip label="−" title="Collapse" onClick={() => setExpanded(false)} />}
    </div>
  );
}

export default function Conversations({
  orgId,
  personas,
  initial,
  initialWith,
}: {
  orgId: string;
  personas: LibraryPersona[];
  initial: ConversationRow[];
  initialWith?: string;
}) {
  const supabase = createClient();
  const byKey = new Map(personas.map((p) => [p.key, p]));

  const [convs, setConvs] = useState<ConversationRow[]>(initial);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(initialWith ? { participantKeys: [initialWith] } : null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ url: string; name: string; mime: string } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeConv = convs.find((c) => c.id === active) ?? null;
  const participantKeys = draft ? draft.participantKeys : activeConv?.participant_keys ?? [];
  const participants = participantKeys.map((k) => byKey.get(k)).filter((p): p is LibraryPersona => !!p);

  useEffect(() => {
    const f = feedRef.current;
    if (f) f.scrollTop = f.scrollHeight;
  }, [messages.length, busy]);

  const signAll = async (atts: Attachment[]) => {
    const missing = atts.filter((a) => !urls[a.path]);
    if (missing.length === 0) return;
    const entries = await Promise.all(
      missing.map(async (a) => {
        const { data } = await supabase!.storage.from("documents").createSignedUrl(a.path, 3600);
        return [a.path, data?.signedUrl ?? ""] as const;
      })
    );
    setUrls((u) => ({ ...u, ...Object.fromEntries(entries.filter(([, v]) => v)) }));
  };

  const openConversation = async (id: string) => {
    setActive(id); setDraft(null); setErr(null); setMessages([]); setPending([]);
    const { data } = await supabase!
      .from("conversation_messages")
      .select("id, role, agent_key, agent_name, content, attachments")
      .eq("conversation_id", id)
      .order("id", { ascending: true });
    const msgs = (data ?? []) as Msg[];
    setMessages(msgs);
    signAll(msgs.flatMap((m) => m.attachments ?? []));
  };

  const startDraft = (keys: string[]) => {
    setDraft({ participantKeys: keys });
    setActive(null); setMessages([]); setErr(null); setPicker(false); setPicked([]); setSearch(""); setPending([]);
  };

  const removeConversation = async (id: string) => {
    setConvs(convs.filter((c) => c.id !== id));
    if (active === id) { setActive(null); setMessages([]); }
    await supabase!.from("conversations").delete().eq("id", id);
  };

  const attachFiles = async (files: FileList | null) => {
    if (!files) return;
    setErr(null);
    const room = MAX_ATTACH - pending.length;
    const list = [...files].slice(0, room);
    let total = pending.reduce((a, p) => a + p.size, 0);
    for (const f of list) {
      const ok = f.type.startsWith("image/") || f.type === "application/pdf";
      if (!ok) { setErr(`${f.name}: images and PDFs only`); continue; }
      if (f.size > MAX_BYTES) { setErr(`${f.name}: 5MB limit per file`); continue; }
      if (total + f.size > MAX_TOTAL_BYTES) { setErr(`${f.name}: 20MB combined limit per message`); continue; }
      total += f.size;
      setUploading(true);
      const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${orgId}/chat/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase!.storage.from("documents").upload(path, f, { contentType: f.type });
      if (error) { setErr(error.message); setUploading(false); continue; }
      const att: Pending = { path, name: f.name, mime: f.type, size: f.size };
      if (f.type.startsWith("image/")) att.preview = URL.createObjectURL(f);
      setPending((p) => [...p, att]);
      setUrls((u) => (att.preview ? { ...u, [path]: att.preview! } : u));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const openAttachment = async (a: Attachment) => {
    let url = urls[a.path];
    if (!url) {
      const { data } = await supabase!.storage.from("documents").createSignedUrl(a.path, 3600);
      url = data?.signedUrl ?? "";
      if (url) setUrls((u) => ({ ...u, [a.path]: url }));
    }
    if (!url) return;
    if (a.mime === "application/pdf") {
      window.open(url, "_blank", "noopener");
    } else {
      setLightbox({ url, name: a.name, mime: a.mime });
    }
  };

  const send = async () => {
    const content = input.trim();
    if (!content || busy || participants.length === 0) return;
    const atts: Attachment[] = pending.map(({ path, name, mime, size }) => ({ path, name, mime, size }));
    setInput(""); setErr(null); setPending([]);
    setMessages((m) => [...m, { role: "user", content, attachments: atts }]);
    setBusy(true);
    try {
      const res = await fetch("/api/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: active ?? undefined,
          personaKeys: draft?.participantKeys,
          content,
          attachments: atts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setMessages((m) => [
        ...m,
        ...data.replies.map((r: { agentKey: string; name: string; content: string }) => ({
          role: "agent" as const, agent_key: r.agentKey, agent_name: r.name, content: r.content,
        })),
      ]);
      if (draft) {
        const title = participants.map((p) => p.name.split(/\s+/)[0]).join(", ");
        const row: ConversationRow = {
          id: data.conversationId, title,
          participant_keys: draft.participantKeys,
          updated_at: new Date().toISOString(),
        };
        setConvs([row, ...convs]);
        setActive(data.conversationId);
        setDraft(null);
      } else if (active) {
        setConvs((cs) => {
          const row = cs.find((c) => c.id === active);
          if (!row) return cs;
          return [{ ...row, updated_at: new Date().toISOString() }, ...cs.filter((c) => c.id !== active)];
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setInput(content);
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filteredPersonas = q
    ? personas.filter((p) =>
        [p.name, p.role, p.tagline ?? "", p.backstory, p.discipline ?? ""].join(" ").toLowerCase().includes(q)
      )
    : personas;

  const showThread = draft !== null || active !== null;

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* conversation list */}
      <div style={{ width: 300, flex: "none", borderRight: "1px solid var(--ln2)", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
        <div style={{ padding: "24px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="kicker">Conversations</div>
          <button onClick={() => { setPicker(true); setPicked([]); setSearch(""); }} className="btnAcc" style={{ padding: "8px 16px", fontSize: 12.5, borderRadius: 100 }}>
            + New
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 10px 20px", display: "flex", flexDirection: "column", gap: 3 }}>
          {convs.length === 0 && !draft && (
            <div style={{ padding: "28px 14px", textAlign: "center" }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".07em", color: "var(--t7)" }}>NO CONVERSATIONS YET</div>
              <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t6)" }}>
                Start one with a single expert or invite several — same experts, fresh thread, any time.
              </p>
            </div>
          )}
          {draft && (
            <div style={{ borderRadius: 12, padding: "12px 12px", background: "var(--acc-dim)", border: "1px solid var(--acc)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <AvatarStack personas={participants} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t0)" }}>New conversation</div>
                  <div style={{ fontSize: 11, color: "var(--t5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {participants.map((p) => p.name.split(" ")[0]).join(", ")}
                  </div>
                </div>
              </div>
            </div>
          )}
          {convs.map((c) => {
            const ps = c.participant_keys.map((k) => byKey.get(k)).filter((p): p is LibraryPersona => !!p);
            const isActive = c.id === active && !draft;
            return (
              <div
                key={c.id}
                onClick={() => openConversation(c.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, borderRadius: 12, padding: "11px 12px",
                  cursor: "pointer", background: isActive ? "var(--acc-dim)" : "transparent",
                  border: `1px solid ${isActive ? "var(--acc)" : "transparent"}`,
                }}
              >
                <AvatarStack personas={ps} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: isActive ? "var(--t0)" : "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.title}
                    </span>
                    <span style={{ ...mono, fontSize: 9, color: "var(--t7)", flex: "none" }}>{timeAgo(c.updated_at)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t6)", marginTop: 2 }}>
                    {ps.length} {ps.length === 1 ? "expert" : "experts"}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeConversation(c.id); }}
                  aria-label="Delete conversation"
                  style={{ ...mono, background: "none", border: "none", color: "var(--t7)", cursor: "pointer", fontSize: 12, padding: 4 }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* thread */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {!showThread ? (
          <div style={{ margin: "auto", textAlign: "center", maxWidth: 440, padding: 24 }}>
            <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)" }}>DIRECT LINE TO THE PANEL</div>
            <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
              Pick a conversation, or start a new one — a single expert, or a group you can steer with @mentions. Every conversation keeps its own history; starting fresh with the same experts is always one click.
            </p>
            <button onClick={() => { setPicker(true); setPicked([]); setSearch(""); }} className="btnAcc" style={{ marginTop: 22, padding: "12px 26px", fontSize: 14 }}>
              Start a conversation
            </button>
          </div>
        ) : (
          <>
            <div style={{ flex: "none", padding: "16px 26px", borderBottom: "1px solid var(--ln2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <AvatarStack personas={participants} size={34} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {participants.map((p) => p.name).join(", ")}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {participants.length === 1 ? participants[0].role : `${participants.length} experts · tag with @name to direct`}
                  </div>
                </div>
              </div>
              {participants.length > 1 && (
                <span style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".06em", color: "var(--acc)", border: "1px solid var(--acc)", borderRadius: 100, padding: "4px 10px" }}>
                  GROUP
                </span>
              )}
            </div>

            <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "24px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
              {messages.length === 0 && !busy && (
                <div style={{ margin: "auto", textAlign: "center", maxWidth: 440 }}>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "var(--t5)" }}>
                    {participants.length === 1
                      ? `Ask ${participants[0].name.split(" ")[0]} anything in their lane — attach a plan, a photo, or a PDF for analysis.`
                      : `Ask the group — or tag ${participants.map((p) => "@" + p.name.split(" ")[0]).slice(0, 3).join(", ")} to direct your question.`}
                  </p>
                </div>
              )}
              {messages.map((m, i) => {
                const p = m.agent_key ? byKey.get(m.agent_key) : null;
                return m.role === "user" ? (
                  <div key={m.id ?? `u${i}`} style={{ display: "flex", justifyContent: "flex-end", animation: "fadeUp .25s ease both" }}>
                    <div style={{ position: "relative", maxWidth: "72%", borderRadius: "16px 16px 4px 16px", padding: "11px 15px", background: "var(--acc-dim)", border: "1px solid var(--acc)", marginTop: m.attachments?.length ? 10 : 0 }}>
                      {(m.attachments?.length ?? 0) > 0 && (
                        <AttachmentChips attachments={m.attachments!} urls={urls} onOpen={openAttachment} />
                      )}
                      <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--t1)", whiteSpace: "pre-wrap" }}>
                        <Highlighted text={m.content} participants={participants} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={m.id ?? `a${i}`} style={{ display: "flex", gap: 10, animation: "fadeUp .25s ease both" }}>
                    <span style={{ ...mono, width: 30, height: 30, borderRadius: "50%", flex: "none", background: p?.source === "custom" ? "var(--acc-dim)" : "var(--sf2)", border: `1px solid ${p?.source === "custom" ? "var(--acc)" : "var(--ln5)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: p?.source === "custom" ? "var(--acc)" : "var(--t3)", marginTop: 2 }}>
                      {p?.initials ?? m.agent_name?.slice(0, 2) ?? "A"}
                    </span>
                    <div style={{ maxWidth: "72%" }}>
                      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", marginBottom: 4 }}>
                        {(m.agent_name ?? "AGENT").toUpperCase()}
                      </div>
                      <div style={{ borderRadius: "4px 16px 16px 16px", padding: "11px 15px", background: "var(--sf)", border: "1px solid var(--ln4)" }}>
                        <div style={{ fontSize: 14, lineHeight: 1.62, color: "var(--t2)", whiteSpace: "pre-wrap" }}>{m.content}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {busy && (
                <div style={{ ...mono, fontSize: 11, color: "var(--t7)" }}>
                  {participants.length === 1
                    ? `${participants[0].name} is typing`
                    : "Routing to the right expert"}
                  <span style={{ animation: "blink 1s step-end infinite" }}>…</span>
                </div>
              )}
              {err && (
                <div className="mono" style={{ fontSize: 11, borderRadius: 10, padding: "10px 14px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)" }}>
                  {err}
                </div>
              )}
            </div>

            <div style={{ flex: "none", padding: "14px 26px 20px", borderTop: "1px solid var(--ln2)" }}>
              {pending.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  {pending.map((a) => (
                    <span key={a.path} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--acc)", background: "var(--acc-dim)", borderRadius: 100, padding: "5px 6px 5px 5px" }}>
                      <span style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", background: "var(--sf2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                        {a.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <span style={{ ...mono, fontSize: 6, color: "var(--acc)" }}>PDF</span>
                        )}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--t2)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      <button onClick={() => setPending(pending.filter((x) => x.path !== a.path))} style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 12, padding: "0 4px" }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" multiple hidden onChange={(e) => attachFiles(e.target.files)} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || pending.length >= MAX_ATTACH}
                  aria-label="Attach files"
                  title="Attach images or PDFs"
                  className="btnGhost"
                  style={{ flex: "none", width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, opacity: uploading || pending.length >= MAX_ATTACH ? 0.5 : 1 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={participants.length > 1 ? "Message the group — @name to direct" : `Message ${participants[0]?.name.split(" ")[0] ?? ""}…`}
                  style={{ flex: 1, boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: "13px 16px", fontSize: 14, color: "var(--t1)", outline: "none" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
                />
                <button onClick={send} disabled={busy || uploading || !input.trim()} className="btnAcc" style={{ padding: "13px 24px", fontSize: 14, borderRadius: 12, opacity: busy || uploading || !input.trim() ? 0.55 : 1 }}>
                  {uploading ? "Uploading…" : "Send"}
                </button>
              </div>
              <div style={{ ...mono, marginTop: 9, fontSize: 9, letterSpacing: ".06em", color: "var(--t7)" }}>
                SYNTHETIC EXPERTS · HISTORY SAVED TO YOUR WORKSPACE · ATTACH IMAGES OR PDFS FOR IN-THREAD ANALYSIS
              </div>
            </div>
          </>
        )}
      </div>

      {/* participant picker */}
      {picker && (
        <div
          onClick={() => setPicker(false)}
          style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(10,11,12,.66)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true"
            style={{ background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, maxWidth: 620, width: "100%", maxHeight: "84vh", display: "flex", flexDirection: "column", padding: "28px 30px", animation: "fadeUp .25s ease both", boxSizing: "border-box" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flex: "none" }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>Who&apos;s in the room?</h3>
              <button onClick={() => setPicker(false)} aria-label="Close" style={{ border: "1px solid var(--ln6)", background: "transparent", color: "var(--t4)", width: 30, height: 30, borderRadius: "50%", cursor: "pointer" }}>×</button>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role, or background…"
              autoFocus
              style={{ flex: "none", marginTop: 16, boxSizing: "border-box", width: "100%", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: "11px 16px", fontSize: 13.5, color: "var(--t1)", outline: "none" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
            />
            <div style={{ ...mono, flex: "none", marginTop: 10, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t7)" }}>
              {filteredPersonas.length} OF {personas.length} PERSONAS{picked.length ? ` · ${picked.length} SELECTED` : ""}
            </div>
            <div style={{ flex: 1, overflowY: "auto", marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, alignContent: "start" }}>
              {filteredPersonas.map((p) => {
                const on = picked.includes(p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => setPicked((prev) => prev.includes(p.key) ? prev.filter((k) => k !== p.key) : [...prev, p.key])}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                      border: `1px solid ${on ? "var(--acc)" : "var(--ln4)"}`,
                      background: on ? "var(--acc-dim)" : "transparent",
                      borderRadius: 12, padding: "10px 12px", cursor: "pointer",
                    }}
                  >
                    <span style={{ ...mono, width: 30, height: 30, borderRadius: "50%", flex: "none", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: on ? "var(--acc)" : "var(--t3)" }}>
                      {p.initials}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: on ? "var(--t0)" : "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                      <span style={{ display: "block", fontSize: 10.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.role}</span>
                    </span>
                  </button>
                );
              })}
              {filteredPersonas.length === 0 && (
                <div style={{ gridColumn: "1 / -1", padding: "26px 0", textAlign: "center", color: "var(--t6)", fontSize: 13 }}>
                  No personas match &quot;{search}&quot; — try a role, like &quot;water&quot; or &quot;zoning&quot;.
                </div>
              )}
            </div>
            <button
              onClick={() => startDraft(picked)}
              disabled={picked.length === 0}
              className="btnAcc"
              style={{ flex: "none", marginTop: 16, width: "100%", padding: "13px 24px", fontSize: 14.5, opacity: picked.length === 0 ? 0.5 : 1 }}
            >
              {picked.length <= 1 ? "Start conversation" : `Start group with ${picked.length} experts`}
            </button>
          </div>
        </div>
      )}

      {/* attachment lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(10,11,12,.85)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, cursor: "zoom-out" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "86vw", maxHeight: "80vh", borderRadius: 14, border: "1px solid var(--ln6)", animation: "fadeUp .2s ease both" }} />
          <div style={{ ...mono, marginTop: 14, fontSize: 10.5, letterSpacing: ".06em", color: "var(--t4)" }}>{lightbox.name} · CLICK ANYWHERE TO CLOSE</div>
        </div>
      )}
    </div>
  );
}
