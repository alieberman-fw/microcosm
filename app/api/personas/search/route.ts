import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { PersonaSpec } from "@/lib/personas";

/**
 * Smart search + browse over the global persona library (CLAUDE.md §3.3/§3.4).
 * A Haiku pass translates natural language ("under 40 home owner",
 * "looking to build a data center") into a websearch-syntax full-text query
 * plus structured demographic filters; the search_personas RPC (Postgres FTS
 * + jsonb filters, RLS-scoped) does the matching, with explicit UI filters,
 * sort, and offset/total pagination on top. Explicit filters always win over
 * parsed ones. Clients echo back `parsed` when paging so the LLM runs once
 * per query, not once per page.
 */
const ROUTER_MODEL = process.env.ROUTER_MODEL ?? "claude-haiku-4-5";

export interface LibrarySearchRow { id: string; kind: string; spec: PersonaSpec; rank: number; total: number }

interface ParsedQuery {
  search: string;
  age_min: number | null;
  age_max: number | null;
  tenure: string | null;
  kinds: string[] | null;
}

const KINDS = ["expert", "consumer", "resident", "stakeholder", "adversarial"];
const SORTS = ["relevance", "name", "age_asc", "age_desc", "newest"];

const PARSE_SYSTEM = `You translate a user's natural-language search over a library of synthetic built-world personas (real-estate experts, consumers, residents, civic stakeholders) into structured search parameters. Reply with ONLY a JSON object:
{"search": "<Postgres websearch-syntax query: the key terms joined with OR, quoted phrases allowed. Expand with strong professional synonyms — e.g. "looking to build a data center" → "data center" OR interconnection OR hyperscaler OR colocation OR "mission critical" OR substation. Use "" (empty) if the query is purely demographic.>",
 "age_min": <int or null>, "age_max": <int or null>,
 "tenure": "owner" | "renter" | null,
 "kinds": <array from ["expert","consumer","resident","stakeholder","adversarial"] or null>}
Rules: "under 40" → age_max 39; "over 55" → age_min 56; "in their 30s" → 30–39. "homeowner"/"home owner" → tenure "owner" and kinds ["consumer"]; "renter" → tenure "renter". Profession/skill/topic queries → kinds null (never over-restrict). Keep search ≤ 12 terms. No prose.`;

function sanitizeParsed(p: unknown): ParsedQuery | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  return {
    search: typeof o.search === "string" ? o.search.slice(0, 400) : "",
    age_min: typeof o.age_min === "number" ? o.age_min : null,
    age_max: typeof o.age_max === "number" ? o.age_max : null,
    tenure: typeof o.tenure === "string" ? o.tenure.slice(0, 20) : null,
    kinds: Array.isArray(o.kinds) ? o.kinds.filter((k): k is string => typeof k === "string" && KINDS.includes(k)) : null,
  };
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: {
    q?: string; limit?: number; offset?: number; smart?: boolean; sort?: string;
    kinds?: string[]; cats?: string[]; ageMin?: number; ageMax?: number; tenure?: string;
    parsed?: unknown; // echo from a previous smart response — skips the LLM when paging
  };
  try { body = await request.json(); } catch { body = {}; }
  const q = (body.q ?? "").trim().slice(0, 300);
  const limit = Math.min(Math.max(body.limit ?? 24, 1), 200);
  const offset = Math.max(body.offset ?? 0, 0);
  const sort = SORTS.includes(body.sort ?? "") ? body.sort! : "relevance";
  const uiKinds = (body.kinds ?? []).filter((k) => KINDS.includes(k));
  const uiCats = (body.cats ?? []).filter((c) => typeof c === "string").slice(0, 50);
  const uiTenure = typeof body.tenure === "string" ? body.tenure.slice(0, 20) : null;
  const uiAgeMin = typeof body.ageMin === "number" ? body.ageMin : null;
  const uiAgeMax = typeof body.ageMax === "number" ? body.ageMax : null;

  let parsed: ParsedQuery | null = sanitizeParsed(body.parsed);
  let smart = parsed !== null;

  // smart:false = the instant first pass (plain FTS, no LLM) — the client
  // fires it in parallel with the smart pass and upgrades when this returns
  if (!parsed && body.smart !== false && q.length >= 4 && process.env.ANTHROPIC_API_KEY) {
    const t0 = Date.now();
    try {
      const anthropic = new Anthropic();
      const resp = await anthropic.messages.create({
        model: ROUTER_MODEL,
        max_tokens: 200,
        system: PARSE_SYSTEM,
        messages: [{ role: "user", content: q }],
      });
      const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      parsed = sanitizeParsed(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
      smart = parsed !== null;
      const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
      if (userRow) {
        await supabase.from("agent_interactions").insert({
          org_id: userRow.org_id, user_id: user.id, surface: "library.search",
          model: ROUTER_MODEL, input_tokens: resp.usage.input_tokens,
          output_tokens: resp.usage.output_tokens, latency_ms: Date.now() - t0, status: "ok",
        });
      }
    } catch {
      parsed = null; // fall back to plain FTS below
    }
  }

  // explicit UI filters always win over LLM-parsed ones
  const args = {
    q: parsed ? parsed.search ?? "" : q,
    age_min: uiAgeMin ?? parsed?.age_min ?? null,
    age_max: uiAgeMax ?? parsed?.age_max ?? null,
    tenure_f: uiTenure ?? parsed?.tenure ?? null,
    kinds: uiKinds.length ? uiKinds : parsed?.kinds?.length ? parsed.kinds : null,
    cats: uiCats.length ? uiCats : null,
    sort, off_set: offset, lim: limit,
  };

  let { data, error } = await supabase.rpc("search_personas", args);

  // smart parse can over-filter; retry once with the raw query + UI filters only
  if (!error && (data ?? []).length === 0 && smart && q && offset === 0) {
    const retry = await supabase.rpc("search_personas", {
      ...args, q,
      age_min: uiAgeMin, age_max: uiAgeMax, tenure_f: uiTenure,
      kinds: uiKinds.length ? uiKinds : null,
    });
    data = retry.data; error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as LibrarySearchRow[];
  return NextResponse.json({
    personas: rows,
    smart,
    total: rows.length ? Number(rows[0].total) : 0,
    parsed: smart ? parsed : null,
  });
}
