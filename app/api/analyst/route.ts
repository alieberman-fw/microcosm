import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { ANALYST_KEY, agentReplySystem, analystSystem, buildAnalystContext, threadTitleFrom } from "@/lib/analyst";
import { CHAT_MODEL_IDS } from "@/lib/chat-models";
import { toolBlocksFor } from "@/lib/tools";

/**
 * The report AI analyst — one message in, ND-JSON replies out.
 * No mention → THE ANALYST answers (neutral, full-substrate, cites [seq]).
 * @mentions (resolved client-side to agent keys) → those leads/crowd
 * members answer in character, sequentially, each seeing the thread so far.
 * Every model call logs to agent_interactions (analyst.reply /
 * analyst.agent_reply) with the question in the detail column.
 */

export const maxDuration = 300;

const MAX_CONTENT = 6000;
const HISTORY_LIMIT = 40;
const MAX_MENTIONS = 5;
const DEFAULT_ANALYST_MODEL = "claude-sonnet-5"; // reasoning over a big substrate — Sonnet-class by default
const REPLY_MAX_TOKENS = 1600;

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body: { simId?: string; conversationId?: string; content?: string; mentionKeys?: string[]; model?: string; webSearch?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const simId = String(body.simId ?? "");
  const content = (body.content ?? "").trim();
  if (!simId) return NextResponse.json({ error: "simId required" }, { status: 400 });
  if (!content || content.length > MAX_CONTENT) return NextResponse.json({ error: "Message must be 1–6000 characters" }, { status: 400 });
  const model = CHAT_MODEL_IDS.includes(String(body.model)) ? String(body.model) : DEFAULT_ANALYST_MODEL;
  const webSearch = body.webSearch === true;

  // RLS proves org membership on the sim before anything streams
  const ctx = await buildAnalystContext(supabase, simId);
  if (!ctx) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

  const { data: orgRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  const orgId = orgRow?.org_id as string;

  // thread: reuse or create (kind 'analyst' keeps it out of Conversations)
  let conversationId = body.conversationId ?? null;
  if (conversationId) {
    const { data: conv } = await supabase.from("conversations")
      .select("id").eq("id", conversationId).eq("kind", "analyst").eq("sim_id", simId).maybeSingle();
    if (!conv) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  } else {
    const { data: conv, error } = await supabase.from("conversations")
      .insert({ org_id: orgId, created_by: user.id, kind: "analyst", sim_id: simId, title: threadTitleFrom(content), participant_keys: [ANALYST_KEY] })
      .select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversationId = conv.id as string;
  }

  const { data: history } = await supabase.from("conversation_messages")
    .select("role, agent_key, agent_name, content").eq("conversation_id", conversationId)
    .order("id", { ascending: false }).limit(HISTORY_LIMIT);
  const thread = (history ?? []).reverse();

  await supabase.from("conversation_messages")
    .insert({ conversation_id: conversationId, role: "user", content });

  const mentioned = (body.mentionKeys ?? []).slice(0, MAX_MENTIONS)
    .map((k) => ({ key: k, spec: ctx.castSpecs.get(k) }))
    .filter((x): x is { key: string; spec: NonNullable<typeof x.spec> } => Boolean(x.spec));

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();
  const threadId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      send({ type: "thread", id: threadId, title: threadTitleFrom(thread.length ? String(thread[0]?.content ?? content) : content) });

      const historyText = [...thread, { role: "user", agent_key: null, agent_name: null, content }]
        .map((m) => `${m.role === "user" ? "USER" : (m.agent_name ?? "ANALYST").toUpperCase()}: ${m.content}`)
        .join("\n\n");

      // substrate rides once per responder with a cache breakpoint — repeat
      // questions in a thread reread it at ~0.1× (same lever as the engine)
      const substrateBlock = {
        type: "text" as const,
        text: `THE RUN SUBSTRATE:\n\n${ctx.substrate}`,
        cache_control: { type: "ephemeral" as const },
      };

      const respond = async (
        surface: string, system: string, replyModel: string,
        who: { key: string; name: string; role: string },
        tools: Record<string, unknown>[],
      ) => {
        send({ type: "typing", key: who.key, name: who.name });
        const t0 = Date.now();
        try {
          const res = await anthropic.messages.create({
            model: replyModel,
            max_tokens: REPLY_MAX_TOKENS,
            system,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: tools.length ? (tools as any) : undefined,
            messages: [{
              role: "user",
              content: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(ctx.corpusBlocks as any[]),
                substrateBlock,
                { type: "text", text: `THE CONVERSATION SO FAR:\n\n${historyText}\n\nRespond now.` },
              ],
            }],
          });
          const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
          await supabase.from("agent_interactions").insert({
            org_id: orgId, user_id: user.id, surface, model: replyModel, sim_id: simId, conversation_id: threadId,
            agent_key: who.key, agent_name: who.name,
            input_tokens: res.usage?.input_tokens ?? null, output_tokens: res.usage?.output_tokens ?? null,
            latency_ms: Date.now() - t0, status: "ok",
            detail: { question: content.slice(0, 300), thread_title: threadTitleFrom(content), web_search: webSearch },
          });
          if (text) {
            await supabase.from("conversation_messages")
              .insert({ conversation_id: threadId, role: "agent", agent_key: who.key, agent_name: who.name, content: text });
            send({ type: "message", key: who.key, name: who.name, role: who.role, content: text });
            return text;
          }
          send({ type: "error", error: `${who.name} returned nothing — try again` });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "reply failed";
          await supabase.from("agent_interactions").insert({
            org_id: orgId, user_id: user.id, surface, model: replyModel, sim_id: simId, conversation_id: threadId,
            agent_key: who.key, agent_name: who.name, latency_ms: Date.now() - t0, status: "error", error: msg.slice(0, 300),
          });
          send({ type: "error", error: msg.slice(0, 200) });
        }
        return null;
      };

      try {
        if (mentioned.length === 0) {
          // the analyst answers — optionally with web search when toggled on
          const tools = webSearch ? toolBlocksFor(["web_search"], model) : [];
          await respond("analyst.reply", analystSystem(ctx.simName), model, { key: ANALYST_KEY, name: "Analyst", role: "Report analyst" }, tools);
        } else {
          // mentioned agents reply in character, sequentially — each sees the
          // ones before it via the persisted thread on the NEXT turn; within
          // this turn they answer independently (never speak for each other)
          for (const m of mentioned) {
            const tierModel = m.spec.seat?.tier === "crowd" ? "claude-haiku-4-5" : model;
            await respond(
              "analyst.agent_reply",
              agentReplySystem(m.spec, ctx.simName),
              tierModel,
              { key: m.key, name: m.spec.name, role: m.spec.seat?.role ?? m.spec.role ?? "" },
              [],
            );
          }
        }
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
