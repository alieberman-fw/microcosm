import { createServerSupabase } from "@/lib/supabase/server";
import { ReportSpec, fmtMoney } from "@/lib/report";
import ReportsClient, { ReportRow } from "@/components/app/ReportsClient";

/** 3b — the card chip for non-decision leads: the committed metric itself */
function leadMetricOf(spec: ReportSpec): string | undefined {
  const l = spec.lead;
  if (!l || l.kind === "decision") return undefined;
  if (l.kind === "price_range" && l.low && l.high) return `${fmtMoney(l.low, l.currency ?? "$")}–${fmtMoney(l.high, l.currency ?? "$")}`;
  if (l.kind === "approval_odds" && typeof l.odds === "number") return `${Math.round(l.odds)}% ${l.band ? l.band.toUpperCase() : "ODDS"}`;
  return "KEY FINDING";
}

export const metadata = { title: "Reports — Microcosm" };
export const dynamic = "force-dynamic";

/** All reports in the org (RLS scopes through simulations → projects). */
export default async function ReportsPage() {
  const supabase = await createServerSupabase();
  const { data: reports } = await supabase!
    .from("reports").select("id, sim_id, version, spec, created_at")
    .order("created_at", { ascending: false }).limit(200);
  const simIds = [...new Set((reports ?? []).map((r) => r.sim_id as string))];
  const { data: sims } = simIds.length
    ? await supabase!.from("simulations").select("id, brief, config").in("id", simIds)
    : { data: [] as { id: string; brief: unknown; config: unknown }[] };
  const problemOf = new Map((sims ?? []).map((s) => [s.id as string, ((s.brief as { problem?: string } | null)?.problem ?? "Untitled simulation")]));
  // ONE name, owned by the simulation (field fix: renaming the sim must
  // reflect in its reports instantly): the sim's rename, else the
  // understanding pass's title — spec.name only as a legacy fallback
  const simNameOf = new Map((sims ?? []).map((s) => {
    const cfg = s.config as { name?: string } | null;
    const contract = (s.brief as { contract?: { title?: string } } | null)?.contract;
    return [s.id as string, cfg?.name ?? contract?.title ?? null];
  }));

  const rows: ReportRow[] = (reports ?? []).map((r) => {
    const spec = r.spec as unknown as ReportSpec;
    return {
      id: r.id as string,
      sim_id: r.sim_id as string,
      version: r.version as number,
      name: simNameOf.get(r.sim_id as string) ?? spec.name ?? null,
      created_at: (r.created_at as string) ?? spec.methodology.generated_at,
      tone: spec.verdict.tone,
      label: spec.verdict.label,
      headline: spec.verdict.headline,
      leadKind: spec.lead?.kind,
      leadMetric: leadMetricOf(spec),
      problem: problemOf.get(r.sim_id as string) ?? "Untitled simulation",
      mode: spec.methodology.mode,
      posts: spec.methodology.posts,
      dissents: spec.dissents.length,
    };
  });

  // favorites (1b): starred report sets (keyed by sim) float first
  const { data: { user: authUser } } = await supabase!.auth.getUser();
  const { data: prefRow } = authUser
    ? await supabase!.from("users").select("prefs").eq("id", authUser.id).single()
    : { data: null };
  const starredReports = (((prefRow?.prefs ?? {}) as { starred_reports?: string[] }).starred_reports) ?? [];

  const mono = { fontFamily: "var(--font-mono), monospace" } as const;

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
      <ReportsClient initialRows={rows} initialStarred={starredReports} />
    </div>
  );
}
