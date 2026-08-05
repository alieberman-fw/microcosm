import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import SimWorkspace, { DocRow } from "@/components/app/SimWorkspace";
import { CastingInfo, WorkspaceSeat } from "@/components/app/PopulationStage";
import { Brief } from "@/components/app/BriefComposer";
import { normalizeQuestions, normalizeSuccess } from "@/lib/corpus";
import { FrozenSpec } from "@/lib/casting";
import { BriefContract } from "@/lib/understand";

export const metadata = { title: "Simulation — Microcosm" };
export const dynamic = "force-dynamic";

export default async function SimulationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: sim } = await supabase!
    .from("simulations")
    .select("id, status, brief, config, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!sim) notFound();

  const [{ data: docs }, { data: agents }] = await Promise.all([
    supabase!
      .from("documents")
      .select("id, name, size_bytes, mime, parse_status, parse_error, token_estimate, page_count, created_at")
      .eq("sim_id", id)
      .order("created_at", { ascending: true }),
    supabase!
      .from("sim_agents")
      .select("agent_key, spec_frozen")
      .eq("sim_id", id),
  ]);

  const stored = (sim.brief ?? {}) as Partial<Brief> & { questions?: unknown; contract?: BriefContract };
  const brief: Brief = {
    problem: stored.problem ?? "",
    questions: normalizeQuestions(stored.questions),
    template: stored.template ?? "Custom",
    success: normalizeSuccess(stored.success),
  };

  // leads deliberate; crowd members (seat.tier "crowd") are the full-run population
  const seats: WorkspaceSeat[] = [];
  const crowd: WorkspaceSeat[] = [];
  for (const a of agents ?? []) {
    const spec = a.spec_frozen as FrozenSpec;
    const seat: WorkspaceSeat = { key: a.agent_key as string, provenance: spec.seat?.provenance ?? "library", spec };
    if (spec.seat?.tier === "crowd") crowd.push(seat);
    else seats.push(seat);
  }
  crowd.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const casting = ((sim.config as { casting?: CastingInfo } | null)?.casting) ?? null;
  // persisted corpus Q&A, newest first (the workspace prepends new answers)
  const qaRaw = ((sim.config as { qa?: unknown[] } | null)?.qa ?? []) as never[];
  const qa = [...qaRaw].reverse();
  const run = ((sim.config as { run?: Record<string, unknown> } | null)?.run) ?? null;
  const savedTools = ((sim.config as { tools?: string[] } | null)?.tools) ?? [];
  const [{ count: reportCount }, { count: postCount }] = await Promise.all([
    supabase!.from("reports").select("id", { count: "exact", head: true }).eq("sim_id", id),
    supabase!.from("posts").select("seq", { count: "exact", head: true }).eq("sim_id", id),
  ]);

  return (
    <SimWorkspace
      sim={{ id: sim.id, status: sim.status, brief, created_at: sim.created_at }}
      initialDocs={(docs ?? []) as DocRow[]}
      initialSeats={seats}
      initialCrowd={crowd}
      initialCasting={casting}
      initialContract={stored.contract ?? null}
      initialAnswers={qa}
      initialRun={run}
      initialTools={savedTools}
      hasRun={(postCount ?? 0) > 0}
      hasReport={(reportCount ?? 0) > 0}
    />
  );
}
