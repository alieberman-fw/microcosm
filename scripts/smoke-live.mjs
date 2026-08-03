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
const KEEP = args.includes("--keep");        // skip cleanup + print the session (manual UI verification)
const SKIP_FORUM = args.includes("--no-forum"); // matrix only
const SKIP_WALKAWAY = args.includes("--no-walkaway"); // 3c detach + stop checks
const SKIP_TOOLS = args.includes("--no-tools");       // 3d web-research check

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

  // FOCUSED density = the structural v1 counts the matrix pins; the living-
  // forum check below exercises lively separately
  const pc = await app(`/api/simulations/${simId}/config`, {
    method: "PATCH",
    body: JSON.stringify({ mode, run: { rounds: ROUNDS, max_posts: 60, tier: "economy", convergence: "fixed", verifier: false, report_length: "brief", speaker: "round-robin", temperature: "balanced", density: "focused" } }),
  });
  if (!pc.ok) throw new Error(`config failed: ${pc.status} ${await pc.text()}`);

  // launch + follow continuations. A chained handoff (3c) means the server
  // took over — stop driving, tail the database like a closed tab would.
  let posts = 0, stop = null, pollRounds = new Set(), errored = null, finished = false, chainedOff = false, toolEvents = 0;
  for (let slice = 0; slice < 6 && !finished && !errored && !chainedOff; slice++) {
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
        else if (e.type === "tool") toolEvents += 1;
        else if (e.type === "stage" && (e.value === "done" || e.value === "converged")) stop = e.detail ?? null;
        else if (e.type === "finished") finished = true;
        else if (e.type === "continue") { wantsContinue = true; if (e.chained) chainedOff = true; }
        else if (e.type === "error") errored = e.error;
      }
    }
    if (!wantsContinue) break;
  }
  if (chainedOff && !finished && !errored) {
    for (let waited = 0; waited < 360_000 && !finished; waited += 5000) {
      await sleep(5000);
      const r = await admin(`/rest/v1/simulations?id=eq.${simId}&select=status,config`);
      const row = (await r.json())[0];
      if (row?.status !== "running") {
        finished = row?.status === "complete";
        stop = row?.config?.run_result?.stop ?? stop;
        break;
      }
    }
    const rp = await admin(`/rest/v1/posts?sim_id=eq.${simId}&select=seq`);
    posts = (await rp.json()).length;
    const re = await admin(`/rest/v1/events?sim_id=eq.${simId}&type=eq.sentiment&select=payload`);
    pollRounds = new Set((await re.json()).map((x) => x.payload.round));
  }

  const exp = EXPECT[mode];
  const polls = [...pollRounds].sort((a, b) => a - b);
  const problems = [];
  if (errored) problems.push(`run errored: ${errored}`);
  if (!finished) problems.push("never reached finished");
  if (posts < exp.postsMin || posts > exp.postsMax) problems.push(`posts ${posts} (want ${exp.postsMin}–${exp.postsMax})`);
  if (stop !== exp.stop) problems.push(`stop "${stop}" (want "${exp.stop}")`);
  if (JSON.stringify(polls) !== JSON.stringify(exp.polls)) problems.push(`polls [${polls}] (want [${exp.polls}])`);
  // 3d — default OFF is a contract: an un-configured run must never touch a tool
  if (toolEvents > 0) problems.push(`tool events ${toolEvents} on a default run (tools are OFF by default)`);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (problems.length) {
    failures.push({ mode, problems });
    console.log(`✗ ${mode.padEnd(10)} ${posts} posts · stop ${stop} · polls [${polls}] · ${secs}s — ${problems.join("; ")}`);
  } else {
    console.log(`✓ ${mode.padEnd(10)} ${posts} posts · stop ${stop} · polls [${polls}] · ${secs}s`);
  }
  return simId;
}

/** Phase-2 living-forum check: an Agora run at LIVELY must produce threaded
 *  chains (depth ≥ 2), crowd interjections, and vote events — then Take the
 *  Floor must get an in-context reply. Returns the simId (kept for --keep). */
