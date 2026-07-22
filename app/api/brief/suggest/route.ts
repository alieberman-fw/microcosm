import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { BRIEF_SUGGEST_MODEL, DECISION_SHAPES, normalizeQuestions } from "@/lib/corpus";
import { parseLooseObject } from "@/lib/llm-json";

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
    // one retry: a rare malformed/truncated response shouldn't surface to the user
    let parsed: Record<string, unknown> = {};
    let attempts = 0;
    for (; attempts < 2; attempts++) {
      const res = await anthropic.messages.create({
        model: BRIEF_SUGGEST_MODEL,
        max_tokens: 1200, // 7 question objects + rationale never truncates at this cap
        system:
          `You prepare real-estate research briefs for an agent-swarm simulation. Given a problem statement, reply with ONLY a JSON object:\n` +
          `{"questions": [{"label": "...", "detail": "..."}], "template": "...", "composition": "experts|consumers|mixed", "rationale": "..."}\n` +
          `- questions: 4-7 items — the sub-questions a decision-grade answer must resolve; each becomes a required report section. label: short UPPERCASE chip, 2-4 words (e.g. "POWER TIMELINE"). detail: one sharp sentence framing what must be answered (e.g. "Can 300MW be interconnected inside 36 months?").\n` +
          `- template: the decision shape — the closest of: ${DECISION_SHAPES.join(" · ")}.\n` +
          `- composition: experts for feasibility/underwriting/legal questions; consumers for demand/pricing/sentiment; mixed when there is a community or political surface or a big capital decision.\n` +
          `- rationale: one sentence explaining the composition call.`,
        messages: [{ role: "user", content: problem }],
      });
      if (orgId) {
        await supabase.from("agent_interactions").insert({
          org_id: orgId, user_id: user.id, surface: "brief.suggest", model: BRIEF_SUGGEST_MODEL,
          input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
          latency_ms: Date.now() - t0, status: "ok",
        });
      }
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const attempt = parseLooseObject(text);
      if (attempt && Array.isArray(attempt.questions) && attempt.questions.length) {
        parsed = attempt;
        break;
      }
      if (attempts === 1) throw new Error(`unparseable suggestion after retry (stop: ${res.stop_reason})`);
    }
    const questions = normalizeQuestions(parsed.questions).slice(0, 7);
    const template = (DECISION_SHAPES as readonly string[]).includes(String(parsed.template)) ? String(parsed.template) : "Custom";
    const composition = ["experts", "consumers", "mixed"].includes(String(parsed.composition)) ? String(parsed.composition) : "mixed";
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
