import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonaSpec } from "@/lib/personas";
import { PACK_PREVIEW_SIZE, PackPreviewMember, PackSummary } from "@/lib/packs";

/** Server-side pack helpers shared by the /api/packs routes. */

export interface PackRow {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  persona_ids: string[];
  created_at: string;
  updated_at: string;
}

/** resolve preview members for a batch of packs in one personas query */
export async function packSummaries(db: SupabaseClient, rows: PackRow[]): Promise<PackSummary[]> {
  const wanted = [...new Set(rows.flatMap((r) => r.persona_ids.slice(0, PACK_PREVIEW_SIZE)))];
  const byId = new Map<string, PackPreviewMember>();
  if (wanted.length) {
    const { data } = await db.from("personas").select("id, spec").in("id", wanted);
    for (const p of data ?? []) {
      const spec = p.spec as PersonaSpec;
      byId.set(p.id as string, { id: p.id as string, name: spec.name, initials: spec.initials, role: spec.role });
    }
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind === "crowd" ? "crowd" : "panel",
    description: r.description,
    count: r.persona_ids.length,
    preview: r.persona_ids.slice(0, PACK_PREVIEW_SIZE).map((id) => byId.get(id)).filter((m): m is PackPreviewMember => Boolean(m)),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/** keep only ids the caller can actually see (their org's + the library) —
 *  a pack can never hold personas the org has no access to */
export async function visiblePersonaIds(db: SupabaseClient, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await db.from("personas").select("id").in("id", ids);
  const found = new Set((data ?? []).map((p) => p.id as string));
  return ids.filter((id) => found.has(id));
}
