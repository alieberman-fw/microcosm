import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Report magic links — management surface (org-scoped via RLS).
 * GET lists the sim's links; POST mints a named link with an optional
 * expiry. The PUBLIC view is /r/<token> (service-role read); these routes
 * never serve report content.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data, error } = await supabase.from("report_links")
    .select("id, token, name, expires_at, revoked_at, created_at")
    .eq("sim_id", id).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; days?: unknown };
  const name = String(body.name ?? "").trim().slice(0, 60) || "Shared link";
  // expiry presets (7/30/90); anything non-positive/absent = never expires
  const days = Number(body.days);
  const expires_at = Number.isFinite(days) && days > 0
    ? new Date(Date.now() + Math.min(days, 365) * 86_400_000).toISOString()
    : null;

  // 24 random bytes, base64url — unguessable, copy-paste friendly
  const token = randomBytes(24).toString("base64url");
  const { data, error } = await supabase.from("report_links")
    .insert({ sim_id: id, token, name, created_by: user.id, expires_at })
    .select("id, token, name, expires_at, revoked_at, created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data });
}
