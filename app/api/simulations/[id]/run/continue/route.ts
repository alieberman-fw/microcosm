import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { executeSlice } from "@/lib/run-worker";
import { CHAIN_PENDING, RunState, chainSecret, heartbeatFresh } from "@/lib/walkaway";

export const maxDuration = 800; // one slice per invocation, same window as launch

/**
 * 3c — the internal slice chain. A suspended slice POSTs here (secret derived
 * from the service key — nothing new to provision) and this invocation runs
 * the NEXT slice under waitUntil after answering 202 immediately, so every
 * slice lives in its own function lifetime. No user session: the run belongs
 * to whoever launched it (simulations.created_by).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: "chain not configured" }, { status: 501 });
  if (request.headers.get("x-engine-key") !== chainSecret(serviceKey, id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: "chain not configured" }, { status: 501 });

  const { data: sim } = await admin.from("simulations").select("id, status, config, created_by").eq("id", id).maybeSingle();
  if (!sim || sim.status !== "running") return NextResponse.json({ skipped: "not running" }, { status: 202 });
  const runState = ((sim.config as Record<string, unknown>)?.run_state as RunState | undefined) ?? null;
  if (!runState) return NextResponse.json({ skipped: "no run state" }, { status: 202 });
  // another worker's heartbeat is fresh → it is driving; never double-drive.
  // The one exception is our OWN handoff: the suspending slice pre-claims
  // with CHAIN_PENDING (fresh beat, so client resumes back off) and this
  // child takes it over. Duplicate chain fires lose here too — the first
  // child replaces CHAIN_PENDING with its own nonce.
  if (heartbeatFresh(runState, Date.now(), 45_000) && runState.worker !== CHAIN_PENDING) {
    return NextResponse.json({ skipped: "already driven" }, { status: 202 });
  }

  const { data: creator } = await admin.from("users").select("org_id").eq("id", sim.created_by as string).maybeSingle();
  if (!creator) return NextResponse.json({ skipped: "no creator org" }, { status: 202 });

  waitUntil(executeSlice({
    db: admin,
    simId: id,
    orgId: creator.org_id as string,
    userId: sim.created_by as string,
    origin: process.env.ENGINE_ORIGIN || new URL(request.url).origin,
    canChain: true,
    workerNonce: Math.random().toString(36).slice(2, 10),
  }));
  return NextResponse.json({ ok: true }, { status: 202 });
}
