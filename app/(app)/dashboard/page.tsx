import { CSSProperties } from "react";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import SimCards, { SimCardRow } from "@/components/app/SimCards";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Simulations — Microcosm" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const supabase = await createServerSupabase();
  const { data } = await supabase!
    .from("simulations")
    .select("id, status, brief, created_at, documents(count), sim_agents(count)")
    .order("created_at", { ascending: false })
    .limit(24);

  const sims: SimCardRow[] = ((data ?? []) as {
    id: string; status: string; created_at: string;
    brief: { problem?: string; question?: string; questions?: unknown[] } | null;
    documents: { count: number }[];
    sim_agents: { count: number }[];
  }[]).map((s) => ({
    id: s.id,
    status: s.status,
    created_at: s.created_at,
    problem: s.brief?.problem ?? s.brief?.question ?? "Untitled simulation",
    questionCount: s.brief?.questions?.length ?? 0,
    docCount: s.documents?.[0]?.count ?? 0,
    seatCount: s.sim_agents?.[0]?.count ?? 0,
  }));

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
      <SimCards initialSims={sims} />
    </div>
  );
}
