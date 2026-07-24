import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { ReportSpec } from "@/lib/report";

export const metadata = { title: "Reports — Microcosm" };
export const dynamic = "force-dynamic";

/** All reports in the org (RLS scopes through simulations → projects). */
export default async function ReportsPage() {
  const supabase = await createServerSupabase();
  const { data: reports } = await supabase!
    .from("reports").select("id, sim_id, version, spec").order("id", { ascending: false }).limit(50);
  const simIds = [...new Set((reports ?? []).map((r) => r.sim_id as string))];
  const { data: sims } = simIds.length
    ? await supabase!.from("simulations").select("id, brief").in("id", simIds)
    : { data: [] as { id: string; brief: unknown }[] };
  const problemOf = new Map((sims ?? []).map((s) => [s.id as string, ((s.brief as { problem?: string } | null)?.problem ?? "Untitled simulation")]));

  // newest report per simulation
  const latest = new Map<string, { id: string; sim_id: string; version: number; spec: ReportSpec }>();
  for (const r of reports ?? []) {
    const key = r.sim_id as string;
    if (!latest.has(key)) latest.set(key, r as unknown as { id: string; sim_id: string; version: number; spec: ReportSpec });
  }

  const mono = { fontFamily: "var(--font-mono), monospace" } as const;
  const tone = (t: string) => (t === "go" ? "var(--acc)" : t === "split" ? "var(--t4)" : "var(--warn)");

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "42px 32px 80px" }}>
      <div style={{ ...mono, fontSize: 11, letterSpacing: ".14em", color: "var(--acc)" }}>REPORTS</div>
      <h1 style={{ fontSize: "clamp(26px, 3.2vw, 38px)", fontWeight: 600, letterSpacing: "-.025em", margin: "10px 0 8px" }}>
        Decision-grade output
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--t5)", maxWidth: 640, margin: 0 }}>
        Every completed run synthesizes into an interactive report — verdict, scores, cited findings,
        preserved dissents. Reports stay linked to their transcript forever.
      </p>
      {latest.size === 0 ? (
        <div className="card" style={{ marginTop: 30, padding: "26px 28px", maxWidth: 560 }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--t6)" }}>NO REPORTS YET</div>
          <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "var(--t5)" }}>
            Run a simulation, then hit “Synthesize the report” on the run screen.
            <Link href="/dashboard" style={{ color: "var(--acc)" }}> Your simulations →</Link>
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, marginTop: 30 }}>
          {[...latest.values()].map((r) => (
            <Link key={r.id} href={`/sim/${r.sim_id}/report`}>
              <div className="card" style={{ padding: "22px 24px", height: "100%", boxSizing: "border-box", cursor: "pointer" }}>
                <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", padding: "4px 12px", borderRadius: 100, border: `1px solid ${tone(r.spec.verdict.tone)}`, color: tone(r.spec.verdict.tone) }}>
                  {r.spec.verdict.label}
                </span>
                <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.4, margin: "12px 0 8px" }}>
                  {problemOf.get(r.sim_id)}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t5)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {r.spec.verdict.headline}
                </div>
                <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t7)", marginTop: 12 }}>
                  V{r.version} · {r.spec.methodology.mode.toUpperCase()} · {r.spec.methodology.posts} POSTS · {r.spec.dissents.length} DISSENTS
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
