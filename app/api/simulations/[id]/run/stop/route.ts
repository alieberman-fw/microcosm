import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { RunState } from "@/lib/walkaway";

/**
 * 3c — graceful stop. Sets run_state.stop_requested; the slice worker's
 * truth loop picks it up within ~12s and zeroes the engine deadline, so the
 * run suspends at its next safe boundary and finalizes as a COMPLETE run
 * with stop reason "stopped" — transcript preserved, report synthesizable.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: sim } = await supabase.from("simulations").select("id, status, config").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  if (sim.status !== "running") return NextResponse.json({ error: "No run in progress" }, { status: 400 });

  const config = (sim.config as Record<string, unknown>) ?? {};
  const runState = ((config.run_state as RunState | undefined) ?? {});
  await supabase.from("simulations").update({
    config: { ...config, run_state: { ...runState, stop_requested: true } },
  }).eq("id", id);
  return NextResponse.json({ ok: true, note: "Stopping at the next safe boundary — the transcript is preserved" });
}
