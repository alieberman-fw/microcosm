import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { normalizeQuestions, normalizeSuccess } from "@/lib/corpus";
import { RUN_DEFAULTS, RunConfig, TIER_MODELS } from "@/lib/run";
import { REPORT_DIRECTOR_SCHEMA, REPORT_JSON_SCHEMA, REPORT_VERSION, ReportLength, ReportSpec, REPORT_BLOCKS_SCHEMA, blocksSpecFor, blocksSynthSystem, clipText, judgePatchSystem, judgeSystem, mergePatchedBlocks, mergePatchedSections, normalizeBlocks, parseJudgeVerdict, reportSpecIncomplete, reportSynthSystem, resolveReportMedia, sectionWorkerSystem, synthBudgetFor, synthesizePlain, verifierSystem } from "@/lib/report";
import { BriefContract } from "@/lib/understand";
import { parseLooseArray, parseLooseObject } from "@/lib/llm-json";
import { normalizeEnabledTools } from "@/lib/tools";
import { synthTicker } from "@/lib/synth-progress";

export const maxDuration = 800; // the synthesis ladder may run a dense Opus pass more than once

const FILES_BETA = "files-api-2025-04-14";

/**
 * Synthesize the report (CLAUDE.md §8) from the persisted transcript.
 * ND-JSON stages: outline → compile → verify → done {reportId}.
 * The verifier (§4.1) audits numeric claims against the corpus when enabled.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const { data: sim } = await supabase.from("simulations").select("id, brief, config, status").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const brief = (sim.brief ?? {}) as { problem?: string; questions?: unknown; success?: unknown; template?: string; contract?: BriefContract };
  // 6-PR4: the contract drives the answer's ARTIFACTS (blocks), the
  // completeness judge, and the audience register — absent = today's path
  const contract = brief.contract ?? null;
  const config = (sim.config as Record<string, unknown>) ?? {};
  const cfg: RunConfig = { ...RUN_DEFAULTS, ...((config.run as Partial<RunConfig>) ?? {}) };
  const runResult = (config.run_result as { posts?: number; converged?: boolean; stop?: string; mode?: string } | undefined) ?? {};
  // field report 3: the report's mode is the mode the TRANSCRIPT was produced
  // under (run_result.mode, written at run end) — casting.mode is the CURRENT
  // config and mislabels a report after the user switches modes between runs
  const mode = String(runResult.mode ?? (config.casting as { mode?: string } | undefined)?.mode ?? "Agora");

  const { data: postRows } = await supabase.from("posts")
    .select("seq, agent_key, tag, content, cites").eq("sim_id", id).order("seq", { ascending: true });
  if (!postRows?.length) return NextResponse.json({ error: "Run the simulation first — there is no transcript yet" }, { status: 400 });

  const { data: agents } = await supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id);
  const leadCount = (agents ?? []).filter((a) => (a.spec_frozen as { seat?: { tier?: string } }).seat?.tier !== "crowd").length;
  const crowdCount = (agents ?? []).length - leadCount;

  const { data: sentimentRows } = await supabase.from("events")
    .select("payload").eq("sim_id", id).eq("type", "sentiment").order("seq", { ascending: true });
  const sentimentsRaw = (sentimentRows ?? []).map((e) => {
    const p = e.payload as { round: number; polled: number; dist: Record<string, number>; ballots?: { name: string; stance: string }[]; question?: string; options?: string[]; labels?: Record<string, string>; angle?: string };
    // 6-PR3: adaptive plans vary the question per round — each poll keeps its
    // own question/options/labels/angle so every display shares one referent
    return { round: p.round, polled: p.polled, dist: p.dist, ballots: p.ballots, question: p.question, options: p.options, labels: p.labels, angle: p.angle };
  });
  // concurrent engine slices can double-poll a round (LiveRun already dedupes
  // client-side); the report keeps the LAST event per (round, angle)
  const sentiments = [...new Map(sentimentsRaw.map((s) => [`${s.round}|${s.angle ?? s.question ?? ""}`, s])).values()];
  // what the crowd was actually asked — from the newest poll event that carried
  // it (constant per sim; older runs pre-date the field and show no question).
  // poll-language fix: options/labels must come from the SAME (last) poll the
  // question comes from — hoisting a middle choice-angle's options against a
  // late proposition's question rendered 0% bars in the simplified report.
  const lastPoll = sentiments.length ? sentiments[sentiments.length - 1] : null;
  const pollQuestion = lastPoll?.question ?? null;
  const pollOptions = lastPoll?.options?.length ? lastPoll.options : null;
  const pollLabels = lastPoll?.labels ?? null;

  // 3d — the searches the panel ran: synthesis input + the WEB SOURCES appendix
  const { data: toolRows } = await supabase.from("tool_runs")
    .select("agent_key, tool, input, output").eq("sim_id", id).order("ts", { ascending: true });
  const toolFindings = (toolRows ?? []).map((r) => ({
    agent: String(r.agent_key ?? ""),
    query: String((r.input as { query?: string } | null)?.query ?? ""),
    results: (((r.output as { results?: { title?: string; url?: string }[] } | null)?.results) ?? [])
      .filter((x) => x.url).map((x) => ({ title: String(x.title ?? x.url).slice(0, 120), url: String(x.url) })),
  }));
  const webSources = (() => {
    const byUrl = new Map<string, { title: string; url: string; uses: number }>();
    for (const f of toolFindings) for (const r of f.results) {
      const cur = byUrl.get(r.url);
      if (cur) cur.uses += 1;
      else byUrl.set(r.url, { ...r, uses: 1 });
    }
    return [...byUrl.values()].sort((a, b) => b.uses - a.uses).slice(0, 20);
  })();

  const { data: docs } = await supabase.from("documents")
    .select("id, name, mime, anthropic_file_id, storage_path").eq("sim_id", id).eq("parse_status", "parsed")
    .order("created_at", { ascending: true }); // canonical corpus order

  // §2b: vote totals are a citable endorsement signal for the synthesizer
  const { data: voteRows } = await supabase.from("post_votes").select("seq, vote").eq("sim_id", id);
  const netBySeq = new Map<number, number>();
  for (const v of voteRows ?? []) netBySeq.set(v.seq as number, (netBySeq.get(v.seq as number) ?? 0) + (v.vote as number));
  const nameOf = (seq: number) => {
    const row = postRows.find((r) => r.seq === seq);
    const m = (row?.cites as { name?: string } | null) ?? {};
    return m.name ?? "Agent";
  };
  const ranked = [...netBySeq.entries()].sort((a, b) => b[1] - a[1]);
  const endorsed = ranked.filter(([, n]) => n > 0).slice(0, 3);
  const contested = ranked.filter(([, n]) => n < 0).slice(-2);
  const voteText = ranked.length
    ? `PANEL VOTE SIGNALS (in-character endorsements; cite post numbers):\n` +
      (endorsed.length ? `- most-endorsed: ${endorsed.map(([s, n]) => `post ${s} by ${nameOf(s)} (net +${n})`).join("; ")}\n` : "") +
      (contested.length ? `- most-contested (net downvoted): ${contested.map(([s, n]) => `post ${s} by ${nameOf(s)} (net ${n})`).join("; ")}\n` : "")
    : "";

  const questions = normalizeQuestions(brief.questions);
  const success = normalizeSuccess(brief.success);
  const transcript = postRows.map((r) => {
    const m = (r.cites as { name?: string; role?: string; round?: number } | null) ?? {};
    return `[${r.seq}] (${r.tag} · round ${m.round ?? 1}) ${m.name ?? "Agent"} — ${m.role ?? ""}:\n${r.content}`;
  }).join("\n\n");
  const briefText =
    `PROBLEM: ${brief.problem}\n` +
    // 3b: the brief composer's silent classification seeds the lead kind — a
    // hint only; the synthesizer re-reads the brief and self-corrects
    (brief.template ? `DECISION SHAPE HINT: ${brief.template}\n` : "") +
    (questions.length ? `QUESTIONS TO RESOLVE (one report section EACH, in order):\n${questions.map((q) => `- ${q.label}${q.detail ? ` — ${q.detail}` : ""}`).join("\n")}\n` : "") +
    // 6-PR4: the contract's sub-asks carry evidence standards the sections
    // must meet — the completeness judge checks against exactly these lines
    (contract?.sub_asks?.length ? `THE BRIEF CONTRACT (every sub-ask below must be ANSWERED by a section — the report is judged against this):\n${contract.sub_asks.map((s) => `- [${s.id}] ${s.ask} (evidence standard: ${s.evidence})`).join("\n")}\n` : "") +
    (success.length ? `SUCCESS CRITERIA (the report is held to every one):\n${success.map((x) => `- ${x}`).join("\n")}\n` : "") +
    (sentiments.length ? `CROWD SENTIMENT BY ROUND${pollQuestion ? ` (the crowd was asked: "${pollQuestion}")` : ""}${pollOptions ? ` (a preference poll — the crowd chose among: ${pollOptions.join(" · ")})` : ""}${pollLabels ? ` (the stances MEAN, for this question: support = "${pollLabels.support}" · conditional = "${pollLabels.conditional}" · oppose = "${pollLabels.oppose}" · disengaged = "${pollLabels.disengaged}" — write about the crowd in THESE terms)` : ""}:\n${sentiments.map((x) => `- round ${x.round}${new Set(sentiments.map((s) => s.question).filter(Boolean)).size > 1 && x.question ? ` (asked: "${x.question}")` : ""}: ${x.polled} polled — ${Object.entries(x.dist).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("\n")}\n` : "") +
    (toolFindings.length ? `TOOL FINDINGS (live web searches the panel ran — citable as "source: web", URLs are real):\n${toolFindings.map((f) => `- [${f.agent}] searched "${f.query}" → ${f.results.slice(0, 3).map((x) => `${x.title} <${x.url}>`).join(" · ") || "no results"}`).join("\n")}\n` : "") +
    ((docs?.length ?? 0) > 0 ? `UPLOADED MATERIALS (exact filenames — usable in "media" when the decision turned on one):\n${docs!.map((d) => `- ${d.name} (${(d.mime ?? "").startsWith("image/") ? "image" : "document"})`).join("\n")}\n` : "") +
    voteText;

  const synthModel = TIER_MODELS[cfg.tier].synth;
  const verifyModel = TIER_MODELS[cfg.tier].verifier;
  const judgeModel = TIER_MODELS[cfg.tier].judge;
  // 6-PR4: which answer artifacts this brief demands (null = none required)
  const blocksSpec = contract
    ? blocksSpecFor(contract.output_contracts, contract.entities ?? [], contract.success_criteria ?? [])
    : null;
  // §4.1 REPORT LENGTH: auto scales depth to the transcript; explicit choices win
  const effLength: ReportLength = cfg.report_length === "auto" || !cfg.report_length
    ? (postRows.length >= 40 ? "dense" : postRows.length <= 12 ? "brief" : "standard")
    : cfg.report_length;
  // budgets are CEILINGS with headroom for the model's internal reasoning
  // (which counts against max_tokens) — the depth rules control actual length
  const synthBudget = synthBudgetFor(effLength);
  const findingClamp = effLength === "dense" ? 4500 : 2500;
  const anthropic = new Anthropic();
  const encoder = new TextEncoder();

  const logCall = async (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => {
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface, model, sim_id: id,
      input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
      latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null,
      detail: detail ?? { mode, posts: postRows.length, docs: (docs ?? []).length },
    });
  };

  // ---- PR D (field-report 2): reports you can walk away from -------------
  // Synthesis used to live INSIDE the response stream — leave the page and
  // there was no status anywhere and no way back in. Now `config.report_state`
  // is the truth (3c's heartbeat pattern): the pipeline runs under waitUntil,
  // every note lands in report_state, and the response is just a TAIL of that
  // state — any tab (or a return visit) attaches to the same synthesis.
  interface ReportState { stage: string; note?: string; heartbeat_at?: string; report_id?: string; version?: number; error?: string; started_at?: string }
  const stateDb = createAdminSupabase() ?? supabase;
  const writeState = async (patch: Partial<ReportState>) => {
    const { data: row } = await stateDb.from("simulations").select("config").eq("id", id).maybeSingle();
    const cfgNow = (row?.config as Record<string, unknown>) ?? {};
    const prev = (cfgNow.report_state as ReportState | undefined) ?? { stage: "compile" };
    await stateDb.from("simulations").update({
      config: { ...cfgNow, report_state: { ...prev, ...patch, heartbeat_at: new Date().toISOString() } },
    }).eq("id", id);
  };
  const tailResponse = () => {
    const stream = new ReadableStream({
      async start(controller) {
        const push = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        let lastNote = "";
        const t0 = Date.now();
        try {
          for (;;) {
            const { data: row } = await supabase.from("simulations").select("config").eq("id", id).maybeSingle();
            const st = ((row?.config as Record<string, unknown>)?.report_state ?? null) as ReportState | null;
            if (!st) { push({ type: "error", error: "Synthesis state lost" }); break; }
            if (st.stage === "done" && st.report_id) { push({ type: "done", reportId: st.report_id, version: st.version }); break; }
            if (st.stage === "error") { push({ type: "error", error: st.error ?? "Report synthesis failed" }); break; }
            const beat = new Date(st.heartbeat_at ?? 0).getTime();
            if (Date.now() - beat > 90_000) { push({ type: "error", error: "Synthesis heartbeat lost — hit SYNTHESIZE to retry" }); break; }
            const noteLine = `${st.stage}·${st.note ?? ""}`;
            if (noteLine !== lastNote) { lastNote = noteLine; push({ type: "stage", value: st.stage, note: st.note ?? "SYNTHESIZING…" }); }
            if (Date.now() - t0 > 780_000) { push({ type: "error", error: "Synthesis is taking unusually long — reattach from the run screen" }); break; }
            await new Promise((r) => setTimeout(r, 1500));
          }
        } catch { /* client went away — the WORKER keeps going; report_state is the truth */ }
        try { controller.close(); } catch { /* already closed */ }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  };

  // a fresh synthesis is already running → ATTACH to it, never start a second
  const priorState = ((config.report_state ?? null) as ReportState | null);
  if (priorState && priorState.stage !== "done" && priorState.stage !== "error"
    && Date.now() - new Date(priorState.heartbeat_at ?? 0).getTime() < 90_000) {
    return tailResponse();
  }

  // state writes are SERIALIZED — a throttled note still in flight must never
  // land after (and clobber) the final done/error state
  let stateWrites: Promise<void> = Promise.resolve();
  const runSynthesis = async (): Promise<{ reportId: string; version: number }> => {
      let lastSent = Date.now();
      let lastWrite = 0;
      let lastStage = "compile";
      const send = (obj: { type: string; value?: string; note?: string }) => {
        lastSent = Date.now();
        if (obj.type !== "stage") return;
        // throttle state writes; a stage CHANGE always lands
        const stageChanged = obj.value !== lastStage;
        if (!stageChanged && Date.now() - lastWrite < 1200) return;
        lastStage = obj.value ?? lastStage;
        lastWrite = Date.now();
        stateWrites = stateWrites.then(() => writeState({ stage: obj.value ?? "compile", note: obj.note })).catch(() => {});
      };
      // HEARTBEAT: adaptive thinking emits NO text for minutes at a time, and
      // an idle response body is exactly what proxies and HTTP clients kill
      // (undici's default body timeout is 300s — a silent think blew it in the
      // field). Pulse a note whenever the stream has been quiet too long.
      const pulse = setInterval(() => {
        if (Date.now() - lastSent > 15_000) {
          try { send({ type: "stage", value: "compile", note: "STILL WORKING — THE DIRECTOR IS THINKING THROUGH THE TRANSCRIPT…" }); } catch { clearInterval(pulse); }
        }
      }, 5_000);
      try {
        // ---- 1 · compile: director synthesizes the structured report ----
        // stage notes are user-facing copy — models stay in Monitoring.
        // ESCALATION LADDER (same medicine as engine turns): adaptive thinking
        // bills against max_tokens, so a hard 78-post dense synthesis can run
        // past a fixed ceiling — each retry raises it. STREAMING keeps long
        // outputs inside HTTP limits and feeds live progress to the strip.
        // COMPLETENESS GATE: truncation salvage once closed the brackets on a
        // partial JSON and shipped a report with no findings — a spec that
        // fails the gate is retried bigger, never accepted.
        send({ type: "stage", value: "compile", note: `READING ${postRows.length} POSTS · COMPILING VERDICT, FINDINGS & DISSENTS…${effLength === "dense" ? " (DENSE REPORT — TYPICALLY 1–3 MINUTES)" : ""}` });
        // dedupe + clamp: dense now STARTS high enough that pass 1 normally
        // lands (a 24K ceiling truncated a 22K dense draft in the field and
        // doubled the wall-clock with a full 250s retry)
        let raw: Record<string, unknown> | null = null;
        let lastErr = "";

        // ---- 6-PR4b (§8): PARALLEL SECTION SYNTHESIS — one worker per
        // question drafts concurrently, then a DIRECTOR writes everything
        // else consistent with the drafts. Wall-clock ≈ slowest section +
        // director, instead of one monolithic pass emitting every token
        // serially. Any failure falls back to the single-pass ladder below,
        // honestly and completely. ----
        const outlineQs = questions.slice(0, 8);
        if (outlineQs.length >= 3) {
          send({ type: "stage", value: "compile", note: `DRAFTING ${outlineQs.length} SECTIONS IN PARALLEL…` });
          let drafted = 0;
          const workerBudget = effLength === "dense" ? 6_000 : 4_000;
          const one = async (q: { label: string; detail?: string }): Promise<Record<string, unknown> | null> => {
            for (const wb of [workerBudget, workerBudget * 2]) {
              const t0 = Date.now();
              try {
                const res = await anthropic.messages.create({
                  model: synthModel, max_tokens: wb,
                  system: sectionWorkerSystem(effLength),
                  messages: [{ role: "user", content: `${briefText}\nASSIGNED QUESTION: ${q.label}${q.detail ? ` — ${q.detail}` : ""}\nTRANSCRIPT:\n${transcript.slice(0, 140_000)}` }],
                });
                await logCall("report.section", synthModel, res.usage, t0, undefined, { q: q.label.slice(0, 60), budget: wb, stop: res.stop_reason });
                if (res.stop_reason === "max_tokens") continue; // escalate once
                const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
                const parsed = parseLooseObject(text);
                if (parsed && typeof parsed.finding === "string" && (parsed.finding as string).length > 20) {
                  drafted += 1;
                  send({ type: "stage", value: "compile", note: `SECTIONS · ${drafted}/${outlineQs.length} DRAFTED IN PARALLEL…` });
                  return parsed;
                }
                lastErr = "unparseable section draft";
              } catch (e) {
                await logCall("report.section", synthModel, null, t0, e instanceof Error ? e.message : "worker failed");
                return null;
              }
            }
            return null;
          };
          const results: (Record<string, unknown> | null)[] = new Array(outlineQs.length).fill(null);
          let nextQ = 0;
          const lane = async () => { for (;;) { const i = nextQ++; if (i >= outlineQs.length) return; results[i] = await one(outlineQs[i]); } };
          await Promise.all(Array.from({ length: Math.min(4, outlineQs.length) }, lane));

          if (results.every(Boolean)) {
            send({ type: "stage", value: "compile", note: "SECTIONS DRAFTED — THE DIRECTOR IS WRITING THE VERDICT, RISKS & DISSENTS…" });
            for (const db of [12_000, 24_000]) {
              const t0 = Date.now();
              try {
                const ms = anthropic.messages.stream({
                  model: synthModel, max_tokens: db,
                  system: reportSynthSystem(effLength, { director: true }),
                  messages: [{ role: "user", content: `${briefText}\nSECTION DRAFTS (final — write everything else consistent with these):\n${JSON.stringify(results)}\nTRANSCRIPT:\n${transcript.slice(0, 160_000)}` }],
                  output_config: { format: { type: "json_schema", schema: REPORT_DIRECTOR_SCHEMA } },
                });
                let dbuf = "";
                let dNote = Date.now();
                ms.on("text", (t) => {
                  dbuf += t;
                  if (Date.now() - dNote > 2000) {
                    dNote = Date.now();
                    const tick = synthTicker(dbuf, { elapsedMs: Date.now() - t0 });
                    send({ type: "stage", value: "compile", note: tick ?? `DIRECTOR · ~${Math.round(dbuf.length / 6).toLocaleString()} WORDS…` });
                  }
                });
                const res = await ms.finalMessage();
                await logCall("report.director", synthModel, res.usage as { input_tokens: number; output_tokens: number }, t0, undefined, { budget: db, stop: res.stop_reason, sections: outlineQs.length });
                if (res.stop_reason === "max_tokens") { lastErr = "director outran the ceiling"; continue; }
                const dtext = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
                const dRaw = parseLooseObject(dtext);
                if (!dRaw) { lastErr = "unparseable director pass"; continue; }
                const merged = { ...dRaw, sections: results };
                const incomplete = reportSpecIncomplete(merged, { questions: questions.length, criteria: success.length });
                if (incomplete) { lastErr = `incomplete director pass — ${incomplete}`; break; } // single-pass rescues
                raw = merged;
                break;
              } catch (e) {
                lastErr = e instanceof Error ? e.message : "director failed";
                await logCall("report.director", synthModel, null, t0, lastErr);
                break;
              }
            }
          } else {
            lastErr = lastErr || "a section worker failed";
          }
          if (!raw) send({ type: "stage", value: "compile", note: "PARALLEL PATH FELL SHORT — FALLING BACK TO THE SINGLE-PASS SYNTHESIS…" });
        }

        const budgets = [...new Set([synthBudget, Math.min(synthBudget * 2, 48_000), 48_000])];
        for (let attempt = 0; attempt < budgets.length && !raw; attempt++) {
          const t0 = Date.now();
          try {
            const ms = anthropic.messages.stream({
              model: synthModel,
              max_tokens: budgets[attempt],
              system: reportSynthSystem(effLength),
              messages: [{ role: "user", content: `${briefText}\nTRANSCRIPT:\n${transcript.slice(0, 160_000)}` }],
              // structured outputs pin the reply to the report schema — a
              // prose-wrapped response killed a live synthesis ("unparseable")
              output_config: { format: { type: "json_schema", schema: REPORT_JSON_SCHEMA } },
            });
            // the ticker (PR-B): the draft streams schema-shaped JSON, so the
            // buffer itself says where the director is — "✓ SUMMARY · WRITING
            // FINDINGS 3/6" beats a bare word count
            let buf = "";
            let lastNote = Date.now();
            ms.on("text", (t) => {
              buf += t;
              if (Date.now() - lastNote > 2000) {
                lastNote = Date.now();
                const tick = synthTicker(buf, { expectedSections: Math.min(questions.length, 8) || undefined, elapsedMs: Date.now() - t0 });
                send({ type: "stage", value: "compile", note: `${tick ?? `COMPILING… ~${Math.round(buf.length / 6).toLocaleString()} WORDS DRAFTED`}${attempt > 0 ? ` · PASS ${attempt + 1}` : ""}` });
              }
            });
            const res = await ms.finalMessage();
            await logCall("report.synthesize", synthModel, res.usage as { input_tokens: number; output_tokens: number }, t0, undefined,
              { mode, posts: postRows.length, length: effLength, budget: budgets[attempt], stop: res.stop_reason });
            if (res.stop_reason === "max_tokens") {
              // a truncated draft is NEVER parsed — salvage would gut the report
              lastErr = `synthesis outran the ${budgets[attempt].toLocaleString()}-token ceiling`;
              send({ type: "stage", value: "compile", note: `DRAFT RAN LONG — RECOMPILING WITH MORE ROOM (PASS ${attempt + 2})…` });
              continue;
            }
            const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
            const parsed = parseLooseObject(text);
            if (!parsed) {
              lastErr = `unparseable synthesis (stop: ${res.stop_reason})`;
              continue;
            }
            const incomplete = reportSpecIncomplete(parsed, { questions: questions.length, criteria: success.length });
            if (incomplete) {
              lastErr = `incomplete synthesis — ${incomplete}`;
              send({ type: "stage", value: "compile", note: `DRAFT CAME BACK INCOMPLETE (${incomplete.toUpperCase()}) — RECOMPILING…` });
              continue;
            }
            raw = parsed;
          } catch (e) {
            lastErr = e instanceof Error ? e.message : "synthesis failed";
            await logCall("report.synthesize", synthModel, null, t0, lastErr);
          }
        }
        if (!raw) throw new Error(`Report synthesis failed — ${lastErr}`);

        // ---- 2 · verify: numeric claims vs the corpus (§4.1) ----
        let verification: ReportSpec["verification"];
        if (cfg.verifier && (docs?.length ?? 0) > 0) {
          send({ type: "stage", value: "verify", note: `FACT-CHECKING CLAIMS AGAINST ${docs!.length} DOCUMENT${docs!.length > 1 ? "S" : ""}…` });
          const corpusBlocks: (Anthropic.Beta.BetaContentBlockParam & { cache_control?: { type: "ephemeral" } })[] = [];
          for (const d of docs!) {
            if (d.anthropic_file_id && !(d.mime ?? "").startsWith("image/")) {
              corpusBlocks.push({ type: "document", source: { type: "file", file_id: d.anthropic_file_id }, title: d.name, citations: { enabled: false } });
            } else if (!d.anthropic_file_id) {
              const { data: chunks } = await supabase.from("doc_chunks")
                .select("content").eq("document_id", d.id).order("seq", { ascending: true }).limit(120);
              const text = (chunks ?? []).map((c) => c.content).join("\n\n");
              if (text) corpusBlocks.push({ type: "document", source: { type: "text", media_type: "text/plain", data: text.slice(0, 200_000) }, title: d.name, citations: { enabled: false } });
            }
          }
          if (corpusBlocks.length) {
            corpusBlocks[corpusBlocks.length - 1].cache_control = { type: "ephemeral" };
            const t1 = Date.now();
            try {
              const vres = await anthropic.beta.messages.create({
                model: verifyModel,
                max_tokens: 5000, // verifier fails soft, but thinking headroom keeps its check list complete
                system: verifierSystem(),
                messages: [{ role: "user", content: [...corpusBlocks, { type: "text", text: `PANEL POSTS:\n${transcript.slice(0, 100_000)}` }] }],
                betas: [FILES_BETA],
              });
              await logCall("report.verify", verifyModel, vres.usage as { input_tokens: number; output_tokens: number }, t1);
              const vtext = vres.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
              const rows = ((parseLooseArray(vtext) ?? []) as { claim?: string; seq?: number; verdict?: string; note?: string }[])
                .filter((r) => r.claim);
              const counted = { supported: 0, contradicted: 0, unverifiable: 0 };
              const contradictions: { claim: string; seq: number; note: string }[] = [];
              for (const r of rows) {
                const v = r.verdict === "supported" ? "supported" : r.verdict === "contradicted" ? "contradicted" : "unverifiable";
                counted[v] += 1;
                if (v === "contradicted") contradictions.push({ claim: String(r.claim).slice(0, 200), seq: Number(r.seq) || 0, note: String(r.note ?? "").slice(0, 200) });
              }
              verification = { checks: rows.length, ...counted, contradictions };
            } catch (e) {
              await logCall("report.verify", verifyModel, null, t1, e instanceof Error ? e.message : "verify failed");
              // verification is best-effort: the report ships without it rather than failing
            }
          }
        }

        // ---- 3 · assemble the spec (methodology computed, never generated) ----
        const num = (v: unknown, lo: number, hi: number) => Math.min(Math.max(Number(v) || 0, lo), hi);
        const rawSpec = raw as Partial<ReportSpec> & { verdict?: { label?: string; tone?: string; headline?: string } };
        // shared by assembly AND the judge's repair pass (6-PR4)
        const normSections = (rawSections: unknown): ReportSpec["sections"] =>
          (Array.isArray(rawSections) ? rawSections : []).slice(0, 16)
            .map((x: { question?: unknown; answer?: unknown; finding?: unknown; numbers?: unknown; cites?: unknown }) => ({
              question: String(x.question ?? "").slice(0, 160),
              answer: String(x.answer ?? "").slice(0, 600), // 3a: the direct answer, first
              finding: String(x.finding ?? "").slice(0, findingClamp),
              // field fix: a ranking section carries EVERY enumerated item as a
              // numbers entry — wide caps, word-boundary clipping; the view
              // renders long entries as rows.
              numbers: (Array.isArray(x.numbers) ? x.numbers : []).slice(0, 16)
                .map((n: { label?: unknown; value?: unknown }) => ({ label: String(n.label ?? "").slice(0, 40), value: clipText(String(n.value ?? ""), 220) })),
              cites: (Array.isArray(x.cites) ? x.cites : []).map((c) => Number(c) || 0).filter(Boolean).slice(0, 8),
            }));
        const spec: ReportSpec = {
          version: REPORT_VERSION,
          verdict: {
            label: String(rawSpec.verdict?.label ?? "SPLIT DECISION").slice(0, 40),
            tone: (["go", "conditional", "no-go", "split"] as const).find((t) => t === rawSpec.verdict?.tone) ?? "split",
            headline: String(rawSpec.verdict?.headline ?? "").slice(0, 300),
          },
          // 3b: the typed lead — clamped passthrough (the 3a lesson: the gate
          // validates the RAW draft; assembly must carry every field it approved)
          lead: (() => {
            // the draft's lead is FLAT (schema complexity budget); assembly
            // reshapes it and computes band/currency/magnitude here
            const l = (rawSpec as { lead?: Record<string, unknown> }).lead;
            const kind = (["decision", "key_finding", "price_range", "approval_odds"] as const).find((k) => k === l?.kind);
            if (!l || !kind) return undefined;
            const numOr = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
            const odds = Number.isFinite(Number(l.odds)) ? Math.min(Math.max(Number(l.odds), 0), 100) : undefined;
            const waVal = numOr(l.walk_away_value);
            const firstNumbers = (rawSpec.sections?.[0]?.numbers ?? []) as { label?: unknown; value?: unknown }[];
            return {
              kind,
              finding: l.finding ? String(l.finding).slice(0, 300) : undefined,
              so_what: l.so_what ? String(l.so_what).slice(0, 240) : undefined,
              // word-boundary clip, roomy cap: with a ranking section these are
              // "#1 item — reason" entries, and a raw 60-char slice clipped
              // them mid-word in a live report's lead
              magnitude: kind === "key_finding" && firstNumbers.length
                ? firstNumbers.slice(0, 3).map((m) => ({ label: String(m.label ?? "").slice(0, 40), value: clipText(String(m.value ?? ""), 200) }))
                : undefined,
              currency: "$",
              low: numOr(l.low), high: numOr(l.high), point: numOr(l.point),
              walk_away: waVal ? { value: waVal, label: String(l.walk_away_label ?? `Walk away at ${waVal}`).slice(0, 80) } : undefined,
              basis: l.basis ? String(l.basis).slice(0, 220) : undefined,
              odds,
              band: kind === "approval_odds" && odds !== undefined
                ? (odds >= 60 ? "likely" as const : odds <= 40 ? "unlikely" as const : "toss-up" as const)
                : undefined,
              drivers: Array.isArray(l.drivers) ? (l.drivers as unknown[]).slice(0, 4).map((d) => String(d).slice(0, 140)) : undefined,
            };
          })(),
          // 3a: THE BOTTOM LINE — three plain sentences, gate-enforced upstream
          bottom_line: {
            answer: String(rawSpec.bottom_line?.answer ?? "").slice(0, 400),
            changes_it: String(rawSpec.bottom_line?.changes_it ?? "").slice(0, 400),
            next_step: String(rawSpec.bottom_line?.next_step ?? "").slice(0, 400),
          },
          executive_summary: String(rawSpec.executive_summary ?? "").slice(0, 3000),
          dimension_scores: (Array.isArray(rawSpec.dimension_scores) ? rawSpec.dimension_scores : []).slice(0, 8)
            .map((d) => ({ name: String(d.name ?? "").slice(0, 60), score: num(d.score, 0, 10), note: String(d.note ?? "").slice(0, 200) })),
          sections: normSections(rawSpec.sections),
          // 6-PR4 (§6f): the register that leads the report; blocks land in
          // their own dedicated call below (grammar budget — see lib/report.ts)
          audience: contract?.audience,
          criteria: (Array.isArray(rawSpec.criteria) ? rawSpec.criteria : []).slice(0, 8)
            .map((c) => ({ criterion: String(c.criterion ?? "").slice(0, 220), where: String(c.where ?? "").slice(0, 220) })),
          risks: (Array.isArray(rawSpec.risks) ? rawSpec.risks : []).slice(0, 10)
            .map((r) => ({ risk: String(r.risk ?? "").slice(0, 220), severity: (["high", "medium", "low"] as const).find((sv) => sv === r.severity) ?? "medium", mitigation: String(r.mitigation ?? "").slice(0, 220), watch_signal: String(r.watch_signal ?? "").slice(0, 220) })),
          dissents: (Array.isArray(rawSpec.dissents) ? rawSpec.dissents : []).slice(0, 6)
            .map((d) => ({ name: String(d.name ?? "").slice(0, 60), role: String(d.role ?? "").slice(0, 90), position: String(d.position ?? "").slice(0, 220), quote: String(d.quote ?? "").slice(0, 400), seq: Number(d.seq) || 0 })),
          tripwires: (Array.isArray(rawSpec.tripwires) ? rawSpec.tripwires : []).slice(0, 8).map((t) => String(t).slice(0, 220)),
          sentiment: sentiments,
          poll_question: pollQuestion ? String(pollQuestion).slice(0, 240) : undefined,
          poll_options: pollOptions ?? undefined,
          poll_labels: pollLabels ?? undefined,
          tool_calls: toolFindings.length || undefined,
          web_sources: webSources.length ? webSources : undefined,
          // PR-A: media picks resolve against REAL uploads only (unknown names drop)
          media: (() => {
            const resolved = resolveReportMedia((rawSpec as { media?: unknown }).media, (docs ?? []).map((d) => ({ name: d.name as string, mime: d.mime as string | null, storage_path: d.storage_path as string | null })));
            return resolved.length ? resolved : undefined;
          })(),
          transcript: postRows.map((r) => {
            const meta = (r.cites as { name?: string; role?: string; initials?: string; adversarial?: boolean; round?: number } | null) ?? {};
            return { seq: r.seq as number, name: meta.name ?? "Agent", role: meta.role ?? "", initials: meta.initials ?? "·", adversarial: meta.adversarial ?? false, tag: r.tag as string, content: r.content as string, round: meta.round ?? 1 };
          }),
          cast: (agents ?? [])
            .filter((a) => (a.spec_frozen as { seat?: { tier?: string } }).seat?.tier !== "crowd")
            .map((a) => {
              const f = a.spec_frozen as { name: string; role: string; kind: string; seat?: { role?: string; provenance?: string; adversarial?: boolean } };
              return { name: f.name, role: f.seat?.role ?? f.role, kind: f.kind, provenance: f.seat?.provenance ?? "library", adversarial: f.seat?.adversarial ?? false };
            }),
          run_config: { mode, rounds: cfg.rounds, max_posts: cfg.max_posts, speaker: cfg.speaker, convergence: cfg.convergence, temperature: cfg.temperature, tier: cfg.tier, verifier: cfg.verifier },
          verification,
          methodology: {
            mode, rounds: cfg.rounds, leads: leadCount, crowd: crowdCount,
            polls: sentiments.reduce((s, x) => s + x.polled, 0),
            tools: normalizeEnabledTools((sim!.config as { tools?: unknown } | null)?.tools),
            posts: postRows.length, tier: cfg.tier,
            models: [...new Set([TIER_MODELS[cfg.tier].leads, TIER_MODELS[cfg.tier].crowd, synthModel, ...(verification ? [verifyModel] : [])])],
            converged: !!runResult.converged,
            stop: runResult.stop,
            docs: (docs ?? []).map((d) => d.name),
            generated_at: new Date().toISOString(),
          },
          limitations:
            "Synthetic, directional output from persona-grounded AI agents — not counsel, engineering of record, or a substitute for primary diligence. " +
            "Verify quantitative claims with the cited sources before acting; crowd sentiment is simulated, not surveyed.",
        };

        // ---- 3b · the answer's ARTIFACTS (6-PR4, §6e): a dedicated small
        // structured call — folding blocks into the main schema blew the
        // grammar budget. Soft-fail: a missing artifact is exactly what the
        // judge below flags and the repair pass regenerates. ----
        if (blocksSpec) {
          send({ type: "stage", value: "compile", note: "BUILDING THE ANSWER'S ARTIFACTS — RANKED LIST · MATRIX · COMPARISON…" });
          for (const bBudget of [12_000, 24_000]) {
            const tb = Date.now();
            try {
              const bres = await anthropic.messages.create({
                model: synthModel, max_tokens: bBudget,
                system: blocksSynthSystem(blocksSpec),
                messages: [{
                  role: "user",
                  content:
                    `${briefText}\nDRAFT ANSWERS (align the artifacts with these):\n` +
                    `${JSON.stringify(spec.sections.map((s) => ({ question: s.question, answer: s.answer })))}\n` +
                    `TRANSCRIPT:\n${transcript.slice(0, 120_000)}`,
                }],
                output_config: { format: { type: "json_schema", schema: REPORT_BLOCKS_SCHEMA } },
              });
              await logCall("report.blocks", synthModel, bres.usage, tb, undefined, { budget: bBudget, stop: bres.stop_reason });
              if (bres.stop_reason === "max_tokens") continue; // escalate, never accept a partial artifact
              const btext = bres.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
              const parsed = parseLooseObject(btext) as { blocks?: unknown } | null;
              const blocks = normalizeBlocks(parsed?.blocks);
              if (blocks.length) { spec.blocks = blocks; break; }
            } catch (e) {
              await logCall("report.blocks", synthModel, null, tb, e instanceof Error ? e.message : "blocks failed");
              break; // the judge will flag the gap; its repair pass regenerates
            }
          }
        }

        // ---- 4 · the answer-completeness judge (6-PR4, §6e): the HARD
        // guarantee at the end of the chain — the draft is checked against
        // the CONTRACT (every sub-ask answered, every artifact complete,
        // evidence standards met), and failures trigger a TARGETED repair of
        // only the failing pieces, never a blind retry. Soft by design: a
        // judge that errors ships the draft with an honest receipt. ----
        if (contract?.sub_asks?.length) {
          send({ type: "stage", value: "verify", note: "JUDGING THE ANSWER AGAINST YOUR BRIEF — EVERY SUB-ASK, EVERY ARTIFACT…" });
          const judgeInput = JSON.stringify({
            contract: {
              sub_asks: contract.sub_asks,
              entities: contract.entities ?? [],
              output_contracts: contract.output_contracts ?? [],
              success_criteria: contract.success_criteria ?? [],
            },
            answers: {
              verdict: spec.verdict,
              bottom_line: spec.bottom_line,
              sections: spec.sections.map((s) => ({ question: s.question, answer: s.answer, finding: s.finding.slice(0, 600), numbers: s.numbers, cites: s.cites })),
              blocks: spec.blocks ?? [],
              criteria: spec.criteria ?? [],
            },
          });
          let verdict: ReturnType<typeof parseJudgeVerdict> = null;
          const tj = Date.now();
          try {
            const jres = await anthropic.messages.create({
              model: judgeModel, max_tokens: 3000,
              system: judgeSystem(),
              messages: [{ role: "user", content: judgeInput.slice(0, 60_000) }],
            });
            await logCall("report.judge", judgeModel, jres.usage, tj, undefined, { sub_asks: contract.sub_asks.length, blocks: spec.blocks?.length ?? 0 });
            const jtext = jres.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
            verdict = parseJudgeVerdict(parseLooseObject(jtext));
          } catch (e) {
            await logCall("report.judge", judgeModel, null, tj, e instanceof Error ? e.message : "judge failed");
          }

          if (verdict && !verdict.pass) {
            send({ type: "stage", value: "verify", note: `THE JUDGE FLAGGED ${verdict.failures.length} GAP${verdict.failures.length > 1 ? "S" : ""} — REPAIRING ONLY THOSE…` });
            const tp = Date.now();
            let fixed = 0;
            try {
              const pres = await anthropic.messages.create({
                model: synthModel, max_tokens: 16_000,
                system: judgePatchSystem(),
                messages: [{
                  role: "user",
                  content:
                    `${briefText}\nTHE JUDGE'S FAILURES (repair EXACTLY these):\n${verdict.failures.map((f) => `- ${f.target}: ${f.problem}${f.must_fix ? ` — fix: ${f.must_fix}` : ""}`).join("\n")}\n` +
                    `CURRENT DRAFT ANSWERS (JSON):\n${judgeInput.slice(0, 30_000)}\nTRANSCRIPT:\n${transcript.slice(0, 120_000)}`,
                }],
              });
              await logCall("report.judge_patch", synthModel, pres.usage, tp, undefined, { failures: verdict.failures.length, stop: pres.stop_reason });
              const ptext = pres.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
              const patch = parseLooseObject(ptext) as { sections?: unknown; blocks?: unknown } | null;
              if (patch) {
                const pSections = normSections(patch.sections).filter((s) => s.question && s.finding);
                const pBlocks = normalizeBlocks(patch.blocks);
                if (pSections.length) spec.sections = mergePatchedSections(spec.sections, pSections);
                if (pBlocks.length) spec.blocks = mergePatchedBlocks(spec.blocks ?? [], pBlocks);
                fixed = pSections.length + pBlocks.length;
              }
            } catch (e) {
              await logCall("report.judge_patch", synthModel, null, tp, e instanceof Error ? e.message : "repair failed");
            }
            spec.judge = { pass: false, fixed, notes: verdict.failures.map((f) => `${f.target} — ${f.problem}`) };
          } else if (verdict) {
            spec.judge = { pass: true, fixed: 0 };
          }
        }

        // ---- 5 · the audience register (§6f): an executive-audience report
        // opens in the plain voice — translate EAGERLY inside the detached
        // pipeline so the report is instant to read. Soft-fail: the SIMPLIFY
        // toggle still generates lazily when this pass misses. ----
        if (spec.audience === "executive") {
          send({ type: "stage", value: "verify", note: "TRANSLATING FOR THE EXECUTIVE READ — YOUR REPORT OPENS IN PLAIN LANGUAGE…" });
          const { plain } = await synthesizePlain(anthropic, spec, TIER_MODELS[cfg.tier].plain,
            async (model, usage, t0, error, detail) => { await logCall("report.plain", model, usage, t0, error, { ...detail, eager: true }); });
          if (plain) spec.plain = plain;
        }

        const { data: prev } = await supabase.from("reports").select("version").eq("sim_id", id).order("version", { ascending: false }).limit(1);
        const version = ((prev?.[0]?.version as number) ?? 0) + 1;
        const { data: inserted, error: insErr } = await supabase.from("reports")
          .insert({ sim_id: id, spec, version }).select("id").single();
        if (insErr || !inserted) throw new Error(insErr?.message ?? "Could not save the report");

        return { reportId: inserted.id as string, version };
      } finally {
        clearInterval(pulse);
      }
  };

  // fresh state (REPLACED, not merged — a previous done/error must not bleed in)
  {
    const { data: row } = await stateDb.from("simulations").select("config").eq("id", id).maybeSingle();
    const cfgNow = (row?.config as Record<string, unknown>) ?? {};
    await stateDb.from("simulations").update({
      config: { ...cfgNow, report_state: { stage: "compile", note: "QUEUED — READING THE TRANSCRIPT…", started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() } },
    }).eq("id", id);
  }
  // the WORKER — survives the response stream being cancelled (3c's pattern)
  waitUntil((async () => {
    try {
      const { reportId, version } = await runSynthesis();
      await stateWrites; // every throttled note lands BEFORE the done state — no regression race
      await writeState({ stage: "done", report_id: reportId, version, note: `REPORT V${version} READY`, error: undefined });
    } catch (e) {
      await stateWrites;
      await writeState({ stage: "error", error: e instanceof Error ? e.message : "Report synthesis failed" });
    }
  })());
  return tailResponse();
}
