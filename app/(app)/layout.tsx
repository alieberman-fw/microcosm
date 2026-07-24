import { redirect } from "next/navigation";
import AppShell from "@/components/app/AppShell";
import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) redirect("/login");
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  if (!user) redirect("/login");

  const { data: userRow } = await supabase!
    .from("users").select("org_id, orgs(name)").eq("id", user.id).single();
  const orgName = (userRow as { orgs?: { name?: string } } | null)?.orgs?.name ?? "personal";

  // recent simulations for the sidebar history sub-menu
  const { data: recentSims } = await supabase!
    .from("simulations").select("id, status, brief, config")
    .order("created_at", { ascending: false }).limit(6);
  const recent = (recentSims ?? []).map((s) => ({
    id: s.id as string,
    status: s.status as string,
    problem: String((s.brief as { problem?: string } | null)?.problem ?? "Untitled").slice(0, 60),
    ran: !!((s.config as { run_result?: unknown } | null)?.run_result),
  }));

  return (
    <AppShell email={user.email ?? "account"} orgName={orgName} recentSims={recent}>
      {children}
    </AppShell>
  );
}
