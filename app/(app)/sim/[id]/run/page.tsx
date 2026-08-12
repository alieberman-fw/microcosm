import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import RunScreen from "@/components/app/RunScreen";
import LiveRun, { LiveLead, LivePost, LiveSentiment, LiveTool } from "@/components/app/LiveRun";
import { FrozenSpec } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig } from "@/lib/run";

export const metadata = { title: "Run — Microcosm" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ replay?: string; autostart?: string }>;
}) {
  const { id } = await params;
  const { replay, autostart } = await searchParams;
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
        kind: s.kind,
        tagline: s.tagline,
        stances: s.stances ?? [],
        backstory: s.backstory,
        spec: s, // full frozen spec → roster rail + PersonaProfile + canvas click
      };
    });
  const crowdCount = (agents ?? []).length - leads.length;
  const scale = ((sim.config as { casting?: { scale?: { experts?: number; residents?: number } } } | null)?.casting?.scale) ?? { experts: 0, residents: 0 };
  const residentLeads = leads.filter((l) => l.residentSide).length;
  const crowdTarget = Math.max((scale.experts ?? 0) - (leads.length - residentLeads), 0) + Math.max((scale.residents ?? 0) - residentLeads, 0);

  // the demo replay stays reachable — and is the default when nothing is cast
  if (replay === "1" || leads.length < 2) {
    return <RunScreen simId={sim.id} problem={problem} />;
  }

  const [{ data: postRows }, { data: eventRows }, { data: latestReportRows }, { data: voteRows }] = await Promise.all([
    supabase!.from("posts").select("seq, author, agent_key, thread, reply_to, tag, content, cites").eq("sim_id", id).order("seq", { ascending: true }),
    supabase!.from("events").select("type, payload").eq("sim_id", id).in("type", ["sentiment", "tool", "coverage", "agenda"]).order("seq", { ascending: true }),
    supabase!.from("reports").select("created_at").eq("sim_id", id).order("created_at", { ascending: false }).limit(1),
    supabase!.from("post_votes").select("seq, voter_key, voter_name, voter_role, vote").eq("sim_id", id),
  ]);
  const initialPosts: LivePost[] = (postRows ?? []).map((r) => {
    const meta = (r.cites as { cites?: { title: string; quote: string }[]; name?: string; role?: string; initials?: string; adversarial?: boolean; round?: number; phase?: string | null; side?: string | null } | null) ?? {};
    return {
      seq: r.seq as number, agent_key: r.agent_key as string, author: (r.author as string) ?? "agent",
      name: meta.name ?? "Agent", role: meta.role ?? "", initials: meta.initials ?? "·",
      adversarial: meta.adversarial ?? false,
      tag: r.tag as string, reply_to: r.reply_to as number | null, content: r.content as string,
      cites: meta.cites ?? [], round: meta.round ?? 1, phase: meta.phase, side: meta.side,
    };
  });
  const initialSentiments: LiveSentiment[] = (eventRows ?? []).filter((e) => e.type === "sentiment").map((e) => e.payload as unknown as LiveSentiment);
  const initialTools: LiveTool[] = (eventRows ?? []).filter((e) => e.type === "tool").map((e) => e.payload as unknown as LiveTool);
  // 6-PR3 — latest tracker scores + per-round agenda labels for replay
  const coverageRows = (eventRows ?? []).filter((e) => e.type === "coverage").map((e) => e.payload as { round?: number; scores?: { id: string; ask: string; score: number; missing: string }[] });
  const initialCoverage = coverageRows.length ? (coverageRows[coverageRows.length - 1].scores ?? []) : [];
  const initialAgendas: Record<number, { label: string; detail: string }> = {};
  for (const e of (eventRows ?? []).filter((x) => x.type === "agenda")) {
    const p = e.payload as { round?: number; label?: string; detail?: string };
    if (p.round && p.label) initialAgendas[p.round] = { label: p.label, detail: String(p.detail ?? "") };
  }
  // the contract's sub-asks seed the COVERAGE strip from launch (pending pills)
  const briefRow = (sim.brief ?? {}) as { contract?: { sub_asks?: { id?: string; ask?: string }[] } };
  const initialSubAsks = (briefRow.contract?.sub_asks ?? [])
    .filter((a) => a.id && a.ask)
    .map((a) => ({ id: String(a.id), ask: String(a.ask) }));
  const initialVotes = (voteRows ?? []).map((v) => ({
    seq: v.seq as number, voter_key: v.voter_key as string, voter_name: v.voter_name as string,
    voter_role: (v.voter_role as string) ?? "", vote: (v.vote as number) === -1 ? -1 as const : 1 as const,
  }));

  const cfg: RunConfig = { ...RUN_DEFAULTS, ...(((sim.config as { run?: Partial<RunConfig> } | null)?.run) ?? {}) };
  const configuredMode = String(((sim.config as { casting?: { mode?: string } } | null)?.casting?.mode) ?? "Agora");
  // a persisted transcript displays under the mode that PRODUCED it — changing
  // the configured mode never relabels an old run's posts
  const lastRunMode = ((sim.config as { run_result?: { mode?: string } } | null)?.run_result?.mode) ?? null;
  const displayMode = initialPosts.length > 0 && lastRunMode ? String(lastRunMode) : configuredMode;

  return (
    <LiveRun
      simId={sim.id}
      problem={problem}
      mode={displayMode}
      configuredMode={configuredMode}
      leads={leads}
      crowdCount={crowdCount}
      crowdTarget={crowdTarget}
      initialPosts={initialPosts}
      initialSentiments={initialSentiments}
      initialTools={initialTools}
      initialVotes={initialVotes}
      initialCoverage={initialCoverage}
      initialAgendas={initialAgendas}
      initialSubAsks={initialSubAsks}
      autoStart={autostart === "1"}
      initialStatus={sim.status as string}
      maxRounds={cfg.rounds}
      hasReport={(() => {
        // field report 3: a report is only "ready to read" if it covers the
        // LATEST run — after a re-run, the primary CTA must be SYNTHESIZE
        const latest = latestReportRows?.[0]?.created_at as string | undefined;
        if (!latest) return false;
        const runAt = (sim.config as { run_result?: { at?: string } } | null)?.run_result?.at;
        return !runAt || new Date(latest).getTime() >= new Date(runAt).getTime();
      })()}
      hasStaleReport={(latestReportRows?.length ?? 0) > 0}
    />
  );
}
