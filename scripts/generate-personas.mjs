/**
 * Persona library pre-generation (CLAUDE.md §3.3).
 *
 * Parses docs/persona-taxonomy.md (~1,100 base personas), generates a full
 * persona spec for each seat with claude-sonnet-5, and inserts them into the
 * Supabase `personas` table as global library rows (org_id null, public,
 * source 'library'). Household/demand-side sections get multiple demographic
 * variants of the same role.
 *
 * Idempotent: every seat carries a deterministic spec.seed_key; existing keys
 * are skipped, so the script is safe to re-run / resume after interruption.
 *
 *   node scripts/generate-personas.mjs --dry        # parse + count only
 *   node scripts/generate-personas.mjs --limit 2    # first 2 batches (smoke test)
 *   node scripts/generate-personas.mjs              # full run
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// ---------- env ----------
const env = {};
for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!env.ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing ANTHROPIC_API_KEY / SUPABASE keys in .env.local");
  process.exit(1);
}

const MODEL = "claude-sonnet-5"; // library quality bounds everything downstream (§6.4)
const BATCH_SIZE = 10;           // personas per model call
const CONCURRENCY = 6;
// Standard-tier chat models per kind (§6.4) — stored as spec config, not logic.
const CHAT_MODEL_BY_KIND = {
  consumer: "claude-haiku-4-5",
  resident: "claude-haiku-4-5",
  expert: "claude-sonnet-5",
  stakeholder: "claude-sonnet-5",
  adversarial: "claude-sonnet-5",
};
// Demographic variants per taxonomy section number.
const VARIANTS = { 28: 3, 29: 3, 30: 2 };

// ---------- taxonomy parsing ----------
function splitRoles(line) {
  // split on "·" but keep parenthesized groups intact
  const parts = [];
  let buf = "";
  let depth = 0;
  for (const ch of line) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "·" && depth === 0) { parts.push(buf); buf = ""; } else buf += ch;
  }
  parts.push(buf);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function expandRole(role) {
  // "city council member archetypes (pro-growth · slow-growth · …)" → one per archetype
  const m = role.match(/^(.+?)\s*\(([^)]*·[^)]*)\)$/);
  if (!m) return [role];
  const base = m[1].replace(/\s*archetypes?$/i, "").trim();
  return m[2].split("·").map((v) => `${base} — ${v.trim()}`);
}

function parseTaxonomy(md) {
  const seats = [];
  let part = "";
  let section = null;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("# ")) { part = line.slice(2); section = null; continue; }
    if (line.startsWith("## ")) {
      const title = line.slice(3);
      section = /^Modifier axes/i.test(title) ? null : title;
      continue;
    }
    if (!section) continue;
    let subgroup = null;
    let roleLine = line;
    const sub = line.match(/^\*\*(.+?):\*\*\s*(.*)$/);
    if (sub) { subgroup = sub[1]; roleLine = sub[2]; }
    if (!roleLine.includes("·") && !sub) continue;
    const secNum = parseInt(section, 10); // NaN for S/T sections
    const variants = VARIANTS[secNum] ?? 1;
    for (const rawRole of splitRoles(roleLine)) {
      for (const role of expandRole(rawRole)) {
        for (let v = 1; v <= variants; v++) {
          const seedKey = `${section}|${role}|${v}`
            .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          seats.push({ seedKey, part, section, subgroup, role, variant: v, variants });
        }
      }
    }
  }
  return seats;
}

// ---------- prompt ----------
const SYSTEM = `You are the persona foundry for Microcosm, an AI agent-swarm simulation platform for the built world. You write the synthetic people who power its expert panels and market crowds. Every persona must read like a real, specific human — never a job description with a name on it.

You will receive a list of seats (taxonomy roles). For EACH seat, return one persona object. Reply with ONLY a JSON array — no prose, no markdown fences.

Each persona object has exactly these fields:
{
  "seed_key": "<copy the seat's seed_key verbatim>",
  "kind": "expert" | "consumer" | "resident" | "stakeholder" | "adversarial",
  "name": "First L.",                  // given name + last initial, e.g. "Priya N."
  "role": "<the seat role, title-cased naturally>",
  "tagline": "<mono-style card line: '18 yrs CMBS desks · prices the exit before the entry'>",
  "discipline": "<ONE short uppercase cluster tag, e.g. CAPITAL, POWER, WATER, LEGAL, ENTITLEMENT, CONSTRUCTION, DESIGN, BROKERAGE, OPERATIONS, RESIDENT, CONSUMER, CIVIC, COMMUNITY, TECH, GTM, AG, EVENTS, MEDIA>",
  "backstory": "<120–180 words. Specific career/life narrative: where they came up, formative wins and scars, how they decide, one humanizing detail. Third person. No clichés, no 'passionate about'.>",
  "skills": ["4–8 concrete competencies, each 2–6 words"],
  "stances": ["3–5 strong first-principles positions in their voice; at least one contrarian or unpopular within their field"],
  "traits": { "risk_tolerance": 0.0-1.0, "agreeableness": 0.0-1.0, "verbosity": 0.0-1.0 },
  "demographics": {
    "age": <int, realistic for the career stage — vary widely across personas>,
    "gender": "female" | "male" | "nonbinary",
    "metro": "<US metro, e.g. 'Phoenix–Mesa, AZ'>", "state": "<2-letter>",
    "years_experience": <int, professionals only>,
    "credentials": "<licenses/certs if natural, else omit>",
    "household": "<e.g. 'married, 2 children', consumers/residents especially>",
    "income_band": "<e.g. '$95–120K', consumer/resident kinds>",
    "tenure": "owner" | "renter" | "<other>",   // consumer/resident kinds
    "occupation": "<day job, consumer/resident kinds>"
  }
}

Kind rules: professionals reasoning from checkable constraints → "expert". Households, buyers, renters, shoppers, guests → "consumer". Neighbors/community members affected by projects → "resident". Civic officials, advocates, institutional voices → "stakeholder". Any seat whose role says "adversarial" → "adversarial", and its stances must include one beginning "Instructed to oppose:".

Population realism rules:
- Names: realistic American demographic diversity (Latino, Black, Asian, South Asian, Middle Eastern, white, immigrant names). Never reuse a first name within one reply. No real famous people. STRONGLY avoid these overused first names: Marisol, Marcus, Priya, Priyanka, Desmond, Renata, Terrence, Marguerite, Harold, Rosa, Dmitri, Keisha, Darnell, Consuelo, Tamika, Rajiv. Prefer distinctive, less-common real names and vary last initials across the alphabet.
- Geography: spread across US metros appropriate to the role (a Texas MUD engineer lives in Texas; a co-op specialist in New York). Not everything in the Sun Belt.
- Ages: spread 24–78. Some early-career, some near retirement.
- When the same role appears multiple times (variant 2 of 3 etc.), make each variant demographically DISTINCT: different age bracket, metro, income, household shape, and a genuinely different life angle on the same role.
- Voices differ: some blunt, some professorial, some folksy, some data-obsessed. Taglines and stances should make two personas in the same field distinguishable at a glance.
- Personas are synthetic composites; never model a real identifiable individual.`;

function batchPrompt(batch) {
  const seats = batch.map((s, i) =>
    `${i + 1}. seed_key: ${s.seedKey}\n   role: ${s.role}${s.subgroup ? `\n   subgroup: ${s.subgroup}` : ""}${s.variants > 1 ? `\n   variant ${s.variant} of ${s.variants} — differentiate demographics strongly` : ""}`
  ).join("\n");
  return `Taxonomy category: ${batch[0].section} (part: ${batch[0].part})\n\nGenerate one persona per seat:\n${seats}\n\nReturn ONLY the JSON array of ${batch.length} persona objects.`;
}

// ---------- supabase ----------
async function sb(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json", ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** full names already in the library — enforced unique across the catalog */
const usedNames = new Set();

