import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import RunScreen from "@/components/app/RunScreen";
import LiveRun, { LiveLead, LivePost, LiveSentiment } from "@/components/app/LiveRun";
import { FrozenSpec } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig } from "@/lib/run";

export const metadata = { title: "Run — Microcosm" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ replay?: string }>;
}) {
  const { id } = await params;
  const { replay } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: sim } = await supabase!
    .from("simulations").select("id, status, brief, config").eq("id", id).maybeSingle();
  if (!sim) notFound();
  const problem = (sim.brief as { problem?: string } | null)?.problem ?? "";

  const { data: agents } = await supabase!.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id);
  const leads: LiveLead[] = (agents ?? [])
    .filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd")
    .map((a) => {
      const s = a.spec_frozen as FrozenSpec;
      return {
        key: a.agent_key as string,
        name: s.name, initials: s.initials, role: s.seat?.role ?? s.role,
        discipline: s.seat?.discipline || s.discipline,
        adversarial: s.seat?.adversarial || s.kind === "adversarial",
        residentSide: s.kind === "consumer" || s.kind === "resident",
      };
    });
  const crowdCount = (agents ?? []).length - leads.length;

  // the demo replay stays reachable — and is the default when nothing is cast
  if (replay === "1" || leads.length < 2) {
    return <RunScreen simId={sim.id} problem={problem} />;
  }

  const [{ data: postRows }, { data: eventRows }] = await Promise.all([
    supabase!.from("posts").select("seq, agent_key, thread, reply_to, tag, content, cites").eq("sim_id", id).order("seq", { ascending: true }),
    supabase!.from("events").select("type, payload").eq("sim_id", id).eq("type", "sentiment").order("seq", { ascending: true }),
  ]);
  const initialPosts: LivePost[] = (postRows ?? []).map((r) => {
    const meta = (r.cites as { cites?: { title: string; quote: string }[]; name?: string; role?: string; initials?: string; adversarial?: boolean; round?: number; phase?: string | null; side?: string | null } | null) ?? {};
    return {
      seq: r.seq as number, agent_key: r.agent_key as string,
      name: meta.name ?? "Agent", role: meta.role ?? "", initials: meta.initials ?? "·",
      adversarial: meta.adversarial ?? false,
      tag: r.tag as string, reply_to: r.reply_to as number | null, content: r.content as string,
      cites: meta.cites ?? [], round: meta.round ?? 1, phase: meta.phase, side: meta.side,
    };
  });
  const initialSentiments: LiveSentiment[] = (eventRows ?? []).map((e) => e.payload as unknown as LiveSentiment);

  const cfg: RunConfig = { ...RUN_DEFAULTS, ...(((sim.config as { run?: Partial<RunConfig> } | null)?.run) ?? {}) };
  const mode = String(((sim.config as { casting?: { mode?: string } } | null)?.casting?.mode) ?? "Agora");

  return (
    <LiveRun
      simId={sim.id}
      problem={problem}
      mode={mode}
      leads={leads}
      crowdCount={crowdCount}
      initialPosts={initialPosts}
      initialSentiments={initialSentiments}
      initialStatus={sim.status as string}
      maxRounds={cfg.rounds}
    />
  );
}
