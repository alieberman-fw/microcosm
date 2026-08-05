import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { RunState, chainSecret, reaperAction } from "@/lib/walkaway";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * The reaper — the server-side walk-away guarantee (field fix, 2026-08-05).
 *
 * A Vercel cron sweeps this route every minute. Any sim stuck at
 * status "running" with a stale heartbeat is a ZOMBIE — its worker was
 * hard-killed (deploy, crash, or the 800s serverless wall) before it could
 * suspend and fire the chain. Before this route existed the only recovery
 * was a human with the tab open clicking RESUME; "simulations should never
 * get stuck even if you walk away" requires the server to heal itself.
 *
 * Per zombie: a pending stop finalizes immediately (no worker exists to run
 * a farewell slice — the transcript is already persisted and synthesizable);
 * anything else gets its slice chain re-fired through /run/continue, which
 * resumes from the persisted transcript with full round/poll/vote dedupe.
 *
 * Auth: the Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`;
 * manual ops can use `x-engine-key: chainSecret(serviceKey, "reaper")`.
 */
export async function GET(request: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "reaper not configured" }, { status: 501 });
  const cronSecret = process.env.CRON_SECRET;
  const authed =
    (cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`) ||
    request.headers.get("x-engine-key") === chainSecret(serviceKey, "reaper");
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: "reaper not configured" }, { status: 501 });

  const { data: running } = await admin
    .from("simulations").select("id, status, config").eq("status", "running").limit(50);

  const origin = process.env.ENGINE_ORIGIN || new URL(request.url).origin;
  const now = Date.now();
  const acted: { id: string; action: string; ok: boolean }[] = [];

  for (const sim of running ?? []) {
    const config = (sim.config as Record<string, unknown>) ?? {};
    const runState = (config.run_state as RunState | undefined) ?? null;
    const action = reaperAction(sim.status as string, runState, now);
    if (action === "skip") continue;

    if (action === "finalize-stopped") {
      const { count } = await admin.from("posts").select("seq", { count: "exact", head: true }).eq("sim_id", sim.id);
      const mode = String((config.casting as { mode?: string } | undefined)?.mode ?? "Agora");
      const { error } = await admin.from("simulations").update({
        status: "complete",
        config: {
          ...config,
          run_state: null,
          run_result: { posts: count ?? 0, converged: false, stop: "stopped", mode, at: new Date().toISOString() },
        },
      }).eq("id", sim.id);
      acted.push({ id: sim.id as string, action, ok: !error });
      continue;
    }

    // re-fire the chain — /run/continue claims the orphan (stale heartbeat)
    // and resumes from the persisted transcript under its own waitUntil
    try {
      const r = await fetch(`${origin}/api/simulations/${sim.id}/run/continue`, {
        method: "POST",
        headers: { "x-engine-key": chainSecret(serviceKey, sim.id as string) },
      });
      acted.push({ id: sim.id as string, action, ok: r.ok });
    } catch {
      acted.push({ id: sim.id as string, action, ok: false });
    }
  }

  return NextResponse.json({ swept: (running ?? []).length, acted });
}
