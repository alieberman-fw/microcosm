import { createServerSupabase } from "@/lib/supabase/server";
import PersonaManager, { CustomPersonaRow } from "@/components/app/PersonaManager";

export const metadata = { title: "Agent Library — Microcosm" };
export const dynamic = "force-dynamic";

export default async function PersonasPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase!.auth.getUser();
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();
  const orgId = userRow!.org_id as string;

  const { data } = await supabase!
    .from("personas")
    .select("id, kind, spec, source, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return <PersonaManager orgId={orgId} initial={(data ?? []) as CustomPersonaRow[]} />;
}
