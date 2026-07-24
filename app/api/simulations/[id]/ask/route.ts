import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { CORPUS_QA_MODEL, CORPUS_QA_MODEL_LARGE, DIRECT_CONTEXT_BUDGET } from "@/lib/corpus";

export const maxDuration = 60;

const FILES_BETA = "files-api-2025-04-14";

interface Cite { title: string; pageStart?: number; pageEnd?: number; quote: string }
interface Segment { text: string; cites: Cite[] }

/**
 * Grounded corpus Q&A (CLAUDE.md §2 Stage 2) — the direct-files architecture:
 * every parsed document rides into context as a native document/image block
 * referenced by Files API id, with citations enabled and a cache_control
 * breakpoint on the corpus prefix so follow-up questions pay ~0.1× for the
 * documents. This is the same grounding path simulation agents will use;
 * chunk retrieval takes over only when a corpus outgrows the context budget.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: { question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const question = (body.question ?? "").trim();
  if (!question || question.length > 2000) {
    return NextResponse.json({ error: "Question must be 1–2000 characters" }, { status: 400 });
  }

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const { data: sim } = await supabase.from("simulations").select("id, brief, config").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

  const { data: docs } = await supabase.from("documents")
    .select("id, name, mime, anthropic_file_id, token_estimate, page_count")
    .eq("sim_id", id).eq("parse_status", "parsed").order("created_at", { ascending: true });
  if (!docs?.length) return NextResponse.json({ error: "Upload at least one document first" }, { status: 400 });

  // build the corpus prefix: one native block per document, citations on
  const corpusBlocks: (Anthropic.Beta.BetaContentBlockParam & { cache_control?: { type: "ephemeral" } })[] = [];
  for (const d of docs) {
    if (d.anthropic_file_id) {
      if ((d.mime ?? "").startsWith("image/")) {
        corpusBlocks.push({ type: "image", source: { type: "file", file_id: d.anthropic_file_id } });
      } else {
        corpusBlocks.push({
          type: "document",
          source: { type: "file", file_id: d.anthropic_file_id },
          title: d.name,
          citations: { enabled: true },
        });
      }
    } else {
      // Files API upload failed at parse time — ground on the extracted text
      const { data: chunks } = await supabase.from("doc_chunks")
        .select("content").eq("document_id", d.id).order("seq", { ascending: true }).limit(200);
      const text = (chunks ?? []).map((c) => c.content).join("\n\n");
      if (text) {
        corpusBlocks.push({
          type: "document",
          source: { type: "text", media_type: "text/plain", data: text.slice(0, 400_000) },
          title: d.name,
          citations: { enabled: true },
        });
      }
    }
  }
  if (!corpusBlocks.length) return NextResponse.json({ error: "No readable documents in the corpus" }, { status: 400 });
  // cache the corpus prefix — follow-up questions read it at ~0.1× price
  corpusBlocks[corpusBlocks.length - 1].cache_control = { type: "ephemeral" };

  // pick the tier the corpus actually fits: the lightweight model has a 200K
  // window and a 100-page PDF cap; past either, step up to the 1M-context tier
  const totalTokens = docs.reduce((s, d) => s + (d.token_estimate ?? 0), 0);
  const bigPdf = docs.some((d) => (d.page_count ?? 0) > 100);
  const model = totalTokens > DIRECT_CONTEXT_BUDGET || bigPdf ? CORPUS_QA_MODEL_LARGE : CORPUS_QA_MODEL;

  const brief = (sim.brief ?? {}) as { problem?: string };
  const anthropic = new Anthropic();
  const t0 = Date.now();
  try {
    const res = await anthropic.beta.messages.create({
      model,
      max_tokens: 1500,
      betas: [FILES_BETA],
      system:
        `You are the corpus analyst for a Microcosm real-estate simulation. The user's research problem: "${(brief.problem ?? "").slice(0, 500)}".\n` +
        `Answer strictly from the attached diligence documents. Cite the documents for every factual claim. ` +
        `If the corpus does not contain the answer, say exactly what is missing — never guess. Be concise and decision-oriented.`,
      messages: [{ role: "user", content: [...corpusBlocks, { type: "text", text: question }] }],
    });

    const segments: Segment[] = [];
    for (const block of res.content) {
      if (block.type !== "text") continue;
      const cites: Cite[] = [];
      for (const c of block.citations ?? []) {
        const cite: Cite = {
          title: ("document_title" in c ? c.document_title : null) ?? "document",
          quote: ("cited_text" in c ? c.cited_text : "").slice(0, 400),
        };
        if (c.type === "page_location") {
          cite.pageStart = c.start_page_number;
          cite.pageEnd = c.end_page_number;
        }
        cites.push(cite);
      }
      segments.push({ text: block.text, cites });
    }

    const usage = {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
    };
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface: "corpus.qa", model, sim_id: id,
      input_tokens: usage.input + usage.cacheRead + usage.cacheWrite,
      output_tokens: usage.output, latency_ms: Date.now() - t0, status: "ok",
      detail: { question: question.slice(0, 200), docs: docs.length, cache_read: usage.cacheRead },
    });
    // persist so the Q&A survives leaving the page (removable via config PATCH qa_remove)
    const qaId = crypto.randomUUID();
    const cfg = ((sim as { config?: Record<string, unknown> }).config as Record<string, unknown>) ?? {};
    const prevQa = Array.isArray(cfg.qa) ? (cfg.qa as unknown[]) : [];
    await supabase.from("simulations").update({
      config: { ...cfg, qa: [...prevQa, { id: qaId, question, segments, model, usage, groundedIn: docs.length, at: new Date().toISOString() }].slice(-20) },
    }).eq("id", id);
    return NextResponse.json({ id: qaId, segments, model, usage, groundedIn: docs.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "corpus answer failed";
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface: "corpus.qa", model, sim_id: id,
      latency_ms: Date.now() - t0, status: "error", error: msg,
      detail: { question: question.slice(0, 200) },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
