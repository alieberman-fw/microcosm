import { CSSProperties } from "react";
import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Settings — Microcosm" };
export const dynamic = "force-dynamic";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--ln2)" }}>
      <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)", textTransform: "uppercase", paddingTop: 2 }}>{k}</span>
      <span style={{ fontSize: 14, color: "var(--t2)", textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

export default async function Settings() {
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!
    .from("users").select("role, created_at, orgs(name, plan)").eq("id", user!.id).single();
  const org = (userRow as { orgs?: { name?: string; plan?: string } } | null)?.orgs;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div className="kicker">Settings</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>Account</h1>

      <div className="card" style={{ marginTop: 32, padding: "10px 28px 14px" }}>
        <Row k="Email" v={user!.email ?? "—"} />
        <Row k="Organization" v={org?.name ?? "personal"} />
        <Row k="Plan" v={(org?.plan ?? "preview").toUpperCase()} />
        <Row k="Role" v={((userRow as { role?: string } | null)?.role ?? "owner").toUpperCase()} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "14px 0" }}>
          <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)", textTransform: "uppercase", paddingTop: 2 }}>Member since</span>
          <span style={{ fontSize: 14, color: "var(--t2)" }}>
            {new Date((userRow as { created_at?: string } | null)?.created_at ?? Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: "24px 28px" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Appearance</h3>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--t5)" }}>
          Light and dark themes follow the toggle in your profile menu (bottom of the sidebar). Your choice persists on this device.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16, padding: "24px 28px" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Session</h3>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--t5)" }}>
          Sign out of Microcosm on this device.
        </p>
        <form action="/auth/signout" method="post" style={{ marginTop: 16 }}>
          <button type="submit" className="btnGhost" style={{ padding: "10px 22px", fontSize: 13.5 }}>Sign out</button>
        </form>
      </div>

      <div style={{ marginTop: 16, border: "1px dashed var(--ln6)", borderRadius: 14, padding: "24px 28px" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--t4)" }}>Coming with the SaaS phase</h3>
        <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "var(--t6)" }}>
          Team members &amp; roles · billing and run credits · connected data tools · API keys for the underwriting integration · account deletion.
        </p>
      </div>
    </div>
  );
}