async function livingForumCheck(personas) {
  const t0 = Date.now();
  const cr = await app("/api/simulations", {
    method: "POST",
    body: JSON.stringify({ problem: PROBLEM, questions: [{ label: "POOL VS FINISHES", detail: "which spend returns more at sale?" }], success: ["A committed answer"] }),
  });
  const simId = (await cr.json()).id;
  simIds.push(simId);
  await app(`/api/simulations/${simId}/agents`, { method: "POST", body: JSON.stringify({ personaIds: personas.leadIds, crowdPersonaIds: personas.crowdIds }) });
  await app(`/api/simulations/${simId}/config`, {
    method: "PATCH",
    body: JSON.stringify({ mode: "Agora", run: { rounds: 2, max_posts: 80, tier: "economy", convergence: "fixed", verifier: false, report_length: "brief", speaker: "round-robin", density: "lively" } }),
  });

  const postEvents = []; let voteEvents = 0; let finished = false; let chainedOff = false;
  for (let slice = 0; slice < 6 && !finished && !chainedOff; slice++) {
    const res = await app(`/api/simulations/${simId}/run/launch`, { method: "POST", body: JSON.stringify(slice ? { continue: true } : {}) });
    if (!res.ok) throw new Error(`lively launch failed: ${res.status}`);
    let wantsContinue = false;
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        if (e.type === "post") postEvents.push(e);
        else if (e.type === "votes") voteEvents += 1;
        else if (e.type === "finished") finished = true;
        else if (e.type === "continue") { wantsContinue = true; if (e.chained) chainedOff = true; }
        else if (e.type === "error") throw new Error(`lively run errored: ${e.error}`);
      }
    }
    if (!wantsContinue) break;
  }
  if (chainedOff && !finished) {
    // 3c: the server took over — tail the DB, then hydrate the assertions
    // from the persisted transcript (same fields the stream carried)
    for (let waited = 0; waited < 360_000 && !finished; waited += 5000) {
      await sleep(5000);
      const r = await admin(`/rest/v1/simulations?id=eq.${simId}&select=status`);
      const st = (await r.json())[0]?.status;
      if (st !== "running") { finished = st === "complete"; break; }
    }
    const rp = await admin(`/rest/v1/posts?sim_id=eq.${simId}&select=seq,reply_to,tag,agent_key,cites&order=seq`);
    postEvents.length = 0;
    for (const r of await rp.json()) {
      postEvents.push({ seq: r.seq, reply_to: r.reply_to, tag: r.tag, agent_key: r.agent_key, name: r.cites?.name });
    }
    const rv = await admin(`/rest/v1/events?sim_id=eq.${simId}&type=eq.votes&select=payload`);
    voteEvents = (await rv.json()).length;
  }

  // threading depth from reply_to chains
  const bySeq = new Map(postEvents.map((p) => [p.seq, p]));
  const depthOf = (seq) => { let d = 0, cur = bySeq.get(seq); while (cur?.reply_to != null && d < 20) { d += 1; cur = bySeq.get(cur.reply_to); } return d; };
  const maxDepth = Math.max(...postEvents.map((p) => depthOf(p.seq)));
  const interjections = postEvents.filter((p) => p.tag === "INTERJECTION").length;
  const leadPosts = postEvents.filter((p) => p.tag !== "INTERJECTION").length;

  // Take the Floor: mention the first lead by agent_key
  const seat = await admin(`/rest/v1/sim_agents?sim_id=eq.${simId}&select=agent_key,spec_frozen&limit=1`);
  const firstSeat = (await seat.json())[0];
  const fl = await app(`/api/simulations/${simId}/floor`, {
    method: "POST",
    body: JSON.stringify({ content: "Before I decide: what single number would change your answer?", mentions: [firstSeat.agent_key] }),
  });
  let floorReplies = 0;
  if (fl.ok) {
    for (const line of (await fl.text()).split("\n")) {
      try { if (JSON.parse(line).type === "post") floorReplies += 1; } catch { /* not json */ }
    }
  }

  // forum-quality invariants (the Benjamin K. regression suite, live)
  const leadOnly = postEvents.filter((p) => p.tag !== "INTERJECTION");
  const distinctAuthors = new Set(leadOnly.map((p) => p.agent_key)).size;
  let consecutiveDupes = 0;
  for (let i = 1; i < leadOnly.length; i++) {
    if (leadOnly[i].agent_key === leadOnly[i - 1].agent_key) consecutiveDupes += 1;
  }

  const problems = [];
  if (!finished) problems.push("never finished");
  if (leadPosts < 14) problems.push(`lead posts ${leadPosts} (want ≥14: 2×(1+6))`);
  if (maxDepth < 2) problems.push(`max chain depth ${maxDepth} (want ≥2)`);
  if (interjections < 3) problems.push(`interjections ${interjections} (want ≥3)`);
  if (voteEvents < 2) problems.push(`vote events ${voteEvents} (want ≥2: realtime micro + close)`);
  if (floorReplies < 1) problems.push(`floor got ${floorReplies} replies (want ≥1)`);
  if (distinctAuthors < 4) problems.push(`only ${distinctAuthors}/4 leads spoke`);
  if (consecutiveDupes > 0) problems.push(`${consecutiveDupes} consecutive same-author posts`);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (problems.length) {
    failures.push({ mode: "living-forum", problems });
    console.log(`✗ living-forum ${leadPosts}+${interjections} posts · depth ${maxDepth} · votes ${voteEvents} · floor ${floorReplies} · ${secs}s — ${problems.join("; ")}`);
  } else {
    console.log(`✓ living-forum ${leadPosts} lead + ${interjections} interjection posts · chain depth ${maxDepth} · ${voteEvents} vote rounds · floor ${floorReplies} repl${floorReplies === 1 ? "y" : "ies"} · ${secs}s`);
  }
  return simId;
}

