import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import Conversations, { ConversationRow } from "@/components/app/Conversations";
import { LIBRARY_PERSONAS, LibraryPersona, PersonaSpec } from "@/lib/personas";

export const metadata = { title: "Conversations — Microcosm" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const { with: withKey } = await searchParams;
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();

  const [{ data: convRows }, { data: customRows }, { count: libraryCount }] = await Promise.all([
    supabase!
      .from("conversations")
      .select("id, title, participant_keys, updated_at, model_overrides")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase!
      .from("personas")
      .select("id, spec")
      .eq("org_id", userRow!.org_id)
      .order("created_at", { ascending: false }),
    supabase!
      .from("personas")
      .select("id", { count: "exact", head: true })
      .is("org_id", null)
      .eq("source", "library"),
  ]);

  const custom: LibraryPersona[] = (customRows ?? []).map((r) => ({
    ...(r.spec as PersonaSpec),
    key: r.id as string,
    id: r.id as string,
    source: "custom" as const,
  }));

  // resolve library participants referenced by existing threads (or ?with=)
  // so names/avatars render without a search round-trip
  const known = new Set([...custom.map((p) => p.key), ...LIBRARY_PERSONAS.map((p) => p.key)]);
  const wanted = new Set<string>();
  (convRows ?? []).forEach((c) => (c.participant_keys as string[]).forEach((k) => {
    if (!known.has(k) && UUID_RE.test(k)) wanted.add(k);
  }));
  if (withKey && !known.has(withKey) && UUID_RE.test(withKey)) wanted.add(withKey);

  let libParticipants: LibraryPersona[] = [];
  if (wanted.size) {
    const { data: rows } = await supabase!.from("personas").select("id, spec").in("id", [...wanted]);
    libParticipants = (rows ?? []).map((r) => ({
      ...(r.spec as PersonaSpec),
      key: r.id as string,
      id: r.id as string,
      source: "library" as const,
    }));
  }

  const personas = [...custom, ...libParticipants, ...LIBRARY_PERSONAS];

  return (
    <Conversations
      orgId={userRow!.org_id as string}
      personas={personas}
      initial={(convRows ?? []) as ConversationRow[]}
      initialWith={withKey && personas.some((p) => p.key === withKey) ? withKey : undefined}
      libraryCount={libraryCount ?? 0}
    />
  );
}
