import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** Report magic links — revoke (PATCH) or remove (DELETE) one link.
 *  RLS scopes both to the caller's org through sim → project → org. */

export async function PATCH(_request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { error } = await supabase.from("report_links")
    .update({ revoked_at: new Date().toISOString() }).eq("id", linkId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { error } = await supabase.from("report_links").delete().eq("id", linkId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
