import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import ReportView from "@/components/app/ReportView";
import { ReportSpec } from "@/lib/report";
import { imageOrdinalsSafe } from "@/lib/corpus";
import { LivePost } from "@/components/app/LiveRun";

export const metadata = { title: "Report — Microcosm" };
export const dynamic = "force-dynamic";

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: sim } = await supabase!.from("simulations").select("id, brief, config").eq("id", id).maybeSingle();
  if (!sim) notFound();

  const { data: reports } = await supabase!
    .from("reports").select("id, spec, version").eq("sim_id", id).order("version", { ascending: false });
  if (!reports?.length) notFound();
  const versions = reports.map((r) => r.version as number);
  const wanted = v ? Number(v) : versions[0];
  const report = reports.find((r) => r.version === wanted) ?? reports[0];
  const spec = report.spec as unknown as ReportSpec;

  // reports carry their own frozen transcript (v2+); older ones fall back to live posts
  let posts: LivePost[];
  if (spec.transcript?.length) {
    posts = spec.transcript.map((t) => ({
      seq: t.seq, agent_key: "", name: t.name, role: t.role, initials: t.initials,
      adversarial: t.adversarial, tag: t.tag, reply_to: null, content: t.content, cites: [], round: t.round,
    }));
  } else {
    const { data: postRows } = await supabase!
      .from("posts").select("seq, agent_key, tag, reply_to, content, cites").eq("sim_id", id).order("seq", { ascending: true });
    posts = (postRows ?? []).map((r) => {
      const meta = (r.cites as { cites?: { title: string; quote: string }[]; name?: string; role?: string; initials?: string; adversarial?: boolean; round?: number } | null) ?? {};
      return {
        seq: r.seq as number, agent_key: r.agent_key as string,
        name: meta.name ?? "Agent", role: meta.role ?? "", initials: meta.initials ?? "·",
        adversarial: meta.adversarial ?? false, tag: r.tag as string, reply_to: r.reply_to as number | null,
        content: r.content as string, cites: meta.cites ?? [], round: meta.round ?? 1,
      };
    });
  }

  // PR-A: sign the decision-critical media so the report can SHOW the winning
  // photo / key document — signed at view time, never stored in the spec
  const mediaUrls: Record<string, string> = {};
  for (const m of spec.media ?? []) {
    const { data } = await supabase!.storage.from("documents").createSignedUrl(m.path, 3600);
    if (data?.signedUrl) mediaUrls[m.path] = data.signedUrl;
  }

  // C6 (field-report 2): the FILE RAIL — every upload in canonical corpus
  // order, carrying the SAME "IMAGE n" ordinal agents see in their context
  // (buildCorpusBlocks numbers images by created_at). Rendered for every
  // report, independent of which files the synthesizer picked as media.
  const { data: docRows } = await supabase!
    .from("documents").select("name, mime, storage_path, parse_status").eq("sim_id", id)
    .eq("parse_status", "parsed").order("created_at", { ascending: true });
  // ordinal chips only when they can't contradict filename digits (field
  // report 3: "IMAGE 1 = 3.webp" vs the panel's "Image 1 = 1.jpg")
  const imageNames = (docRows ?? []).filter((d) => ((d.mime as string | null) ?? "").startsWith("image/")).map((d) => d.name as string);
  const useOrdinals = imageOrdinalsSafe(imageNames);
  let imageOrdinal = 0;
  const files: { name: string; kind: "image" | "document"; ordinal: number | null; url?: string }[] = [];
  for (const d of docRows ?? []) {
    const isImage = ((d.mime as string | null) ?? "").startsWith("image/");
    let url: string | undefined;
    if (d.storage_path) {
      const { data } = await supabase!.storage.from("documents").createSignedUrl(d.storage_path as string, 3600);
      url = data?.signedUrl;
    }
    if (isImage) imageOrdinal += 1;
    files.push({ name: d.name as string, kind: isImage ? "image" : "document", ordinal: isImage && useOrdinals ? imageOrdinal : null, url });
  }

  return (
    <ReportView
      simId={sim.id}
      problem={(sim.brief as { problem?: string } | null)?.problem ?? ""}
      name={
        spec.name
        ?? (sim.config as { name?: string } | null)?.name
        ?? (sim.brief as { contract?: { title?: string } } | null)?.contract?.title
        ?? null
      }
      spec={spec}
      posts={posts}
      version={report.version as number}
      versions={versions}
      reportId={report.id as string}
      mediaUrls={mediaUrls}
      files={files}
    />
  );
}
