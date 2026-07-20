import type { Metadata } from "next";
import Link from "next/link";
import Nav, { Logo } from "@/components/Nav";

export const metadata: Metadata = { title: "Sign in — Microcosm" };

export default function Login() {
  return (
    <>
      <Nav />
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "120px 24px 60px" }}>
        <div className="card" style={{ borderRadius: 18, padding: "48px 44px", maxWidth: 440, width: "100%", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}><Logo size={44} /></div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-.02em" }}>Sign in to Microcosm</h1>
          <p style={{ margin: "14px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
            The Microcosm app is in private preview with design partners. Accounts open here as we onboard — join the waitlist and we&apos;ll bring you in.
          </p>
          <div
            className="mono"
            style={{
              margin: "26px 0 0", border: "1px dashed var(--ln6)", borderRadius: 12,
              padding: "14px 18px", fontSize: 11, letterSpacing: ".08em", color: "var(--t6)",
            }}
          >
            PRIVATE PREVIEW · ACCOUNTS BY INVITATION
          </div>
          <a href="/#access" className="btnAcc" style={{ display: "block", marginTop: 26, padding: "14px 28px", fontSize: 15 }}>
            Join the waitlist
          </a>
          <Link href="/" style={{ display: "inline-block", marginTop: 18, fontSize: 13.5, color: "var(--t5)" }}>
            ← Back to the site
          </Link>
        </div>
      </main>
    </>
  );
}
