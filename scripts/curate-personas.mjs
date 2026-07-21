/**
 * Persona library curation (QC for CLAUDE.md §3.3 pre-generation).
 *
 *   node scripts/curate-personas.mjs report      # name stats + programmatic red flags
 *   node scripts/curate-personas.mjs fix-names   # make every full name library-unique
 *   node scripts/curate-personas.mjs audit       # LLM coherence audit of demographics (+applies field fixes)
 *
 * fix-names: keeps one persona per duplicated "First L." name, renames the
 * rest (Haiku proposes demographically-consistent names; the script enforces
 * global uniqueness and rewrites first-name references in backstory/tagline/
 * stances). audit: checks income vs role+metro, years_experience vs age and
 * tagline, credentials vs role, tenure vs cohort, metro vs state — fixes the
 * FIELDS to match the narrative, never the narrative.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {};
for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const NAME_MODEL = "claude-haiku-4-5";
const AUDIT_MODEL = "claude-haiku-4-5";

const usage = { in: 0, out: 0, calls: 0 };

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

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await sb(`/rest/v1/personas?select=id,kind,spec&org_id=is.null&source=eq.library&order=created_at.asc`, {
      headers: { Range: `${from}-${from + 999}` },
    });
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function patchSpec(id, spec) {
  await sb(`/rest/v1/personas?id=eq.${id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ spec }),
  });
}

async function llm(model, system, content, maxTokens, attempt = 0) {
  try {
    const resp = await anthropic.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] });
    usage.calls++; usage.in += resp.usage.input_tokens; usage.out += resp.usage.output_tokens;
    const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  } catch (e) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      return llm(model, system, content, maxTokens, attempt + 1);
    }
    throw e;
  }
}

function firstName(name) { return (name ?? "").split(/\s+/)[0]; }
function initialsOf(name) { return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }

function replaceFirstName(text, oldFirst, newFirst) {
  if (!text || oldFirst === newFirst) return text;
  return text.replace(new RegExp(`\\b${oldFirst.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), newFirst);
}

/** programmatic red flags, no LLM */
function redFlags(spec) {
  const d = spec.demographics ?? {};
  const flags = [];
  if (!d.age) flags.push("missing age");
  if (d.age && (d.age < 18 || d.age > 90)) flags.push(`implausible age ${d.age}`);
  if (d.age && d.years_experience && d.years_experience > d.age - 16) flags.push(`yoe ${d.years_experience} vs age ${d.age}`);
  // metro must be a bare city/metro name — the state lives in its own field
  if (d.metro && /,\s*[A-Z]{2}/.test(String(d.metro))) flags.push(`state embedded in metro "${d.metro}"`);
  const tag = (spec.tagline ?? "").match(/(\d{1,2})\s*(?:\+\s*)?(?:yrs|years)/i);
  if (tag && d.years_experience && Math.abs(Number(tag[1]) - d.years_experience) > 4) {
    flags.push(`tagline says ${tag[1]} yrs, field says ${d.years_experience}`);
  }
  return flags;
}

