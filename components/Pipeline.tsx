"use client";

import { CSSProperties, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const personas = [
  { initials: "DR", name: "Dana R., 41", meta: "Relocating from Sacramento · $135K HHI · two kids · cap $610K", quote: "We lost a house last year because we hesitated. This time the home office is non-negotiable." },
  { initials: "LO", name: "Luis & Marta O., 34", meta: "Local move-up · $118K HHI · expecting their second · cap $540K", quote: "Our starter house has one bathroom. I am not surviving another year of that." },
  { initials: "KB", name: "Kathy B., 63", meta: "Downsizing from Scottsdale · cash buyer · single-story only", quote: "I'm done with stairs, and done with HOAs that repaint my front door." },
  { initials: "SW", name: "Sam W., 29", meta: "First-time buyer · $92K HHI · payment-anchored at $2,900/mo", quote: "Every 25 basis points changes what I can look at. I shop by payment, not price." },
  { initials: "NF", name: "The Nath family", meta: "Multigenerational · $160K HHI · needs a ground-floor suite", quote: "Ammi lives with us. A flex room without a full bath doesn't count." },
  { initials: "JT", name: "Jordan T., 37", meta: "Remote tech worker · $145K HHI · two dogs · lot size matters", quote: "I left the Bay for a yard. Show me the yard before the granite." },
  { initials: "MC", name: "Maria C., 45", meta: "Re-entering the market · $88K HHI · school district locked", quote: "I have exactly one non-negotiable and it's the middle school boundary." },
  { initials: "RP", name: "Ray & Priya P., 52", meta: "Move-down · equity-rich · 2.9% lock-in, reluctant sellers", quote: "We're not trading a 3% mortgage for granite countertops. Make the math work." },
];

const seedLayers = [
  { t: "Grounded in real data", tag: "CENSUS · MLS · MIGRATION", d: "The population's makeup matches your actual submarket, not the internet: real Census demographics — age, income, household size — plus transaction history, migration flows, and lending data for the geography." },
  { t: "Every agent gets a life", tag: "STANFORD PROTOCOL", d: "No agent is a spreadsheet row. Each gets a full story consistent with its stats — a job, a commute, kids' ages, what they hated about their last house, the budget number a spouse won't cross. That's what the research shows actually drives accuracy." },
  { t: "Scored against reality", tag: "THE HONESTY LAYER", d: "The population is tested against real sales and lease-up outcomes, scored, and corrected. That's what lets us use the word defensible — the read arrives with a track record, not vibes." },
];

const compBars = [
  { label: "Relocating Californians", pct: "32%", w: "32%", note: "$600K budget ceiling", fill: "var(--acc)" },
  { label: "Local move-up buyers", pct: "41%", w: "41%", note: "median cap $540K", fill: "var(--t7)" },
  { label: "First-time buyers", pct: "18%", w: "18%", note: "payment-anchored", fill: "var(--t7)" },
  { label: "Investors / second home", pct: "9%", w: "9%", note: "yield-driven", fill: "var(--t7)" },
];

const tabs = [
  { num: "01 / SEED", t: "Build the crowd", sub: "A population that matches your market, person by person" },
  { num: "02 / SIMULATE", t: "Let them argue", sub: "Forums, debates, private chats — minds changing in real time" },
  { num: "03 / REPORT", t: "Read the answer", sub: "Ranked, explained, dissent preserved, confidence labeled" },
];

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ ...mono, fontSize: 10.5, padding: "6px 12px", borderRadius: 100, border: "1px solid var(--ln6)", color: "var(--t5)" }}>
      {children}
    </span>
  );
}

function Point({ head, rest }: { head: string; rest: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 14, lineHeight: 1.6, color: "var(--t2)" }}>
      <span style={{ color: "var(--acc)", flex: "none" }}>→</span>
      <span><strong style={{ fontWeight: 600, color: "var(--t0)" }}>{head}</strong> {rest}</span>
    </div>
  );
}

