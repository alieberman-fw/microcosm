import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import HomeClient, { ChecklistState, HomeConversation, HomePersona } from "@/components/app/HomeClient";
import { PersonaSpec } from "@/lib/personas";

export const metadata = { title: "Home — Microcosm" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!
    .from("users").select("org_id, prefs").eq("id", user!.id).single();
  const prefs = (userRow?.prefs ?? {}) as { hide_onboarding?: boolean };

  const [{ data: convRows }, { data: personaRows }, { data: searchHit }, { data: attachHit }, { data: simHit }] = await Promise.all([
    supabase!
      .from("conversations")
      .select("id, title, participant_keys, updated_at, conversation_messages(count)")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase!
      .from("personas")
      .select("id, kind, spec")
      .eq("org_id", userRow!.org_id as string)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase!
      .from("agent_interactions")
      .select("id")
      .eq("surface", "library.search")
      .limit(1),
    supabase!
      .from("conversation_messages")
      .select("id")
      .neq("attachments", "[]")
      .limit(1),
    supabase!
      .from("simulations")
      .select("id")
      .limit(1),
  ]);

  const convs = (convRows ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string,
    participants: (c.participant_keys as string[]).length,
    messages: (c.conversation_messages as { count: number }[] | null)?.[0]?.count ?? 0,
    updated_at: c.updated_at as string,
  })) as HomeConversation[];

  const checklist: ChecklistState = {
    conversation: convs.length > 0,
    group: convs.some((c) => c.participants > 1),
    persona: (personaRows ?? []).length > 0,
    search: (searchHit ?? []).length > 0,
    attachment: (attachHit ?? []).length > 0,
    simulate: (simHit ?? []).length > 0,
  };

  return (
    <HomeClient
      email={user?.email ?? "you"}
      checklist={checklist}
      hideChecklist={Boolean(prefs.hide_onboarding)}
      conversations={convs.slice(0, 6)}
      personas={(personaRows ?? []).map((p) => ({ id: p.id as string, kind: p.kind as string, spec: p.spec as PersonaSpec })) as HomePersona[]}
    />
  );
}
