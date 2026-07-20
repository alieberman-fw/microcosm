"use client";

import { useState } from "react";
import { Logo } from "./Nav";

export default function Access() {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);

  return (
    <section id="access" style={{ maxWidth: 1240, margin: "0 auto", padding: "130px 40px 120px", textAlign: "center" }}>
      <div style={{ marginBottom: 26, display: "flex", justifyContent: "center" }}><Logo size={52} /></div>
      <h2 style={{ margin: 0, fontSize: "clamp(34px,4.2vw,58px)", fontWeight: 600, letterSpacing: "-.035em" }}>
        Rehearse the decision.<br />Then commit the capital.
      </h2>
      <p style={{ margin: "22px auto 0", maxWidth: 520, fontSize: 16, lineHeight: 1.65, color: "var(--t5)" }}>
        Microcosm is onboarding a limited set of design partners — builders, developers, and operators with real outcomes to calibrate against.
      </p>
      {!joined ? (
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 38, flexWrap: "wrap" }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="work email"
            style={{
              background: "var(--sf)", border: "1px solid var(--ln6)", borderRadius: 100,
              padding: "14px 24px", fontSize: 15, color: "var(--t1)", width: 300, outline: "none",
            }}
          />
          <button
            onClick={() => { if (email.trim()) setJoined(true); }}
            className="btnAcc"
            style={{ padding: "14px 30px", fontSize: 15 }}
          >
            Join the waitlist
          </button>
        </div>
      ) : (
        <div
          className="mono"
          style={{
            marginTop: 38, display: "inline-flex", alignItems: "center", gap: 10,
            border: "1px solid var(--acc)", borderRadius: 100, padding: "14px 28px",
            fontSize: 13, color: "var(--acc)", animation: "fadeUp .4s ease both",
          }}
        >
          ✓ You&apos;re on the list. We&apos;ll be in touch.
        </div>
      )}
    </section>
  );
}
