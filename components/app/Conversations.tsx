"use client";

/**
 * Conversations: persistent 1:1 and group chats with personas.
 * iMessage-style UX — conversation list left, thread right, @mentions to
 * direct questions, fresh threads any time, file attachments (image/PDF)
 * that the experts genuinely analyze, searchable participant picker.
 */

import { CSSProperties, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LibraryPersona, PersonaSpec } from "@/lib/personas";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, chatModel } from "@/lib/chat-models";
import PersonaProfile from "@/components/app/PersonaProfile";
import Markdown from "@/components/app/Markdown";
import Link from "next/link";

/** room cap — mirrored server-side in app/api/converse/route.ts */
const MAX_PARTICIPANTS = 20;
/** model chips shown inline before overflowing into the roster panel */
const MODEL_CHIP_LIMIT = 6;

/** "Rosa, Derek, Aliyah +5" — compact display for large rooms */
function firstNames(ps: { name: string }[], max = 3): string {
  const names = ps.map((p) => p.name.split(/\s+/)[0]);
  return names.length > max + 1 ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
}

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface ConversationRow {
  id: string;
  title: string;
  participant_keys: string[];
  updated_at: string;
  model_overrides?: Record<string, string>;
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
        border: "1.5px solid var(--acc)",
        // opaque: accent tint layered over a solid surface so bubble text never shows through
        background: "linear-gradient(0deg, var(--acc-dim), var(--acc-dim)), var(--sf)",
        color: "var(--acc)",
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
        // the +N counter sits ON TOP of the stack (avatar-stack pattern) so its
        // label is never clipped by the neighboring chip
        <span style={{ marginLeft: -9, position: "relative", zIndex: 5, display: "flex" }}>
          <ToggleChip label={`+${attachments.length - 2}`} title={`Show all ${attachments.length} files`} onClick={() => setExpanded(true)} />
        </span>
      )}
      {spread && <ToggleChip label="−" title="Collapse" onClick={() => setExpanded(false)} />}
    </div>
  );
}

/**
 * Per-participant model tier selector (CLAUDE.md §6.4). Every voice defaults
 * to the lightweight tier; the chip opens a menu to bump one persona to a
 * deeper model for this thread only.
 */
