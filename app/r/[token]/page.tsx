import { CSSProperties } from "react";
import ReportView from "@/components/app/ReportView";
import { ReportSpec } from "@/lib/report";
import { LivePost } from "@/components/app/LiveRun";
import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * The magic-link view (pre-5a feature batch): /r/<token> renders one
 * simulation's LATEST report, read-only, to anyone holding a live link —
 * no login, no app chrome, no workspace/run links, no rename, no file
 * rail. Reads run through the SERVICE ROLE only after the token checks
 * out (anon has no policy on report_links or reports at all).
 */

export const metadata = { title: "Shared report — Microcosm" };
export const dynamic = "force-dynamic";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

function DeadLink({ reason }: { reason: string }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div className="card" style={{ maxWidth: 460, padding: "30px 34px", textAlign: "center" }}>
        <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" }}>MICROCOSM · SHARED REPORT</div>
        <h1 style={{ margin: "14px 0 0", fontSize: 21, fontWeight: 600, letterSpacing: "-.02em" }}>{reason}</h1>
        <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "var(--t5)" }}>
          Ask whoever sent it to mint a fresh link from the report&rsquo;s SHARE panel.
        </p>
      </div>
    </div>
  );
}

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminSupabase();
  if (!admin || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return <DeadLink reason="This link isn't available" />;

  const { data: link } = await admin.from("report_links")
    .select("sim_id, expires_at, revoked_at").eq("token", token).maybeSingle();
  if (!link) return <DeadLink reason="This link isn't available" />;
  if (link.revoked_at) return <DeadLink reason="This link was revoked" />;
  if (link.expires_at && Date.parse(link.expires_at as string) < Date.now()) return <DeadLink reason="This link has expired" />;

  const { data: sim } = await admin.from("simulations")
    .select("id, brief, config").eq("id", link.sim_id).maybeSingle();
  const { data: reports } = await admin.from("reports")
    .select("spec, version").eq("sim_id", link.sim_id).order("version", { ascending: false }).limit(1);
  const report = reports?.[0];
  if (!sim || !report) return <DeadLink reason="This report isn't available" />;
  const spec = report.spec as unknown as ReportSpec;

  // the shared view leans on the report's FROZEN transcript (v2+); legacy
  // specs without one share the report body with citations un-expandable
  const posts: LivePost[] = (spec.transcript ?? []).map((t) => ({
    seq: t.seq, agent_key: "", name: t.name, role: t.role, initials: t.initials,
    adversarial: t.adversarial, tag: t.tag, reply_to: null, content: t.content, cites: [], round: t.round,
  }));

  // decision-critical media stays part of the report's argument — signed
  // short-lived; the raw corpus file rail does NOT ship to outsiders
  const mediaUrls: Record<string, string> = {};
  for (const m of spec.media ?? []) {
    const { data } = await admin.storage.from("documents").createSignedUrl(m.path, 3600);
    if (data?.signedUrl) mediaUrls[m.path] = data.signedUrl;
  }

  const name =
    (sim.config as { name?: string } | null)?.name
    ?? (sim.brief as { contract?: { title?: string } } | null)?.contract?.title
    ?? spec.name
    ?? null;

  return (
    <ReportView
      shared
      simId={sim.id as string}
      problem={(sim.brief as { problem?: string } | null)?.problem ?? ""}
      name={name}
      spec={spec}
      posts={posts}
      version={report.version as number}
      mediaUrls={mediaUrls}
    />
  );
}
