/**
 * Casting Director (CLAUDE.md §3.2A) — config, types, and prompts.
 *
 * The casting pass never runs below the Sonnet tier: casting quality bounds
 * simulation quality (§6.4). Flow: draft the ideal seats from brief +
 * corpus → match each seat against the org's custom personas first, then
 * the global library → generate only true gaps (saved back to the org's
 * custom library so the catalog self-heals).
 */

import { PersonaSpec } from "@/lib/personas";

/** never below Sonnet (§6.4) — env-overridable, e.g. claude-opus-4-8 */
export const CASTING_MODEL = process.env.CASTING_MODEL ?? "claude-sonnet-5";

export const MAX_SEATS = 20;

/** pre-cast panel-size presets (deliberation LEADS — the full-run population
 * of hundreds/thousands is the recommended scale, unlocked with PUMS + engine) */
export const PANEL_SIZES = [
  { seats: 6, label: "FOCUSED", desc: "a tight expert huddle" },
  { seats: 10, label: "STANDARD", desc: "the default panel" },
  { seats: 15, label: "DEEP", desc: "wide coverage, sub-debates" },
  { seats: 20, label: "MAX", desc: "every discipline seated" },
] as const;

export const SIM_MODES = ["Agora", "Roundtable", "Tribunal", "Chamber", "Jury", "Desk", "Expedition"] as const;

export interface CastSeat {
  key: string;                 // stable slug used as sim_agents.agent_key
  role: string;                // the seat as cast ("Grid interconnection planner")
  kind: "expert" | "consumer" | "resident" | "stakeholder" | "adversarial";
  discipline: string;          // drives graph clustering ("POWER")
  why: string;                 // one line: why this seat exists for this brief
  query: string;               // 2-4 keyword library-search terms
}

export interface CastPlan {
  composition: "experts" | "consumers" | "mixed";
  rationale: string;
  scale: { experts: number; residents: number };
  mode: (typeof SIM_MODES)[number];
  modeRationale: string;
  seats: CastSeat[];
}

export function castingPlanSystem(targetSeats?: number): string {
  const seatCount = targetSeats
    ? `EXACTLY ${Math.min(Math.max(targetSeats, 4), MAX_SEATS)} seats (the user chose this panel size — hit it).`
    : `6-${MAX_SEATS} seats.`;
  return (
    `You are the Casting Director for Microcosm, an agent-swarm simulation platform for real estate decisions. ` +
    `Given a research brief and the diligence corpus inventory, design the ideal panel. Reply with ONLY a JSON object:\n` +
    `{"composition": "experts|consumers|mixed", "rationale": "...", ` +
    `"scale": {"experts": N, "residents": N}, ` +
    `"mode": "Agora|Roundtable|Tribunal|Chamber|Jury|Desk|Expedition", "mode_rationale": "...", ` +
    `"seats": [{"role": "...", "kind": "expert|consumer|resident|stakeholder|adversarial", "discipline": "...", "why": "...", "query": "..."}]}\n\n` +
    `Composition rules (non-negotiable):\n` +
    `- Feasibility / engineering / underwriting / legal questions → experts only.\n` +
    `- Demand / preference / pricing / sentiment questions → consumers-residents, plus a thin expert bench.\n` +
    `- Community or political surface, or a big capital decision → mixed, ALWAYS with resident seats.\n` +
    `Seat rules (non-negotiable):\n` +
    `- ${seatCount} Every question-to-resolve must have at least one expert seat that owns it (name the mapping in "why").\n` +
    `- EXACTLY ONE seat with kind "adversarial": a credible skeptic instructed to attack the thesis (organized-opposition voice when there is a community surface).\n` +
    `- Seat kinds MUST match the composition: an "experts" panel has only expert/stakeholder/adversarial seats (no consumer or resident kinds); a "consumers" panel is mostly consumer/resident seats with a thin expert bench; "mixed" requires at least two consumer/resident seats.\n` +
    `- Seats are the deliberation LEADS. "scale" is the recommended full-run population (experts 4-500, residents 0-1000; residents 0 unless composition includes consumers/residents).\n` +
    `- discipline: short UPPERCASE cluster label (POWER, WATER, CAPITAL, ZONING, COMMUNITY, MARKET...).\n` +
    `- query: 2-4 lowercase keywords to find this person in a persona library (e.g. "grid interconnection utility").\n` +
    `Mode guide: Agora = open deliberation (default); Roundtable = equals, every voice each round; Tribunal = genuinely two-sided dispute; ` +
    `Chamber = independent takes then blind peer review; Jury = independent scored verdicts; Desk = research memo; Expedition = deep background research.`
  );
}

