import type { SupabaseClient } from "@supabase/supabase-js";
import { FrozenSpec } from "@/lib/casting";
import { CorpusDocInput, buildCorpusBlocks } from "@/lib/corpus";
import { ReportSpec } from "@/lib/report";

/**
 * The report AI analyst (pre-5a feature batch) — the substrate builder.
 * One assembly of EVERYTHING the run produced: brief + contract, the latest
 * report, the full transcript, every poll (with question-matched labels and
 * per-round tallies), votes, tool findings, and the corpus as native
 * document blocks. The analyst answers ANY question about the run from
 * this; @mentioned agents answer in character on top of the same substrate.
 *
 * Analyst threads are SIDE conversations — they never touch the transcript
 * and are invisible to future synthesis. Annotation, not evidence.
 */

export const ANALYST_KEY = "analyst";
/** substrate budget (chars ≈ tokens×3.6) — beyond it the transcript clips
 *  from the MIDDLE with an honest note; the report + polls always fit */
const SUBSTRATE_CHAR_BUDGET = 340_000;

export interface CastMember {
  key: string;
  name: string;
  role: string;
  tier: "lead" | "crowd";
  adversarial: boolean;
}

export interface AnalystContext {
  substrate: string;
  corpusBlocks: ReturnType<typeof buildCorpusBlocks>;
  cast: CastMember[];
  castSpecs: Map<string, FrozenSpec>;
  simName: string;
  reportVersion: number | null;
}

function pollTable(sentiments: {
  round: number; polled: number; dist: Record<string, number>;
  question?: string; options?: string[]; labels?: Record<string, string>; angle?: string;
}[]): string {
  if (!sentiments.length) return "No crowd polls ran.";
  return sentiments.map((s) => {
    const label = (k: string) => s.labels?.[k] ?? k;
    const entries = Object.entries(s.dist).map(([k, v]) => `${label(k)}: ${v}`).join(" · ");
    return `- round ${s.round}${s.angle ? ` [${s.angle}]` : ""}${s.question ? ` — asked "${s.question}"` : ""}: ${s.polled} polled → ${entries}`;
  }).join("\n");
}

