#!/usr/bin/env node
/**
 * smoke-live.mjs — the Phase-1 live sweep (docs/next-level-plan.md §1a).
 *
 * Runs ALL SEVEN interaction modes end-to-end against a real deployment with
 * real model calls at the smallest honest size (4 leads · 8 crowd · 2 rounds
 * · economy tier ≈ well under $1 total), asserting per-mode post counts,
 * poll placement, and stop reasons — the same contract the offline matrix
 * (tests/engine/modes.test.ts) pins — then synthesizes one report and cleans
 * up EVERYTHING it created.
 *
 * Usage:
 *   node scripts/smoke-live.mjs [--base http://localhost:3000] [--modes Agora,Desk]
 *
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN (Management API — email
 * provider toggle). The email provider is enabled ONLY for the throwaway
 * password-grant user and ALWAYS re-disabled, even on failure — production
 * auth stays Google-only.
 */

import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

/* ------------------------------- setup ---------------------------------- */

const args = process.argv.slice(2);
const argOf = (flag, fb) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fb;
};
const BASE = argOf("--base", "http://localhost:3000").replace(/\/$/, "");
const ONLY = argOf("--modes", "").split(",").map((s) => s.trim()).filter(Boolean);

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT = env.SUPABASE_ACCESS_TOKEN;
if (!SUPA_URL || !ANON || !SERVICE || !MGMT) {
  console.error("Missing Supabase env (.env.local): URL / ANON / SERVICE_ROLE / ACCESS_TOKEN");
  process.exit(1);
}
const REF = new URL(SUPA_URL).hostname.split(".")[0];

const admin = (path, init = {}) =>
  fetch(`${SUPA_URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });

const mgmtAuth = (body) =>
  fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/* ------------------------- per-mode expectations ------------------------- */
/* 4 leads · 8 crowd · 2 rounds — mirror of tests/engine/modes.test.ts.
 * postsMin/postsMax tolerate the one non-structural count (a Jury tally
 * needs ≥1 parseable score). */

const LEADS = 4, CROWD = 8, ROUNDS = 2;
const EXPECT = {
  Agora:      { postsMin: 8,  postsMax: 8,  stop: "rounds",       polls: [1, 2] },
  Roundtable: { postsMin: 8,  postsMax: 8,  stop: "rounds",       polls: [1, 2] },
  Tribunal:   { postsMin: 10, postsMax: 10, stop: "rounds",       polls: [1, 2] },
  Jury:       { postsMin: 8,  postsMax: 10, stop: "rounds",       polls: [1, 2] },
  Chamber:    { postsMin: 9,  postsMax: 9,  stop: "choreography", polls: [1, 3] },
  Desk:       { postsMin: 5,  postsMax: 5,  stop: "choreography", polls: [] },
  Expedition: { postsMin: 15, postsMax: 15, stop: "choreography", polls: [] },
};
const MODES = (ONLY.length ? ONLY : Object.keys(EXPECT)).filter((m) => EXPECT[m]);

const PROBLEM =
  "Smoke test: a builder in Beverly Hills has $160K left — build the pool or upgrade kitchen and primary-bath finishes? " +
  "Goal is maximum profit on the spec build; no splitting the budget.";

/* --------------------------------- state --------------------------------- */

let emailEnabled = false;
let uid = null, orgId = null, cookie = null;
const simIds = [];
const failures = [];

const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const app = (path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { Cookie: cookie, "Content-Type": "application/json", ...(init.headers ?? {}) } });

/* -------------------------------- phases --------------------------------- */

async function setupUser() {
  console.log("• enabling email provider (throwaway user only — re-disabled at the end)");
  const r = await mgmtAuth({ external_email_enabled: true });
  if (!r.ok) throw new Error(`Management API enable failed: ${r.status} ${await r.text()}`);
  emailEnabled = true;
  await sleep(16_000); // config propagation

  const email = `smoke-${Date.now()}@example.com`;
  const password = `Smoke-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const cu = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!cu.ok) throw new Error(`admin create user failed: ${cu.status} ${await cu.text()}`);
  uid = (await cu.json()).id;

  const tok = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!tok.ok) throw new Error(`password grant failed: ${tok.status} ${await tok.text()}`);
  const session = await tok.json();
  cookie = `sb-${REF}-auth-token=base64-${b64url(JSON.stringify(session))}`;

  for (let i = 0; i < 20 && !orgId; i++) { // signup trigger provisions the org
    const u = await admin(`/rest/v1/users?id=eq.${uid}&select=org_id`);
    orgId = (await u.json())[0]?.org_id ?? null;
    if (!orgId) await sleep(1000);
  }
  if (!orgId) throw new Error("org never provisioned for smoke user");
  console.log(`• smoke user ready (${email})`);
}

