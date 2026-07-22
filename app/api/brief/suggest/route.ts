import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { BRIEF_SUGGEST_MODEL, DECISION_TEMPLATES } from "@/lib/corpus";

/**
 * Brief composer assist (CLAUDE.md §2 Stage 1): one lightweight pass over the
 * problem statement proposes the questions-to-resolve chips, the closest
 * decision template, and the §4.2 composition recommendation.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: { problem?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const problem = (body.problem ?? "").trim();
  if (!problem || problem.length > 2000) {
    return NextResponse.json({ error: "Problem statement must be 1–2000 characters" }, { status: 400 });
  }

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  const orgId = userRow?.org_id as string | undefined;

  const anthropic = new Anthropic();
  const t0 = Date.now();
  try {
    const res = await anthropic.messages.create({
      model: BRIEF_SUGGEST_MODEL,
      max_tokens: 500,
      system:
        `You prepare real-estate research briefs for an agent-swarm simulation. Given a problem statement, reply with ONLY a JSON object:\n` +
        `{"questions": ["..."], "template": "...", "composition": "experts|consumers|mixed", "rationale": "..."}\n` +
        `- questions: 4-7 short UPPERCASE question chips (2-4 words each, e.g. "POWER TIMELINE", "WATER STRATEGY") — the sub-questions a decision-grade answer must resolve.\n` +
        `- template: the closest of: ${DECISION_TEMPLATES.join(" · ")}.\n` +
        `- composition: experts for feasibility/underwriting/legal questions; consumers for demand/pricing/sentiment; mixed when there is a community or political surface or a big capital decision.\n` +
        `- rationale: one sentence explaining the composition call.`,
      messages: [{ role: "user", content: problem }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    const questions: string[] = Array.isArray(parsed.questions)
      ? parsed.questions.map((q: unknown) => String(q).toUpperCase().slice(0, 40)).slice(0, 7)
      : [];
    const template = DECISION_TEMPLATES.includes(parsed.template) ? parsed.template : "Custom";
    const composition = ["experts", "consumers", "mixed"].includes(parsed.composition) ? parsed.composition : "mixed";

    if (orgId) {
      await supabase.from("agent_interactions").insert({
        org_id: orgId, user_id: user.id, surface: "brief.suggest", model: BRIEF_SUGGEST_MODEL,
        input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
        latency_ms: Date.now() - t0, status: "ok",
      });
    }
    return NextResponse.json({ questions, template, composition, rationale: String(parsed.rationale ?? "").slice(0, 300) });
  } catch (e) {
    if (orgId) {
      await supabase.from("agent_interactions").insert({
        org_id: orgId, user_id: user.id, surface: "brief.suggest", model: BRIEF_SUGGEST_MODEL,
        latency_ms: Date.now() - t0, status: "error", error: e instanceof Error ? e.message : "suggest failed",
      });
    }
    return NextResponse.json({ error: "Suggestion failed — add questions manually" }, { status: 502 });
  }
}
