import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import ConversationHistory, { HistoryRow } from "@/components/app/ConversationHistory";
import { LIBRARY_PERSONAS, PersonaSpec } from "@/lib/personas";

export const metadata = { title: "Conversation history — Microcosm" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationHistoryPage() {
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();

  const [{ data: convRows }, { data: customRows }] = await Promise.all([
    supabase!
      .from("conversations")
      .select("id, title, participant_keys, updated_at, conversation_messages(count)")
      .order("updated_at", { ascending: false })
      .limit(1000),
    supabase!.from("personas").select("id, spec").eq("org_id", userRow!.org_id),
  ]);

  // resolve participant specs: custom + legacy library + DB library
  const byKey = new Map<string, PersonaSpec>();
  (customRows ?? []).forEach((r) => byKey.set(r.id as string, r.spec as PersonaSpec));
  LIBRARY_PERSONAS.forEach((p) => byKey.set(p.key, p));
  const wanted = new Set<string>();
  (convRows ?? []).forEach((c) => (c.participant_keys as string[]).forEach((k) => {
    if (!byKey.has(k) && UUID_RE.test(k)) wanted.add(k);
  }));
  if (wanted.size) {
    const { data } = await supabase!.from("personas").select("id, spec").in("id", [...wanted]);
    (data ?? []).forEach((r) => byKey.set(r.id as string, r.spec as PersonaSpec));
  }

  const rows: HistoryRow[] = (convRows ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string,
    updated_at: c.updated_at as string,
    messages: (c.conversation_messages as { count: number }[] | null)?.[0]?.count ?? 0,
    participants: (c.participant_keys as string[])
      .map((k) => byKey.get(k))
      .filter((p): p is PersonaSpec => Boolean(p))
      .map((p) => ({ name: p.name, initials: p.initials, role: p.role })),
  }));

  return <ConversationHistory rows={rows} />;
}