async function pickPersonas() {
  const r = await admin(`/rest/v1/personas?org_id=is.null&select=id&limit=${LEADS + CROWD}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length < LEADS + CROWD) throw new Error(`library too small: got ${rows?.length}`);
  return { leadIds: rows.slice(0, LEADS).map((x) => x.id), crowdIds: rows.slice(LEADS, LEADS + CROWD).map((x) => x.id) };
}

async function runOne(mode, personas) {
  const t0 = Date.now();
  const cr = await app("/api/simulations", {
    method: "POST",
    body: JSON.stringify({ problem: PROBLEM, questions: [{ label: "POOL VS FINISHES", detail: "which spend returns more at sale?" }], success: ["A committed answer with a dollar rationale"] }),
  });
  if (!cr.ok) throw new Error(`create sim failed: ${cr.status} ${await cr.text()}`);
  const simId = (await cr.json()).id;
  simIds.push(simId);

  const seat = await app(`/api/simulations/${simId}/agents`, {
    method: "POST",
    body: JSON.stringify({ personaIds: personas.leadIds, crowdPersonaIds: personas.crowdIds }),
  });
  if (!seat.ok) throw new Error(`seat panel failed: ${seat.status} ${await seat.text()}`);

  const pc = await app(`/api/simulations/${simId}/config`, {
    method: "PATCH",
    body: JSON.stringify({ mode, run: { rounds: ROUNDS, max_posts: 60, tier: "economy", convergence: "fixed", verifier: false, report_length: "brief", speaker: "round-robin", temperature: "balanced" } }),
  });
  if (!pc.ok) throw new Error(`config failed: ${pc.status} ${await pc.text()}`);

  // launch + follow chunked continuations
  let posts = 0, stop = null, pollRounds = new Set(), errored = null, finished = false;
  for (let slice = 0; slice < 6 && !finished && !errored; slice++) {
    const res = await app(`/api/simulations/${simId}/run/launch`, { method: "POST", body: JSON.stringify(slice ? { continue: true } : {}) });
    if (!res.ok) throw new Error(`launch failed: ${res.status} ${await res.text()}`);
    let wantsContinue = false;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        if (e.type === "post") posts += 1;
        else if (e.type === "sentiment") pollRounds.add(e.round);
        else if (e.type === "stage" && (e.value === "done" || e.value === "converged")) stop = e.detail ?? null;
        else if (e.type === "finished") finished = true;
        else if (e.type === "continue") wantsContinue = true;
        else if (e.type === "error") errored = e.error;
      }
    }
    if (!wantsContinue) break;
  }

  const exp = EXPECT[mode];
  const polls = [...pollRounds].sort((a, b) => a - b);
  const problems = [];
  if (errored) problems.push(`run errored: ${errored}`);
  if (!finished) problems.push("never reached finished");
  if (posts < exp.postsMin || posts > exp.postsMax) problems.push(`posts ${posts} (want ${exp.postsMin}–${exp.postsMax})`);
  if (stop !== exp.stop) problems.push(`stop "${stop}" (want "${exp.stop}")`);
  if (JSON.stringify(polls) !== JSON.stringify(exp.polls)) problems.push(`polls [${polls}] (want [${exp.polls}])`);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (problems.length) {
    failures.push({ mode, problems });
    console.log(`✗ ${mode.padEnd(10)} ${posts} posts · stop ${stop} · polls [${polls}] · ${secs}s — ${problems.join("; ")}`);
  } else {
    console.log(`✓ ${mode.padEnd(10)} ${posts} posts · stop ${stop} · polls [${polls}] · ${secs}s`);
  }
  return simId;
}

async function synthesizeReport(simId) {
  const r = await app(`/api/simulations/${simId}/report`, { method: "POST" });
  let reportId = null, streamErr = null;
  if (r.ok) {
    // the synthesis stream ends with {type:"done", reportId} — the spec lives in the reports table
    for (const line of (await r.text()).split("\n")) {
      try {
        const e = JSON.parse(line);
        if (e.type === "done") reportId = e.reportId;
        if (e.type === "error") streamErr = e.error;
      } catch { /* progress lines */ }
    }
  }
  if (!r.ok || streamErr || !reportId) {
    failures.push({ mode: "report", problems: [streamErr ?? `synthesis HTTP ${r.status}, no done event`] });
    return;
  }
  const row = await admin(`/rest/v1/reports?id=eq.${reportId}&select=spec`);
  const verdict = (await row.json())[0]?.spec?.verdict?.label ?? null;
  if (!verdict) failures.push({ mode: "report", problems: ["stored report has no verdict.label"] });
  else console.log(`✓ report     verdict "${verdict}"`);
}

async function cleanup() {
  console.log("• cleanup");
  for (const id of simIds) {
    try { await app(`/api/simulations/${id}`, { method: "DELETE" }); } catch { /* keep going */ }
  }
  if (orgId) {
    for (const t of ["agent_interactions", "personas", "persona_sets", "conversations", "projects"]) {
      try { await admin(`/rest/v1/${t}?org_id=eq.${orgId}`, { method: "DELETE" }); } catch { /* keep going */ }
    }
  }
  if (uid) {
    try { await admin(`/rest/v1/users?id=eq.${uid}`, { method: "DELETE" }); } catch { /* keep going */ }
    try { await admin(`/auth/v1/admin/users/${uid}`, { method: "DELETE" }); } catch { /* keep going */ }
  }
  if (orgId) {
    try { await admin(`/rest/v1/orgs?id=eq.${orgId}`, { method: "DELETE" }); } catch { /* keep going */ }
  }
}

/* --------------------------------- main ---------------------------------- */

let exitCode = 0;
try {
  console.log(`Smoke sweep → ${BASE} · modes: ${MODES.join(", ")}`);
  await setupUser();
  const personas = await pickPersonas();
  let firstSim = null;
  for (const mode of MODES) {
    try {
      const id = await runOne(mode, personas);
      firstSim = firstSim ?? id;
    } catch (e) {
      failures.push({ mode, problems: [String(e.message ?? e)] });
      console.log(`✗ ${mode} — ${e.message ?? e}`);
    }
  }
  if (firstSim) await synthesizeReport(firstSim);
  if (failures.length) {
    exitCode = 1;
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  ${f.mode}: ${f.problems.join("; ")}`);
  } else {
    console.log("\nAll modes passed.");
  }
} catch (e) {
  exitCode = 1;
  console.error("Smoke sweep aborted:", e.message ?? e);
} finally {
  try { await cleanup(); } catch (e) { console.error("cleanup issue:", e.message ?? e); }
  // NON-NEGOTIABLE: production auth is Google-only — always re-disable email
  if (emailEnabled) {
    const r = await mgmtAuth({ external_email_enabled: false });
    console.log(r.ok ? "• email provider re-disabled" : `!! FAILED to re-disable email provider (${r.status}) — disable manually NOW`);
    if (!r.ok) exitCode = 1;
  }
}
process.exit(exitCode);
