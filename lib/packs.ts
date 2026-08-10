/**
 * Panel & crowd packs (§3.4 persona sets) — shared types, caps, and pure
 * validation used by the /api/packs routes and every pack picker surface.
 * A PANEL pack drops into a simulation as lead seats (or a group chat as
 * participants); a CROWD pack seeds the polled crowd.
 */

export const PACK_KINDS = ["panel", "crowd"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/** member caps mirror the surfaces packs land on: MAX_SEATS leads / the
 *  manual-crowd request cap — a pack that can't be applied whole is a trap */
export const PACK_CAPS: Record<PackKind, number> = { panel: 20, crowd: 200 };

export const MAX_PACK_NAME = 80;
export const MAX_PACK_DESC = 240;
export const MAX_PACKS_PER_ORG = 100;
/** members shown as the card's avatar stack */
export const PACK_PREVIEW_SIZE = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PackPreviewMember {
  id: string;
  name: string;
  initials: string;
  role: string;
}

export interface PackSummary {
  id: string;
  name: string;
  kind: PackKind;
  description: string | null;
  count: number;
  preview: PackPreviewMember[];
  created_at: string;
  updated_at: string;
}

export function parsePackKind(v: unknown): PackKind | null {
  return PACK_KINDS.includes(v as PackKind) ? (v as PackKind) : null;
}

export function clipPackName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_PACK_NAME);
}

export function clipPackDescription(v: unknown): string | null {
  const d = String(v ?? "").trim().slice(0, MAX_PACK_DESC);
  return d || null;
}

/** dedupe, drop non-uuids, and cap to the pack kind's limit — order kept */
export function normalizePackIds(ids: unknown, kind: PackKind): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").toLowerCase();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= PACK_CAPS[kind]) break;
  }
  return out;
}
