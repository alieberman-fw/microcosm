import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { FrozenSpec } from "@/lib/casting";

/** The analyst panel's bootstrap: this sim's analyst THREADS (newest first)
 *  and the CAST for the @mention typeahead (leads first, then crowd). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [{ data: threads }, { data: agents }] = await Promise.all([
    supabase.from("conversations")
      .select("id, title, updated_at").eq("kind", "analyst").eq("sim_id", id)
      .order("updated_at", { ascending: false }).limit(30),
    supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id),
  ]);

  const cast = (agents ?? []).map((a) => {
    const spec = a.spec_frozen as FrozenSpec;
    return {
      key: a.agent_key as string,
      name: spec.name,
      role: spec.seat?.role ?? spec.role ?? "",
      tier: spec.seat?.tier === "crowd" ? "crowd" : "lead",
    };
  }).sort((a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier === "lead" ? -1 : 1));

  return NextResponse.json({ threads: threads ?? [], cast });
}