export async function buildAnalystContext(db: SupabaseClient, simId: string): Promise<AnalystContext | null> {
  const { data: sim } = await db.from("simulations")
    .select("id, brief, config, status").eq("id", simId).maybeSingle();
  if (!sim) return null;
  const brief = (sim.brief ?? {}) as { problem?: string; contract?: Record<string, unknown> };
  const config = (sim.config ?? {}) as { name?: string };
  const contract = brief.contract as { title?: string; mirror?: string; sub_asks?: { ask: string }[]; success_criteria?: string[] } | undefined;
  const simName = config.name ?? contract?.title ?? "Untitled simulation";

  const [{ data: reports }, { data: agents }, { data: posts }, { data: events }, { data: tools }, { data: docs }] = await Promise.all([
    db.from("reports").select("spec, version").eq("sim_id", simId).order("version", { ascending: false }).limit(1),
    db.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", simId),
    db.from("posts").select("seq, agent_key, tag, reply_to, content, cites").eq("sim_id", simId).order("seq", { ascending: true }),
    db.from("events").select("type, payload").eq("sim_id", simId).in("type", ["sentiment", "votes"]).order("seq", { ascending: true }),
    db.from("tool_runs").select("tool, input, output").eq("sim_id", simId).limit(40),
    db.from("documents").select("id, name, mime, anthropic_file_id").eq("sim_id", simId).eq("parse_status", "parsed").order("created_at", { ascending: true }),
  ]);

  const castSpecs = new Map<string, FrozenSpec>();
  const cast: CastMember[] = (agents ?? []).map((a) => {
    const spec = a.spec_frozen as FrozenSpec;
    castSpecs.set(a.agent_key as string, spec);
    return {
      key: a.agent_key as string,
      name: spec.name,
      role: spec.seat?.role ?? spec.role ?? "",
      tier: spec.seat?.tier === "crowd" ? "crowd" as const : "lead" as const,
      adversarial: Boolean(spec.seat?.adversarial ?? (spec.kind === "adversarial")),
    };
  });

  // transcript with the same [seq] numbering every other surface uses
  const nameOf = (key: string) => castSpecs.get(key)?.name ?? "Agent";
  const roleOf = (key: string) => castSpecs.get(key)?.seat?.role ?? castSpecs.get(key)?.role ?? "";
  const lines = (posts ?? []).map((p) => {
    const meta = (p.cites as { round?: number } | null) ?? {};
    return `[${p.seq}] r${meta.round ?? "?"} ${nameOf(p.agent_key as string)} (${roleOf(p.agent_key as string)})${p.tag && p.tag !== "POST" ? ` [${p.tag}]` : ""}${p.reply_to ? ` → [${p.reply_to}]` : ""}: ${p.content}`;
  });
  let transcript = lines.join("\n");
  const overhead = 60_000; // report + polls + brief always ride whole
  if (transcript.length > SUBSTRATE_CHAR_BUDGET - overhead) {
    const keep = Math.floor((SUBSTRATE_CHAR_BUDGET - overhead) / 2);
    const head = transcript.slice(0, keep);
    const tail = transcript.slice(-keep);
    transcript = `${head}\n\n[… TRANSCRIPT CLIPPED FOR LENGTH — the middle rounds are omitted; say so if asked about them …]\n\n${tail}`;
  }

  const sentiments = (events ?? []).filter((e) => e.type === "sentiment").map((e) => e.payload as Parameters<typeof pollTable>[0][number]);
  // concurrent slices can double-poll a round — keep the last per (round, angle)
  const dedupedPolls = [...new Map(sentiments.map((s) => [`${s.round}|${s.angle ?? s.question ?? ""}`, s])).values()];
  const voteEvents = (events ?? []).filter((e) => e.type === "votes").length;

  const report = reports?.[0];
  const spec = report?.spec as unknown as ReportSpec | undefined;
  const reportText = spec ? [
    `VERDICT: ${spec.verdict.label} — ${spec.verdict.headline}`,
    spec.bottom_line ? `BOTTOM LINE: ${spec.bottom_line.answer} | WOULD CHANGE IT: ${spec.bottom_line.changes_it} | NEXT: ${spec.bottom_line.next_step}` : "",
    `EXECUTIVE SUMMARY: ${spec.executive_summary}`,
    ...spec.sections.map((s) => `SECTION — ${s.question}\nANSWER: ${s.answer ?? ""}\nFINDING: ${s.finding}${s.numbers?.length ? `\nNUMBERS: ${s.numbers.map((n) => `${n.label}=${n.value}`).join(" · ")}` : ""} (cites: ${s.cites.join(",")})`),
    ...(spec.blocks ?? []).map((b) => `BLOCK [${b.kind}] ${b.title}: ${b.rows.map((r) => `${r.label} → ${r.cells.join(" | ")}`).join(" ;; ")}`),
    (spec.risks?.length ?? 0) > 0 ? `RISKS: ${spec.risks.map((r) => `${r.risk} (${r.severity}; mitigate: ${r.mitigation})`).join(" ;; ")}` : "",
    spec.dissents.length ? `DISSENTS: ${spec.dissents.map((d) => `${d.name} (${d.role}): ${d.position} — "${d.quote}" [${d.seq}]`).join(" ;; ")}` : "",
    (spec.tripwires?.length ?? 0) > 0 ? `TRIPWIRES: ${spec.tripwires.join(" ;; ")}` : "",
  ].filter(Boolean).join("\n") : "No report synthesized yet.";

  const toolText = (tools ?? []).length
    ? (tools ?? []).map((t) => {
        const q = (t.input as { query?: string } | null)?.query ?? "";
        const results = ((t.output as { results?: { title: string; url: string }[] } | null)?.results ?? []).slice(0, 3);
        return `- ${t.tool}: "${q}" → ${results.map((r) => r.title).join(" · ")}`;
      }).join("\n")
    : "No agent tool calls.";

  const substrate = [
    `SIMULATION: ${simName} (status: ${sim.status})`,
    `THE BRIEF:\n${(brief.problem ?? "").slice(0, 8000)}`,
    contract?.mirror ? `WHAT THE USER WANTS (understanding pass):\n${contract.mirror}` : "",
    contract?.sub_asks?.length ? `SUB-ASKS:\n${contract.sub_asks.map((s, i) => `${i + 1}. ${s.ask}`).join("\n")}` : "",
    `THE PANEL (${cast.filter((c) => c.tier === "lead").length} leads, ${cast.filter((c) => c.tier === "crowd").length} crowd):\n` +
      cast.filter((c) => c.tier === "lead").map((c) => `- ${c.name} — ${c.role}${c.adversarial ? " [ADVERSARIAL SEED]" : ""}`).join("\n"),
    `THE REPORT (v${report?.version ?? "—"}):\n${reportText}`,
    `CROWD POLLS (every member polled each listed round; labels are the answers as asked):\n${pollTable(dedupedPolls)}`,
    voteEvents ? `IN-FORUM VOTES: ${voteEvents} vote sweeps ran (endorsement signals on posts).` : "",
    `AGENT TOOL CALLS:\n${toolText}`,
    `THE TRANSCRIPT (cite posts as [seq]):\n${transcript}`,
  ].filter(Boolean).join("\n\n====\n\n");

  const docInputs: CorpusDocInput[] = (docs ?? [])
    .filter((d) => d.anthropic_file_id)
    .map((d) => ({ name: d.name as string, mime: d.mime as string | null, file_id: d.anthropic_file_id as string }));
  const corpusBlocks = buildCorpusBlocks(docInputs);

  return { substrate, corpusBlocks, cast, castSpecs, simName, reportVersion: report?.version ?? null };
}

