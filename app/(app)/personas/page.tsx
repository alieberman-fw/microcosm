import { createServerSupabase } from "@/lib/supabase/server";
import PersonaManager, { CustomPersonaRow, LibraryRow } from "@/components/app/PersonaManager";

export const metadata = { title: "Agent Library — Microcosm" };
export const dynamic = "force-dynamic";

export default async function PersonasPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase!.auth.getUser();
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();
  const orgId = userRow!.org_id as string;

  const [{ data: customRows }, { data: libRows, count }] = await Promise.all([
    supabase!
      .from("personas")
      .select("id, kind, spec, source, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    supabase!
      .from("personas")
      .select("id, kind, spec", { count: "exact" })
      .is("org_id", null)
      .eq("source", "library")
      .order("created_at", { ascending: true })
      .limit(60),
  ]);

  return (
    <PersonaManager
      orgId={orgId}
      initial={(customRows ?? []) as CustomPersonaRow[]}
      library={(libRows ?? []) as LibraryRow[]}
      libraryCount={count ?? 0}
    />
  );
}
