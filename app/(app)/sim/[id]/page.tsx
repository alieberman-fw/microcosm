import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import SimWorkspace, { DocRow } from "@/components/app/SimWorkspace";
import { CastingInfo, WorkspaceSeat } from "@/components/app/PopulationStage";
import { Brief } from "@/components/app/BriefComposer";
import { normalizeQuestions, normalizeSuccess } from "@/lib/corpus";
import { FrozenSpec } from "@/lib/casting";

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

  const stored = (sim.brief ?? {}) as Partial<Brief> & { questions?: unknown };
  const brief: Brief = {
    problem: stored.problem ?? "",
    questions: normalizeQuestions(stored.questions),
    template: stored.template ?? "Custom",
    success: normalizeSuccess(stored.success),
  };

  const seats: WorkspaceSeat[] = (agents ?? []).map((a) => {
    const spec = a.spec_frozen as FrozenSpec;
    return { key: a.agent_key as string, provenance: spec.seat?.provenance ?? "library", spec };
  });
  const casting = ((sim.config as { casting?: CastingInfo } | null)?.casting) ?? null;

  return (
    <SimWorkspace
      sim={{ id: sim.id, status: sim.status, brief, created_at: sim.created_at }}
      initialDocs={(docs ?? []) as DocRow[]}
      initialSeats={seats}
      initialCasting={casting}
    />
  );
}
