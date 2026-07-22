"use client";

/**
 * The docs surface: index grid + per-page layout with a sticky section rail.
 * Same look as the rest of the app — kicker/h2 rhythm, cards, mono labels.
 */

import { CSSProperties } from "react";
import Link from "next/link";
import { DOC_META } from "@/components/app/docs/registry";
import { DOC_RENDER } from "@/components/app/docs/content";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export function DocsIndex() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "42px 32px 80px" }}>
      <div style={{ ...mono, fontSize: 11, letterSpacing: ".14em", color: "var(--acc)" }}>DOCS</div>
      <h1 style={{ fontSize: "clamp(26px, 3.2vw, 38px)", fontWeight: 600, letterSpacing: "-.025em", margin: "10px 0 8px" }}>
        How Microcosm works
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--t5)", maxWidth: 640, margin: 0 }}>
        Everything from the idea to your first run — what simulations are, the language of leads and
        crowds, the seven interaction modes, and every control on the way to a report. Docs grow with
        the product: every new feature lands here too.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginTop: 34 }}>
        {DOC_META.map((p, i) => (
          <Link key={p.slug} href={`/docs/${p.slug}`} style={{ display: "block" }}>
            <div className="card" style={{ padding: "22px 24px", height: "100%", boxSizing: "border-box", animation: `fadeUp .5s ease ${i * 0.06}s both`, cursor: "pointer" }}>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".12em", color: "var(--acc)" }}>{p.kicker}</div>
              <div style={{ fontSize: 17, fontWeight: 600, margin: "10px 0 8px", letterSpacing: "-.01em" }}>{p.title}</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--t5)" }}>{p.blurb}</div>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)", marginTop: 14 }}>READ →</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DocsPage({ slug }: { slug: string }) {
  const idx = DOC_META.findIndex((p) => p.slug === slug);
  const page = DOC_META[idx];
  const Body = DOC_RENDER[slug];
  if (!page || !Body) return null;
  const prev = DOC_META[idx - 1];
  const next = DOC_META[idx + 1];
  return (
    <div style={{ display: "flex", gap: 40, maxWidth: 1080, margin: "0 auto", padding: "42px 32px 80px", alignItems: "flex-start" }}>
      {/* rail */}
      <nav style={{ width: 190, flex: "none", position: "sticky", top: 42, display: "flex", flexDirection: "column", gap: 2 }} className="docsRail">
        <Link href="/docs" style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--t6)", padding: "6px 10px" }}>← ALL DOCS</Link>
        <div style={{ height: 8 }} />
        {DOC_META.map((p) => (
          <Link key={p.slug} href={`/docs/${p.slug}`}>
            <div style={{
              fontSize: 12.5, padding: "7px 10px", borderRadius: 8, lineHeight: 1.35,
              color: p.slug === slug ? "var(--acc)" : "var(--t5)",
              background: p.slug === slug ? "var(--acc-dim)" : "transparent",
              fontWeight: p.slug === slug ? 600 : 400,
            }}>
              {p.title}
            </div>
          </Link>
        ))}
      </nav>
      {/* content */}
      <article style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".14em", color: "var(--acc)" }}>{page.kicker}</div>
        <h1 style={{ fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 600, letterSpacing: "-.025em", margin: "8px 0 18px" }}>{page.title}</h1>
        <Body />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 48, borderTop: "1px solid var(--ln2)", paddingTop: 20 }}>
          {prev ? (
            <Link href={`/docs/${prev.slug}`} style={{ ...mono, fontSize: 10, letterSpacing: ".07em", color: "var(--t5)" }}>← {prev.title.toUpperCase()}</Link>
          ) : <span />}
          {next ? (
            <Link href={`/docs/${next.slug}`} style={{ ...mono, fontSize: 10, letterSpacing: ".07em", color: "var(--acc)" }}>{next.title.toUpperCase()} →</Link>
          ) : <span />}
        </div>
      </article>
    </div>
  );
}
