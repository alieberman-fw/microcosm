import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { TIER_MODELS, RunConfig } from "@/lib/run";
import { ReportSpec, synthesizePlain } from "@/lib/report";

export const maxDuration = 300; // dense reports translate long — 120s was killed by the platform mid-call, returning a PLAIN-TEXT error the client tried to JSON.parse

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

  const tier = (spec.run_config?.tier ?? "standard") as RunConfig["tier"];
  const model = TIER_MODELS[tier].plain;
  const anthropic = new Anthropic();

  // 6-PR4: one shared implementation with the executive register's eager pass
  const { plain, lastErr } = await synthesizePlain(anthropic, spec, model, async (m, usage, t0, error, detail) => {
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface: "report.plain", model: m, sim_id: report.sim_id,
      input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
      latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null,
      detail: { report_id: id, ...detail },
    });
  });
  if (!plain) return NextResponse.json({ error: `Plain-English view failed — ${lastErr}` }, { status: 500 });

  const { error: upErr } = await supabase.from("reports").update({ spec: { ...spec, plain } }).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ plain, cached: false });
}
