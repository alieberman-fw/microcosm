import { createServerSupabase } from "@/lib/supabase/server";
import Conversations, { ConversationRow } from "@/components/app/Conversations";
import { LIBRARY_PERSONAS, LibraryPersona, PersonaSpec } from "@/lib/personas";

export const metadata = { title: "Conversations — Microcosm" };
export const dynamic = "force-dynamic";

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const { with: withKey } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase!.auth.getUser();
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();

  const [{ data: convRows }, { data: customRows }] = await Promise.all([
    supabase!
      .from("conversations")
      .select("id, title, participant_keys, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase!
      .from("personas")
      .select("id, spec")
      .eq("org_id", userRow!.org_id)
      .order("created_at", { ascending: false }),
  ]);

  const custom: LibraryPersona[] = (customRows ?? []).map((r) => ({
    ...(r.spec as PersonaSpec),
    key: r.id as string,
    id: r.id as string,
    source: "custom" as const,
  }));
  const personas = [...custom, ...LIBRARY_PERSONAS];

  return (
    <Conversations
      personas={personas}
      initial={(convRows ?? []) as ConversationRow[]}
      initialWith={withKey && personas.some((p) => p.key === withKey) ? withKey : undefined}
    />
  );
}
