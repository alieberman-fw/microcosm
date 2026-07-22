import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** The org's custom personas — feeds the hand-pick seat picker (client-side
 * instant filter; the global library goes through /api/personas/search). */
export async function GET() {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });

  const { data, error } = await supabase
    .from("personas")
    .select("id, kind, spec")
    .eq("org_id", userRow.org_id as string)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ personas: data ?? [] });
}
