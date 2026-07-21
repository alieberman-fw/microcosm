import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import ParticipantBrowser, { BrowserCustomRow } from "@/components/app/ParticipantBrowser";
import { LibraryRow, LibraryFacets } from "@/components/app/LibraryBrowse";

export const metadata = { title: "New conversation — Microcosm" };
export const dynamic = "force-dynamic";

export default async function NewConversationPage() {
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();

  const [{ data: customRows }, { data: libRows, count }, { data: facets }] = await Promise.all([
    supabase!
      .from("personas")
      .select("id, kind, spec")
      .eq("org_id", userRow!.org_id as string)
      .order("created_at", { ascending: false }),
    supabase!
      .from("personas")
      .select("id, kind, spec", { count: "exact" })
      .is("org_id", null)
      .eq("source", "library")
      .order("spec->>name")
      .limit(24),
    supabase!.rpc("library_facets"),
  ]);

  const emptyFacets: LibraryFacets = { total: 0, kinds: [], categories: [] };

  return (
    <ParticipantBrowser
      custom={(customRows ?? []) as BrowserCustomRow[]}
      library={(libRows ?? []) as LibraryRow[]}
      libraryCount={count ?? 0}
      facets={(facets as LibraryFacets | null) ?? emptyFacets}
    />
  );
}
