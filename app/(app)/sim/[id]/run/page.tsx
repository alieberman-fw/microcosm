import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import RunScreen from "@/components/app/RunScreen";

export const metadata = { title: "Run — Microcosm" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: sim } = await supabase!
    .from("simulations").select("id, brief").eq("id", id).maybeSingle();
  if (!sim) notFound();
  const problem = (sim.brief as { problem?: string } | null)?.problem;
  return <RunScreen simId={sim.id} problem={problem} />;
}
