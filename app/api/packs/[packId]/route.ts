import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { clipPackDescription, clipPackName, normalizePackIds, parsePackKind } from "@/lib/packs";
import { PackRow, packSummaries, visiblePersonaIds } from "@/lib/packs-server";
import type { PersonaSpec } from "@/lib/personas";

/**
 * One pack (RLS org-scoped via pset_all):
 * GET — summary + full member rows (id/kind/spec, pack order) for pickers.
 * PATCH — rename, re-describe, and/or replace the member list.
 * DELETE — remove the pack (personas themselves are untouched).
 */

export async function GET(_request: Request, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: row } = await supabase.from("persona_sets")
    .select("id, name, kind, description, persona_ids, created_at, updated_at")
    .eq("id", packId).maybeSingle();
  if (!row) return NextResponse.json({ error: "Pack not found" }, { status: 404 });

  const ids = (row.persona_ids ?? []) as string[];
  const members: { id: string; kind: string; spec: PersonaSpec }[] = [];
  if (ids.length) {
    const { data: personas } = await supabase.from("personas").select("id, kind, spec").in("id", ids);
    const byId = new Map((personas ?? []).map((p) => [p.id as string, p]));
    for (const id of ids) {
      const p = byId.get(id);
      if (p) members.push({ id: p.id as string, kind: p.kind as string, spec: p.spec as PersonaSpec });
    }
  }

  const [pack] = await packSummaries(supabase, [row as PackRow]);
  return NextResponse.json({ pack, members });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { name?: string; description?: string; personaIds?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { data: existing } = await supabase.from("persona_sets")
    .select("id, kind").eq("id", packId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  const kind = parsePackKind(existing.kind) ?? "panel";

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = clipPackName(body.name);
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = clipPackDescription(body.description);
  if (body.personaIds !== undefined) {
    patch.persona_ids = await visiblePersonaIds(supabase, normalizePackIds(body.personaIds, kind));
  }

  const { data: row, error } = await supabase.from("persona_sets")
    .update(patch).eq("id", packId)
    .select("id, name, kind, description, persona_ids, created_at, updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [pack] = await packSummaries(supabase, [row as PackRow]);
  return NextResponse.json({ pack });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.from("persona_sets").delete().eq("id", packId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
