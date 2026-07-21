import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { compilePersonaPrompt, LIBRARY_PERSONAS, PersonaSpec } from "@/lib/personas";

/**
 * Conversations: persistent 1:1 and group chats with personas (CLAUDE.md §3.4).
 * - Replies come from @mentioned participants; with no mention, a cheap router
 *   model picks the most relevant participant(s).
 * - History lives in conversation_messages; each reply sees the full transcript.
 * Models per §6.4: experts on Sonnet, routing on Haiku. Config, not code.
 */
const EXPERT_MODEL = process.env.CONSULT_MODEL ?? "claude-sonnet-5";
const ROUTER_MODEL = process.env.ROUTER_MODEL ?? "claude-haiku-4-5";

const MAX_CONTENT = 6000;
const MAX_RESPONDERS = 3;
const HISTORY_LIMIT = 60;

type Participant = PersonaSpec & { key: string };

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
  msgs: { role: string; agent_name: string | null; content: string }[],
): string {
  return msgs
    .map((m) => `${m.role === "user" ? "USER" : (m.agent_name ?? "AGENT").toUpperCase()}: ${m.content}`)
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

  let body: { conversationId?: string; personaKeys?: string[]; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const content = (body.content ?? "").trim();
  if (!content || content.length > MAX_CONTENT) {
    return NextResponse.json({ error: "Message must be 1–6000 characters" }, { status: 400 });
  }

  // org for inserts
  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  // load or create the conversation
  let convId = body.conversationId ?? null;
  let participantKeys: string[];
  if (convId) {
    const { data: conv } = await supabase
      .from("conversations").select("id, participant_keys").eq("id", convId).single();
    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    participantKeys = conv.participant_keys as string[];
  } else {
    participantKeys = (body.personaKeys ?? []).slice(0, 8);
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

  // create conversation lazily on first message
  if (!convId) {
    const title = participants.map((p) => p.name.split(/\s+/)[0]).join(", ");
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ org_id: orgId, created_by: user.id, title, participant_keys: participantKeys })
      .select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    convId = created.id as string;
  }

  // history + persist the user message
  const { data: history } = await supabase
    .from("conversation_messages")
    .select("role, agent_name, content")
    .eq("conversation_id", convId)
    .order("id", { ascending: true })
    .limit(HISTORY_LIMIT);
  const { error: umErr } = await supabase.from("conversation_messages").insert({
    conversation_id: convId, role: "user", content,
  });
  if (umErr) return NextResponse.json({ error: umErr.message }, { status: 500 });

  const anthropic = new Anthropic();
  const transcriptBase = [...(history ?? []), { role: "user", agent_name: null, content }];

  // choose responders: mentions win; otherwise route (or the sole participant)
  let responders = parseMentions(content, participants).slice(0, MAX_RESPONDERS);
  if (responders.length === 0) {
    if (participants.length === 1) {
      responders = [participants[0]];
    } else {
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
      } catch { /* fall through */ }
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
    try {
      const resp = await anthropic.messages.create({
        model: EXPERT_MODEL,
        max_tokens: 700,
        system: compilePersonaPrompt(p) + groupNote,
        messages: [{
          role: "user",
          content: `Conversation transcript:\n\n${renderTranscript(rolling)}\n\n---\nReply now as ${p.name}. Do not prefix your reply with your name.`,
        }],
      });
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      replies.push({ agentKey: p.key, name: p.name, initials: p.initials, content: text });
      rolling.push({ role: "agent", agent_name: p.name, content: text });
      await supabase.from("conversation_messages").insert({
        conversation_id: convId, role: "agent", agent_key: p.key, agent_name: p.name, content: text,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Model call failed";
      return NextResponse.json({ error: msg, conversationId: convId, replies }, { status: 502 });
    }
  }

  await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

  return NextResponse.json({ conversationId: convId, replies });
}
