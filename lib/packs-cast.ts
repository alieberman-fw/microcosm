import { CastSeat, seatKey } from "@/lib/casting";
import { MAX_PACK_DESC, MAX_PACK_NAME, PackKind } from "@/lib/packs";

/**
 * The Pack Director (natural-language pack casting) — pure prompt builders
 * and plan normalization, unit-tested apart from the streaming route.
 * "A team of 25 investors focused on REITs, AVs, and urban infill" → a
 * plan of distinct member descriptors that match-or-generate resolves.
 */

/** NL casting caps — panel mirrors MAX_SEATS; crowd is bounded by
 *  generation cost, not the 200-member storage cap (add more by search) */
export const CAST_MEMBER_CAPS: Record<PackKind, number> = { panel: 20, crowd: 40 };
export const DEFAULT_CAST_COUNTS: Record<PackKind, number> = { panel: 8, crowd: 24 };
export const MAX_PACK_PROMPT = 600;

export interface PackPlan {
  name: string;
  kind: PackKind;
  description: string;
  requested: number;
  clamped: boolean;
  members: CastSeat[];
}

export function packPlanSystem(kindOverride?: PackKind): string {
  return (
    `You are the Pack Director for Microcosm, a real-estate simulation platform. The user describes a reusable roster ` +
    `("pack") of synthetic personas in natural language. Produce STRICT JSON only — no prose, no code fences:\n` +
    `{"name": "short pack name", "kind": "panel|crowd", "description": "one plain-English line on what this pack is for", ` +
    `"members": [{"role": "specific professional or person title", "kind": "expert|consumer|resident|stakeholder", ` +
    `"discipline": "SHORT UPPERCASE GROUP", "why": "one clause, <=12 words — their distinct angle", "query": "2-4 lowercase search keywords"}]}\n` +
    `Rules:\n` +
    (kindOverride
      ? `- kind MUST be "${kindOverride}" (the user chose it).\n`
      : `- kind: "panel" = named professionals who deliberate and advise (the default); "crowd" = a population polled for sentiment (renters, buyers, shoppers, guests, residents).\n`) +
    `- member count: honor the user's number, capped at ${CAST_MEMBER_CAPS.panel} for panel and ${CAST_MEMBER_CAPS.crowd} for crowd. ` +
    `No number given → ${DEFAULT_CAST_COUNTS.panel} for panel, ${DEFAULT_CAST_COUNTS.crowd} for crowd.\n` +
    `- Every member is DISTINCT — spread the roles across every focus the user names (specialties, asset classes, geographies, dispositions) so the roster covers the whole description, not one archetype repeated.\n` +
    `- Roles are concrete ("REIT portfolio manager, industrial", not "investor").\n` +
    `- No adversarial seats — packs are neutral rosters; opposition gets seeded at simulation time.`
  );
}

/** single-member draft ("a land-use attorney who's fought three data-center
 *  CUPs") — the §3.2C one-liner path, returning ONE persona JSON */
export function packDraftSystem(): string {
  return (
    `You create ONE synthetic persona for Microcosm from a one-line description. Produce STRICT JSON only (no prose):\n` +
    `{"name": "Full Name", "initials": "XX", "role": "their concrete title", "tagline": "experience + disposition, <=90 chars", ` +
    `"kind": "expert|consumer|resident|stakeholder", "discipline": "SHORT UPPERCASE", "backstory": "3-5 sentences of career/life story grounding their judgment", ` +
    `"stances": ["2-4 standing positions"], "skills": ["3-6 skills"], "traits": {"risk_tolerance": 0-1, "agreeableness": 0-1, "verbosity": 0-1}, ` +
    `"demographics": {"age": n, "metro": "...", "state": "XX"} }\n` +
    `Honor every detail the user gives; invent the rest plausibly. The persona is a synthetic composite — never a real person.`
  );
}

/** clamp + shape the plan JSON; tolerate partial/malformed model output */
export function normalizePackPlan(
  raw: Record<string, unknown> | null,
  opts: { kindOverride?: PackKind; nameOverride?: string } = {},
): PackPlan | null {
  if (!raw || !Array.isArray(raw.members) || raw.members.length === 0) return null;
  const kind: PackKind = opts.kindOverride ?? (raw.kind === "crowd" ? "crowd" : "panel");
  const cap = CAST_MEMBER_CAPS[kind];
  const requested = raw.members.length;
  const members: CastSeat[] = (raw.members as { role?: unknown; kind?: unknown; discipline?: unknown; why?: unknown; query?: unknown }[])
    .slice(0, cap)
    .map((m, i): CastSeat => ({
      key: seatKey(String(m.role ?? "member"), i + 1),
      role: String(m.role ?? "Panelist").slice(0, 80),
      kind: (["expert", "consumer", "resident", "stakeholder"] as const).find((k) => k === m.kind) ?? (kind === "crowd" ? "consumer" : "expert"),
      discipline: String(m.discipline ?? (kind === "crowd" ? "CROWD" : "PANEL")).toUpperCase().slice(0, 20),
      why: String(m.why ?? "").slice(0, 200),
      query: String(m.query ?? m.role ?? "").slice(0, 80),
    }));
  const name = (opts.nameOverride ?? String(raw.name ?? "")).trim().replace(/\s+/g, " ").slice(0, MAX_PACK_NAME) || "Untitled pack";
  return {
    name,
    kind,
    description: String(raw.description ?? "").trim().slice(0, MAX_PACK_DESC),
    requested,
    clamped: requested > cap,
    members,
  };
}
