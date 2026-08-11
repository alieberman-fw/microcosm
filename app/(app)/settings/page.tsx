import { CSSProperties, ReactNode } from "react";
import { createServerSupabase, getLocalUser } from "@/lib/supabase/server";
import ChecklistPref from "@/components/app/ChecklistPref";
import ThemePref from "@/components/app/ThemePref";
import FinishPref from "@/components/app/FinishPref";
import OrbInkPref from "@/components/app/OrbInkPref";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Settings — Microcosm" };
export const dynamic = "force-dynamic";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--ln2)" }}>
      <span style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", textTransform: "uppercase", paddingTop: 2, flex: "none" }}>{k}</span>
      <span style={{ fontSize: 13.5, color: "var(--t2)", textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

/** one labeled setting inside a section card: mono label + hint, control below */
function Setting({ label, hint, last, children }: { label: string; hint: string; last?: boolean; children: ReactNode }) {
  return (
    <div style={{ padding: "18px 0 20px", borderBottom: last ? "none" : "1px solid var(--ln2)" }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--t6)" }}>{label}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--t5)", marginTop: 4, maxWidth: 560 }}>{hint}</div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

export default async function Settings() {
  const supabase = await createServerSupabase();
  const user = await getLocalUser(supabase!);
  const { data: userRow } = await supabase!
    .from("users").select("role, created_at, prefs, orgs(name, plan)").eq("id", user!.id).single();
  const org = (userRow as { orgs?: { name?: string; plan?: string } } | null)?.orgs;
  const prefs = ((userRow as { prefs?: { hide_onboarding?: boolean } } | null)?.prefs) ?? {};
  const email = user!.email ?? "—";
  const initial = (email[0] ?? "?").toUpperCase();

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div className="kicker">Settings</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>Account</h1>

      {/* who you are — identity headline, then the quiet facts */}
      <div className="card" style={{ marginTop: 32, padding: "22px 28px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 18, borderBottom: "1px solid var(--ln2)" }}>
          <span aria-hidden style={{
            ...mono, width: 40, height: 40, borderRadius: "50%", flex: "none",
            background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          }}>
            {initial}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--t1)", overflowWrap: "anywhere" }}>{email}</span>
            <span style={{ ...mono, display: "block", fontSize: 9, letterSpacing: ".08em", color: "var(--t6)", marginTop: 3 }}>
              {(org?.name ?? "PERSONAL").toUpperCase()} · {(org?.plan ?? "preview").toUpperCase()}
            </span>
          </span>
        </div>
        <Row k="Role" v={((userRow as { role?: string } | null)?.role ?? "owner").toUpperCase()} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "13px 0" }}>
          <span style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)", textTransform: "uppercase", paddingTop: 2 }}>Member since</span>
          <span style={{ fontSize: 13.5, color: "var(--t2)" }}>
            {new Date((userRow as { created_at?: string } | null)?.created_at ?? Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </span>
        </div>
      </div>

      {/* how it looks — theme, finish, orbs; every control previews itself */}
      <div className="card" style={{ marginTop: 16, padding: "22px 28px 8px" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Appearance</h3>
        <Setting label="THEME" hint="Light to dark, with two warm grays between. The profile-menu switch cycles all four.">
          <ThemePref />
        </Setting>
        <Setting label="FINISH" hint="How much light the interface carries. Premium adds depth, glow, and motion — same layout, same colors.">
          <FinishPref />
        </Setting>
        <Setting label="LOADING ORBS" hint="The animations that play while agents think, search, and write." last>
          <OrbInkPref />
        </Setting>
      </div>

      <div className="card" style={{ marginTop: 16, padding: "10px 28px" }}>
        <ChecklistPref initiallyHidden={Boolean(prefs.hide_onboarding)} />
      </div>

      <div className="card" style={{ marginTop: 16, padding: "22px 28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <span>
            <span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>Session</span>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--t5)", marginTop: 4 }}>Sign out of Microcosm on this device.</span>
          </span>
          <form action="/auth/signout" method="post" style={{ flex: "none" }}>
            <button type="submit" className="btnGhost" style={{ padding: "10px 22px", fontSize: 13 }}>Sign out</button>
          </form>
        </div>
      </div>

      <div style={{ marginTop: 16, border: "1px dashed var(--ln6)", borderRadius: 14, padding: "22px 28px" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--t4)" }}>Coming with the SaaS phase</h3>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.65, color: "var(--t6)" }}>
          Team members &amp; roles · billing and run credits · connected data tools · API keys for the underwriting integration · account deletion.
        </p>
      </div>
    </div>
  );
}
