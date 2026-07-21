import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { compilePersonaPrompt, PersonaSpec } from "@/lib/personas";

/**
 * Office Hours: single-persona consultation (CLAUDE.md §3.4).
 * Expert-tier model per §6.4 Standard: claude-sonnet-5. Never hardcode
 * models in business logic — this constant is the config.
 */
const CONSULT_MODEL = process.env.CONSULT_MODEL ?? "claude-sonnet-5";

const MAX_MESSAGES = 40;
const MAX_CHARS = 4000;

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: { persona?: PersonaSpec; messages?: { role: "user" | "assistant"; content: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const persona = body.persona;
  const messages = body.messages ?? [];
  if (!persona?.name || !persona?.role || !persona?.backstory) {
    return NextResponse.json({ error: "Invalid persona" }, { status: 400 });
  }
  if (messages.length === 0 || messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "Invalid message count" }, { status: 400 });
  }
  for (const m of messages) {
    if (typeof m.content !== "string" || m.content.length > MAX_CHARS) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 });
    }
  }

  try {
    const anthropic = new Anthropic();
    const resp = await anthropic.messages.create({
      model: CONSULT_MODEL,
      max_tokens: 700,
      system: compilePersonaPrompt(persona),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const reply = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return NextResponse.json({ reply, usage: { in: resp.usage.input_tokens, out: resp.usage.output_tokens } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Model call failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
