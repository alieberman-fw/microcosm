import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeQuestions, normalizeSuccess } from "@/lib/corpus";
import { RUN_DEFAULTS, RunConfig, TIER_MODELS } from "@/lib/run";
import { REPORT_JSON_SCHEMA, REPORT_VERSION, ReportLength, ReportSpec, reportSynthSystem, verifierSystem } from "@/lib/report";
import { parseLooseArray, parseLooseObject } from "@/lib/llm-json";

export const maxDuration = 300;

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
  const brief = (sim.brief ?? {}) as { problem?: string; questions?: unknown; success?: unknown };
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

  const { data: docs } = await supabase.from("documents")
    .select("id, name, mime, anthropic_file_id").eq("sim_id", id).eq("parse_status", "parsed");

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
    (questions.length ? `QUESTIONS TO RESOLVE (one report section EACH, in order):\n${questions.map((q) => `- ${q.label}${q.detail ? ` — ${q.detail}` : ""}`).join("\n")}\n` : "") +
    (success.length ? `SUCCESS CRITERIA (the report is held to every one):\n${success.map((x) => `- ${x}`).join("\n")}\n` : "") +
    (sentiments.length ? `CROWD SENTIMENT BY ROUND:\n${sentiments.map((x) => `- round ${x.round}: ${x.polled} polled — ${Object.entries(x.dist).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("\n")}\n` : "") +
    voteText;

  const synthModel = TIER_MODELS[cfg.tier].synth;
  const verifyModel = TIER_MODELS[cfg.tier].verifier;
  // §4.1 REPORT LENGTH: auto scales depth to the transcript; explicit choices win
  const effLength: ReportLength = cfg.report_length === "auto" || !cfg.report_length
    ? (postRows.length >= 40 ? "dense" : postRows.length <= 12 ? "brief" : "standard")
    : cfg.report_length;
  // budgets are CEILINGS with headroom for the model's internal reasoning
  // (which counts against max_tokens) — the depth rules control actual length
  const synthBudget = effLength === "brief" ? 6000 : effLength === "dense" ? 14_000 : 9000;
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
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        // ---- 1 · compile: director synthesizes the structured report ----
        // stage notes are user-facing copy — models stay in Monitoring
        send({ type: "stage", value: "compile", note: `READING ${postRows.length} POSTS · COMPILING VERDICT, FINDINGS & DISSENTS…` });
        let raw: Record<string, unknown> | null = null;
        let lastErr = "";
        for (let attempt = 0; attempt < 2 && !raw; attempt++) {
          const t0 = Date.now();
          try {
            const res = await anthropic.messages.create({
              model: synthModel,
              max_tokens: synthBudget,
              system: reportSynthSystem(effLength),
              messages: [{ role: "user", content: `${briefText}\nTRANSCRIPT:\n${transcript.slice(0, 160_000)}` }],
              // structured outputs pin the reply to the report schema — a
              // prose-wrapped response killed a live synthesis ("unparseable")
              output_config: { format: { type: "json_schema", schema: REPORT_JSON_SCHEMA } },
            });
            await logCall("report.synthesize", synthModel, res.usage, t0, undefined, { mode, posts: postRows.length, length: effLength });
            const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
            raw = parseLooseObject(text);
            if (!raw) lastErr = `unparseable synthesis (stop: ${res.stop_reason})`;
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
                max_tokens: 3000,
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
          executive_summary: String(rawSpec.executive_summary ?? "").slice(0, 3000),
          dimension_scores: (Array.isArray(rawSpec.dimension_scores) ? rawSpec.dimension_scores : []).slice(0, 8)
            .map((d) => ({ name: String(d.name ?? "").slice(0, 60), score: num(d.score, 0, 10), note: String(d.note ?? "").slice(0, 200) })),
          sections: (Array.isArray(rawSpec.sections) ? rawSpec.sections : []).slice(0, 16)
            .map((x) => ({ question: String(x.question ?? "").slice(0, 160), finding: String(x.finding ?? "").slice(0, findingClamp), cites: (Array.isArray(x.cites) ? x.cites : []).map((c) => Number(c) || 0).filter(Boolean).slice(0, 8) })),
          criteria: (Array.isArray(rawSpec.criteria) ? rawSpec.criteria : []).slice(0, 8)
            .map((c) => ({ criterion: String(c.criterion ?? "").slice(0, 220), where: String(c.where ?? "").slice(0, 220) })),
          risks: (Array.isArray(rawSpec.risks) ? rawSpec.risks : []).slice(0, 10)
            .map((r) => ({ risk: String(r.risk ?? "").slice(0, 220), severity: (["high", "medium", "low"] as const).find((sv) => sv === r.severity) ?? "medium", mitigation: String(r.mitigation ?? "").slice(0, 220), watch_signal: String(r.watch_signal ?? "").slice(0, 220) })),
          dissents: (Array.isArray(rawSpec.dissents) ? rawSpec.dissents : []).slice(0, 6)
            .map((d) => ({ name: String(d.name ?? "").slice(0, 60), role: String(d.role ?? "").slice(0, 90), position: String(d.position ?? "").slice(0, 220), quote: String(d.quote ?? "").slice(0, 400), seq: Number(d.seq) || 0 })),
          tripwires: (Array.isArray(rawSpec.tripwires) ? rawSpec.tripwires : []).slice(0, 8).map((t) => String(t).slice(0, 220)),
          sentiment: sentiments,
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
