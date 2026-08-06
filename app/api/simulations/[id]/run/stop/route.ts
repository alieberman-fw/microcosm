import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { RunState, claimRun, heartbeatFresh } from "@/lib/walkaway";

/**
 * 3c — graceful stop. Sets run_state.stop_requested; the slice worker's
 * truth loop picks it up within ~12s and zeroes the engine deadline, so the
 * run suspends at its next safe boundary and finalizes as a COMPLETE run
 * with stop reason "stopped" — transcript preserved, report synthesizable.
 *
 * Field fix (2026-08-05): a STOP on an ORPHANED run (stale heartbeat — the
 * worker was hard-killed) used to set a flag no living worker would ever
 * read, leaving the run "running" forever. No worker = nothing to wind
 * down: finalize immediately with the persisted transcript.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // every write below is a fenced CAS on run_state.worker (migration 0018):
  // a stop can no longer clobber a worker that claimed the run between our
  // read and our write. A lost CAS re-reads and retries — worst case the run
  // changed hands twice in one request, and we report honestly.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: sim } = await supabase.from("simulations").select("id, status, config").eq("id", id).maybeSingle();
    if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
    if (sim.status !== "running") {
      return attempt === 0
        ? NextResponse.json({ error: "No run in progress" }, { status: 400 })
        : NextResponse.json({ ok: true, finalized: true, note: "The run finished on its own while stopping" });
    }

    const config = (sim.config as Record<string, unknown>) ?? {};
    const runState = ((config.run_state as RunState | undefined) ?? {});

    if (!heartbeatFresh(runState, Date.now())) {
      const { count } = await supabase.from("posts").select("seq", { count: "exact", head: true }).eq("sim_id", id);
      const mode = String((config.casting as { mode?: string } | undefined)?.mode ?? "Agora");
      const claim = await claimRun(supabase, {
        simId: id,
        expectedWorker: runState.worker ?? null,
        runState: null,
        status: "complete",
        configPatch: { run_result: { posts: count ?? 0, converged: false, stop: "stopped", mode, at: new Date().toISOString() } },
      });
      if (claim === "error") return NextResponse.json({ error: "Run chain lock unavailable — is migration 0018 applied?" }, { status: 500 });
      if (claim === "lost") continue; // a worker claimed the orphan mid-request — re-read and stop IT gracefully
      return NextResponse.json({ ok: true, finalized: true, note: "The run had no live worker — stopped immediately with the transcript preserved" });
    }

    const claim = await claimRun(supabase, {
      simId: id,
      expectedWorker: runState.worker ?? null,
      runState: { stop_requested: true },
    });
    if (claim === "error") return NextResponse.json({ error: "Run chain lock unavailable — is migration 0018 applied?" }, { status: 500 });
    if (claim === "lost") continue; // the run changed hands — re-read and flag the new worker
    return NextResponse.json({ ok: true, note: "Stopping at the next safe boundary — the transcript is preserved" });
  }
  return NextResponse.json({ error: "The run is changing hands — try STOP again in a moment" }, { status: 409 });
}
