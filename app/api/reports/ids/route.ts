import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** The unread-reports badge's feed: every report id this org can see
 *  (RLS-scoped). "Seen" lives client-side — the badge subtracts the ids
 *  the user has actually opened. */
export async function GET() {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data } = await supabase.from("reports")
    .select("id").order("created_at", { ascending: false }).limit(300);
  return NextResponse.json({ ids: (data ?? []).map((r) => r.id as string) });
}
