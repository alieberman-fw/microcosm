import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeQuestions, normalizeSuccess } from "@/lib/corpus";
import { RUN_DEFAULTS, RunConfig, TIER_MODELS } from "@/lib/run";
import { REPORT_JSON_SCHEMA, REPORT_VERSION, ReportLength, ReportSpec, reportSpecIncomplete, reportSynthSystem, resolveReportMedia, synthBudgetFor, verifierSystem } from "@/lib/report";
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
  const brief = (sim.brief ?? {}) as { problem?: string; questions?: unknown; success?: unknown; template?: string };
  const config = (sim.config as Record<string, unknown>) ?? {};
  const cfg: RunConfig = { ...RUN_DEFAULTS, ...((config.run as Partial<RunConfig>) ?? {}) };
  const mode = String((config.casting as { mode?: string } | undefined)?.mode ?? "Agora");
  const runResult = (config.run_result as { posts?: number; converged?: boolean; stop?: string } | undefined) ?? {};

  const { data: postRows } = await supabase.from("posts")
    .select("seq, agent_key, tag, content, cites").eq("sim_id", id).order("seq", { ascending: true });
  if (!postRows?.length) return NextResponse.json({ error: "Run the simulation first — there is no transcript yet" }, { status: 400 });

  const { data: agents } = await supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id);
  const leadCount = (agents ?? []).filter((a) => (a.spec_frozen as { seat?: { tier?: string } }).seat?.tier !== "crowd").length;
  const crowdCount = (agents ?? []).length - leadCount;

  const { data: sentimentRows } = await supabase.from("events")
    .select("payload").eq("sim_id", id).eq("type", "sentiment").order("seq", { ascending: true });
  const sentiments = (sentimentRows ?? []).map((e) => {
    const p = e.payload as { round: number; polled: number; dist: Record<string, number> };
    return { round: p.round, polled: p.polled, dist: p.dist };
  });
  // what the crowd was actually asked — from the newest poll event that carried
  // it (constant per sim; older runs pre-date the field and show no question).
  // Choice instruments (PR-B) also carry the option list the crowd chose among.
  const pollQuestion = (sentimentRows ?? []).map((e) => (e.payload as { question?: string }).question).filter(Boolean).pop() ?? null;
  const pollOptions = (sentimentRows ?? []).map((e) => (e.payload as { options?: string[] }).options).filter((o) => Array.isArray(o) && o.length).pop() ?? null;

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
    .select("id, name, mime, anthropic_file_id, storage_path").eq("sim_id", id).eq("parse_status", "parsed");

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
    (success.length ? `SUCCESS CRITERIA (the report is held to every one):\n${success.map((x) => `- ${x}`).join("\n")}\n` : "") +
    (sentiments.length ? `CROWD SENTIMENT BY ROUND${pollQuestion ? ` (the crowd was asked: "${pollQuestion}")` : ""}${pollOptions ? ` (a preference poll — the crowd chose among: ${pollOptions.join(" · ")})` : ""}:\n${sentiments.map((x) => `- round ${x.round}: ${x.polled} polled — ${Object.entries(x.dist).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("\n")}\n` : "") +
    (toolFindings.length ? `TOOL FINDINGS (live web searches the panel ran — citable as "source: web", URLs are real):\n${toolFindings.map((f) => `- [${f.agent}] searched "${f.query}" → ${f.results.slice(0, 3).map((x) => `${x.title} <${x.url}>`).join(" · ") || "no results"}`).join("\n")}\n` : "") +
    ((docs?.length ?? 0) > 0 ? `UPLOADED MATERIALS (exact filenames — usable in "media" when the decision turned on one):\n${docs!.map((d) => `- ${d.name} (${(d.mime ?? "").startsWith("image/") ? "image" : "document"})`).join("\n")}\n` : "") +
    voteText;

  const synthModel = TIER_MODELS[cfg.tier].synth;
  const verifyModel = TIER_MODELS[cfg.tier].verifier;
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

  const stream = new ReadableStream({
    async start(controller) {
      let lastSent = Date.now();
      const send = (obj: unknown) => { lastSent = Date.now(); controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`)); };
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
        const budgets = [synthBudget, synthBudget * 2, Math.min(synthBudget * 3, 48_000)];
        let raw: Record<string, unknown> | null = null;
        let lastErr = "";
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
              magnitude: kind === "key_finding" && firstNumbers.length
                ? firstNumbers.slice(0, 3).map((m) => ({ label: String(m.label ?? "").slice(0, 40), value: String(m.value ?? "").slice(0, 60) }))
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
          sections: (Array.isArray(rawSpec.sections) ? rawSpec.sections : []).slice(0, 16)
            .map((x) => ({
              question: String(x.question ?? "").slice(0, 160),
              answer: String(x.answer ?? "").slice(0, 600), // 3a: the direct answer, first
              finding: String(x.finding ?? "").slice(0, findingClamp),
              numbers: (Array.isArray(x.numbers) ? x.numbers : []).slice(0, 6)
                .map((n) => ({ label: String(n.label ?? "").slice(0, 40), value: String(n.value ?? "").slice(0, 60) })),
              cites: (Array.isArray(x.cites) ? x.cites : []).map((c) => Number(c) || 0).filter(Boolean).slice(0, 8),
            })),
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

        const { data: prev } = await supabase.from("reports").select("version").eq("sim_id", id).order("version", { ascending: false }).limit(1);
        const version = ((prev?.[0]?.version as number) ?? 0) + 1;
        const { data: inserted, error: insErr } = await supabase.from("reports")
          .insert({ sim_id: id, spec, version }).select("id").single();
        if (insErr || !inserted) throw new Error(insErr?.message ?? "Could not save the report");

        send({ type: "done", reportId: inserted.id, version });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "Report synthesis failed" });
      } finally {
        clearInterval(pulse);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