async function loadExistingNames() {
  for (let from = 0; ; from += 1000) {
    const res = await sb(`/rest/v1/personas?select=name:spec->>name&org_id=is.null&source=eq.library`, {
      headers: { Range: `${from}-${from + 999}` },
    });
    const rows = await res.json();
    rows.forEach((r) => r.name && usedNames.add(r.name));
    if (rows.length < 1000) break;
  }
}

/** if the proposed name collides, walk last initials until it doesn't */
function uniqueName(name) {
  if (!usedNames.has(name)) return name;
  const first = name.split(/\s+/)[0];
  for (const L of "ABCDEFGHJKLMNPQRSTVWXZ") {
    const cand = `${first} ${L}.`;
    if (!usedNames.has(cand)) return cand;
  }
  return name; // 22 collisions on one first name — accept rather than loop
}

async function existingSeedKeys() {
  const keys = new Set();
  for (let from = 0; ; from += 1000) {
    const res = await sb(`/rest/v1/personas?select=seed_key:spec->>seed_key&org_id=is.null&source=eq.library`, {
      headers: { Range: `${from}-${from + 999}`, Prefer: "count=exact" },
    });
    const rows = await res.json();
    rows.forEach((r) => r.seed_key && keys.add(r.seed_key));
    if (rows.length < 1000) break;
  }
  return keys;
}

// ---------- generation ----------
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const usage = { in: 0, out: 0, calls: 0, inserted: 0, failedBatches: 0 };

