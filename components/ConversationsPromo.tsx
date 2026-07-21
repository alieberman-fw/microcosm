import { CSSProperties } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

/**
 * Landing section for Conversations — the direct line to the persona library,
 * positioned as the lighter-weight complement to a full simulation run.
 */
export default function ConversationsPromo() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "110px 40px" }}>
      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
        {/* chat mockup */}
        <div className="card" style={{ borderRadius: 18, padding: "26px 28px", order: 0 }}>
          <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)" }}>
            <span>ROSA + JONAH · GROUP</span>
            <span style={{ color: "var(--acc)" }}>2 IN THE ROOM</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
            <div style={{ alignSelf: "flex-end", maxWidth: "85%", borderRadius: "14px 14px 4px 14px", padding: "10px 14px", background: "var(--acc-dim)", border: "1px solid var(--acc)", fontSize: 13.5, lineHeight: 1.55, color: "var(--t1)" }}>
              <span style={{ color: "var(--acc)", fontWeight: 600 }}>@Rosa</span> if the interconnection queue clears a year early, what happens to the option price?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ ...mono, width: 28, height: 28, borderRadius: "50%", flex: "none", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--t3)" }}>RM</span>
              <div style={{ maxWidth: "85%" }}>
                <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)", marginBottom: 5 }}>ROSA M. · GRID INTERCONNECTION</div>
                <div style={{ borderRadius: "4px 14px 14px 14px", padding: "10px 14px", background: "var(--sf2)", border: "1px solid var(--ln3)", fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)" }}>
                  It cuts the carry. Energization in 2028 instead of 2030 means the premium you&apos;re paying for time is mispriced — and <span style={{ color: "var(--acc)", fontWeight: 600 }}>@Jonah</span> should re-strike the milestones before the seller notices.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {["ROSA · SONNET 5", "JONAH · HAIKU 4.5", "SITE_PLAN.PDF ATTACHED"].map((c) => (
                <span key={c} style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--t6)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "4px 10px" }}>{c}</span>
              ))}
            </div>
          </div>
        </div>

        {/* copy */}
        <div>
          <div className="kicker">Conversations</div>
          <h2 style={{ margin: "16px 0 0", fontSize: "clamp(28px,3.2vw,44px)", fontWeight: 600, letterSpacing: "-.03em" }}>
            Don&apos;t need a full simulation? Just ask the room.
          </h2>
          <p style={{ margin: "20px 0 0", fontSize: 15.5, lineHeight: 1.7, color: "var(--t5)" }}>
            Every voice in Microcosm is available for a direct conversation — over 1,800 persona-grounded experts, consumers, and residents across the built world, each with a real career, real demographics, and real opinions. Open a one-on-one with a grid interconnection planner, or put a lender, a zoning attorney, and a skeptical neighbor in the same group chat.
          </p>
          <p style={{ margin: "14px 0 0", fontSize: 15.5, lineHeight: 1.7, color: "var(--t5)" }}>
            Attach site plans and PDFs for in-thread analysis, direct questions with @mentions, and dial any voice from lightweight-fast to frontier reasoning. Every thread is saved to your workspace — same experts, fresh conversation, any time.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 26 }}>
            {["1,800+ PERSONAS", "1:1 OR ROOMS OF 20", "PLAIN-LANGUAGE SEARCH", "ATTACH PLANS & PDFS"].map((c) => (
              <span key={c} style={{ ...mono, fontSize: 10, padding: "6px 12px", borderRadius: 100, border: "1px solid var(--ln6)", color: "var(--t6)" }}>{c}</span>
            ))}
          </div>
          <a href="/login" className="btnAcc" style={{ display: "inline-block", marginTop: 30, padding: "13px 26px", fontSize: 14.5 }}>
            Start a conversation
          </a>
        </div>
      </div>
    </section>
  );
}