export function analystSystem(simName: string): string {
  return (
    `You are THE ANALYST for the Microcosm simulation "${simName}" — a sharp, neutral research analyst who watched every ` +
    `post of the deliberation, read every document, and knows the report cold. The full substrate follows in your context.\n` +
    `What you do:\n` +
    `- ANSWER anything about the run: summarize threads, explain report sections simply, compare polls across rounds/questions, ` +
    `trace who argued what and who flipped, reconcile the report against the transcript.\n` +
    `- COMPUTE from the data given (poll tables, tallies) — never invent numbers.\n` +
    `- CITE posts as [seq] (e.g. [14]) whenever a claim rests on the transcript; cite documents by filename.\n` +
    `- GO BEYOND the report when asked — but label extrapolation plainly ("the panel didn't test this; extrapolating from [12], [31]…"). ` +
    `For genuinely new questions the run can't answer, say so and suggest re-running or forking the simulation.\n` +
    `- The user can @mention any panel or crowd member to hear from them directly — suggest it when a question is really FOR someone.\n` +
    `Voice: direct, concrete, plain language; markdown; short paragraphs; no filler. This chat is annotation — it never enters the run record.`
  );
}

export function agentReplySystem(spec: FrozenSpec, simName: string): string {
  const seat = spec.seat?.role ?? spec.role ?? "";
  return (
    `You are ${spec.name} — ${seat} — a participant in the Microcosm simulation "${simName}". ` +
    `${spec.tagline ? `(${spec.tagline}) ` : ""}` +
    `${spec.stances?.length ? `Your standing positions: ${spec.stances.join("; ")}. ` : ""}` +
    `The full run substrate (brief, report, transcript with your own posts) follows in your context.\n` +
    `A user reading the report is asking YOU directly. Answer IN CHARACTER, first person, consistent with everything you said ` +
    `in the deliberation — reference your own posts as [seq] where relevant. You may go deeper than the transcript, but stay ` +
    `true to your expertise and disposition. 2-6 sentences unless the question demands more. Never speak for other participants.`
  );
}

/** thread titles come from the first question — compact, prose-cased */
export function threadTitleFrom(content: string): string {
  const t = content.trim().replace(/\s+/g, " ");
  return (t.length > 64 ? `${t.slice(0, 61)}…` : t) || "Analyst conversation";
}
