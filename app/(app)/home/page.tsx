import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import HomeClient, {
  ChecklistState, HomeActivityDay, HomeConversation, HomePersona, HomeReport, HomeSim, HomeStats,
} from "@/components/app/HomeClient";
import { PersonaSpec } from "@/lib/personas";
import { ReportSpec } from "@/lib/report";

export const metadata = { title: "Home — Microcosm" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!
    .from("users").select("org_id, prefs").eq("id", user!.id).single();
  const prefs = (userRow?.prefs ?? {}) as { hide_onboarding?: boolean };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const [
    { data: convRows, count: convCount },
    { data: personaRows, count: personaCount },
    { data: searchHit },
    { data: attachHit },
    { data: simRows, count: simCount },
    { count: runCount },
    { data: reportRows, count: reportCount },
    { data: activityRows },
  ] = await Promise.all([
    supabase!
      .from("conversations")
      .select("id, title, participant_keys, updated_at, conversation_messages(count)", { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase!
      .from("personas")
      .select("id, kind, spec", { count: "exact" })
      .eq("org_id", userRow!.org_id as string)
      .order("created_at", { ascending: false })
      .limit(5),
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
    supabase!
      .from("agent_interactions")
      .select("created_at, input_tokens, output_tokens")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  const convs = (convRows ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string,
    participants: (c.participant_keys as string[]).length,
    messages: (c.conversation_messages as { count: number }[] | null)?.[0]?.count ?? 0,
    updated_at: c.updated_at as string,
  })) as HomeConversation[];

  const sims: HomeSim[] = (simRows ?? []).map((s) => {
    const cfg = (s.config ?? {}) as { casting?: { mode?: string }; run_result?: { mode?: string; posts?: number } };
    return {
      id: s.id as string,
      problem: ((s.brief as { problem?: string } | null)?.problem ?? "Untitled simulation").slice(0, 200),
      status: s.status as string,
      mode: cfg.run_result?.mode ?? cfg.casting?.mode ?? null,
      posts: cfg.run_result?.posts ?? 0,
      created_at: s.created_at as string,
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

  // 14-day activity, aggregated per UTC day — the dashboard's bar strip
  const dayKey = (iso: string) => iso.slice(0, 10);
  const byDay = new Map<string, { calls: number; tokens: number }>();
  for (let i = 13; i >= 0; i--) {
    byDay.set(dayKey(new Date(Date.now() - i * 86_400_000).toISOString()), { calls: 0, tokens: 0 });
  }
  for (const r of activityRows ?? []) {
    const slot = byDay.get(dayKey(r.created_at as string));
    if (slot) {
      slot.calls += 1;
      slot.tokens += (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0);
    }
  }
  const activity: HomeActivityDay[] = [...byDay.entries()].map(([day, v]) => ({ day, ...v }));

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
    />
  );
}
