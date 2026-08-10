import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import HomeClient, {
  ChecklistState, HomeActivityDay, HomeConversation, HomePersona, HomeReport, HomeSeries, HomeSim, HomeStats,
} from "@/components/app/HomeClient";
import { PersonaSpec } from "@/lib/personas";
import { ReportSpec } from "@/lib/report";
import { ReportState, reportSynthFresh } from "@/lib/report-state";

export const metadata = { title: "Home — Microcosm" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!
    .from("users").select("org_id, prefs").eq("id", user!.id).single();
  const prefs = (userRow?.prefs ?? {}) as { hide_onboarding?: boolean };
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    { data: convRows, count: convCount },
    { data: personaRows, count: personaCount },
    { data: searchHit },
    { data: attachHit },
    { data: simRows, count: simCount },
    { count: runCount },
    { data: reportRows, count: reportCount },
    { data: activityRows },
    { data: simDates },
    { data: msgDates },
    { data: toneRows },
    { data: modeRows },
  ] = await Promise.all([
    // persona/conversation rows are ~half the height of a report row, so 8 of
    // each fills the lane beside 4 reports instead of leaving dead space
    supabase!
      .from("conversations")
      .select("id, title, participant_keys, updated_at, conversation_messages(count)", { count: "exact" })
      .eq("kind", "chat")
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase!
      .from("personas")
      .select("id, kind, spec", { count: "exact" })
      .eq("org_id", userRow!.org_id as string)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase!.from("agent_interactions").select("id").eq("surface", "library.search").limit(1),
    supabase!.from("conversation_messages").select("id").neq("attachments", "[]").limit(1),
    supabase!
      .from("simulations")
      .select("id, status, brief, config, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(8),
    supabase!.from("simulations").select("id", { count: "exact", head: true }).eq("status", "complete"),
    supabase!
      .from("reports")
      .select("id, sim_id, spec, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(4),
    // server-side rollup — raw-row fetches hit PostgREST's 1,000-row response
    // cap on heavy days, which erased every earlier day from the chart
    supabase!.rpc("activity_rollup", { p_days: 14 }),
    supabase!.from("simulations").select("created_at").gte("created_at", since30).limit(2000),
    supabase!.from("conversation_messages").select("created_at").gte("created_at", since30).limit(5000),
    supabase!.from("reports").select("tone:spec->verdict->>tone, lead_kind:spec->lead->>kind").limit(500),
    supabase!.from("simulations").select("mode:config->run_result->>mode").limit(1000),
  ]);

  const convs = (convRows ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string,
    participants: (c.participant_keys as string[]).length,
    messages: (c.conversation_messages as { count: number }[] | null)?.[0]?.count ?? 0,
    updated_at: c.updated_at as string,
  })) as HomeConversation[];

  const sims: HomeSim[] = (simRows ?? []).map((s) => {
    const cfg = (s.config ?? {}) as { casting?: { mode?: string }; run_result?: { mode?: string; posts?: number }; report_state?: ReportState };
    // PR D: a report being synthesized right now — the ONE shared freshness
    // rule (lib/report-state), same as the run screen and the workspace
    const synthesizing = reportSynthFresh(cfg.report_state, Date.now());
    return {
      id: s.id as string,
      problem: ((s.brief as { problem?: string } | null)?.problem ?? "Untitled simulation").slice(0, 200),
      status: s.status as string,
      mode: cfg.run_result?.mode ?? cfg.casting?.mode ?? null,
      posts: cfg.run_result?.posts ?? 0,
      created_at: s.created_at as string,
      synthesizing,
    };
  });

  const reports: HomeReport[] = (reportRows ?? []).map((r) => {
    const spec = r.spec as unknown as ReportSpec;
    return {
      sim_id: r.sim_id as string,
      label: spec.verdict.label,
      tone: spec.verdict.tone,
      headline: spec.verdict.headline,
      created_at: r.created_at as string,
    };
  });

  // 14-day activity from the SQL rollup (activity_rollup RPC) — exact per-day
  // counts regardless of volume; one heavy day can no longer blank the rest
  const dayKey = (iso: string) => iso.slice(0, 10);
  const byDay = new Map<string, { calls: number; tokens: number }>();
  for (let i = 13; i >= 0; i--) {
    byDay.set(dayKey(new Date(Date.now() - i * 86_400_000).toISOString()), { calls: 0, tokens: 0 });
  }
  for (const r of (activityRows ?? []) as { day: string; calls: number; tokens_in: number; tokens_out: number }[]) {
    const slot = byDay.get(dayKey(String(r.day)));
    if (slot) {
      slot.calls += Number(r.calls) || 0;
      slot.tokens += (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0);
    }
  }
  const activity: HomeActivityDay[] = [...byDay.entries()].map(([day, v]) => ({ day, ...v }));

  // 30-day creation series (simulations · conversation messages), one slot per day
  const series30 = (rows: { created_at: string }[] | null): HomeSeries[] => {
    const m = new Map<string, number>();
    for (let i = 29; i >= 0; i--) m.set(dayKey(new Date(Date.now() - i * 86_400_000).toISOString()), 0);
    for (const r of rows ?? []) {
      const k = dayKey(r.created_at);
      if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([day, value]) => ({ day, value }));
  };
  const sims30 = series30(simDates as { created_at: string }[] | null);
  const msgs30 = series30(msgDates as { created_at: string }[] | null);

  // outcomes: verdict tones across every report + which modes actually ran.
  // 3b: non-decision leads (key finding / price range / approval odds) bucket
  // as INSIGHT — exclusive, so the stacked bar always sums to the report count
  const verdictMix: Record<string, number> = {};
  for (const r of (toneRows ?? []) as { tone: string | null; lead_kind?: string | null }[]) {
    const bucket = r.lead_kind && r.lead_kind !== "decision" ? "insight" : r.tone;
    if (bucket) verdictMix[bucket] = (verdictMix[bucket] ?? 0) + 1;
  }
  const modeCounts = new Map<string, number>();
  for (const r of (modeRows ?? []) as { mode: string | null }[]) {
    if (r.mode) modeCounts.set(r.mode, (modeCounts.get(r.mode) ?? 0) + 1);
  }
  const modeMix = [...modeCounts.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count);

  const stats: HomeStats = {
    sims: simCount ?? 0,
    runs: runCount ?? 0,
    reports: reportCount ?? 0,
    personas: personaCount ?? 0,
    conversations: convCount ?? 0,
    calls14: activity.reduce((s, d) => s + d.calls, 0),
    tokens14: activity.reduce((s, d) => s + d.tokens, 0),
  };

  const checklist: ChecklistState = {
    conversation: (convCount ?? 0) > 0,
    group: convs.some((c) => c.participants > 1),
    persona: (personaCount ?? 0) > 0,
    search: (searchHit ?? []).length > 0,
    attachment: (attachHit ?? []).length > 0,
    simulate: (simCount ?? 0) > 0,
  };

  return (
    <HomeClient
      email={user?.email ?? "you"}
      checklist={checklist}
      hideChecklist={Boolean(prefs.hide_onboarding)}
      conversations={convs}
      personas={(personaRows ?? []).map((p) => ({ id: p.id as string, kind: p.kind as string, spec: p.spec as PersonaSpec })) as HomePersona[]}
      sims={sims}
      reports={reports}
      stats={stats}
      activity={activity}
      sims30={sims30}
      msgs30={msgs30}
      verdictMix={verdictMix}
      modeMix={modeMix}
    />
  );
}
