import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** Remove one seat from the cast (RLS scopes to the org's simulations). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.from("sim_agents").delete().eq("sim_id", id).eq("agent_key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