function initialsOf(name) {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function toRow(p, seat) {
  const kind = ["expert", "consumer", "resident", "stakeholder", "adversarial"].includes(p.kind) ? p.kind : "expert";
  const name = uniqueName(p.name ?? "??");
  usedNames.add(name);
  return {
    org_id: null,
    public: true,
    source: "library",
    kind,
    spec: {
      seed_key: seat.seedKey,
      kind,
      name,
      initials: initialsOf(name),
      role: p.role ?? seat.role,
      tagline: p.tagline ?? "",
      discipline: (p.discipline ?? "GENERAL").toUpperCase(),
      category: seat.section,
      subgroup: seat.subgroup ?? undefined,
      backstory: p.backstory ?? "",
      skills: Array.isArray(p.skills) ? p.skills : [],
      stances: Array.isArray(p.stances) ? p.stances : [],
      traits: p.traits ?? {},
      demographics: p.demographics ?? {},
      provenance: "library",
      version: 1,
      model: { name: CHAT_MODEL_BY_KIND[kind] },
    },
  };
}

async function generateBatch(batch, attempt = 0) {
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 12000,
      system: SYSTEM,
      messages: [{ role: "user", content: batchPrompt(batch) }],
    });
    usage.calls++;
    usage.in += resp.usage.input_tokens;
    usage.out += resp.usage.output_tokens;
    const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const start = text.indexOf("["), end = text.lastIndexOf("]");
    const arr = JSON.parse(text.slice(start, end + 1));
    const bySeed = new Map(arr.map((p) => [p.seed_key, p]));
    const rows = batch.map((seat) => bySeed.has(seat.seedKey) ? toRow(bySeed.get(seat.seedKey), seat) : null).filter(Boolean);
    if (rows.length) {
      await sb("/rest/v1/personas", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
      usage.inserted += rows.length;
    }
    if (rows.length < batch.length) console.log(`  ! batch dropped ${batch.length - rows.length} malformed personas (${batch[0].section})`);
    return rows.length;
  } catch (e) {
    const status = e?.status ?? 0;
    if ((status === 429 || status === 500 || status === 529 || /JSON|Unexpected/i.test(String(e?.message))) && attempt < 5) {
      const retryAfter = Number(e?.headers?.get?.("retry-after")) || 0;
      const wait = Math.max(retryAfter * 1000, 2000 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, wait));
      return generateBatch(batch, attempt + 1);
    }
    usage.failedBatches++;
    console.log(`  ✗ batch failed permanently (${batch[0].section} · ${batch[0].role}): ${String(e?.message).slice(0, 160)}`);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const limitIx = args.indexOf("--limit");
  const limit = limitIx >= 0 ? parseInt(args[limitIx + 1], 10) : Infinity;

  const md = readFileSync(path.join(ROOT, "docs/persona-taxonomy.md"), "utf8");
  const seats = parseTaxonomy(md);
  console.log(`Parsed ${seats.length} seats from taxonomy.`);

  if (dry) {
    const byPart = {};
    seats.forEach((s) => (byPart[s.part] = (byPart[s.part] ?? 0) + 1));
    Object.entries(byPart).forEach(([p, n]) => console.log(`  ${n}  ${p}`));
    return;
  }

  const existing = await existingSeedKeys();
  await loadExistingNames();
  const todo = seats.filter((s) => !existing.has(s.seedKey));
  console.log(`${existing.size} already in library · ${todo.length} to generate.`);

  // batches grouped by section so each call shares category context
  const batches = [];
  const bySection = new Map();
  todo.forEach((s) => {
    if (!bySection.has(s.section)) bySection.set(s.section, []);
    bySection.get(s.section).push(s);
  });
  for (const group of bySection.values()) {
    for (let i = 0; i < group.length; i += BATCH_SIZE) batches.push(group.slice(i, i + BATCH_SIZE));
  }
  const run = batches.slice(0, limit);
  console.log(`${run.length} batches of ≤${BATCH_SIZE} · model ${MODEL} · concurrency ${CONCURRENCY}`);

  let done = 0;
  const t0 = Date.now();
  const queue = [...run];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const batch = queue.shift();
      await generateBatch(batch);
      done++;
      if (done % 5 === 0 || queue.length === 0) {
        const mins = ((Date.now() - t0) / 60000).toFixed(1);
        console.log(`[${done}/${run.length}] ${usage.inserted} personas inserted · ${mins} min · ${(usage.out / 1000).toFixed(0)}K out-tokens`);
      }
    }
  }));

  const cost = (usage.in / 1e6) * 3 + (usage.out / 1e6) * 15; // sonnet $3/$15 per MTok
  console.log(`\nDONE: ${usage.inserted} inserted · ${usage.failedBatches} failed batches · ${usage.calls} calls`);
  console.log(`Tokens: ${usage.in.toLocaleString()} in / ${usage.out.toLocaleString()} out · est. $${cost.toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
