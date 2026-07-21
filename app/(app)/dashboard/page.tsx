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
    .select("id, status, brief, created_at")
    .order("created_at", { ascending: false })
    .limit(24);
  const sims = data ?? [];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div className="kicker">Simulations</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>Your runs</h1>

      <div className="grid3" style={{ marginTop: 36 }}>
        <Link href="/sim/demo" className="card cardHover" style={{ display: "block", padding: "26px 28px", color: "var(--t1)" }}>
          <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: ".07em", color: "var(--t6)" }}>
            <span>REPLAY FIXTURE</span><span style={{ color: "var(--acc)" }}>● READY</span>
          </div>
          <h3 style={{ margin: "14px 0 0", fontSize: 17.5, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.35 }}>
            Site 47-A — 300MW data center campus, Mesa, AZ
          </h3>
          <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--t5)" }}>
            The golden fixture: 48 experts + 400 residents, 14 simulated days, replayed through the production run screen.
          </p>
          <div style={{ ...mono, marginTop: 16, fontSize: 10, color: "var(--t7)" }}>AGORA · 611 POSTS · 3 DISSENTS</div>
        </Link>

        {sims.map((s) => (
          <div key={s.id} className="card" style={{ padding: "26px 28px" }}>
            <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: ".07em", color: "var(--t6)" }}>
              <span>{new Date(s.created_at).toLocaleDateString()}</span>
              <span style={{ color: s.status === "done" ? "var(--acc)" : "var(--t5)" }}>{s.status.toUpperCase()}</span>
            </div>
            <h3 style={{ margin: "14px 0 0", fontSize: 16.5, fontWeight: 600, lineHeight: 1.35 }}>
              {(s.brief as { question?: string } | null)?.question ?? "Untitled simulation"}
            </h3>
          </div>
        ))}

        <div className="card" style={{ padding: "26px 28px", border: "1px dashed var(--ln6)", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", gap: 8 }}>
          <div style={{ ...mono, fontSize: 11, letterSpacing: ".07em", color: "var(--t6)" }}>+ NEW SIMULATION</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
            Brief → documents → casting → live run. Next up: the brief composer (build step 3).
          </p>
        </div>
      </div>
    </div>
  );
}