function ModelChip({
  persona, modelId, open, onToggle, onPick,
}: {
  persona: LibraryPersona; modelId: string; open: boolean;
  onToggle: () => void; onPick: (id: string) => void;
}) {
  const m = chatModel(modelId);
  return (
    <span style={{ position: "relative", flex: "none", display: "inline-flex" }}>
      <button
        onClick={onToggle}
        title={`${persona.name} answers on ${m.name} (${m.desc.toLowerCase()}) — click to change`}
        style={{
          ...mono, display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
          fontSize: 9.5, letterSpacing: ".05em", color: open ? "var(--acc)" : "var(--t5)",
          background: "var(--sf2)", border: `1px solid ${open ? "var(--acc)" : "var(--ln5)"}`,
          borderRadius: 100, padding: "5px 11px 5px 6px",
        }}
      >
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--sf)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, color: "var(--t3)", flex: "none" }}>
          {persona.initials}
        </span>
        {persona.name.split(" ")[0].toUpperCase()} · {m.short}
        <span style={{ fontSize: 8, color: "var(--t7)" }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, minWidth: 235, background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 14, padding: 6, boxShadow: "0 18px 44px rgba(0,0,0,.35)", animation: "fadeUp .15s ease both" }}>
          {CHAT_MODELS.map((opt) => {
            const on = opt.id === m.id;
            return (
              <button
                key={opt.id}
                onClick={() => onPick(opt.id)}
                style={{
                  display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 12,
                  textAlign: "left", cursor: "pointer", borderRadius: 9, padding: "9px 11px",
                  background: on ? "var(--acc-dim)" : "transparent", border: "none",
                }}
              >
                <span>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: on ? "var(--acc)" : "var(--t2)" }}>{opt.name}</span>
                  <span style={{ ...mono, display: "block", fontSize: 9, letterSpacing: ".05em", color: "var(--t6)", marginTop: 2, textTransform: "uppercase" }}>{opt.desc}</span>
                </span>
                {on && <span style={{ color: "var(--acc)", fontSize: 12 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

export default function Conversations({
  orgId,
  personas,
  initial,
  initialWith,
  initialOpen,
  initialDraft,
  libraryCount = 0,
}: {
  orgId: string;
  personas: LibraryPersona[];
  initial: ConversationRow[];
  initialWith?: string;
  initialOpen?: string;
  initialDraft?: string[];
  libraryCount?: number;
}) {
  const supabase = createClient();
  // library personas discovered via search are accumulated so picked chips
  // and thread headers keep resolving after the result list changes
  const [extras, setExtras] = useState<LibraryPersona[]>([]);
  const byKey = useMemo(() => {
    const m = new Map<string, LibraryPersona>();
    [...personas, ...extras].forEach((p) => m.set(p.key, p));
    return m;
  }, [personas, extras]);

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
  const [libResults, setLibResults] = useState<LibraryPersona[]>([]);
  const [searchingLib, setSearchingLib] = useState(false);
  const searchSeq = useRef(0);
  // per-participant model tier for the open thread ({} = everyone on default)
  const [models, setModels] = useState<Record<string, string>>({});
  const [modelMenu, setModelMenu] = useState<string | null>(null);
  // conversation-row ⋯ menu, inline rename, roster panel, profile card
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [roster, setRoster] = useState(false);
  const [profileOf, setProfileOf] = useState<LibraryPersona | null>(null);
  // @mention typeahead over the room's participants; picked keys ride along
  // with send() so two participants with the same display name stay distinct
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [mentionIx, setMentionIx] = useState(0);
  const pickedMentions = useRef<{ handle: string; key: string }[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // composer grows vertically as you type (capped), never scrolls sideways
  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  };
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

  // deep links: ?open=<id> from history · ?draft=<keys> from the browser page
  useEffect(() => {
    if (initialOpen && initial.some((c) => c.id === initialOpen)) openConversation(initialOpen);
    else if (initialDraft && initialDraft.length > 0) startDraft(initialDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setModels(convs.find((c) => c.id === id)?.model_overrides ?? {}); setModelMenu(null);
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
    setModels({}); setModelMenu(null);
  };

  const setModel = async (key: string, modelId: string) => {
    const next = { ...models, [key]: modelId };
    setModels(next); setModelMenu(null);
    if (active) {
      setConvs((cs) => cs.map((c) => (c.id === active ? { ...c, model_overrides: next } : c)));
      await supabase!.from("conversations").update({ model_overrides: next }).eq("id", active);
    }
  };

  const removeConversation = async (id: string) => {
    setConvs(convs.filter((c) => c.id !== id));
    if (active === id) { setActive(null); setMessages([]); }
    await supabase!.from("conversations").delete().eq("id", id);
  };

  const startRename = (c: ConversationRow) => {
    setRenaming(c.id); setTitleDraft(c.title); setRowMenu(null);
  };

  const saveRename = async () => {
    const id = renaming;
    const t = titleDraft.trim();
    setRenaming(null);
    if (!id || !t) return;
    setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, title: t } : c)));
    await supabase!.from("conversations").update({ title: t }).eq("id", id);
  };

  // ---- @mention typeahead ----
  const mentionMatches = mentionQ !== null
    ? participants.filter((p) =>
        p.name.toLowerCase().startsWith(mentionQ.toLowerCase()) ||
        p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(mentionQ.toLowerCase()))
      ).slice(0, 6)
    : [];

  const pickMention = (p: LibraryPersona) => {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? input.length;
    const before = input.slice(0, caret).replace(/@[\w]*$/, "");
    const first = p.name.split(/\s+/)[0];
    // if two participants share a first name, insert the full name so the
    // mention resolves unambiguously
    const dupFirst = participants.filter((x) => x.name.split(/\s+/)[0].toLowerCase() === first.toLowerCase()).length > 1;
    const handle = dupFirst ? p.name : first;
    pickedMentions.current.push({ handle, key: p.key });
    const next = `${before}@${handle} ${input.slice(caret)}`;
    setInput(next);
    setMentionQ(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = `${before}@${handle} `.length;
      el.setSelectionRange(pos, pos);
    });
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
    // resolved mention keys: only picks whose @handle survived editing
    const mentionKeys = [...new Set(
      pickedMentions.current.filter((m) => content.includes(`@${m.handle}`)).map((m) => m.key)
    )];
    pickedMentions.current = [];
    setInput(""); setErr(null); setPending([]); setMentionQ(null);
    requestAnimationFrame(autosize);
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
          modelOverrides: models,
          mentionKeys,
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
        const title = firstNames(participants);
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

  // picker search: local personas filter instantly; the global library runs
  // two-phase — instant plain FTS, then the smart pass replaces it
  useEffect(() => {
    if (!picker) return;
    const q = search.trim();
    if (q.length < 2) { setLibResults([]); setSearchingLib(false); return; }
    setSearchingLib(true);
    const seq = ++searchSeq.current;
    let smartDone = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const apply = (rows: LibraryPersona[]) => {
      setLibResults(rows);
      setExtras((prev) => {
        const m = new Map(prev.map((p) => [p.key, p] as const));
        rows.forEach((r) => { if (!m.has(r.key)) m.set(r.key, r); });
        return [...m.values()];
      });
    };
    const run = (smartPass: boolean, delay: number) => {
      timers.push(setTimeout(async () => {
        try {
          const res = await fetch("/api/personas/search", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q, limit: 40, smart: smartPass }),
          });
          const json = await res.json();
          if (seq !== searchSeq.current || !res.ok) return;
          const rows: LibraryPersona[] = (json.personas as { id: string; spec: PersonaSpec }[])
            .map((r) => ({ ...r.spec, key: r.id, id: r.id, source: "library" as const }));
          if (smartPass) { smartDone = true; apply(rows); setSearchingLib(false); }
          else if (!smartDone) { apply(rows); setSearchingLib(false); }
        } catch {
          if (seq === searchSeq.current && smartPass) setSearchingLib(false);
        }
      }, delay));
    };
    run(false, 120);
    run(true, 400);
    return () => timers.forEach(clearTimeout);
  }, [search, picker]);

  const q = search.trim().toLowerCase();
  const localMatches = q
    ? personas.filter((p) =>
        [p.name, p.role, p.tagline ?? "", p.backstory, p.discipline ?? ""].join(" ").toLowerCase().includes(q)
      )
    : personas;
  const filteredPersonas = q
    ? [...localMatches, ...libResults.filter((r) => !localMatches.some((l) => l.key === r.key))]
    : personas;

  const showThread = draft !== null || active !== null;

  // sidebar shows only as many rows as fit the height — no overscroll; the
  // rest live on /conversations/history (searchable)
  const listRef = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState(10);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ROW = 66; // row height + gap
    const measure = () => setFitCount(Math.max(3, Math.floor((el.clientHeight - (draft ? ROW : 0) - 44) / ROW)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft]);
  const visibleConvs = convs.slice(0, fitCount);
  const hiddenCount = convs.length - visibleConvs.length;

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
        <div ref={listRef} style={{ flex: 1, overflow: "hidden", padding: "0 10px 20px", display: "flex", flexDirection: "column", gap: 3 }}>
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
          {visibleConvs.map((c) => {
            const ps = c.participant_keys.map((k) => byKey.get(k)).filter((p): p is LibraryPersona => !!p);
            const isActive = c.id === active && !draft;
            return (
              <div
                key={c.id}
                className="convRow"
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
                    {renaming === c.id ? (
                      <input
                        value={titleDraft}
                        autoFocus
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        onBlur={saveRename}
                        style={{ width: "100%", boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--acc)", borderRadius: 7, padding: "3px 8px", fontSize: 13, color: "var(--t0)", outline: "none", fontFamily: "inherit" }}
                      />
                    ) : (
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: isActive ? "var(--t0)" : "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.title}
                      </span>
                    )}
                    <span style={{ ...mono, fontSize: 9, color: "var(--t7)", flex: "none" }}>{timeAgo(c.updated_at)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t6)", marginTop: 2 }}>
                    {ps.length} {ps.length === 1 ? "expert" : "experts"}
                  </div>
                </div>
                <span className="rowActions" style={{ position: "relative", flex: "none" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setRowMenu(rowMenu === c.id ? null : c.id); }}
                    aria-label="Conversation options"
                    style={{ ...mono, background: "none", border: "none", color: "var(--t6)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "3px 4px", letterSpacing: "1px" }}
                  >
                    ⋯
                  </button>
                  {rowMenu === c.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 45, minWidth: 132, background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 12, padding: 5, boxShadow: "0 14px 34px rgba(0,0,0,.35)", animation: "fadeUp .15s ease both" }}
                    >
                      <button className="menuItem" onClick={() => startRename(c)}>Rename</button>
                      <button className="menuItem" style={{ color: "var(--warn)" }} onClick={() => { setRowMenu(null); removeConversation(c.id); }}>Delete</button>
                    </div>
                  )}
                </span>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <Link
              href="/conversations/history"
              style={{ ...mono, marginTop: 6, display: "block", textAlign: "center", fontSize: 9.5, letterSpacing: ".08em", color: "var(--acc)", border: "1px dashed var(--ln5)", borderRadius: 10, padding: "10px 12px" }}
            >
              SEE ALL {convs.length} CONVERSATIONS →
            </Link>
          )}
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
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 22 }}>
              <button onClick={() => { setPicker(true); setPicked([]); setSearch(""); }} className="btnAcc" style={{ padding: "12px 26px", fontSize: 14 }}>
                Start a conversation
              </button>
              <Link href="/conversations/new" className="btnGhost" style={{ padding: "12px 24px", fontSize: 14, borderRadius: 100 }}>
                Browse all personas
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div style={{ flex: "none", padding: "16px 26px", borderBottom: "1px solid var(--ln2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <AvatarStack personas={participants} size={34} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {activeConv?.title ?? (participants.length > 3 ? firstNames(participants) : participants.map((p) => p.name).join(", "))}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {participants.length === 1 ? participants[0].role : `${participants.length} experts · tag with @name to direct`}
                  </div>
                </div>
              </div>
              {participants.length > 0 && (
                <button
                  onClick={() => setRoster(true)}
                  style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".06em", color: "var(--acc)", background: "transparent", border: "1px solid var(--acc)", borderRadius: 100, padding: "5px 12px", cursor: "pointer" }}
                >
                  {participants.length} IN THE ROOM →
                </button>
              )}
            </div>

            {/* per-participant model tier strip — overflows into the roster panel */}
            <div style={{ flex: "none", padding: "9px 26px", borderBottom: "1px solid var(--ln2)", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <span style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".12em", color: "var(--t7)" }}>MODELS</span>
              {participants.slice(0, MODEL_CHIP_LIMIT).map((p) => (
                <ModelChip
                  key={p.key}
                  persona={p}
                  modelId={models[p.key] ?? DEFAULT_CHAT_MODEL}
                  open={modelMenu === p.key}
                  onToggle={() => setModelMenu(modelMenu === p.key ? null : p.key)}
                  onPick={(id) => setModel(p.key, id)}
                />
              ))}
              {participants.length > MODEL_CHIP_LIMIT && (
                <button
                  onClick={() => setRoster(true)}
                  style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t5)", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "6px 12px", cursor: "pointer" }}
                >
                  +{participants.length - MODEL_CHIP_LIMIT} MORE →
                </button>
              )}
            </div>
            {modelMenu && !roster && <div onClick={() => setModelMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />}

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
                        <div style={{ fontSize: 14, lineHeight: 1.62, color: "var(--t2)" }}>
                          <Markdown text={m.content} mentions={participants.flatMap((x) => [x.name, x.name.split(/\s+/)[0]])} />
                        </div>
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
                <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                  {/* @mention typeahead — participants matching the @prefix */}
                  {mentionQ !== null && mentionMatches.length > 0 && (
                    <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 45, minWidth: 250, maxWidth: 360, background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 14, padding: 5, boxShadow: "0 14px 34px rgba(0,0,0,.35)", animation: "fadeUp .12s ease both" }}>
                      {mentionMatches.map((p, i) => (
                        <button
                          key={p.key}
                          onMouseDown={(e) => { e.preventDefault(); pickMention(p); }}
                          onMouseEnter={() => setMentionIx(i)}
                          style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", background: i === mentionIx ? "var(--acc-dim)" : "transparent", border: "none", borderRadius: 9, padding: "7px 9px", cursor: "pointer" }}
                        >
                          <span style={{ ...mono, width: 24, height: 24, borderRadius: "50%", flex: "none", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, color: i === mentionIx ? "var(--acc)" : "var(--t3)" }}>
                            {p.initials}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                            <span style={{ display: "block", fontSize: 10, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.role}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={inputRef}
                    value={input}
                    rows={1}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInput(v);
                      autosize();
                      const caret = e.target.selectionStart ?? v.length;
                      const m = v.slice(0, caret).match(/@([\w]*)$/);
                      if (m) { setMentionQ(m[1]); setMentionIx(0); } else setMentionQ(null);
                    }}
                    onKeyDown={(e) => {
                      if (mentionQ !== null && mentionMatches.length > 0) {
                        if (e.key === "ArrowDown") { e.preventDefault(); setMentionIx((i) => (i + 1) % mentionMatches.length); return; }
                        if (e.key === "ArrowUp") { e.preventDefault(); setMentionIx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
                        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionMatches[mentionIx]); return; }
                        if (e.key === "Escape") { setMentionQ(null); return; }
                      }
                      // Enter sends · Shift+Enter adds a line
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); requestAnimationFrame(autosize); }
                    }}
                    placeholder={participants.length > 1 ? "Message the group — @name to direct" : `Message ${participants[0]?.name.split(" ")[0] ?? ""}…`}
                    style={{ width: "100%", boxSizing: "border-box", display: "block", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: "13px 16px", fontSize: 14, lineHeight: 1.5, color: "var(--t1)", outline: "none", resize: "none", overflowY: "auto", maxHeight: 150, fontFamily: "inherit" }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--ln5)"; setTimeout(() => setMentionQ(null), 150); }}
                  />
                </div>
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
              placeholder={libraryCount ? `Search ${libraryCount.toLocaleString()} personas — a problem, a role, a person…` : "Search by name, role, or background…"}
              autoFocus
              style={{ flex: "none", marginTop: 16, boxSizing: "border-box", width: "100%", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: "11px 16px", fontSize: 13.5, color: "var(--t1)", outline: "none" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
            />
            <div style={{ ...mono, flex: "none", marginTop: 10, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t7)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                {q
                  ? searchingLib
                    ? `SEARCHING ${libraryCount ? libraryCount.toLocaleString() : "THE"} PERSONA LIBRARY…`
                    : `${filteredPersonas.length} MATCH${filteredPersonas.length === 1 ? "" : "ES"}`
                  : `${personas.length} RECENT & CUSTOM · TYPE TO SEARCH ${libraryCount ? libraryCount.toLocaleString() : "ALL"} PERSONAS`}
                {picked.length ? ` · ${picked.length}/${MAX_PARTICIPANTS} SELECTED` : ""}
              </span>
              <span style={{ flex: 1 }} />
              <Link href="/conversations/new" style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)" }}>
                BROWSE ALL WITH FILTERS →
              </Link>
            </div>
            {/* gridAutoRows max-content: overflow-hidden grid items have a zero
                auto-min-size, so without it the grid crushes rows instead of
                scrolling */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoRows: "max-content", gap: 8, alignContent: "start" }}>
              {filteredPersonas.map((p) => {
                const on = picked.includes(p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => setPicked((prev) => prev.includes(p.key) ? prev.filter((k) => k !== p.key) : prev.length >= MAX_PARTICIPANTS ? prev : [...prev, p.key])}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                      minWidth: 0, width: "100%", boxSizing: "border-box", overflow: "hidden",
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
                  {searchingLib
                    ? "Searching the library…"
                    : <>No personas match &quot;{search}&quot; — try a problem (&quot;build a data center&quot;) or a person (&quot;under 40 homeowner&quot;).</>}
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

      {/* conversation-row menu backdrop */}
      {rowMenu && <div onClick={() => setRowMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />}

      {/* roster panel — everyone in the room, scrollable, with quick model cycling */}
      {roster && (
        <>
          <div onClick={() => setRoster(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(10,11,12,.45)", backdropFilter: "blur(3px)" }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 340, maxWidth: "88vw", zIndex: 61, background: "var(--sf)", borderLeft: "1px solid var(--ln4)", display: "flex", flexDirection: "column", animation: "fadeUp .22s ease both" }}>
            <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "18px 20px", borderBottom: "1px solid var(--ln2)" }}>
              <span style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)" }}>IN THE ROOM · {participants.length}</span>
              <button onClick={() => setRoster(false)} aria-label="Close" style={{ border: "1px solid var(--ln6)", background: "transparent", color: "var(--t4)", width: 28, height: 28, borderRadius: "50%", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
              {participants.map((p) => {
                const mid = models[p.key] ?? DEFAULT_CHAT_MODEL;
                const m = chatModel(mid);
                return (
                  <div
                    key={p.key}
                    onClick={() => setProfileOf(p)}
                    style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 10px", borderRadius: 12, cursor: "pointer" }}
                    className="rosterRow"
                  >
                    <span style={{ ...mono, width: 34, height: 34, borderRadius: "50%", flex: "none", background: p.kind === "adversarial" ? "var(--warn-dim)" : "var(--sf2)", border: `1px solid ${p.kind === "adversarial" ? "var(--warn)" : "var(--ln5)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: p.kind === "adversarial" ? "var(--warn)" : "var(--t3)" }}>
                      {p.initials}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.role}</span>
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const order = CHAT_MODELS.map((x) => x.id as string);
                        setModel(p.key, order[(order.indexOf(mid) + 1) % order.length]);
                      }}
                      title={`${m.name} — ${m.desc.toLowerCase()} · click to switch tier`}
                      style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", color: "var(--t5)", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "5px 10px", cursor: "pointer" }}
                    >
                      {m.short}
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ ...mono, flex: "none", padding: "12px 20px", borderTop: "1px solid var(--ln2)", fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)" }}>
              CLICK A PERSON FOR THEIR FULL PROFILE · CLICK A TIER TO SWITCH MODEL
            </div>
          </div>
        </>
      )}

      {/* persona profile card (from roster) */}
      {profileOf && (
        <PersonaProfile
          kind={profileOf.kind}
          spec={profileOf}
          chatKey={profileOf.key}
          source={profileOf.source}
          onClose={() => setProfileOf(null)}
          showChatCta={false}
        />
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
