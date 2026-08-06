import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** The run-finished badge's feed: completed runs from the last 7 days
 *  (RLS-scoped), each with the timestamp the run actually ended — the
 *  client subtracts the runs this user has already opened. The window
 *  keeps a first-ever load from flooding the badge with ancient runs. */
export async function GET() {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data } = await supabase.from("simulations")
    .select("id, config").eq("status", "complete")
    .order("created_at", { ascending: false }).limit(200);
  const cutoff = Date.now() - 7 * 24 * 3600_000;
  const runs = (data ?? []).flatMap((r) => {
    const at = (r.config as { run_result?: { at?: string } } | null)?.run_result?.at;
    if (!at || Date.parse(at) < cutoff) return [];
    return [{ id: r.id as string, at }];
  });
  return NextResponse.json({ runs });
}
