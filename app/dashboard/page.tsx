import { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Dashboard — Microcosm" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const connected = supabaseConfigured();
  let email: string | null = null;
  let orgName: string | null = null;
  let sims: { id: string; status: string; brief: { question?: string } | null; created_at: string }[] = [];

  if (connected) {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase!.auth.getUser();
    if (!user) redirect("/login?next=/dashboard");
    email = user.email ?? null;

    const { data: userRow } = await supabase!
      .from("users").select("org_id, orgs(name)").eq("id", user.id).single();
    orgName = (userRow as { orgs?: { name?: string } } | null)?.orgs?.name ?? null;

    const { data } = await supabase!
      .from("simulations")
      .select("id, status, brief, created_at")
      .order("created_at", { ascending: false })
      .limit(24);
    sims = data ?? [];
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "120px 40px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="kicker">Simulations</div>
            <h1 style={{ margin: "14px 0 0", fontSize: "clamp(28px,3.2vw,40px)", fontWeight: 600, letterSpacing: "-.03em" }}>Your runs</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span
              style={{
                ...mono, fontSize: 10.5, letterSpacing: ".06em", padding: "6px 14px", borderRadius: 100,
                border: `1px solid ${connected ? "var(--acc)" : "var(--ln6)"}`,
                color: connected ? "var(--acc)" : "var(--t6)",
                background: connected ? "var(--acc-dim)" : "transparent",
              }}
            >
              {connected ? `SUPABASE · CONNECTED${email ? ` · ${email.toUpperCase()}` : ""}` : "SUPABASE · NOT CONFIGURED"}
            </span>
            {email && (
              <form action="/auth/signout" method="post">
                <button type="submit" className="btnGhost" style={{ ...mono, fontSize: 10.5, padding: "6px 14px" }}>
                  SIGN OUT
                </button>
              </form>
            )}
          </div>
        </div>
        {orgName && (
          <div style={{ ...mono, marginTop: 10, fontSize: 10.5, letterSpacing: ".06em", color: "var(--t7)" }}>
            ORG · {orgName.toUpperCase()}
          </div>
        )}

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

          {sims.map((s) => (
            <div key={s.id} className="card" style={{ padding: "26px 28px" }}>
              <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: ".07em", color: "var(--t6)" }}>
                <span>{new Date(s.created_at).toLocaleDateString()}</span>
                <span style={{ color: s.status === "done" ? "var(--acc)" : "var(--t5)" }}>{s.status.toUpperCase()}</span>
              </div>
              <h3 style={{ margin: "14px 0 0", fontSize: 16.5, fontWeight: 600, lineHeight: 1.35 }}>
                {s.brief?.question ?? "Untitled simulation"}
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
      </main>
    </>
  );
}
