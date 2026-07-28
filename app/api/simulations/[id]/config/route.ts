import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { SIM_MODES } from "@/lib/casting";
import { RUN_DEFAULTS, RUN_RANGES, RunConfig } from "@/lib/run";

/**
 * User adjustments to the casting plan (CLAUDE.md §3 Stage 3): the full-run
 * crowd counts (experts 4-500, residents 0-1000 per §4.1) and the
 * interaction mode. Merged into config.casting with user_set flags so the
 * UI can show YOURS vs RECOMMENDED and the engine honors the user's numbers.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { scale?: { experts?: number; residents?: number }; mode?: string; qa_remove?: string; run?: Partial<RunConfig> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: sim } = await supabase.from("simulations").select("id, config").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const config = (sim.config as Record<string, unknown>) ?? {};
  const casting = (config.casting as Record<string, unknown>) ?? {};
  const userSet = (casting.user_set as Record<string, boolean>) ?? {};

  if (body.scale) {
    const prev = (casting.scale as { experts?: number; residents?: number }) ?? {};
    casting.scale = {
      experts: Math.min(Math.max(Math.round(Number(body.scale.experts ?? prev.experts ?? 10)), 4), 500),
      residents: Math.min(Math.max(Math.round(Number(body.scale.residents ?? prev.residents ?? 0)), 0), 1000),
    };
    userSet.scale = true;
  }
  if (body.mode) {
    const mode = SIM_MODES.find((m) => m === body.mode);
    if (!mode) return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
    casting.mode = mode;
    userSet.mode = true;
  }
  casting.user_set = userSet;

  // §4.1 run parameters → config.run (clamped to ranges; enums validated)
  if (body.run) {
    const prev = { ...RUN_DEFAULTS, ...((config.run as Partial<RunConfig>) ?? {}) };
    const r = body.run;
    const num = (v: unknown, lo: number, hi: number, fb: number) =>
      Math.min(Math.max(Math.round(Number(v ?? fb)) || fb, lo), hi);
    const pick = <T extends string>(v: unknown, opts: readonly T[], fb: T): T =>
      (opts as readonly string[]).includes(String(v)) ? (v as T) : fb;
    config.run = {
      rounds: num(r.rounds, RUN_RANGES.rounds.min, RUN_RANGES.rounds.max, prev.rounds),
      max_posts: num(r.max_posts, RUN_RANGES.max_posts.min, RUN_RANGES.max_posts.max, prev.max_posts),
      speaker: pick(r.speaker ?? prev.speaker, ["priority", "round-robin", "random", "mention-driven"] as const, "priority"),
      convergence: pick(r.convergence ?? prev.convergence, ["stability", "fixed", "budget"] as const, "stability"),
      temperature: pick(r.temperature ?? prev.temperature, ["conservative", "balanced", "exploratory"] as const, "balanced"),
      tier: pick(r.tier ?? prev.tier, ["economy", "standard", "frontier"] as const, "standard"),
      verifier: typeof r.verifier === "boolean" ? r.verifier : prev.verifier,
      report_length: pick(r.report_length ?? prev.report_length, ["auto", "brief", "standard", "dense"] as const, "auto"),
    } satisfies RunConfig;
  }

  // remove one persisted corpus Q&A by id
  if (body.qa_remove && Array.isArray(config.qa)) {
    config.qa = (config.qa as { id?: string }[]).filter((x) => x.id !== body.qa_remove);
  }

  const { error } = await supabase.from("simulations")
    .update({ config: { ...config, casting } }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ casting });
}
