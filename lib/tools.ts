/**
 * 3d — the AGENT TOOL RACK (CLAUDE.md §7, docs/next-level-plan.md §3d).
 * The single source of truth for every tool that exists or is coming: the
 * run-config cards, the Conversations tool menu, the engine wiring, the cost
 * estimator, and the report methodology ALL read from this file. Adding a
 * future tool = adding one descriptor — never re-architecture.
 *
 * The contract: the USER controls which tools a simulation or chat
 * participant is ALLOWED to use (all off by default); AGENTS decide when an
 * allowed tool is actually worth using — never per-post mandatory.
 */

export interface ToolDescriptor {
  key: string;                 // stable id stored in config.tools / tool_overrides
  name: string;                // card title
  tagline: string;             // mono one-liner under the title
  description: string;         // plain-English: what it is, what agents do with it
  example: string;             // one concrete line that makes it real
  costNote: string;            // honest usage pricing for the card
  status: "available" | "coming_soon";
  /** server-side tools: build the API tool block for a given model id.
   *  Version strings live HERE ONLY — never in engine or route code. */
  serverTool?: (model: string) => Record<string, unknown>;
  /* future function tools (§7 interface) — slots, not code, in v1 */
  schema?: Record<string, unknown>;
}

/** newer dynamic-filtering web search on Sonnet-5/Opus-4.6+ class models;
 *  the basic variant everywhere else (Haiku 4.5 economy leads) */
function webSearchBlock(model: string): Record<string, unknown> {
  const modern = /claude-(sonnet-5|opus-4-[678]|sonnet-4-6)/.test(model);
  return {
    type: modern ? "web_search_20260209" : "web_search_20250305",
    name: "web_search",
    max_uses: 2, // per turn — bounds cost and latency; the panel shares results anyway
  };
}

export const TOOL_RACK: ToolDescriptor[] = [
  {
    key: "web_search",
    name: "Web research",
    tagline: "LIVE FACTS FROM THE PUBLIC WEB",
    description:
      "Agents can search the web mid-deliberation when their expertise needs a current fact — today's rates, recent sales, a zoning change, news about a tenant. They decide when it's worth it; most turns won't search.",
    example: "the capital-markets seat checks the current 10-year treasury before defending a cap rate",
    costNote: "usage-based · ≈1¢ per search + result tokens",
    status: "available",
    serverTool: webSearchBlock,
  },
  {
    key: "parcel_data",
    name: "Parcel & lot data",
    tagline: "OWNERSHIP · ZONING · LOT LINES",
    description: "Assessor and parcel records on demand — acreage, zoning designation, ownership, assessed value — so siting arguments rest on the county's own numbers.",
    example: "the zoning attorney pulls the parcel's actual designation instead of trusting the broker deck",
    costNote: "usage-based",
    status: "coming_soon",
  },
  {
    key: "econ_series",
    name: "Economic series",
    tagline: "FRED · BLS — RATES, JOBS, CPI",
    description: "Live macro series — treasury rates, metro employment, inflation — so underwriting arguments quote the real curve, not a remembered one.",
    example: "the economist charts 24 months of metro job growth before calling absorption",
    costNote: "free public APIs",
    status: "coming_soon",
  },
  {
    key: "census",
    name: "Census & demographics",
    tagline: "ACS — INCOMES, TENURE, COMMUTES",
    description: "Neighborhood-level demographics on demand — who actually lives in the trade area, what they earn, how they commute.",
    example: "the market analyst checks renter share within 3 miles before sizing the unit mix",
    costNote: "free public API",
    status: "coming_soon",
  },
  {
    key: "historical_web",
    name: "Historical web",
    tagline: "THE WEB AS IT WAS ON A DATE",
    description: "Archived pages for point-in-time facts — what a listing, rent roll, or policy page said last year, not just today.",
    example: "the analyst compares today's asking rents against the same page 18 months ago",
    costNote: "usage-based",
    status: "coming_soon",
  },
  {
    key: "flood_climate",
    name: "Flood & climate risk",
    tagline: "FEMA NFHL · HAZARD LAYERS",
    description: "Flood zones and hazard designations for the exact parcel — the difference between a talking point and a mapped fact.",
    example: "the insurance seat confirms the site sits outside the 100-year floodplain before pricing coverage",
    costNote: "free public data",
    status: "coming_soon",
  },
];

export const availableToolKeys = (): string[] => TOOL_RACK.filter((t) => t.status === "available").map((t) => t.key);

/** sanitize a stored allowlist to real, available keys */
export function normalizeEnabledTools(raw: unknown): string[] {
  const avail = new Set(availableToolKeys());
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((k) => String(k)).filter((k) => avail.has(k)))];
}

/** the API `tools` array for a turn — empty when nothing applies */
export function toolBlocksFor(enabled: string[], model: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const key of normalizeEnabledTools(enabled)) {
    const t = TOOL_RACK.find((x) => x.key === key);
    if (t?.serverTool) out.push(t.serverTool(model));
  }
  return out;
}

/** the agent-decided instruction — present ONLY when tools are enabled */
export function toolPromptAddendum(enabled: string[]): string {
  if (normalizeEnabledTools(enabled).length === 0) return "";
  return (
    ` TOOLS: You may search the web when your expertise genuinely needs a current fact (rates, prices, news, codes, comps). ` +
    `Most turns do not need it — search only when the result would change your answer. Check the facts the panel already pulled before searching again. Cite what you find.`
  );
}
