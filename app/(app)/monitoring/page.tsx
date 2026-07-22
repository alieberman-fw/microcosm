import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import MonitoringClient, { InteractionRow, ConvMeta } from "@/components/app/MonitoringClient";

export const metadata = { title: "Monitoring — Microcosm" };
export const dynamic = "force-dynamic";

export default async function Monitoring() {
  const supabase = await createServerSupabase();
  await getLocalUser(supabase!);

  const { data } = await supabase!
    .from("agent_interactions")
    .select("id, surface, agent_name, model, input_tokens, output_tokens, latency_ms, status, error, created_at, conversation_id, sim_id, detail")
    .order("id", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as InteractionRow[];

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

  return <MonitoringClient rows={rows} conversations={convMap} />;
}
