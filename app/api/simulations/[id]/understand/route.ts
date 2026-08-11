import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeQuestions, normalizeSuccess } from "@/lib/corpus";
import { CASTING_MODEL } from "@/lib/casting";
import {
  BriefContract, UNDERSTAND_MAX_TOKENS, normalizeContractEdits, parseContract, understandSystem,
} from "@/lib/understand";

export const maxDuration = 120;

type BriefRow = {
  problem?: string;
  questions?: unknown;
  success?: unknown;
  template?: string;
  contract?: BriefContract;
};

async function loadSim(id: string) {
  const supabase = await createServerSupabase();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase not configured" }, { status: 500 }) } as const;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) } as const;
  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return { error: NextResponse.json({ error: "No org" }, { status: 400 }) } as const;
  const { data: sim } = await supabase.from("simulations").select("id, brief").eq("id", id).maybeSingle();
  if (!sim) return { error: NextResponse.json({ error: "Simulation not found" }, { status: 404 }) } as const;
  return { supabase, user, orgId: userRow.org_id as string, sim: sim as { id: string; brief: BriefRow } } as const;
}

/**
 * The Understanding pass (§6b): one CASTING_MODEL call over the free-form
 * brief + doc inventory → the Brief Contract, persisted at brief.contract
 * and logged as `brief.understand`. Probabilistic by design — the WHAT I
 * UNDERSTOOD card is where the user catches a bad parse in seconds.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadSim(id);
  if ("error" in ctx) return ctx.error;
  const { supabase, user, orgId, sim } = ctx;
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }
  const brief = sim.brief ?? {};
  const problem = (brief.problem ?? "").trim();
  if (!problem) return NextResponse.json({ error: "Write the brief first" }, { status: 400 });

  // the same inventory casting sees: names + a taste of each parsed doc
  const { data: docs } = await supabase.from("documents")
    .select("id, name, token_estimate, page_count").eq("sim_id", id).eq("parse_status", "parsed").order("created_at");
  const docNames = (docs ?? []).map((d) => d.name as string);
  const docLines: string[] = [];
  for (const d of docs ?? []) {
    const { data: chunks } = await supabase.from("doc_chunks")
      .select("content").eq("document_id", d.id).order("seq").limit(2);
    const opening = (chunks ?? []).map((c) => c.content).join(" ").replace(/\s+/g, " ").slice(0, 900);
    docLines.push(`- ${d.name} (${d.page_count ? `${d.page_count}p, ` : ""}~${d.token_estimate ?? "?"} tokens)${opening ? ` — opens: "${opening}…"` : ""}`);
  }

  const questions = normalizeQuestions(brief.questions);
  const success = normalizeSuccess(brief.success);
  const briefText =
    `THE BRIEF (the user's own words — capture ALL of it):\n${problem}\n\n` +
    (questions.length ? `QUESTIONS THE USER LISTED:\n${questions.map((q) => `- ${q.label}${q.detail ? ` — ${q.detail}` : ""}`).join("\n")}\n` : "") +
    (success.length ? `SUCCESS CRITERIA THE USER LISTED:\n${success.map((s) => `- ${s}`).join("\n")}\n` : "") +
    (docLines.length ? `DOCUMENTS UPLOADED:\n${docLines.join("\n")}\n` : "DOCUMENTS UPLOADED: none\n");

  const anthropic = new Anthropic();
  let contract: BriefContract | null = null;
  let lastStop: string | null = null;
  for (let attempt = 0; attempt < 2 && !contract; attempt++) {
    const t0 = Date.now();
    // U-H23: the retry is INFORMED, not a blind identical re-roll (computed
    // before the call — referencing lastStop inside it made `res` circular)
    const retryNote: string = attempt === 0
      ? ""
      : `\nNOTE: your previous reply ${lastStop === "max_tokens" ? "was TRUNCATED (it hit the output ceiling)" : "did not parse as the required JSON"}. Reply with COMPLETE, terse JSON — shorter notes, no prose outside the object.`;
    try {
      const res: Anthropic.Message = await anthropic.messages.create({
        model: CASTING_MODEL,
        // U-H15: a truncated attempt retries at DOUBLE the ceiling
        max_tokens: attempt === 0 ? UNDERSTAND_MAX_TOKENS : UNDERSTAND_MAX_TOKENS * 2,
        system: understandSystem(docNames),
        messages: [{ role: "user", content: `${briefText}${retryNote}` }],
      });
      lastStop = res.stop_reason;
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      // U-H15: a max_tokens stop is a FAILED attempt even when the bracket
      // salvage can close the JSON — the last-ordered fields (doc_roles,
      // flags, poll_plan) are exactly what truncation silently destroys
      contract = res.stop_reason === "max_tokens" ? null : parseContract(text, docNames);
      await supabase.from("agent_interactions").insert({
        org_id: orgId, user_id: user.id, surface: "brief.understand", model: CASTING_MODEL, sim_id: id,
        input_tokens: res.usage?.input_tokens ?? null, output_tokens: res.usage?.output_tokens ?? null,
        latency_ms: Date.now() - t0, status: contract ? "ok" : "error",
        error: contract ? null : (res.stop_reason === "max_tokens" ? "truncated contract (rejected, retrying bigger)" : `unparseable contract (stop: ${res.stop_reason})`),
        detail: { problem: problem.slice(0, 160), docs: docNames.length, attempt },
      });
    } catch (e) {
      await supabase.from("agent_interactions").insert({
        org_id: orgId, user_id: user.id, surface: "brief.understand", model: CASTING_MODEL, sim_id: id,
        latency_ms: Date.now() - t0, status: "error", error: e instanceof Error ? e.message.slice(0, 300) : "call failed",
        detail: { problem: problem.slice(0, 160), docs: docNames.length, attempt },
      });
      if (attempt === 1) throw e;
    }
  }
  if (!contract) {
    return NextResponse.json({ error: `Understanding pass returned no usable contract (stop: ${lastStop})` }, { status: 502 });
  }

  const { error } = await supabase.from("simulations")
    .update({ brief: { ...brief, contract } }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contract });
}

/** Save user edits to the contract (chips on the card). Edits mutate the
 * CONTRACT — the truth — through the same normalizer the pass uses. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await loadSim(id);
  if ("error" in ctx) return ctx.error;
  const { supabase, sim } = ctx;
  const brief = sim.brief ?? {};
  const existing = brief.contract;
  if (!existing) return NextResponse.json({ error: "No contract to edit — derive it first" }, { status: 400 });

  let body: { contract?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { data: docs } = await supabase.from("documents")
    .select("name").eq("sim_id", id).eq("parse_status", "parsed").order("created_at");
  const contract = normalizeContractEdits(body.contract ?? null, existing, (docs ?? []).map((d) => d.name as string));
  if (!contract) return NextResponse.json({ error: "Contract needs an intent and at least one sub-ask" }, { status: 400 });

  const { error } = await supabase.from("simulations")
    .update({ brief: { ...brief, contract } }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contract });
}
