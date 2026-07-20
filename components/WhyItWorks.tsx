import { CSSProperties } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

function CardShell({ children, className, style }: { children: React.ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={className} style={{ border: "1px solid var(--ln3)", borderRadius: 16, background: "var(--bg)", padding: "28px 28px", display: "flex", flexDirection: "column", gap: 0, ...style }}>
      {children}
    </div>
  );
}

function Head({ num, t }: { num: string; t: string }) {
  return (
    <>
      <div style={{ ...mono, fontSize: 12, color: "var(--acc)" }}>{num}</div>
      <h3 style={{ margin: "12px 0 0", fontSize: 18.5, fontWeight: 600, letterSpacing: "-.01em" }}>{t}</h3>
    </>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.66, color: "var(--t5)" }}>{children}</p>;
}

/* Card 1 visual — one model vs. the swarm */
function SwarmDiagram() {
  const nodes = [
    [172, 26], [214, 18], [252, 38], [162, 62], [206, 58], [248, 78], [180, 96], [232, 104],
  ] as const;
  const answer: [number, number] = [206, 138];
  return (
    <svg viewBox="0 0 290 168" style={{ width: "100%", maxWidth: 320 }} aria-hidden>
      {/* one model */}
      <circle cx={52} cy={48} r={5} fill="var(--t7)" />
      <line x1={52} y1={56} x2={52} y2={122} stroke="var(--ln7)" strokeWidth={1} />
      <circle cx={52} cy={130} r={4} fill="var(--t7)" opacity={0.7} />
      <text x={52} y={22} textAnchor="middle" style={{ ...mono, fontSize: 8.5, fill: "var(--t7)", letterSpacing: ".08em" }}>ONE MODEL</text>
      <text x={52} y={154} textAnchor="middle" style={{ ...mono, fontSize: 8.5, fill: "var(--t7)", letterSpacing: ".08em" }}>FIRST GUESS</text>
      {/* the swarm */}
      {nodes.map(([x, y], i) =>
        nodes.slice(i + 1).map(([x2, y2], j) => {
          const d = Math.hypot(x - x2, y - y2);
          return d < 62 ? <line key={`${i}-${j}`} x1={x} y1={y} x2={x2} y2={y2} stroke="var(--ln6)" strokeWidth={0.7} /> : null;
        })
      )}
      {nodes.slice(0, 5).map(([x, y], i) => (
        <line key={`a${i}`} x1={x} y1={y} x2={answer[0]} y2={answer[1]} stroke="var(--acc)" strokeWidth={0.8} opacity={0.4} />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 4 : 3} fill={i % 2 === 0 ? "var(--acc)" : "var(--t5)"} opacity={i % 2 === 0 ? 0.9 : 0.7} />
      ))}
      <circle cx={answer[0]} cy={answer[1]} r={6} fill="var(--acc)" />
      <circle cx={answer[0]} cy={answer[1]} r={11} fill="none" stroke="var(--acc)" strokeWidth={1} opacity={0.35} />
      <text x={207} y={8} textAnchor="middle" style={{ ...mono, fontSize: 8.5, fill: "var(--t6)", letterSpacing: ".08em" }}>THE SWARM</text>
      <text x={answer[0]} y={162} textAnchor="middle" style={{ ...mono, fontSize: 8.5, fill: "var(--acc)", letterSpacing: ".08em" }}>THE ANSWER THAT SURVIVED</text>
    </svg>
  );
}

/* Card 2 visual — library grid with cast seats lit */
function LibraryGrid() {
  const lit = new Set([3, 9, 17, 26, 34, 43]);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 5 }}>
        {Array.from({ length: 48 }, (_, i) => (
          <div
            key={i}
            style={{
              aspectRatio: "1", borderRadius: 4,
              background: lit.has(i) ? "var(--acc)" : "var(--sf2)",
              border: `1px solid ${lit.has(i) ? "var(--acc)" : "var(--ln3)"}`,
              opacity: lit.has(i) ? 1 : 0.85,
            }}
          />
        ))}
      </div>
      <div style={{ ...mono, display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t7)" }}>
        <span>1,100+ IN THE LIBRARY</span>
        <span style={{ color: "var(--acc)" }}>6 CAST FOR THIS QUESTION</span>
      </div>
    </div>
  );
}

/* Card 3 visual — cohort distribution bars */
function CohortBars() {
  const bars = [
    ["Relocating in-movers", "32%", "var(--acc)"],
    ["Local move-up", "41%", "var(--t7)"],
    ["First-time", "18%", "var(--t7)"],
    ["Investor", "9%", "var(--t7)"],
  ] as const;
  return (
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      {bars.map(([label, w, fill]) => (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--t5)", marginBottom: 4 }}>
            <span>{label}</span>
            <span style={{ ...mono, fontSize: 10 }}>{w}</span>
          </div>
          <div style={{ height: 6, borderRadius: 100, background: "var(--sf2)" }}>
            <div style={{ width: w, height: 6, borderRadius: 100, background: fill }} />
          </div>
        </div>
      ))}
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t7)", marginTop: 2 }}>ZIP 85212 · SAMPLED FROM ACS PUMS RECORDS</div>
    </div>
  );
}

/* Card 4 visual — the adversarial seat */
function SkepticSeat() {
  return (
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ border: "1px solid var(--warn)", background: "var(--warn-dim)", borderRadius: 10, padding: "11px 14px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Community advocate</span>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--warn)" }}>ADVERSARIAL SEED</span>
      </div>
      <div style={{ border: "1px solid var(--ln3)", borderRadius: 10, padding: "11px 14px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: 13, color: "var(--t4)" }}>Final report</span>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t5)" }}>3 DISSENTS · PRESERVED</span>
      </div>
    </div>
  );
}

