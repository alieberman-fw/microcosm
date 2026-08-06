import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Delete one report version (reports tab ⋯ menu). RLS (reports_delete,
 * migration 0013) scopes the delete to the caller's org; the transcript and
 * the simulation itself are untouched — only the synthesized document goes.
 */
// NOTE: report renames write the SIMULATION's config.name (one name,
// owned by the sim — dashboard card, every report version, and the open
// report agree). spec.name remains readable as a legacy fallback only.

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
