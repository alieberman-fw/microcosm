import { CSSProperties } from "react";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import SimCards, { SimCardRow } from "@/components/app/SimCards";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Simulations — Microcosm" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const supabase = await createServerSupabase();
  // sim_agents(count) is the whole population; the aliased crowd embed counts
  // seat.tier "crowd" rows so cards can report leads and crowd separately
  const { data } = await supabase!
    .from("simulations")
    .select("id, status, brief, config, created_at, documents(count), sim_agents(count), crowd:sim_agents(count), reports(count)")
    .eq("crowd.spec_frozen->seat->>tier", "crowd")
    .order("created_at", { ascending: false })
    .limit(200);

  const sims: SimCardRow[] = ((data ?? []) as {
    id: string; status: string; created_at: string;
    brief: { problem?: string; question?: string; questions?: unknown[]; contract?: { title?: string; mirror?: string } } | null;
    config: { name?: string; casting?: { mode?: string }; run_result?: { posts?: number; converged?: boolean; at?: string } } | null;
    documents: { count: number }[];
    sim_agents: { count: number }[];
    crowd: { count: number }[];
    reports: { count: number }[];
  }[]).map((s) => ({
    id: s.id,
    status: s.status,
    created_at: s.created_at,
    problem: s.brief?.problem ?? s.brief?.question ?? "Untitled simulation",
    // cards lead with a NAME: the user's rename first, then the understanding
    // pass's derived title; long free-form briefs collapse behind FULL BRIEF
    name: s.config?.name ?? s.brief?.contract?.title ?? null,
    summary: s.brief?.contract?.mirror ?? null,
    questionCount: s.brief?.questions?.length ?? 0,
    docCount: s.documents?.[0]?.count ?? 0,
    // leads = population minus crowd rows (lead seats may predate seat.tier)
    seatCount: Math.max(0, (s.sim_agents?.[0]?.count ?? 0) - (s.crowd?.[0]?.count ?? 0)),
    crowdCount: s.crowd?.[0]?.count ?? 0,
    mode: s.config?.casting?.mode ?? null,
    runPosts: s.config?.run_result?.posts ?? null,
    reportCount: s.reports?.[0]?.count ?? 0,
  }));

  // favorites (1b): the user's starred sims float first and power ★ FAVORITES
  const { data: { user: authUser } } = await supabase!.auth.getUser();
  const { data: prefRow } = authUser
    ? await supabase!.from("users").select("prefs").eq("id", authUser.id).single()
    : { data: null };
  const starredSims = (((prefRow?.prefs ?? {}) as { starred_sims?: string[] }).starred_sims) ?? [];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div className="kicker">Simulations</div>
          <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>Your runs</h1>
        </div>
        <Link
          href="/sim/new"
          style={{
            background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 13.5,
            padding: "11px 22px", borderRadius: 100,
          }}
        >
          New simulation →
        </Link>
      </div>
      {sims.length === 0 && (
        <p style={{ ...mono, marginTop: 30, fontSize: 11, letterSpacing: ".05em", color: "var(--t6)" }}>
          NO RUNS YET — START WITH THE BRIEF COMPOSER
        </p>
      )}
      <SimCards initialSims={sims} initialStarred={starredSims} />
    </div>
  );
}
