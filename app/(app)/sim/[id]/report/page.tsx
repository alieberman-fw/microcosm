import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import ReportView from "@/components/app/ReportView";
import { ReportSpec } from "@/lib/report";
import { LivePost } from "@/components/app/LiveRun";

export const metadata = { title: "Report — Microcosm" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: sim } = await supabase!.from("simulations").select("id, brief").eq("id", id).maybeSingle();
  if (!sim) notFound();

  const { data: reports } = await supabase!
    .from("reports").select("id, spec, version").eq("sim_id", id).order("version", { ascending: false }).limit(1);
  if (!reports?.length) notFound();

  const { data: postRows } = await supabase!
    .from("posts").select("seq, agent_key, tag, reply_to, content, cites").eq("sim_id", id).order("seq", { ascending: true });
  const posts: LivePost[] = (postRows ?? []).map((r) => {
    const meta = (r.cites as { cites?: { title: string; quote: string }[]; name?: string; role?: string; initials?: string; adversarial?: boolean; round?: number } | null) ?? {};
    return {
      seq: r.seq as number, agent_key: r.agent_key as string,
      name: meta.name ?? "Agent", role: meta.role ?? "", initials: meta.initials ?? "·",
      adversarial: meta.adversarial ?? false, tag: r.tag as string, reply_to: r.reply_to as number | null,
      content: r.content as string, cites: meta.cites ?? [], round: meta.round ?? 1,
    };
  });

  return (
    <ReportView
      simId={sim.id}
      problem={(sim.brief as { problem?: string } | null)?.problem ?? ""}
      spec={reports[0].spec as unknown as ReportSpec}
      posts={posts}
      version={reports[0].version as number}
    />
  );
}