/* Card 5 visual — verifier catch */
function VerifierCatch() {
  return (
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ border: "1px solid var(--ln3)", borderRadius: 10, padding: "11px 14px" }}>
        <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t7)" }}>CLAIM · BROKER OM, P.12</div>
        <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 4 }}>&quot;Full power available 2027&quot;</div>
      </div>
      <div style={{ border: "1px solid var(--warn)", background: "var(--warn-dim)", borderRadius: 10, padding: "11px 14px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--warn)" }}>CONTRADICTED</span>
        <span style={{ ...mono, fontSize: 9.5, color: "var(--t5)" }}>SRP_TRANSMISSION_MAP · QUEUE FILINGS</span>
      </div>
    </div>
  );
}

/* Card 6 visual — the leading-indicator timeline */
function IndicatorTimeline() {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ position: "relative", height: 2, background: "var(--ln4)", borderRadius: 100, margin: "34px 8px 0" }}>
        <div style={{ position: "absolute", left: 0, top: -5, width: 12, height: 12, borderRadius: "50%", background: "var(--acc)" }} />
        <div style={{ position: "absolute", left: "38%", top: -4, width: 10, height: 10, borderRadius: "50%", background: "var(--t5)" }} />
        <div style={{ position: "absolute", right: 0, top: -4, width: 10, height: 10, borderRadius: "50%", background: "var(--t7)" }} />
        <div style={{ position: "absolute", left: 0, top: -30, ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)" }}>SIMULATE · TODAY</div>
        <div style={{ position: "absolute", left: "38%", top: 16, transform: "translateX(-30%)", ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t5)", whiteSpace: "nowrap" }}>COMMIT CAPITAL</div>
        <div style={{ position: "absolute", right: 0, top: -30, ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t7)", textAlign: "right" }}>MARKET VERDICT · +12–24 MO</div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 44, flexWrap: "wrap" }}>
        <span style={{ ...mono, fontSize: 10, padding: "6px 12px", borderRadius: 100, border: "1px solid var(--acc)", color: "var(--acc)", background: "var(--acc-dim)" }}>EVERY RUN SCORED WHEN REALITY ARRIVES</span>
        <span style={{ ...mono, fontSize: 10, padding: "6px 12px", borderRadius: 100, border: "1px solid var(--ln6)", color: "var(--t6)" }}>SYNTHETIC &amp; DIRECTIONAL · ALWAYS LABELED</span>
      </div>
    </div>
  );
}

export default function WhyItWorks() {
  return (
    <section id="why" style={{ background: "var(--sf)", borderTop: "1px solid var(--ln1)", borderBottom: "1px solid var(--ln1)" }}>
      <div className="section">
        <div className="kicker">Why it works</div>
        <h2 className="h2" style={{ maxWidth: 800 }}>Why an agent swarm answers what one AI — and one gut call — can&apos;t.</h2>

        <div className="whyGrid" style={{ marginTop: 52 }}>
          {/* 01 — spans 2 columns, copy + diagram side by side */}
          <CardShell className="whySpan2">
            <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 28, alignItems: "center" }}>
              <div>
                <Head num="01" t="Many specialized minds, one argument" />
                <Body>
                  A single AI gives you one plausible answer. A swarm gives you a contest: specialists reasoning from different facts and incentives, challenging each other until weak claims die and strong ones survive. The answer that emerges has already been argued with — before you rely on it.
                </Body>
              </div>
              <SwarmDiagram />
            </div>
          </CardShell>

          {/* 02 */}
          <CardShell>
            <Head num="02" t="1,100+ experts, cast per question" />
            <Body>
              A persona library spanning the entire built world — capital, construction, power, water, civic, legal, community. A casting pass fills each seat with the specialist who owns it; every seat stays editable.
            </Body>
            <LibraryGrid />
          </CardShell>

          {/* 03 */}
          <CardShell>
            <Head num="03" t="A crowd that matches your market" />
            <Body>
              Consumer and resident cohorts are sampled from public Census microdata for your actual geography — the crowd judging your project statistically resembles the market that will.
            </Body>
            <CohortBars />
          </CardShell>

          {/* 04 */}
          <CardShell>
            <Head num="04" t="Skeptics on the payroll" />
            <Body>
              Every panel seats at least one agent instructed to oppose you — and when panelists still disagree at the end, the report preserves the dissent by name instead of averaging it away.
            </Body>
            <SkepticSeat />
          </CardShell>

          {/* 05 */}
          <CardShell>
            <Head num="05" t="Claims don't pass unchecked" />
            <Body>
              An independent verifier tests every numeric claim against your uploaded documents and connected data. Contradictions are flagged into the record — whichever side they come from.
            </Body>
            <VerifierCatch />
          </CardShell>

          {/* 06 — spans full width, horizontal */}
          <CardShell className="whySpan3">
            <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 40, alignItems: "center" }}>
              <div>
                <Head num="06" t="A leading indicator, honestly labeled" />
                <Body>
                  The market tells you whether you were right 12–24 months after the capital is committed. A calibrated simulation tells you before — with an auditable track record, as an instrument for the decision-maker, never a replacement.
                </Body>
              </div>
              <IndicatorTimeline />
            </div>
          </CardShell>
        </div>

        <p style={{ ...mono, margin: "26px 0 0", fontSize: 11.5, lineHeight: 1.7, color: "var(--t7)" }}>
          RESEARCH ANCHOR · INTERVIEW-GROUNDED AI AGENTS MATCHED REAL PEOPLE&apos;S SURVEY ANSWERS AT 85% OF THEIR OWN TWO-WEEK CONSISTENCY (STANFORD, N=1,052).
        </p>
      </div>
    </section>
  );
}
