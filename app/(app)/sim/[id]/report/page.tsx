import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import ReportView from "@/components/app/ReportView";
import { ReportSpec } from "@/lib/report";
import { LivePost } from "@/components/app/LiveRun";

export const metadata = { title: "Report — Microcosm" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: sim } = await supabase!.from("simulations").select("id, brief").eq("id", id).maybeSingle();
  if (!sim) notFound();

  const { data: reports } = await supabase!
    .from("reports").select("id, spec, version").eq("sim_id", id).order("version", { ascending: false });
  if (!reports?.length) notFound();
  const versions = reports.map((r) => r.version as number);
  const wanted = v ? Number(v) : versions[0];
  const report = reports.find((r) => r.version === wanted) ?? reports[0];
  const spec = report.spec as unknown as ReportSpec;

  // reports carry their own frozen transcript (v2+); older ones fall back to live posts
  let posts: LivePost[];
  if (spec.transcript?.length) {
    posts = spec.transcript.map((t) => ({
      seq: t.seq, agent_key: "", name: t.name, role: t.role, initials: t.initials,
      adversarial: t.adversarial, tag: t.tag, reply_to: null, content: t.content, cites: [], round: t.round,
    }));
  } else {
    const { data: postRows } = await supabase!
      .from("posts").select("seq, agent_key, tag, reply_to, content, cites").eq("sim_id", id).order("seq", { ascending: true });
    posts = (postRows ?? []).map((r) => {
      const meta = (r.cites as { cites?: { title: string; quote: string }[]; name?: string; role?: string; initials?: string; adversarial?: boolean; round?: number } | null) ?? {};
      return {
        seq: r.seq as number, agent_key: r.agent_key as string,
        name: meta.name ?? "Agent", role: meta.role ?? "", initials: meta.initials ?? "·",
        adversarial: meta.adversarial ?? false, tag: r.tag as string, reply_to: r.reply_to as number | null,
        content: r.content as string, cites: meta.cites ?? [], round: meta.round ?? 1,
      };
    });
  }

  return (
    <ReportView
      simId={sim.id}
      problem={(sim.brief as { problem?: string } | null)?.problem ?? ""}
      spec={spec}
      posts={posts}
      version={report.version as number}
      versions={versions}
      reportId={report.id as string}
    />
  );
}
