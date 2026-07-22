import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import SimWorkspace, { DocRow } from "@/components/app/SimWorkspace";
import { Brief } from "@/components/app/BriefComposer";
import { normalizeQuestions } from "@/lib/corpus";

export const metadata = { title: "Simulation — Microcosm" };
export const dynamic = "force-dynamic";

export default async function SimulationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: sim } = await supabase!
    .from("simulations")
    .select("id, status, brief, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!sim) notFound();

  const { data: docs } = await supabase!
    .from("documents")
    .select("id, name, size_bytes, mime, parse_status, parse_error, token_estimate, page_count, created_at")
    .eq("sim_id", id)
    .order("created_at", { ascending: true });

  const stored = (sim.brief ?? {}) as Partial<Brief> & { questions?: unknown };
  const brief: Brief = {
    problem: stored.problem ?? "",
    questions: normalizeQuestions(stored.questions),
    template: stored.template ?? "Custom",
    success: stored.success ?? "",
  };

  return (
    <SimWorkspace
      sim={{ id: sim.id, status: sim.status, brief, created_at: sim.created_at }}
      initialDocs={(docs ?? []) as DocRow[]}
    />
  );
}
