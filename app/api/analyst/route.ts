import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { ANALYST_KEY, agentReplySystem, analystSystem, buildAnalystContext, threadTitleFrom } from "@/lib/analyst";
import {
  ARTIFACT_SYSTEM, ARTIFACT_TOOLS, ArtifactRef, MAX_ARTIFACT_HTML, MAX_ARTIFACT_NAME, MAX_TOOL_HOPS,
  wrapArtifactHtml,
} from "@/lib/artifacts";
import { CHAT_MODEL_IDS } from "@/lib/chat-models";
import { toolBlocksFor } from "@/lib/tools";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The report AI analyst — one message in, ND-JSON replies out.
 * No mention → THE ANALYST answers (neutral, full-substrate, cites [seq]),
 * with document tools: create/update/delete_artifact write standalone styled
 * HTML documents to Storage (tracked in report_artifacts) via a tool-use
 * loop; each operation streams an `artifact` event and is persisted on the
 * reply message's attachments so reopened threads keep their cards.
 * @mentions (resolved client-side to agent keys) → those leads/crowd
 * members answer in character, sequentially, each seeing the thread so far.
 * Every model call logs to agent_interactions (analyst.reply /
 * analyst.agent_reply; artifact ops as analyst.artifact) with the question
 * in the detail column.
 */

export const maxDuration = 300;

const MAX_CONTENT = 6000;
const HISTORY_LIMIT = 40;
const MAX_MENTIONS = 5;
const DEFAULT_ANALYST_MODEL = "claude-sonnet-5"; // reasoning over a big substrate — Sonnet-class by default
const REPLY_MAX_TOKENS = 1600;
const ANALYST_MAX_TOKENS = 12_000; // the analyst may write whole documents

interface ArtifactRuntime {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  simId: string;
  threadId: string;
  simName: string;
  send: (obj: unknown) => void;
  touched: ArtifactRef[];
}

