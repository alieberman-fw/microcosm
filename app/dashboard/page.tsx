import { CSSProperties } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import { supabaseConfigured } from "@/lib/supabase/env";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Dashboard — Microcosm" };

export default function Dashboard() {
  const connected = supabaseConfigured();

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "120px 40px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="kicker">Simulations</div>
            <h1 style={{ margin: "14px 0 0", fontSize: "clamp(28px,3.2vw,40px)", fontWeight: 600, letterSpacing: "-.03em" }}>Your runs</h1>
          </div>
          <span
            style={{
              ...mono, fontSize: 10.5, letterSpacing: ".06em", padding: "6px 14px", borderRadius: 100,
              border: `1px solid ${connected ? "var(--acc)" : "var(--ln6)"}`,
              color: connected ? "var(--acc)" : "var(--t6)",
              background: connected ? "var(--acc-dim)" : "transparent",
            }}
          >
            {connected ? "SUPABASE · CONNECTED" : "SUPABASE · NOT CONFIGURED — HISTORY IS LOCAL ONLY"}
          </span>
        </div>

        <div className="grid3" style={{ marginTop: 44 }}>
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

          <div className="card" style={{ padding: "26px 28px", border: "1px dashed var(--ln6)", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center", gap: 8 }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".07em", color: "var(--t6)" }}>+ NEW SIMULATION</div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
              Brief → documents → casting → live run. Unlocks when the engine and Supabase land (build steps 4–5).
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
