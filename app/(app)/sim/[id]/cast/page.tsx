import { notFound } from "next/navigation";
import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import ParticipantBrowser, { BrowserCustomRow } from "@/components/app/ParticipantBrowser";
import { LibraryRow, LibraryFacets } from "@/components/app/LibraryBrowse";
import { FrozenSpec } from "@/lib/casting";

export const metadata = { title: "Hand-pick the panel — Microcosm" };
export const dynamic = "force-dynamic";

/** Full-library hand-pick for a simulation panel — the conversations "build
 *  the room" browser pointed at lead seats (multi-select, filters, search). */
export default async function CastBrowserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!.from("users").select("org_id").eq("id", user!.id).single();

  const [{ data: sim }, { data: seated }, { data: customRows }, { data: libRows, count }, { data: facets }] = await Promise.all([
    supabase!.from("simulations").select("id").eq("id", id).maybeSingle(),
    supabase!.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id),
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
  if (!sim) notFound();

  const seatedLeads = (seated ?? []).filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd").length;
  const emptyFacets: LibraryFacets = { total: 0, kinds: [], categories: [] };

  return (
    <ParticipantBrowser
      custom={(customRows ?? []) as BrowserCustomRow[]}
      library={(libRows ?? []) as LibraryRow[]}
      libraryCount={count ?? 0}
      facets={(facets as LibraryFacets | null) ?? emptyFacets}
      panel={{ simId: sim.id as string, seated: seatedLeads }}
    />
  );
}
