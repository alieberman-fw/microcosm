import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import MonitoringClient, { InteractionRow, ConvMeta, RollupRow } from "@/components/app/MonitoringClient";

export const metadata = { title: "Monitoring — Microcosm" };
export const dynamic = "force-dynamic";

export default async function Monitoring() {
  const supabase = await createServerSupabase();
  await getLocalUser(supabase!);

  // the browsing table stays a recent-rows window; the ANALYTICS come from the
  // SQL rollup — raw rows hit PostgREST's 1,000-row cap on heavy days and made
  // history look deleted
  const [{ data }, { data: rollupRows }, { count: totalCount }] = await Promise.all([
    supabase!
      .from("agent_interactions")
      .select("id, surface, agent_name, model, input_tokens, output_tokens, latency_ms, status, error, created_at, conversation_id, sim_id, detail")
      .order("id", { ascending: false })
      .limit(500),
    supabase!.rpc("activity_rollup", { p_days: 14 }),
    supabase!.from("agent_interactions").select("id", { count: "exact", head: true }),
  ]);
  const rows = (data ?? []) as InteractionRow[];
  const rollup = (rollupRows ?? []) as RollupRow[];

  // conversation context for the drill-down panels
  const convIds = [...new Set(rows.map((r) => r.conversation_id).filter((x): x is string => Boolean(x)))];
  const convMap: Record<string, ConvMeta> = {};
  if (convIds.length) {
    const { data: convs } = await supabase!
      .from("conversations")
      .select("id, title, participant_keys")
      .in("id", convIds);
    (convs ?? []).forEach((c) => {
      convMap[c.id as string] = { title: c.title as string, participants: (c.participant_keys as string[]).length };
    });
  }

  return <MonitoringClient rows={rows} rollup={rollup} conversations={convMap} total={totalCount ?? rows.length} />;
}
