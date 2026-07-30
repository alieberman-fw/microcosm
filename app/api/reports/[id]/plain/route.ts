import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { TIER_MODELS, RunConfig } from "@/lib/run";
import { REPORT_PLAIN_SCHEMA, ReportPlain, ReportSpec, plainSpecIncomplete, reportPlainSystem } from "@/lib/report";
import { parseLooseObject } from "@/lib/llm-json";

export const maxDuration = 120;

/**
 * The PLAIN ENGLISH toggle (3a report overhaul): translate the frozen report
 * spec for a non-technical reader — same answers, same numbers, jargon-free,
 * with a micro-glossary. Generated once on first toggle and cached into
 * reports.spec.plain (RLS: reports_update, migration 0016), so it's instant
 * afterward and works retroactively on any past report. A TRANSLATION of the
 * frozen spec, never a re-synthesis — the two views cannot disagree.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { data: report } = await supabase.from("reports").select("id, sim_id, spec").eq("id", id).maybeSingle();
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const spec = report.spec as ReportSpec;
  if (spec.plain) return NextResponse.json({ plain: spec.plain, cached: true });

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  const orgId = userRow?.org_id as string;

  // translation input: the decision content of the frozen spec — never the transcript
  const input = JSON.stringify({
    verdict: spec.verdict,
    bottom_line: spec.bottom_line,
    executive_summary: spec.executive_summary,
    sections: spec.sections.map((s) => ({ question: s.question, answer: s.answer, finding: s.finding, numbers: s.numbers })),
    risks: spec.risks,
    tripwires: spec.tripwires,
    dissents: spec.dissents?.map((d) => ({ role: d.role, position: d.position })),
  });

  const tier = (spec.run_config?.tier ?? "standard") as RunConfig["tier"];
  const model = TIER_MODELS[tier].plain;
  const anthropic = new Anthropic();

  let plain: ReportPlain | null = null;
  let lastErr = "";
  // same ceiling policy as everywhere: escalate on truncation, never accept a partial
  for (const budget of [6_000, 12_000]) {
    const t0 = Date.now();
    try {
      const res = await anthropic.messages.create({
        model,
        max_tokens: budget,
        system: reportPlainSystem(),
        messages: [{ role: "user", content: `TECHNICAL REPORT (JSON):\n${input.slice(0, 60_000)}` }],
        output_config: { format: { type: "json_schema", schema: REPORT_PLAIN_SCHEMA } },
      });
      await supabase.from("agent_interactions").insert({
        org_id: orgId, user_id: user.id, surface: "report.plain", model, sim_id: report.sim_id,
        input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
        latency_ms: Date.now() - t0, status: "ok", detail: { report_id: id, budget },
      });
      if (res.stop_reason === "max_tokens") { lastErr = "translation outran the ceiling"; continue; }
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const parsed = parseLooseObject(text);
      if (!parsed) { lastErr = "unparseable translation"; continue; }
      const incomplete = plainSpecIncomplete(parsed, spec.sections.length);
      if (incomplete) { lastErr = `incomplete translation — ${incomplete}`; continue; }
      plain = parsed as unknown as ReportPlain;
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "translation failed";
      await supabase.from("agent_interactions").insert({
        org_id: orgId, user_id: user.id, surface: "report.plain", model, sim_id: report.sim_id,
        latency_ms: Date.now() - t0, status: "error", error: lastErr, detail: { report_id: id },
      });
    }
  }
  if (!plain) return NextResponse.json({ error: `Plain-English view failed — ${lastErr}` }, { status: 500 });

  const { error: upErr } = await supabase.from("reports").update({ spec: { ...spec, plain } }).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ plain, cached: false });
}