/** execute one artifact tool call — returns the tool_result payload */
async function runArtifactTool(name: string, input: Record<string, unknown>, rt: ArtifactRuntime): Promise<Record<string, unknown>> {
  const { supabase, orgId, simId, threadId } = rt;
  const t0 = Date.now();
  const log = async (action: string, artifactName: string, status: "ok" | "error", error?: string) => {
    await supabase.from("agent_interactions").insert({
      // model "none": storage/db work, zero tokens — spend estimator unaffected
      org_id: orgId, user_id: rt.userId, surface: "analyst.artifact", model: "none", sim_id: simId, conversation_id: threadId,
      agent_key: ANALYST_KEY, agent_name: "Analyst", latency_ms: Date.now() - t0, status,
      error: error?.slice(0, 300) ?? null, detail: { action, artifact_name: artifactName.slice(0, 120) },
    });
  };
  const generatedAt = new Date().toISOString().slice(0, 10);

  if (name === "create_artifact") {
    const docName = String(input.name ?? "").trim().slice(0, MAX_ARTIFACT_NAME);
    const title = String(input.title ?? docName).trim().slice(0, 200);
    const bodyHtml = String(input.body_html ?? "");
    if (!docName || !bodyHtml) return { ok: false, error: "name and body_html are required" };
    if (bodyHtml.length > MAX_ARTIFACT_HTML) return { ok: false, error: `body_html exceeds ${MAX_ARTIFACT_HTML} chars` };
    const html = wrapArtifactHtml({ title, simName: rt.simName, bodyHtml, generatedAt });
    const path = `${orgId}/artifacts/${simId}/${crypto.randomUUID()}.html`;
    const { error: upErr } = await supabase.storage.from("documents")
      .upload(path, Buffer.from(html, "utf8"), { contentType: "text/html" });
    if (upErr) { await log("create", docName, "error", upErr.message); return { ok: false, error: upErr.message }; }
    const { data: row, error: rowErr } = await supabase.from("report_artifacts")
      .insert({ sim_id: simId, conversation_id: threadId, name: docName, storage_path: path, created_by: rt.userId })
      .select("id, name, created_at, updated_at").single();
    if (rowErr) {
      await supabase.storage.from("documents").remove([path]);
      await log("create", docName, "error", rowErr.message);
      return { ok: false, error: rowErr.message };
    }
    const ref: ArtifactRef = { kind: "artifact", id: row.id as string, name: docName, action: "created" };
    rt.touched.push(ref);
    rt.send({ type: "artifact", action: "created", artifact: row });
    await log("create", docName, "ok");
    return { ok: true, artifact_id: row.id, name: docName };
  }

  if (name === "update_artifact" || name === "delete_artifact") {
    const id = String(input.artifact_id ?? "");
    const { data: row } = await supabase.from("report_artifacts")
      .select("id, name, storage_path").eq("id", id).eq("sim_id", simId).maybeSingle();
    if (!row) return { ok: false, error: "artifact not found — check the EXISTING ARTIFACTS list" };

    if (name === "delete_artifact") {
      await supabase.storage.from("documents").remove([row.storage_path as string]);
      const { error } = await supabase.from("report_artifacts").delete().eq("id", id);
      if (error) { await log("delete", row.name as string, "error", error.message); return { ok: false, error: error.message }; }
      const ref: ArtifactRef = { kind: "artifact", id, name: row.name as string, action: "deleted" };
      rt.touched.push(ref);
      rt.send({ type: "artifact", action: "deleted", artifact: { id, name: row.name } });
      await log("delete", row.name as string, "ok");
      return { ok: true, artifact_id: id };
    }

    const newName = input.name != null ? String(input.name).trim().slice(0, MAX_ARTIFACT_NAME) : (row.name as string);
    const bodyHtml = input.body_html != null ? String(input.body_html) : null;
    if (bodyHtml != null) {
      if (bodyHtml.length > MAX_ARTIFACT_HTML) return { ok: false, error: `body_html exceeds ${MAX_ARTIFACT_HTML} chars` };
      const title = String(input.title ?? newName).trim().slice(0, 200);
      const html = wrapArtifactHtml({ title, simName: rt.simName, bodyHtml, generatedAt });
      const { error: upErr } = await supabase.storage.from("documents")
        .upload(row.storage_path as string, Buffer.from(html, "utf8"), { contentType: "text/html", upsert: true });
      if (upErr) { await log("update", newName, "error", upErr.message); return { ok: false, error: upErr.message }; }
    }
    const { data: updated, error } = await supabase.from("report_artifacts")
      .update({ name: newName, updated_at: new Date().toISOString() }).eq("id", id)
      .select("id, name, created_at, updated_at").single();
    if (error) { await log("update", newName, "error", error.message); return { ok: false, error: error.message }; }
    const ref: ArtifactRef = { kind: "artifact", id, name: newName, action: "updated" };
    rt.touched.push(ref);
    rt.send({ type: "artifact", action: "updated", artifact: updated });
    await log("update", newName, "ok");
    return { ok: true, artifact_id: id, name: newName };
  }

  return { ok: false, error: `unknown tool ${name}` };
}

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

  // existing artifacts ride per-request (they change turn to turn — never
  // inside the cached substrate)
  const { data: artifactRows } = await supabase.from("report_artifacts")
    .select("id, name, updated_at").eq("sim_id", simId).order("updated_at", { ascending: false }).limit(30);
  const artifactList = (artifactRows ?? []).length
    ? `EXISTING ARTIFACTS (documents you already created for this report):\n${(artifactRows ?? []).map((a) => `- ${a.id} — "${a.name}" (updated ${String(a.updated_at).slice(0, 10)})`).join("\n")}`
    : "EXISTING ARTIFACTS: none yet.";

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
        artifactRt: ArtifactRuntime | null,
      ) => {
        send({ type: "typing", key: who.key, name: who.name });
        const t0 = Date.now();
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const messages: any[] = [{
            role: "user",
            content: [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...(ctx.corpusBlocks as any[]),
              substrateBlock,
              { type: "text", text: `${artifactRt ? `${artifactList}\n\n` : ""}THE CONVERSATION SO FAR:\n\n${historyText}\n\nRespond now.` },
            ],
          }];
          let text = "";
          let inTok = 0, outTok = 0;
          // tool-use loop: artifact ops execute between hops; plain replies
          // exit on the first pass (stop_reason end_turn)
          for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
            const res = await anthropic.messages.create({
              model: replyModel,
              max_tokens: artifactRt ? ANALYST_MAX_TOKENS : REPLY_MAX_TOKENS,
              system,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: tools.length ? (tools as any) : undefined,
              messages,
            });
            inTok += res.usage?.input_tokens ?? 0;
            outTok += res.usage?.output_tokens ?? 0;
            text += res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
            const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
            if (res.stop_reason !== "tool_use" || toolUses.length === 0 || !artifactRt) break;
            messages.push({ role: "assistant", content: res.content });
            const results = [];
            for (const tu of toolUses) {
              const out = await runArtifactTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, artifactRt);
              results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
            }
            messages.push({ role: "user", content: results });
          }
          text = text.trim();
          await supabase.from("agent_interactions").insert({
            org_id: orgId, user_id: user.id, surface, model: replyModel, sim_id: simId, conversation_id: threadId,
            agent_key: who.key, agent_name: who.name,
            input_tokens: inTok || null, output_tokens: outTok || null,
            latency_ms: Date.now() - t0, status: "ok",
            detail: { question: content.slice(0, 300), thread_title: threadTitleFrom(content), web_search: webSearch, artifacts: artifactRt?.touched.length || undefined },
          });
          const attachments = artifactRt?.touched ?? [];
          if (text || attachments.length) {
            await supabase.from("conversation_messages")
              .insert({ conversation_id: threadId, role: "agent", agent_key: who.key, agent_name: who.name, content: text, attachments });
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
          // the analyst answers — document tools always on, web search when toggled
          const tools = [...ARTIFACT_TOOLS, ...(webSearch ? toolBlocksFor(["web_search"], model) : [])];
          const artifactRt: ArtifactRuntime = {
            supabase, orgId, userId: user.id, simId, threadId, simName: ctx.simName, send, touched: [],
          };
          await respond(
            "analyst.reply", `${analystSystem(ctx.simName)}\n\n${ARTIFACT_SYSTEM}`, model,
            { key: ANALYST_KEY, name: "Analyst", role: "Report analyst" }, tools, artifactRt,
          );
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
              null,
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