export default function Pipeline() {
  const [step, setStep] = useState(0);
  const [layer, setLayer] = useState(0);
  const [pIdx, setPIdx] = useState(0);

  return (
    <section id="product" className="section">
      <div className="kicker">How it works</div>
      <h2 className="h2" style={{ maxWidth: 720 }}>Three steps from a hard question to a defensible answer.</h2>
      <div className="grid3" style={{ marginTop: 52 }}>
        {tabs.map((pt, i) => (
          <button
            key={pt.num}
            onClick={() => setStep(i)}
            style={{
              textAlign: "left", border: `1px solid ${step === i ? "var(--acc)" : "var(--ln3)"}`,
              borderRadius: 14, padding: "22px 24px", background: step === i ? "var(--acc-dim)" : "var(--sf)",
              cursor: "pointer", transition: "border-color .25s, background .25s",
            }}
          >
            <div style={{ ...mono, fontSize: 11.5, letterSpacing: ".08em", color: step === i ? "var(--acc)" : "var(--t7)" }}>{pt.num}</div>
            <div style={{ marginTop: 8, fontSize: 18, fontWeight: 600, letterSpacing: "-.01em", color: "var(--t1)" }}>{pt.t}</div>
            <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: "var(--t5)" }}>{pt.sub}</div>
          </button>
        ))}
      </div>

      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 24, marginTop: 24, alignItems: "stretch" }}>
        {/* left column */}
        <div className="card" style={{ borderRadius: 16, padding: "32px 30px" }}>
          {step === 0 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Build the crowd</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                A simulation is only as good as its people. Microcosm grounds the crowd three ways — select each to see how it shapes the pool.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
                {seedLayers.map((sl, i) => (
                  <div
                    key={sl.t}
                    onClick={() => setLayer(i)}
                    style={{
                      border: `1px solid ${layer === i ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 12,
                      padding: "18px 20px", background: layer === i ? "var(--acc-dim)" : "transparent",
                      cursor: "pointer", transition: "border-color .25s, background .25s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <span style={{ fontSize: 15.5, fontWeight: 600 }}>{sl.t}</span>
                      <span style={{ ...mono, fontSize: 10.5, color: layer === i ? "var(--acc)" : "var(--t7)", flex: "none" }}>{sl.tag}</span>
                    </div>
                    {layer === i && <p style={{ margin: "9px 0 0", fontSize: 13.5, lineHeight: 1.62, color: "var(--t4)" }}>{sl.d}</p>}
                  </div>
                ))}
              </div>
              <p style={{ ...mono, margin: "18px 0 0", fontSize: 11.5, lineHeight: 1.7, color: "var(--t7)" }}>
                + PREMIUM · INTERVIEW-GROUNDED PERSONAS BUILT FROM YOUR OWN BUYER INTERVIEWS — THE STANFORD PROTOCOL, APPLIED TO YOUR PIPELINE.
              </p>
            </div>
          )}
          {step === 1 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Let them argue</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                Upload floor plans, renderings, pricing sheets, or a full diligence pack. Agents tour, react, argue in forums, hold private conversations, and change their minds.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
                <Point head="They don't fill out surveys — they argue." rest="Positions form, collide, and shift under social pressure, capturing dynamics single-shot AI answers structurally miss." />
                <Point head="They remember." rest="Agents recall what they saw two threads ago, reflect on it, and let it change their next reaction." />
                <Point head="Every mind-change is logged." rest="Not just what the crowd concluded — which argument moved it, and for whom." />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 24 }}>
                <Chip>PANEL</Chip><Chip>FORUM</Chip><Chip>ADVERSARIAL</Chip><Chip>LONGITUDINAL</Chip>
              </div>
            </div>
          )}
          {step === 2 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Read the answer</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                Numbers you can put in front of an investment committee: ranked options with confidence ranges, segment breakouts, and drill-down into the reasoning behind every number.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
                <Point head="Dissent preserved." rest="The minority view ships with the verdict — the buyers who disagree are in the report, not averaged away." />
                <Point head="Confidence labeled." rest="Every estimate says how sure to be — and flags the questions simulation handles well versus the ones it doesn't." />
                <Point head="Track record attached." rest="The read arrives with the model's live scorecard against real outcomes — defensible because it's checkable." />
              </div>
            </div>
          )}
        </div>

        {/* right column */}
        <div className="card" style={{ borderRadius: 16, padding: 26, display: "flex", flexDirection: "column" }}>
          {step === 0 && layer === 0 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>GILBERT, AZ · BUYER POOL COMPOSITION</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                <Chip>CENSUS / ACS</Chip><Chip>MLS TRANSACTIONS</Chip><Chip>MIGRATION FLOWS</Chip><Chip>LENDING DATA</Chip><Chip>ABSORPTION OUTCOMES</Chip>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 26 }}>
                {compBars.map((b) => (
                  <div key={b.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{b.label}</span>
                      <span style={{ ...mono, color: "var(--t6)", fontSize: 11 }}>{b.pct} · {b.note}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 100, background: "var(--sf2)" }}>
                      <div style={{ width: b.w, height: 8, borderRadius: 100, background: b.fill, transformOrigin: "left", animation: "grow .8s ease both" }} />
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 22, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                If a third of Gilbert buyers are relocating Californians with a $600K ceiling, so is the agent pool. That is the answer to &quot;these are just ChatGPT&apos;s opinions.&quot;
              </p>
            </div>
          )}
          {step === 0 && layer === 1 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>2,400 AGENTS SEEDED · SELECT ONE</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 16 }}>
                {personas.map((p, i) => (
                  <button
                    key={p.initials}
                    onClick={() => setPIdx(i)}
                    style={{
                      ...mono, height: 44, borderRadius: 10,
                      border: `1px solid ${pIdx === i ? "var(--acc)" : "var(--ln4)"}`,
                      background: pIdx === i ? "var(--acc-dim)" : "var(--sf2)",
                      cursor: "pointer", fontSize: 11, color: pIdx === i ? "var(--acc)" : "var(--t7)", transition: "all .2s",
                    }}
                  >
                    {p.initials}
                  </button>
                ))}
              </div>
              <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "18px 20px", marginTop: 18, background: "var(--sf2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--acc)", color: "var(--acc-c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flex: "none" }}>
                    {personas[pIdx].initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{personas[pIdx].name}</div>
                    <div style={{ fontSize: 12, color: "var(--t5)", marginTop: 2 }}>{personas[pIdx].meta}</div>
                  </div>
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--t2)", fontStyle: "italic" }}>&quot;{personas[pIdx].quote}&quot;</p>
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 22, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                Not a demographic row: a job, a commute, kids&apos; ages, what they hated about their last house, and the number a spouse won&apos;t cross.
              </p>
            </div>
          )}
          {step === 0 && layer === 2 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>BACKTEST · SCORE · RECALIBRATE</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
                {[
                  ["Predicted vs. realized absorption", "±9% · n=41 runs"],
                  ["Top-choice plan agreement with actual sales", "78%"],
                  ["Population drift vs. migration data", "RE-SEEDED QUARTERLY"],
                ].map(([k, v]) => (
                  <div key={k} style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "16px 18px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{k}</span>
                    <span style={{ ...mono, fontSize: 11.5, color: "var(--acc)" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...mono, marginTop: 18, border: "1px dashed var(--ln6)", borderRadius: 12, padding: "16px 18px", fontSize: 11.5, lineHeight: 1.7, color: "var(--t6)", textAlign: "center" }}>
                RUN → PREDICT → REALITY ARRIVES → SCORE → RECALIBRATE → RUN
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 22, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                Every run is scored when reality arrives; miss patterns feed the next population. &quot;Defensible&quot; means a track record, not vibes.
              </p>
            </div>
          )}
          {step === 1 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>RUN_04182 · FORUM · THREAD 112 OF 1,893</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 18 }}>
                {[
                  ["MK", "Marcus K. · first-time buyer, 29", "The flex room is wasted space at this price point. I'd rather have the fourth bedroom — resale in this school district depends on it.", ""],
                  ["PT", "Priya T. · remote worker, relocating, 38", "Hard disagree. Two of us work from home. No dedicated office means we don't even tour it.", ""],
                ].map(([ini, who, text]) => (
                  <div key={who as string} style={{ display: "flex", gap: 12 }}>
                    <div style={{ ...mono, flex: "none", width: 30, height: 30, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: "var(--t4)" }}>{ini}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "var(--t5)" }}>{who}</div>
                      <p style={{ margin: "3px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)" }}>{text}</p>
                    </div>
                  </div>
                ))}
                <div style={{ marginLeft: 42, border: "1px dashed var(--ln6)", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t7)" }}>PRIVATE · PRIYA T. → DANA R.</div>
                  <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--t4)" }}>Did you see the pantry on Plan B? That&apos;s the actual seller here.</p>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ ...mono, flex: "none", width: 30, height: 30, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: "var(--t4)" }}>MK</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--t5)" }}>Marcus K. · <span style={{ color: "#cf9436" }}>changed position</span></div>
                    <p style={{ margin: "3px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)" }}>Fair — if the flex room ships with a door and a closet, it counts as a bedroom anyway. That version I&apos;d pay for.</p>
                  </div>
                </div>
              </div>
              <div style={{ ...mono, margin: "auto 0 0", paddingTop: 18, borderTop: "1px solid var(--ln2)", fontSize: 11, color: "var(--t6)" }}>
                2,412 AGENTS · 18,940 POSTS · 31% CHANGED POSITION AT LEAST ONCE
              </div>
            </div>
          )}
          {step === 2 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>RUN_04182 · SYNTHESIS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>
                {[
                  ["Plan B — flex room w/ door", "54% ± 5 · HIGH", "54%", "var(--acc)", "0s"],
                  ["Plan A — 4th bedroom", "33% ± 6 · HIGH", "33%", "var(--t7)", ".1s"],
                  ["Plan C — open loft", "13% ± 4 · MEDIUM", "13%", "var(--t7)", ".2s"],
                ].map(([label, meta, w, fill, delay]) => (
                  <div key={label as string}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      <span style={{ ...mono, color: "var(--t6)", fontSize: 11 }}>{meta}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 100, background: "var(--sf2)" }}>
                      <div style={{ width: w as string, height: 8, borderRadius: 100, background: fill as string, transformOrigin: "left", animation: `grow .8s ${delay} ease both` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 22 }}>
                {[
                  ["TOP OBJECTION", "Kitchen island clearance"],
                  ["DISSENT", "Move-down buyers prefer Plan A"],
                  ["CALIBRATION RECORD", "±9% vs. actual absorption, n=41"],
                ].map(([k, v]) => (
                  <div key={k} style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "14px 18px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                    <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--t7)" }}>{k}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 22, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                Ranked, bounded, and argued — with drill-down into the reasoning of any agent behind any number.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