/** 3c — walk-away semantics: kill the stream right after the first post and
 *  the run must finish server-side on its own (the stream is a WINDOW, not
 *  the engine's home). Then a fresh run on the same sim gets a graceful
 *  STOP: complete status, honest "stopped" reason, transcript preserved. */
async function walkAwayCheck(personas) {
  const t0 = Date.now();
  const cr = await app("/api/simulations", {
    method: "POST",
    body: JSON.stringify({ problem: PROBLEM, questions: [{ label: "POOL VS FINISHES", detail: "which spend returns more at sale?" }], success: ["A committed answer"] }),
  });
  if (!cr.ok) throw new Error(`walkaway: create sim failed: ${cr.status}`);
  const simId = (await cr.json()).id;
  simIds.push(simId);
  const seat = await app(`/api/simulations/${simId}/agents`, {
    method: "POST",
    body: JSON.stringify({ personaIds: personas.leadIds, crowdPersonaIds: personas.crowdIds }),
  });
  if (!seat.ok) throw new Error(`walkaway: seat failed: ${seat.status}`);
  const pc = await app(`/api/simulations/${simId}/config`, {
    method: "PATCH",
    body: JSON.stringify({ mode: "Agora", run: { rounds: ROUNDS, max_posts: 60, tier: "economy", convergence: "fixed", verifier: false, report_length: "brief", speaker: "round-robin", temperature: "balanced", density: "focused" } }),
  });
  if (!pc.ok) throw new Error(`walkaway: config failed: ${pc.status}`);

  const launchAndDrop = async (body) => {
    const res = await app(`/api/simulations/${simId}/run/launch`, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`walkaway: launch failed: ${res.status} ${await res.text()}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        if (e.type === "post") break outer;              // first post landed — "close the tab"
        if (e.type === "error") throw new Error(`walkaway: run error: ${e.error}`);
      }
    }
    await reader.cancel().catch(() => {});
  };
  const pollDone = async (maxMs) => {
    let waited = 0;
    for (;;) {
      await sleep(5000);
      waited += 5000;
      const r = await admin(`/rest/v1/simulations?id=eq.${simId}&select=status,config`);
      const row = (await r.json())[0];
      if (row?.status !== "running") return row;
      if (waited > maxMs) return row;
    }
  };
  const countPosts = async () => {
    const r = await admin(`/rest/v1/posts?sim_id=eq.${simId}&select=seq`);
    return (await r.json()).length;
  };

  const problems = [];
  // 1 · detach: the run must complete with NOBODY watching
  await launchAndDrop({});
  const row1 = await pollDone(300_000);
  const posts1 = await countPosts();
  const rr1 = row1?.config?.run_result ?? {};
  if (row1?.status !== "complete") problems.push(`detached run ended "${row1?.status}" (want complete)`);
  if (posts1 < EXPECT.Agora.postsMin) problems.push(`detached run persisted ${posts1} posts (want ≥${EXPECT.Agora.postsMin})`);
  if (rr1.stop !== "rounds") problems.push(`detached run stop "${rr1.stop}" (want rounds)`);

  // 2 · graceful stop: re-run, drop the stream, request a stop mid-flight
  await launchAndDrop({});
  await app(`/api/simulations/${simId}/run/stop`, { method: "POST" });
  const row2 = await pollDone(240_000);
  const rr2 = row2?.config?.run_result ?? {};
  const posts2 = await countPosts();
  if (row2?.status !== "complete") problems.push(`stopped run ended "${row2?.status}" (want complete)`);
  if (rr2.stop !== "stopped") problems.push(`stopped run reason "${rr2.stop}" (want stopped)`);
  if (posts2 < 1) problems.push("stopped run preserved no posts");

  const secs = Math.round((Date.now() - t0) / 1000);
  if (problems.length) {
    failures.push({ mode: "walk-away", problems });
    console.log(`✗ walk-away  ${problems.join("; ")} · ${secs}s`);
  } else {
    console.log(`✓ walk-away  detached run completed alone (${posts1} posts · stop ${rr1.stop}) · graceful stop honored (${posts2} posts · stop ${rr2.stop}) · ${secs}s`);
  }
  return simId;
}

/** 3d — agent tools: a run with web research ENABLED on a current-facts brief
 *  must produce at least one search that lands in the feed events, tool_runs,
 *  and the report's inputs. (Default-OFF is asserted inside runOne.) */
async function toolsCheck(personas) {
  const t0 = Date.now();
  const cr = await app("/api/simulations", {
    method: "POST",
    body: JSON.stringify({
      problem: "Smoke test: is now a sensible quarter for a small Sun Belt developer to lock a construction loan, given CURRENT interest rates? Use today's actual rate environment.",
      questions: [{ label: "RATE TIMING", detail: "what do current rates say about locking now vs waiting?" }],
      success: ["A committed answer grounded in the current rate environment"],
    }),
  });
  if (!cr.ok) throw new Error(`tools: create sim failed: ${cr.status}`);
  const simId = (await cr.json()).id;
  simIds.push(simId);
  const seat = await app(`/api/simulations/${simId}/agents`, {
    method: "POST",
    body: JSON.stringify({ personaIds: personas.leadIds.slice(0, 3) }),
  });
  if (!seat.ok) throw new Error(`tools: seat failed: ${seat.status}`);
  const pc = await app(`/api/simulations/${simId}/config`, {
    method: "PATCH",
    body: JSON.stringify({
      mode: "Roundtable",
      run: { rounds: 1, max_posts: 30, tier: "economy", convergence: "fixed", verifier: false, report_length: "brief", speaker: "round-robin", temperature: "balanced", density: "focused" },
      tools: ["web_search"],
    }),
  });
  if (!pc.ok) throw new Error(`tools: config failed: ${pc.status}`);

  let toolEvents = 0, finished = false, errored = null, chainedOff = false;
  for (let slice = 0; slice < 4 && !finished && !errored && !chainedOff; slice++) {
    const res = await app(`/api/simulations/${simId}/run/launch`, { method: "POST", body: JSON.stringify(slice ? { continue: true } : {}) });
    if (!res.ok) throw new Error(`tools: launch failed: ${res.status} ${await res.text()}`);
    let wantsContinue = false;
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        if (e.type === "tool") toolEvents += 1;
        else if (e.type === "finished") finished = true;
        else if (e.type === "continue") { wantsContinue = true; if (e.chained) chainedOff = true; }
        else if (e.type === "error") errored = e.error;
      }
    }
    if (!wantsContinue) break;
  }
  if (chainedOff && !finished) {
    for (let waited = 0; waited < 300_000 && !finished; waited += 5000) {
      await sleep(5000);
      const r = await admin(`/rest/v1/simulations?id=eq.${simId}&select=status`);
      const st = (await r.json())[0]?.status;
      if (st !== "running") { finished = st === "complete"; break; }
    }
    const rt = await admin(`/rest/v1/events?sim_id=eq.${simId}&type=eq.tool&select=payload`);
    toolEvents = (await rt.json()).length;
  }
  const tr = await admin(`/rest/v1/tool_runs?sim_id=eq.${simId}&select=id,input`);
  const toolRuns = await tr.json();
  const problems = [];
  if (errored) problems.push(`run errored: ${errored}`);
  if (!finished) problems.push("never finished");
  if (toolEvents < 1) problems.push("no tool events — the panel never searched a current-rates brief");
  if (toolRuns.length !== toolEvents) problems.push(`tool_runs ${toolRuns.length} ≠ tool events ${toolEvents}`);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (problems.length) {
    failures.push({ mode: "agent-tools", problems });
    console.log(`✗ agent-tools ${problems.join("; ")} · ${secs}s`);
  } else {
    console.log(`✓ agent-tools ${toolEvents} search${toolEvents === 1 ? "" : "es"} (e.g. "${String(toolRuns[0]?.input?.query ?? "").slice(0, 60)}") · persisted to tool_runs · ${secs}s`);
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
  const spec = (await row.json())[0]?.spec;
  const verdict = spec?.verdict?.label ?? null;
  const problems = [];
  if (!verdict) problems.push("no verdict.label");
  // 3a contract: bottom line + a direct answer on every section
  if (!spec?.bottom_line?.answer || !spec?.bottom_line?.next_step) problems.push("no bottom_line");
  if (!Array.isArray(spec?.sections) || spec.sections.some((s) => !s.answer)) problems.push("sections missing direct answers");
  // poll instrument: a crowd run must record WHAT the crowd was asked
  if ((spec?.sentiment?.length ?? 0) > 0 && !spec?.poll_question) problems.push("sentiment present but no poll_question");
  // 3b: every fresh synthesis must pick a typed lead kind
  if (!["decision", "key_finding", "price_range", "approval_odds"].includes(spec?.lead?.kind)) {
    problems.push(`lead kind missing/invalid (${spec?.lead?.kind})`);
  }
  if (problems.length) {
    failures.push({ mode: "report", problems });
    console.log(`✗ report     ${problems.join("; ")}`);
    return;
  }
  console.log(`✓ report     verdict "${verdict}" · lead ${spec.lead.kind} · bottom line + ${spec.sections.length} direct answers${spec.poll_question ? ` · asked "${String(spec.poll_question).slice(0, 60)}…"` : ""}`);

  // the PLAIN ENGLISH toggle: translation generated, gated, and cached
  const pl = await app(`/api/reports/${reportId}/plain`, { method: "POST" });
  const plBody = await pl.json().catch(() => ({}));
  if (!pl.ok || !plBody.plain?.bottom_line?.answer || (plBody.plain?.sections?.length ?? 0) < spec.sections.length) {
    failures.push({ mode: "report-plain", problems: [`plain ${pl.status}: ${(plBody.error ?? "missing fields")}`] });
    console.log(`✗ plain      ${pl.status}`);
  } else {
    const again = await app(`/api/reports/${reportId}/plain`, { method: "POST" });
    const cached = (await again.json()).cached === true;
    console.log(`✓ plain      ${plBody.plain.sections.length} sections · ${plBody.plain.glossary?.length ?? 0} glossary terms · cached=${cached}`);
    if (!cached) failures.push({ mode: "report-plain", problems: ["second call was not served from cache"] });
  }
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
  let forumSim = null;
  if (!SKIP_FORUM) forumSim = await livingForumCheck(personas);
  if (!SKIP_WALKAWAY) {
    try { await walkAwayCheck(personas); } catch (e) { failures.push({ mode: "walk-away", problems: [String(e.message ?? e)] }); }
  }
  if (!SKIP_TOOLS) {
    try { await toolsCheck(personas); } catch (e) { failures.push({ mode: "agent-tools", problems: [String(e.message ?? e)] }); }
  }
  if (KEEP && (forumSim || firstSim)) {
    console.log(`\n--keep: session preserved for manual UI verification`);
    console.log(`  run screen: ${BASE}/sim/${forumSim ?? firstSim}/run`);
    console.log(`  cookie: ${cookie}`);
    console.log(`  CLEANUP IS ON YOU: re-run without --keep, or delete the smoke user + disable email manually`);
  }
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
  if (KEEP) {
    console.log("• --keep: skipping cleanup AND leaving email enabled — clean up when done");
  } else {
    try { await cleanup(); } catch (e) { console.error("cleanup issue:", e.message ?? e); }
    // NON-NEGOTIABLE: production auth is Google-only — always re-disable email
    if (emailEnabled) {
      const r = await mgmtAuth({ external_email_enabled: false });
      console.log(r.ok ? "• email provider re-disabled" : `!! FAILED to re-disable email provider (${r.status}) — disable manually NOW`);
      if (!r.ok) exitCode = 1;
    }
  }
}
process.exit(exitCode);
