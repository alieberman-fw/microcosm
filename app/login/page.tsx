"use client";

import { CSSProperties, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Nav, { Logo } from "@/components/Nav";
import { createClient } from "@/lib/supabase/client";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--sf2)",
  border: "1px solid var(--ln6)", borderRadius: 100, padding: "13px 22px",
  fontSize: 14.5, color: "var(--t1)", outline: "none",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const supabase = createClient();

  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  if (!supabase) {
    return (
      <div className="mono" style={{ border: "1px dashed var(--ln6)", borderRadius: 12, padding: "14px 18px", fontSize: 11, letterSpacing: ".08em", color: "var(--t6)" }}>
        SUPABASE NOT CONFIGURED — ADD KEYS TO .ENV.LOCAL
      </div>
    );
  }

  const submit = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Check your email for the sign-in link." });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Account created — check your email to confirm, then sign in." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
        return;
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 24 }}>
        {([["signin", "Sign in"], ["signup", "Create account"], ["magic", "Email link"]] as const).map(([m, label]) => (
          <button
            key={m}
            onClick={() => { setMode(m); setMsg(null); }}
            style={{
              ...mono, fontSize: 11, padding: "8px 16px", borderRadius: 100, cursor: "pointer",
              border: `1px solid ${mode === m ? "var(--acc)" : "var(--ln6)"}`,
              background: mode === m ? "var(--acc-dim)" : "transparent",
              color: mode === m ? "var(--acc)" : "var(--t5)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="email" placeholder="work email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        {mode !== "magic" && (
          <input
            type="password" placeholder="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            style={inputStyle}
          />
        )}
        <button onClick={submit} disabled={busy} className="btnAcc" style={{ padding: "13px 24px", fontSize: 15, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send sign-in link"}
        </button>
      </div>
      {msg && (
        <div
          className="mono"
          style={{
            marginTop: 16, fontSize: 11, lineHeight: 1.6, letterSpacing: ".04em", borderRadius: 12, padding: "12px 16px",
            border: `1px solid ${msg.kind === "err" ? "var(--warn)" : "var(--acc)"}`,
            background: msg.kind === "err" ? "var(--warn-dim)" : "var(--acc-dim)",
            color: msg.kind === "err" ? "var(--warn)" : "var(--acc)",
          }}
        >
          {msg.text}
        </div>
      )}
    </>
  );
}

export default function Login() {
  return (
    <>
      <Nav />
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "120px 24px 60px" }}>
        <div className="card" style={{ borderRadius: 18, padding: "44px 40px", maxWidth: 440, width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}><Logo size={40} /></div>
          <h1 style={{ margin: "0 0 26px", fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", textAlign: "center" }}>
            Welcome to Microcosm
          </h1>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
          <Link href="/" style={{ display: "block", textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--t5)" }}>
            ← Back to the site
          </Link>
        </div>
      </main>
    </>
  );
}
