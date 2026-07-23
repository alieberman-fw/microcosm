import { notFound } from "next/navigation";
import { DocsPage } from "@/components/app/docs/DocsShell";
import { DOC_META } from "@/components/app/docs/registry";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = DOC_META.find((p) => p.slug === slug);
  return { title: page ? `${page.title} — Microcosm Docs` : "Docs — Microcosm" };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!DOC_META.some((p) => p.slug === slug)) notFound();
  return <DocsPage slug={slug} />;
}
