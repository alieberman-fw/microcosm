import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { CROWD_MODEL } from "@/lib/casting";

/**
 * Compress a hand-typed question-to-resolve into its chip label — the same
 * 2-4 word UPPERCASE grammar the AI suggestions use, so manual questions
 * render identically (label pill + full framing to the right). Tiny Haiku
 * call; the composer falls back to a word-boundary slice on any failure.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body: { text?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const text = (body.text ?? "").trim();
  if (!text || text.length > 400) return NextResponse.json({ error: "Question must be 1–400 characters" }, { status: 400 });

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  const anthropic = new Anthropic();
  const t0 = Date.now();
  try {
    const res = await anthropic.messages.create({
      model: CROWD_MODEL,
      max_tokens: 24,
      system:
        `Compress the user's research question into a 2-4 word UPPERCASE chip label (max 32 characters), ` +
        `like "POWER TIMELINE" or "BUYER PROFILE FIT". Reply with ONLY the label — no quotes, no punctuation beyond spaces & hyphens.`,
      messages: [{ role: "user", content: text }],
    });
    await supabase.from("agent_interactions").insert({
      org_id: userRow?.org_id ?? null, user_id: user.id, surface: "brief.label", model: CROWD_MODEL,
      input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
      latency_ms: Date.now() - t0, status: "ok", error: null, detail: { text: text.slice(0, 120) },
    });
    const label = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")
      .trim().toUpperCase().replace(/[^A-Z0-9 \-&/]/g, "").slice(0, 40);
    if (!label) throw new Error("empty label");
    return NextResponse.json({ label });
  } catch (e) {
    await supabase.from("agent_interactions").insert({
      org_id: userRow?.org_id ?? null, user_id: user.id, surface: "brief.label", model: CROWD_MODEL,
      input_tokens: null, output_tokens: null, latency_ms: Date.now() - t0,
      status: "error", error: e instanceof Error ? e.message : "label failed", detail: null,
    });
    return NextResponse.json({ error: "Label failed" }, { status: 500 });
  }
}