/** add-more mode: extend the existing panel instead of replacing it */
export function castingAddSystem(existingRoles: string[], maxNew: number): string {
  return (
    `You are the Casting Director for Microcosm, extending an EXISTING simulation panel. ` +
    `The panel already seats:\n${existingRoles.map((r) => `- ${r}`).join("\n")}\n\n` +
    `Given the brief and the user's request, propose ONLY the ADDITIONAL seats (1-${maxNew}) — never duplicate or rework existing seats. ` +
    `Reply with ONLY a JSON object:\n` +
    `{"seats": [{"role": "...", "kind": "expert|consumer|resident|stakeholder|adversarial", "discipline": "...", "why": "...", "query": "..."}]}\n` +
    `- Follow the user's request precisely ("add more pool engineering experts" → pool/aquatics engineering seats).\n` +
    `- kind "adversarial" only if the user explicitly asks for another skeptic (the panel already has one).\n` +
    `- discipline: short UPPERCASE cluster label. query: 2-4 lowercase library-search keywords.`
  );
}

export function castingGenerateSystem(): string {
  return (
    `You create synthetic personas for Microcosm's real-estate simulations. For EACH seat requested, write one complete persona. ` +
    `Reply with ONLY a JSON array, one object per seat, in the same order:\n` +
    `[{"seat_key": "...", "name": "First Last", "initials": "FL", "role": "...", "kind": "...", "discipline": "...", ` +
    `"tagline": "22 yrs X · sharp angle", "backstory": "3-4 sentence career/life story grounded in the market at hand", ` +
    `"stances": ["...", "...", "..."], "skills": ["...", "...", "...", "..."], ` +
    `"traits": {"risk_tolerance": 0.0-1.0, "agreeableness": 0.0-1.0, "verbosity": 0.0-1.0}, ` +
    `"demographics": {"age": N, "metro": "City", "state": "ST", "years_experience": N, "credentials": "...", "occupation": "...", "income_band": "$X–YK", "tenure": "owner|renter", "household": "..."}}]\n` +
    `Rules: every persona is a synthetic composite — never a real person. Full names must be distinct from each other and from the avoid-list. ` +
    `Ground each persona in the geography and asset type of the brief. Adversarial seats get stances that genuinely attack the thesis with professional credibility, not strawmen. ` +
    `Ages, experience, income, credentials must be mutually coherent.`
  );
}

/** seat → agent_key slug ("grid-interconnection-planner-2") */
export function seatKey(role: string, index: number): string {
  const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug || "seat"}-${index}`;
}

/** what sim_agents.spec_frozen carries beyond the persona spec */
export interface SeatMeta {
  role: string;
  why: string;
  discipline: string;
  adversarial: boolean;
  provenance: "yours" | "library" | "generated";
}

export type FrozenSpec = PersonaSpec & { seat: SeatMeta };

/** crude-but-honest overlap score for matching org custom personas first */
export function overlapScore(seatText: string, spec: PersonaSpec): number {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const a = words(seatText);
  const b = words([spec.role, spec.tagline ?? "", (spec.skills ?? []).join(" ")].join(" "));
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}