// ---------- report ----------
async function report(rows) {
  const byName = new Map();
  rows.forEach((r) => byName.set(r.spec.name, (byName.get(r.spec.name) ?? 0) + 1));
  const dups = [...byName.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const dupRows = dups.reduce((a, [, n]) => a + n - 1, 0);
  console.log(`${rows.length} personas · ${byName.size} distinct names · ${dups.length} duplicated names · ${dupRows} rows need renaming`);
  console.log("worst:", dups.slice(0, 8).map(([n, c]) => `${n}×${c}`).join(" · "));
  let flagged = 0;
  rows.forEach((r) => { const f = redFlags(r.spec); if (f.length) flagged++; });
  console.log(`programmatic red flags: ${flagged} personas`);
}

// ---------- fix-names ----------
const NAME_SYSTEM = `You rename synthetic personas whose names collide with others in a library. For EACH input persona, propose a NEW name in "First L." format (given name + last initial).
Rules:
- Must NOT be any name in the forbidden list, and no two outputs may share a full name.
- Keep gender consistent. Keep cultural plausibility with the persona's backstory hints and metro; realistic American diversity across many heritages.
- STRONGLY avoid these overused first names: {OVERUSED}.
- Prefer distinctive, real-world first names you have NOT used elsewhere in this reply. Vary last initials across the alphabet.
Reply ONLY a JSON array: [{"id": "...", "name": "First L."}]`;

async function fixNames(rows) {
  const used = new Set(rows.map((r) => r.spec.name));
  const firstCounts = new Map();
  rows.forEach((r) => firstCounts.set(firstName(r.spec.name), (firstCounts.get(firstName(r.spec.name)) ?? 0) + 1));
  const overused = [...firstCounts.entries()].filter(([, n]) => n >= 8).sort((a, b) => b[1] - a[1]).map(([n]) => n);

  const seen = new Set();
  const toRename = [];
  for (const r of rows) {
    if (seen.has(r.spec.name)) toRename.push(r);
    else seen.add(r.spec.name);
  }
  console.log(`${toRename.length} personas to rename · avoiding ${overused.length} overused first names`);

  const system = NAME_SYSTEM.replace("{OVERUSED}", overused.join(", "));
  let renamed = 0;
  for (let i = 0; i < toRename.length; i += 15) {
    const batch = toRename.slice(i, i + 15);
    const payload = batch.map((r) => ({
      id: r.id, current: r.spec.name, gender: r.spec.demographics?.gender ?? "unspecified",
      age: r.spec.demographics?.age, metro: r.spec.demographics?.metro, role: r.spec.role,
      backstory_hint: (r.spec.backstory ?? "").slice(0, 140),
    }));
    // forbidden: their current names + a sample of the most-collided names
    const forbidden = [...new Set([...batch.map((b) => b.spec.name), ...overused.map((f) => `${f} T.`)])];
    let proposals;
    try {
      proposals = await llm(NAME_MODEL, system, `Forbidden full names (plus everything obviously similar): ${forbidden.join("; ")}\n\nPersonas:\n${JSON.stringify(payload)}`, 1500);
    } catch (e) {
      console.log(`  ✗ batch failed: ${String(e.message).slice(0, 120)}`); continue;
    }
    const byId = new Map(proposals.map((p) => [p.id, p.name]));
    for (const r of batch) {
      let name = (byId.get(r.id) ?? "").trim();
      const valid = /^[A-Z][\w'’-]+ [A-Z]\.$/u.test(name);
      if (!valid || used.has(name)) {
        // deterministic fallback: walk last initials on the proposed first
        // name, then fall through to a fresh-first-name pool (gender-aware)
        const letters = "ABCDEFGHJKLMNPQRSTVWZ";
        const base = firstName(valid ? name : r.spec.name);
        name = "";
        for (const L of letters) {
          if (!used.has(`${base} ${L}.`)) { name = `${base} ${L}.`; break; }
        }
        if (!name) {
          const g = (r.spec.demographics?.gender ?? "").toLowerCase();
          const pool = g === "female"
            ? ["Odette", "Ingrid", "Imogen", "Zora", "Leilani", "Vera", "Petra", "Amara", "Tavia", "Maeve", "Sadie", "Wren", "Thea", "Perla", "Nadia", "Romy", "Lucille", "Bettina", "Cleo", "Salma"]
            : ["Caleb", "Mateo", "Ellis", "Declan", "Bram", "Anders", "Otis", "Callum", "Silas", "Hollis", "Ruben", "Kofi", "Emeka", "Basil", "Judah", "Grover", "Cyrus", "Alistair", "Ezra", "Yusuf"];
          outer: for (const f of pool) {
            for (const L of letters) {
              if (!used.has(`${f} ${L}.`)) { name = `${f} ${L}.`; break outer; }
            }
          }
        }
        if (!name) { console.log(`  ! could not rename ${r.spec.name}`); continue; }
      }
      used.add(name);
      const oldFirst = firstName(r.spec.name);
      const newFirst = firstName(name);
      const spec = {
        ...r.spec,
        name,
        initials: initialsOf(name),
        tagline: replaceFirstName(r.spec.tagline, oldFirst, newFirst),
        backstory: replaceFirstName(r.spec.backstory, oldFirst, newFirst),
        stances: (r.spec.stances ?? []).map((s) => replaceFirstName(s, oldFirst, newFirst)),
      };
      await patchSpec(r.id, spec);
      renamed++;
    }
    if ((i / 15) % 5 === 0 || i + 15 >= toRename.length) {
      console.log(`[${Math.min(i + 15, toRename.length)}/${toRename.length}] renamed ${renamed}`);
    }
  }
  console.log(`DONE fix-names: ${renamed} renamed · ${usage.calls} calls · ${usage.in.toLocaleString()} in / ${usage.out.toLocaleString()} out tokens`);
}

// ---------- audit ----------
const AUDIT_SYSTEM = `You audit synthetic real-estate personas for internal coherence. For EACH persona judge whether the demographics are realistic and consistent with the role, narrative, and each other:
- income_band plausible for the role/occupation AND the metro's cost structure
- years_experience consistent with age (career start ≥ ~18) and with any "N yrs" claim in the tagline (tagline wins — adjust the field)
- credentials appropriate to the role (licenses match the profession)
- tenure consistent with the role (a renter cohort persona must rent; a homeowner persona owns)
- metro and state agree; occupation makes sense for consumer/resident kinds
Reply ONLY a JSON array, one object per persona:
[{"seed_key": "...", "ok": true}] or
[{"seed_key": "...", "ok": false, "problems": ["…"], "fixes": {"income_band": "$90–120K", "years_experience": 18, ...}}]
fixes may ONLY contain demographics fields (age, gender, metro, state, years_experience, credentials, occupation, household, income_band, tenure). Change as little as possible; make fields match the persona's story. If in doubt, ok: true.`;

async function audit(rows) {
  const flagged = [];
  let fixedCount = 0, checked = 0;
  const queue = [];
  for (let i = 0; i < rows.length; i += 8) queue.push(rows.slice(i, i + 8));
  const CONC = 8;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const batch = queue.shift();
      const payload = batch.map((r) => ({
        seed_key: r.spec.seed_key, kind: r.kind, role: r.spec.role, category: r.spec.category,
        subgroup: r.spec.subgroup, tagline: r.spec.tagline, demographics: r.spec.demographics ?? {},
      }));
      let verdicts;
      try {
        verdicts = await llm(AUDIT_MODEL, AUDIT_SYSTEM, JSON.stringify(payload), 2500);
      } catch (e) {
        console.log(`  ✗ audit batch failed: ${String(e.message).slice(0, 120)}`); continue;
      }
      const byKey = new Map(verdicts.map((v) => [v.seed_key, v]));
      for (const r of batch) {
        checked++;
        const v = byKey.get(r.spec.seed_key);
        if (!v || v.ok || !v.fixes || Object.keys(v.fixes).length === 0) continue;
        const ALLOWED = ["age", "gender", "metro", "state", "years_experience", "credentials", "occupation", "household", "income_band", "tenure"];
        const fixes = Object.fromEntries(Object.entries(v.fixes).filter(([k]) => ALLOWED.includes(k)));
        if (!Object.keys(fixes).length) continue;
        flagged.push({ id: r.id, name: r.spec.name, role: r.spec.role, problems: v.problems, fixes });
        await patchSpec(r.id, { ...r.spec, demographics: { ...(r.spec.demographics ?? {}), ...fixes } });
        fixedCount++;
      }
      if (checked % 200 < 8) console.log(`[${checked}/${rows.length}] flagged+fixed ${fixedCount}`);
    }
  }));
  const reportPath = path.join(ROOT, "scripts", "audit-report.json");
  writeFileSync(reportPath, JSON.stringify(flagged, null, 2));
  const cost = (usage.in / 1e6) * 1 + (usage.out / 1e6) * 5;
  console.log(`DONE audit: ${checked} checked · ${fixedCount} personas fixed · report → scripts/audit-report.json`);
  console.log(`Tokens: ${usage.in.toLocaleString()} in / ${usage.out.toLocaleString()} out · est. $${cost.toFixed(2)}`);
}

// ---------- main ----------
const cmd = process.argv[2];
const rows = await fetchAll();
if (cmd === "report") await report(rows);
else if (cmd === "fix-names") await fixNames(rows);
else if (cmd === "audit") await audit(rows);
else console.log("usage: node scripts/curate-personas.mjs report|fix-names|audit");
