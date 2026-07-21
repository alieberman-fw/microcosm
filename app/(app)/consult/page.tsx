import { createServerSupabase } from "@/lib/supabase/server";
import ConsultChat from "@/components/app/ConsultChat";
import { LIBRARY_PERSONAS, LibraryPersona, PersonaSpec } from "@/lib/personas";

export const metadata = { title: "Office Hours — Microcosm" };
export const dynamic = "force-dynamic";

export default async function ConsultPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase!.auth.getUser();
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();

  const { data: customRows } = await supabase!
    .from("personas")
    .select("id, kind, spec")
    .eq("org_id", userRow!.org_id)
    .order("created_at", { ascending: false });

  const custom: LibraryPersona[] = (customRows ?? []).map((r) => ({
    ...(r.spec as PersonaSpec),
    key: r.id as string,
    id: r.id as string,
    source: "custom" as const,
  }));

  const personas = [...custom, ...LIBRARY_PERSONAS];
  const initialKey = p && personas.some((x) => x.key === p) ? p : personas[custom.length > 0 ? 0 : 0]?.key;

  return <ConsultChat personas={personas} initialKey={initialKey} />;
}
