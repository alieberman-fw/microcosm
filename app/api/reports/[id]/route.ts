import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Delete one report version (reports tab ⋯ menu). RLS (reports_delete,
 * migration 0013) scopes the delete to the caller's org; the transcript and
 * the simulation itself are untouched — only the synthesized document goes.
 */
/** Rename one report version (reports tab ⋯ menu / the report header ✎).
 *  The name lives in spec.name — display resolves spec.name → the sim's
 *  name → the contract title, so unnamed reports follow their simulation. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  if (typeof body.name !== "string") return NextResponse.json({ error: "name required" }, { status: 400 });
  const name = body.name.trim().slice(0, 80);

  const { data: row } = await supabase.from("reports").select("spec").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const spec = { ...(row.spec as Record<string, unknown>) };
  if (name) spec.name = name;
  else delete spec.name; // clearing the field re-follows the simulation's name
  const { error } = await supabase.from("reports").update({ spec }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, name: name || null });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.from("reports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
