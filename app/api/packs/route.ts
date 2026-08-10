import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { MAX_PACKS_PER_ORG, clipPackDescription, clipPackName, normalizePackIds, parsePackKind } from "@/lib/packs";
import { PackRow, packSummaries, visiblePersonaIds } from "@/lib/packs-server";

/**
 * Packs (persona sets, §3.4): GET lists the org's packs with member
 * previews; POST creates one. Members are personas.id uuids — validated
 * against RLS-visible personas (the org's own + the global library).
 */

export async function GET() {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: rows, error } = await supabase.from("persona_sets")
    .select("id, name, kind, description, persona_ids, created_at, updated_at")
    .order("updated_at", { ascending: false }).limit(MAX_PACKS_PER_ORG);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ packs: await packSummaries(supabase, (rows ?? []) as PackRow[]) });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { name?: string; kind?: string; description?: string; personaIds?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = clipPackName(body.name);
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const kind = parsePackKind(body.kind ?? "panel");
  if (!kind) return NextResponse.json({ error: "kind must be 'panel' or 'crowd'" }, { status: 400 });

  const { count } = await supabase.from("persona_sets").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_PACKS_PER_ORG) {
    return NextResponse.json({ error: `Packs are capped at ${MAX_PACKS_PER_ORG} for now` }, { status: 400 });
  }

  const { data: orgRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!orgRow) return NextResponse.json({ error: "No org" }, { status: 400 });

  const personaIds = await visiblePersonaIds(supabase, normalizePackIds(body.personaIds, kind));

  const { data: row, error } = await supabase.from("persona_sets")
    .insert({
      org_id: orgRow.org_id, created_by: user.id, name, kind,
      description: clipPackDescription(body.description), persona_ids: personaIds,
    })
    .select("id, name, kind, description, persona_ids, created_at, updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [pack] = await packSummaries(supabase, [row as PackRow]);
  return NextResponse.json({ pack }, { status: 201 });
}
