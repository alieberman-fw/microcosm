import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { compilePersonaPrompt, LIBRARY_PERSONAS, PersonaSpec } from "@/lib/personas";
import { CHAT_MODEL_IDS, DEFAULT_CHAT_MODEL } from "@/lib/chat-models";

/**
 * Conversations: persistent 1:1 and group chats with personas (CLAUDE.md §3.4).
 * - Replies come from @mentioned participants; with no mention, a cheap router
 *   model picks the most relevant participant(s).
 * - Image/PDF attachments on the latest message are passed to the model as
 *   content blocks, so experts genuinely analyze them.
 * - Every model call is logged to agent_interactions (monitoring surface).
 */
const ROUTER_MODEL = process.env.ROUTER_MODEL ?? "claude-haiku-4-5";
/** replies default to the lightweight tier; per-participant overrides win */
const DEFAULT_REPLY_MODEL = process.env.CONSULT_MODEL ?? DEFAULT_CHAT_MODEL;

const MAX_CONTENT = 6000;
const MAX_RESPONDERS = 3;
const MAX_PARTICIPANTS = 20; // mirrored client-side in components/app/Conversations.tsx
const HISTORY_LIMIT = 60;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** combined cap keeps the base64-inflated request under Claude's 32MB API limit */
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

type Participant = PersonaSpec & { key: string };
export interface Attachment { path: string; name: string; mime: string; size: number }

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMentions(content: string, participants: Participant[]): Participant[] {
  const hits: Participant[] = [];
  for (const p of participants) {
    const first = p.name.split(/\s+/)[0];
    const re = new RegExp(`@(?:"${esc(p.name)}"|${esc(p.name)}|${esc(first)})(?=\\b|[^\\w])`, "i");
    if (re.test(content)) hits.push(p);
  }
  return hits;
}

