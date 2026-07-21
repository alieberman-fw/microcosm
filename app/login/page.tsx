"use client";

import { CSSProperties, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Nav";
import AgentCanvas from "@/components/AgentCanvas";
import { createClient } from "@/lib/supabase/client";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const label: CSSProperties = {
  ...mono, display: "block", fontSize: 10.5, letterSpacing: ".1em",
  color: "var(--t6)", marginBottom: 8, textTransform: "uppercase",
};

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--sf2)",
  border: "1px solid var(--ln5)", borderRadius: 12, padding: "13px 16px",
  fontSize: 14.5, color: "var(--t1)", outline: "none",
};

const roomLines: [string, string][] = [
  ["rosa m. · grid interconnection", "The OM is fiction — full energization is 2030–31, realistically."],
  ["jonah b. · powered-land investor", "That spread IS the interconnect risk. Don't buy it — option it."],
  ["elena r. · community advocate", "Sound walls in the first site plan. Not as a concession later."],
  ["resident #204 · mesa 85212", "Publish the testing schedule, and answer the phone when we call."],
  ["derek c. · site selection", "Updating from go to conditional go — here's what changed my mind."],
];

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function RoomTicker() {
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    let li = 0, ci = 0, t: ReturnType<typeof setTimeout>;
    const step = () => {
      const text = roomLines[li][1];
      if (ci <= text.length) {
        setTyped(text.slice(0, ci)); setLine(li); ci++;
        t = setTimeout(step, 24);
      } else {
        t = setTimeout(() => { li = (li + 1) % roomLines.length; ci = 0; step(); }, 3400);
      }
    };
    step();
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ minHeight: 64 }}>
      <div style={{ ...mono, fontSize: 11, letterSpacing: ".08em", color: "var(--acc)" }}>{roomLines[line][0]} ›</div>
      <div style={{ marginTop: 8, fontSize: 15, lineHeight: 1.6, color: "var(--t3)" }}>
        {typed}
        <span style={{ display: "inline-block", width: 7, height: 14, background: "var(--acc)", verticalAlign: "-2px", marginLeft: 3, animation: "blink 1s step-end infinite" }} />
      </div>
    </div>
  );
}

function AuthForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/home";
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!supabase) {
    return (
      <div className="mono" style={{ border: "1px dashed var(--ln6)", borderRadius: 12, padding: "14px 18px", fontSize: 11, letterSpacing: ".08em", color: "var(--t6)" }}>
        SUPABASE NOT CONFIGURED — ADD KEYS TO .ENV.LOCAL
      </div>
    );
  }

  const google = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) { setErr(error.message); setBusy(false); }
    // on success the browser redirects to Google
  };

  return (
    <>
      <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-.02em" }}>Welcome to Microcosm</h1>
      <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
        Sign in to your simulations, agents, and reports.
      </p>

      <button
        onClick={google}
        disabled={busy}
        style={{
          marginTop: 26, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: "var(--t0)", color: "var(--bg)", border: "none", borderRadius: 12,
          padding: "14px 16px", fontSize: 14.5, fontWeight: 600, cursor: "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <GoogleIcon />
        {busy ? "Redirecting…" : "Continue with Google"}
      </button>

      {err && (
        <div className="mono" style={{ marginTop: 14, fontSize: 11, lineHeight: 1.6, borderRadius: 12, padding: "12px 16px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)", animation: "fadeUp .3s ease both" }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "24px 0" }}>
        <span style={{ flex: 1, height: 1, background: "var(--ln3)" }} />
        <span style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--t7)" }}>EMAIL SIGN-IN</span>
        <span style={{ flex: 1, height: 1, background: "var(--ln3)" }} />
      </div>

      {/* email sign-in is disabled at the auth layer during the internal preview */}
      <div style={{ opacity: 0.35, pointerEvents: "none", userSelect: "none", display: "flex", flexDirection: "column", gap: 14 }} aria-disabled>
        <div>
          <label style={label} htmlFor="email">Work email</label>
          <input id="email" type="email" placeholder="you@company.com" disabled style={inputStyle} />
        </div>
        <div>
          <label style={label} htmlFor="password">Password</label>
          <input id="password" type="password" placeholder="••••••••" disabled style={inputStyle} />
        </div>
      </div>
      <div className="mono" style={{ marginTop: 14, fontSize: 10, lineHeight: 1.6, letterSpacing: ".05em", borderRadius: 10, padding: "10px 14px", border: "1px dashed var(--ln6)", color: "var(--t6)" }}>
        INTERNAL PREVIEW · EMAIL SIGN-IN IS DISABLED — USE YOUR FIFTH WALL GOOGLE ACCOUNT
      </div>
    </>
  );
}

export default function Login() {
  return (
    <div style={{ height: "100dvh", display: "flex", overflow: "hidden", boxSizing: "border-box" }}>
      {/* form panel */}
      <div style={{ flex: "1 0 auto", width: "100%", maxWidth: 460, margin: "0 auto", display: "flex", flexDirection: "column", boxSizing: "border-box", padding: "28px 44px", overflowY: "auto" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, flex: "none" }}>
          <Logo size={26} />
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-.02em" }}>microcosm</span>
        </Link>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "24px 0" }}>
          <Suspense fallback={null}>
            <AuthForm />
          </Suspense>
        </div>
        <div className="mono" style={{ flex: "none", fontSize: 9.5, letterSpacing: ".08em", color: "var(--t7)" }}>
          PRIVATE PREVIEW · OUTPUTS ARE SYNTHETIC &amp; DIRECTIONAL, ALWAYS LABELED
        </div>
      </div>

      {/* visual panel */}
      <div className="authVisual" style={{ flex: 1, position: "relative", background: "var(--sf)", borderLeft: "1px solid var(--ln2)", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden" }}>
        <AgentCanvas density={70} style={{ opacity: 0.55 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--sf) 96%)" }} />
        <div style={{ position: "relative", zIndex: 2, padding: "0 56px 52px", maxWidth: 640 }}>
          <div className="kicker">The room you&apos;re joining</div>
          <h2 style={{ margin: "14px 0 0", fontSize: "clamp(24px,2.6vw,36px)", fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.15 }}>
            The panel is already arguing.
          </h2>
          <div style={{ marginTop: 22 }}>
            <RoomTicker />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 26 }}>
            {["1,100+ PERSONAS", "CENSUS-SEEDED CROWDS", "DISSENT PRESERVED", "EVERY CLAIM VERIFIED"].map((c) => (
              <span key={c} style={{ ...mono, fontSize: 10, padding: "6px 12px", borderRadius: 100, border: "1px solid var(--ln6)", color: "var(--t6)" }}>{c}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
