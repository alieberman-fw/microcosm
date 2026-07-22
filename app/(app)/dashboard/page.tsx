import { CSSProperties } from "react";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Simulations — Microcosm" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const supabase = await createServerSupabase();
  const { data } = await supabase!
    .from("simulations")
    .select("id, status, brief, created_at, documents(count)")
    .order("created_at", { ascending: false })
    .limit(24);
  const sims = (data ?? []) as {
    id: string; status: string; created_at: string;
    brief: { problem?: string; question?: string; template?: string; questions?: unknown[] } | null;
    documents: { count: number }[];
  }[];

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

      <div className="grid3" style={{ marginTop: 36 }}>
        {sims.map((s) => {
          const docCount = s.documents?.[0]?.count ?? 0;
          return (
            <Link key={s.id} href={`/sim/${s.id}`} className="card" style={{ padding: "26px 28px", display: "block" }}>
              <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: ".07em", color: "var(--t6)" }}>
                <span>{new Date(s.created_at).toLocaleDateString()}</span>
                <span style={{ color: s.status === "done" ? "var(--acc)" : "var(--t5)" }}>{s.status.toUpperCase()}</span>
              </div>
              <h3 style={{ margin: "14px 0 0", fontSize: 16.5, fontWeight: 600, lineHeight: 1.35, color: "var(--t1)" }}>
                {s.brief?.problem ?? s.brief?.question ?? "Untitled simulation"}
              </h3>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)", marginTop: 14 }}>
                {(s.brief?.template ?? "CUSTOM").toUpperCase()}
                {s.brief?.questions?.length ? ` · ${s.brief.questions.length} QUESTIONS` : ""}
                {docCount ? ` · ${docCount} DOC${docCount > 1 ? "S" : ""}` : ""}
              </div>
            </Link>
          );
        })}

        <Link
          href="/sim/new"
          className="card"
          style={{ padding: "26px 28px", border: "1px dashed var(--ln6)", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", gap: 8 }}
        >
          <div style={{ ...mono, fontSize: 11, letterSpacing: ".07em", color: "var(--acc)" }}>+ NEW SIMULATION</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
            State the problem, attach the diligence docs, and test the corpus with cited answers.
          </p>
        </Link>
      </div>
    </div>
  );
}