function renderTranscript(
  msgs: { role: string; agent_name: string | null; content: string; attachments?: Attachment[] }[],
): string {
  return msgs
    .map((m) => {
      const att = m.attachments?.length ? ` [attached: ${m.attachments.map((a) => a.name).join(", ")}]` : "";
      return `${m.role === "user" ? "USER" : (m.agent_name ?? "AGENT").toUpperCase()}: ${m.content}${att}`;
    })
    .join("\n\n");
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: {
    conversationId?: string;
    personaKeys?: string[];
    content?: string;
    attachments?: Attachment[];
    modelOverrides?: Record<string, string>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const content = (body.content ?? "").trim();
  if (!content || content.length > MAX_CONTENT) {
    return NextResponse.json({ error: "Message must be 1–6000 characters" }, { status: 400 });
  }
  let attachTotal = 0;
  const attachments = (body.attachments ?? []).slice(0, MAX_ATTACHMENTS)
    .filter((a) => a?.path && a?.mime && (a.mime.startsWith("image/") || a.mime === "application/pdf") && a.size <= MAX_ATTACHMENT_BYTES)
    .filter((a) => { attachTotal += a.size; return attachTotal <= MAX_TOTAL_ATTACHMENT_BYTES; });

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  // per-participant model tier: stored overrides merged with this request's
  // picks; unknown model ids are dropped
  const requestOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.modelOverrides ?? {})) {
    if (typeof v === "string" && CHAT_MODEL_IDS.includes(v)) requestOverrides[k] = v;
  }

  // load or create the conversation
  let convId = body.conversationId ?? null;
  let participantKeys: string[];
  let storedOverrides: Record<string, string> = {};
  if (convId) {
    const { data: conv } = await supabase
      .from("conversations").select("id, participant_keys, model_overrides").eq("id", convId).single();
    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    participantKeys = conv.participant_keys as string[];
    storedOverrides = (conv.model_overrides ?? {}) as Record<string, string>;
  } else {
    participantKeys = (body.personaKeys ?? []).slice(0, MAX_PARTICIPANTS);
    if (participantKeys.length === 0) {
      return NextResponse.json({ error: "Pick at least one participant" }, { status: 400 });
    }
  }

  // resolve participants: library keys or custom persona UUIDs
  const libByKey = new Map(LIBRARY_PERSONAS.map((p) => [p.key, p]));
  const customIds = participantKeys.filter((k) => !libByKey.has(k));
  const customById = new Map<string, PersonaSpec>();
  if (customIds.length) {
    const { data: rows } = await supabase.from("personas").select("id, spec").in("id", customIds);
    (rows ?? []).forEach((r) => customById.set(r.id as string, r.spec as PersonaSpec));
  }
  const participants: Participant[] = participantKeys
    .map((k) => {
      const spec = libByKey.get(k) ?? customById.get(k);
      return spec ? { ...spec, key: k } : null;
    })
    .filter((p): p is Participant => p !== null);
  if (participants.length === 0) {
    return NextResponse.json({ error: "No valid participants" }, { status: 400 });
  }

  const modelByKey = { ...storedOverrides, ...requestOverrides };

  if (!convId) {
    const names = participants.map((p) => p.name.split(/\s+/)[0]);
    const title = names.length > 4 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ org_id: orgId, created_by: user.id, title, participant_keys: participantKeys, model_overrides: modelByKey })
      .select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    convId = created.id as string;
  }

  const { data: history } = await supabase
    .from("conversation_messages")
    .select("role, agent_name, content, attachments")
    .eq("conversation_id", convId)
    .order("id", { ascending: true })
    .limit(HISTORY_LIMIT);
  const { error: umErr } = await supabase.from("conversation_messages").insert({
    conversation_id: convId, role: "user", content, attachments,
  });
  if (umErr) return NextResponse.json({ error: umErr.message }, { status: 500 });

  // download attachments once; reuse blocks for every responder this round
  const attachmentBlocks: Anthropic.ContentBlockParam[] = [];
  for (const a of attachments) {
    const { data: blob, error } = await supabase.storage.from("documents").download(a.path);
    if (error || !blob) continue;
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    if (a.mime.startsWith("image/")) {
      attachmentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: a.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: b64 },
      });
    } else {
      attachmentBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: b64 },
      });
    }
  }

  const anthropic = new Anthropic();
  const transcriptBase = [
    ...(history ?? []) as { role: string; agent_name: string | null; content: string; attachments?: Attachment[] }[],
    { role: "user", agent_name: null, content, attachments },
  ];

  const logInteraction = async (row: {
    surface: string; agent_key?: string | null; agent_name?: string | null; model: string;
    input_tokens?: number | null; output_tokens?: number | null; latency_ms: number;
    status?: string; error?: string | null;
  }) => {
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, conversation_id: convId,
      surface: row.surface, agent_key: row.agent_key ?? null, agent_name: row.agent_name ?? null,
      model: row.model, input_tokens: row.input_tokens ?? null, output_tokens: row.output_tokens ?? null,
      latency_ms: row.latency_ms, status: row.status ?? "ok", error: row.error ?? null,
    });
  };

  // choose responders: mentions win; otherwise route (or the sole participant)
  let responders = parseMentions(content, participants).slice(0, MAX_RESPONDERS);
  if (responders.length === 0) {
    if (participants.length === 1) {
      responders = [participants[0]];
    } else {
      const t0 = Date.now();
      try {
        const routing = await anthropic.messages.create({
          model: ROUTER_MODEL,
          max_tokens: 60,
          system:
            "You route messages in a group chat to the right expert(s). Reply with ONLY the comma-separated keys of 1-2 participants best suited to answer, nothing else.",
          messages: [{
            role: "user",
            content: `Participants:\n${participants.map((p) => `${p.key}: ${p.name} — ${p.role}`).join("\n")}\n\nConversation tail:\n${renderTranscript(transcriptBase.slice(-6))}\n\nWhich participant key(s) should answer the last user message?`,
          }],
        });
        const text = routing.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
        const keys = text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        responders = participants.filter((p) => keys.includes(p.key)).slice(0, 2);
        await logInteraction({ surface: "conversation.router", model: ROUTER_MODEL, input_tokens: routing.usage.input_tokens, output_tokens: routing.usage.output_tokens, latency_ms: Date.now() - t0 });
      } catch (e) {
        await logInteraction({ surface: "conversation.router", model: ROUTER_MODEL, latency_ms: Date.now() - t0, status: "error", error: e instanceof Error ? e.message : "router failed" });
      }
      if (responders.length === 0) responders = [participants[0]];
    }
  }

  // generate replies sequentially so later responders see earlier ones
  const replies: { agentKey: string; name: string; initials: string; content: string }[] = [];
  const rolling = [...transcriptBase];
  for (const p of responders) {
    const others = participants.filter((x) => x.key !== p.key).map((x) => x.name);
    const groupNote = participants.length > 1
      ? `\n\nYou are in a group conversation with the user${others.length ? ` and ${others.join(", ")}` : ""}. Reply only as yourself; react to others' points when relevant; never speak for them.`
      : "";
    const attNote = attachmentBlocks.length
      ? `\n\nThe user attached ${attachments.length} file(s) to their latest message — they are provided to you directly; analyze them concretely.`
      : "";
    const t0 = Date.now();
    // per-participant tier (§6.4): thread-level override wins, else the
    // lightweight default — the UI toggle is the only way to spend more
    const model = modelByKey[p.key] ?? DEFAULT_REPLY_MODEL;
    try {
      const resp = await anthropic.messages.create({
        model,
        max_tokens: 900,
        system: compilePersonaPrompt(p) + groupNote + attNote,
        messages: [{
          role: "user",
          content: [
            ...attachmentBlocks,
            { type: "text" as const, text: `Conversation transcript:\n\n${renderTranscript(rolling)}\n\n---\nReply now as ${p.name}. Do not prefix your reply with your name.` },
          ],
        }],
      });
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      replies.push({ agentKey: p.key, name: p.name, initials: p.initials, content: text });
      rolling.push({ role: "agent", agent_name: p.name, content: text });
      await supabase.from("conversation_messages").insert({
        conversation_id: convId, role: "agent", agent_key: p.key, agent_name: p.name, content: text,
      });
      await logInteraction({ surface: "conversation.reply", agent_key: p.key, agent_name: p.name, model, input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, latency_ms: Date.now() - t0 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Model call failed";
      await logInteraction({ surface: "conversation.reply", agent_key: p.key, agent_name: p.name, model, latency_ms: Date.now() - t0, status: "error", error: msg });
      return NextResponse.json({ error: msg, conversationId: convId, replies }, { status: 502 });
    }
  }

  await supabase.from("conversations").update({ updated_at: new Date().toISOString(), model_overrides: modelByKey }).eq("id", convId);

  return NextResponse.json({ conversationId: convId, replies });
}
