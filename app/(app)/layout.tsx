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

  return (
    <AppShell email={user.email ?? "account"} orgName={orgName}>
      {children}
    </AppShell>
  );
}
