"use client";

import { CSSProperties, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

/* ---------- shared bits ---------- */

function Tag({ children, color = "var(--t7)" }: { children: React.ReactNode; color?: string }) {
  return <span style={{ ...mono, fontSize: 10, letterSpacing: ".05em", color, flex: "none" }}>{children}</span>;
}

function Point({ head, rest }: { head: string; rest: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 14, lineHeight: 1.6, color: "var(--t2)" }}>
      <span style={{ color: "var(--acc)", flex: "none" }}>→</span>
      <span><strong style={{ fontWeight: 600, color: "var(--t0)" }}>{head}</strong> {rest}</span>
    </div>
  );
}

/* ---------- stage data ---------- */

const stages = [
  { num: "01", key: "BRIEF", t: "State the question", sub: "One clear question, in your own words" },
  { num: "02", key: "DOCUMENTS", t: "Hand over the homework", sub: "Your diligence docs become the panel's source of truth" },
  { num: "03", key: "POPULATION", t: "Cast the panel", sub: "The right experts and the right crowd, seat by seat" },
  { num: "04", key: "SIMULATION", t: "Run the deliberation", sub: "Watch it live — and take the floor yourself" },
  { num: "05", key: "REPORT", t: "Read the answer", sub: "A decision-grade report, every number sourced" },
];

/* ---------- casting demo data (stage 03) ---------- */

type Seat = { role: string; why: string; tag: string; tagColor?: string };
type CastProblem = {
  label: string;
  question: string;
  composition: string;
  expertN: number; residentN: number;
  expertPct: number; // width of expert share in the bar
  mode: string;
  seats: Seat[];
};

const castProblems: CastProblem[] = [
  {
    label: "DATA CENTER GO/NO-GO",
    question: "Is ±212 acres at Signal Butte & Pecos suitable for a 300MW data center campus?",
    composition: "MIXED PANEL — feasibility needs experts; consent needs the neighbors",
    expertN: 48, residentN: 400, expertPct: 34,
    mode: "AGORA · open deliberation",
    seats: [
      { role: "Grid interconnection planner", why: "Owns the power timeline — the gating constraint", tag: "LIBRARY MATCH · POWER" },
      { role: "Water resources engineer", why: "Cooling strategy and the political optics of water", tag: "LIBRARY MATCH · WATER" },
      { role: "Powered-land investor", why: "Structures the option against interconnect risk", tag: "LIBRARY MATCH · CAPITAL" },
      { role: "City planner, econ development", why: "Reads council appetite and the entitlement path", tag: "LIBRARY MATCH · CIVIC" },
      { role: "Community advocate", why: "Instructed to oppose — finds the moratorium risk first", tag: "ADVERSARIAL SEED", tagColor: "var(--warn)" },
      { role: "Residents of ZIPs 85212 + 85142", why: "400 agents sampled from Census records for the actual neighborhoods", tag: "CENSUS COHORT · ACS PUMS" },
    ],
  },
  {
    label: "FLOOR-PLAN MIX",
    question: "Which floor-plan mix should we build for a 300-lot community in Raleigh–Durham?",
    composition: "CONSUMERS FIRST — demand questions belong to the buyers, with a thin expert bench",
    expertN: 6, residentN: 2400, expertPct: 8,
    mode: "JURY first pass · AGORA deep dive",
    seats: [
      { role: "Move-up buyer cohort", why: "The volume segment — sampled to match the metro's actual incomes and households", tag: "CENSUS COHORT · ACS" },
      { role: "First-time buyer cohort", why: "Payment-anchored — finds the price ceiling before you do", tag: "CENSUS COHORT · ACS" },
      { role: "Relocating remote-worker cohort", why: "The migration segment with different non-negotiables", tag: "CENSUS COHORT · MIGRATION" },
      { role: "Homebuilder division president", why: "Interprets demand signals into spec-mix decisions", tag: "LIBRARY MATCH · DEVELOPMENT" },
      { role: "New-home sales counselor", why: "Knows what buyers say in model homes vs. what they sign", tag: "LIBRARY MATCH · SALES" },
      { role: "Skeptical residential appraiser", why: "Instructed to challenge — will the premium comp out?", tag: "ADVERSARIAL SEED", tagColor: "var(--warn)" },
    ],
  },
  {
    label: "REZONING HEARING",
    question: "Will our 96-unit, 4-story infill proposal survive the planning commission?",
    composition: "MIXED, RESIDENT-HEAVY — approval is a social process before it's a legal one",
    expertN: 7, residentN: 340, expertPct: 12,
    mode: "TRIBUNAL · advocates argue, a judge rules",
    seats: [
      { role: "Residents within notice radius", why: "340 agents from Census records — the actual public-comment pool", tag: "CENSUS COHORT · ACS PUMS" },
      { role: "Organized-opposition coalition", why: "Instructed to fight — surfaces the real objection (traffic, not height)", tag: "ADVERSARIAL SEED", tagColor: "var(--warn)" },
      { role: "Council member archetypes", why: "Pro-growth, slow-growth, swing vote — the room that decides", tag: "LIBRARY MATCH · CIVIC" },
      { role: "Land-use counsel", why: "What's defensible on the record vs. what merely sounds good", tag: "LIBRARY MATCH · LEGAL" },
      { role: "Planning staff reviewer", why: "Writes the conditions your pro forma has to absorb", tag: "LIBRARY MATCH · CIVIC" },
      { role: "YIMBY renter cohort", why: "The support that shows up when someone asks it to", tag: "CENSUS COHORT · ACS" },
    ],
  },
];

/* ---------- the component ---------- */

export default function ProductTour() {
  const [stage, setStage] = useState(2); // open on the differentiator
  const [problem, setProblem] = useState(0);
  const cp = castProblems[problem];

  return (
    <section id="product" className="section">
      <div className="kicker">How it works</div>
      <h2 className="h2" style={{ maxWidth: 760 }}>Five stages from a hard question to a defensible answer.</h2>
      <p style={{ margin: "20px 0 0", maxWidth: 680, fontSize: 16, lineHeight: 1.65, color: "var(--t5)" }}>
        The same loop every time — brief, documents, population, simulation, report. Strong defaults at every stage, and everything stays editable.
      </p>

      {/* stage tabs */}
      <div className="grid3" style={{ gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginTop: 52 }}>
        {stages.map((st, i) => (
          <button
            key={st.key}
            onClick={() => setStage(i)}
            style={{
              textAlign: "left", border: "none", borderTop: `2px solid ${stage === i ? "var(--acc)" : "var(--ln4)"}`,
              background: "transparent", padding: "14px 4px 0", cursor: "pointer", transition: "all .25s",
            }}
          >
            <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".1em", color: stage === i ? "var(--acc)" : "var(--t7)" }}>
              {st.num} · {st.key}
            </div>
            <div style={{ marginTop: 5, fontSize: 14.5, fontWeight: 600, color: stage === i ? "var(--t0)" : "var(--t5)" }}>{st.t}</div>
          </button>
        ))}
      </div>

      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 24, marginTop: 30, alignItems: "stretch" }}>
        {/* ---------- LEFT: explanation ---------- */}
        <div className="card" style={{ borderRadius: 16, padding: "32px 30px" }}>
          {stage === 0 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>State the question</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                Write it the way you&apos;d ask a partner — one clear question. Microcosm proposes the sub-questions a decision-grade answer has to resolve; you edit the list.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
                <Point head="Every sub-question becomes a report section." rest="Nothing you asked for goes unanswered — the report is built backwards from this list." />
                <Point head="Templates for common decisions." rest="Site go/no-go, product mix, pricing, lease-up, entitlement rehearsal, policy impact — each pre-fills questions, panel shape, and report skeleton." />
                <Point head="Success criteria up front." rest="Tell it what a useful answer looks like to your committee, and the synthesis aims at that bar." />
              </div>
            </div>
          )}
          {stage === 1 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Hand over the homework</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                Upload what you already have — surveys, offering memos, zoning code, environmental reports, rent rolls, site plans. Every document is parsed and indexed for the panel.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
                <Point head="Agents cite documents by name and page." rest="Claims trace to sources — the deliberation runs on your facts, not the model's memory." />
                <Point head="A verifier checks every number." rest="An independent fact-checking agent runs behind the panel, testing each claim against the documents. Contradictions get flagged into the record — including the seller's." />
                <Point head="Connected data, when you allow it." rest="Census, market, and public-records tools can be switched on per simulation; every tool call is logged and citable." />
              </div>
            </div>
          )}
          {stage === 2 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Cast the panel</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                This is the heart of the product. A casting pass reads your brief and documents, decides whether the question needs experts, consumers, or both — then fills every seat.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
                <Point head="1,100+ specialized personas on call." rest="A library covering the entire built world — capital, construction, civic, community, power, water, legal — matched to your question seat by seat." />
                <Point head="Crowds built from Census records." rest="Consumer and resident cohorts are sampled from public microdata for your actual ZIP codes, so the crowd's incomes, ages, and households match the real market." />
                <Point head="Every panel hires its own critics." rest="At least one seat is instructed to oppose you. Rehearse the objection here, not at the hearing." />
                <Point head="Edit anything, add anyone." rest="Rewrite backstories, change counts, write your own experts, save panels for reuse." />
              </div>
            </div>
          )}
          {stage === 3 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Run the deliberation</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                Pick how the room runs — an open forum by default, a judged debate for contested calls, independent verdicts for a fast read. Then watch it happen live: a network of agents on one side, the threaded argument on the other.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
                <Point head="Positions change on the record." rest="When an agent flips, it says so and says why — the argument that moved it is part of the output." />
                <Point head="Take the floor yourself." rest="Post into the forum, tag any agent by name, and get an answer grounded in everything said so far. Challenge a claim, add missing context, redirect the room — before the report is written." />
                <Point head="Pause, speed up, skip to the end." rest="The deliberation is watchable and steerable, never a black box." />
              </div>
            </div>
          )}
          {stage === 4 && (
            <div style={{ animation: "fadeUp .4s ease both" }}>
              <h3 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Read the answer</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>
                The output is a report your investment committee can interrogate: a verdict with conditions, scores by dimension, findings cited to the transcript, a risk register with early-warning signals, and the dissents — preserved, named, never averaged away.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
                <Point head="Every number carries its source." rest="Click a finding and land on the exact posts, documents, or data behind it." />
                <Point head="The room stays open." rest="Ask follow-up questions after the report ships — the panel answers with full memory of the run, and material threads append to the report." />
                <Point head="Fork the scenario." rest="Change one assumption, document, or parameter and re-run. The diff view shows exactly what moved: verdict, scores, and who changed their mind." />
              </div>
            </div>
          )}
        </div>

        {/* ---------- RIGHT: visual ---------- */}
        <div className="card" style={{ borderRadius: 16, padding: 26, display: "flex", flexDirection: "column" }}>
          {stage === 0 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>NEW SIMULATION · THE BRIEF</div>
              <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "20px 22px", marginTop: 16, background: "var(--sf2)" }}>
                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.45, letterSpacing: "-.01em" }}>
                  Is ±212 acres at Signal Butte &amp; Pecos suitable for a 300MW data center campus?
                  <span style={{ display: "inline-block", width: 8, height: 16, background: "var(--acc)", verticalAlign: "-2px", marginLeft: 4, animation: "blink 1s step-end infinite" }} />
                </div>
              </div>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)", marginTop: 22 }}>QUESTIONS TO RESOLVE · AUTO-SUGGESTED, EDITABLE</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                {["POWER TIMELINE", "WATER STRATEGY", "FIBER", "ENTITLEMENT PATH", "COMMUNITY RISK", "BUY VS. OPTION"].map((q) => (
                  <span key={q} style={{ ...mono, fontSize: 11, padding: "7px 14px", borderRadius: 100, background: "var(--acc-dim)", border: "1px solid var(--acc)", color: "var(--acc)" }}>{q}</span>
                ))}
                <span style={{ ...mono, fontSize: 11, padding: "7px 14px", borderRadius: 100, border: "1px dashed var(--ln6)", color: "var(--t6)" }}>+ ADD YOUR OWN</span>
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 22, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                Six questions in — six required sections out. The report can&apos;t skip what you asked.
              </p>
            </div>
          )}
          {stage === 1 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>DILIGENCE SET · PARSED &amp; INDEXED</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16 }}>
                {[
                  ["ALTA_SURVEY.PDF", "4.2 MB"],
                  ["SRP_TRANSMISSION_MAP.GEOJSON", "11.0 MB"],
                  ["MESA_ZONING_CODE.HTML", "2.1 MB"],
                  ["PHASE_ONE_ESA.PDF", "18.3 MB"],
                  ["BROKER_OM.PDF", "9.4 MB"],
                ].map(([name, size]) => (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--ln3)", borderRadius: 10, padding: "11px 16px" }}>
                    <span style={{ ...mono, fontSize: 11, color: "var(--t3)", flex: "none" }}>{name}</span>
                    <span style={{ ...mono, fontSize: 10, color: "var(--t7)", flex: "none" }}>{size}</span>
                    <div style={{ flex: 1, height: 3, borderRadius: 100, background: "var(--sf2)" }}>
                      <div style={{ height: 3, borderRadius: 100, background: "var(--acc)", width: "100%" }} />
                    </div>
                    <span style={{ ...mono, fontSize: 10, color: "var(--acc)", flex: "none" }}>INDEXED ✓</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 18, border: "1px solid var(--warn)", background: "var(--warn-dim)", borderRadius: 12, padding: "14px 18px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--warn)" }}>VERIFIER PASS · LIVE</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>9 broker claims contradicted by the documents</span>
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 22, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                The panel argues from your documents — and gets fact-checked against them in real time.
              </p>
            </div>
          )}
          {stage === 2 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>THE CASTING PASS · PICK A QUESTION</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                {castProblems.map((p, i) => (
                  <button
                    key={p.label}
                    onClick={() => setProblem(i)}
                    style={{
                      ...mono, fontSize: 10.5, padding: "8px 14px", borderRadius: 100,
                      border: `1px solid ${problem === i ? "var(--acc)" : "var(--ln6)"}`,
                      background: problem === i ? "var(--acc-dim)" : "transparent",
                      color: problem === i ? "var(--acc)" : "var(--t5)", cursor: "pointer", transition: "all .2s",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div key={problem} style={{ animation: "fadeUp .35s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ marginTop: 16, fontSize: 13.5, lineHeight: 1.55, color: "var(--t4)", fontStyle: "italic" }}>&quot;{cp.question}&quot;</div>
                <div style={{ marginTop: 16, border: "1px solid var(--ln4)", borderRadius: 12, padding: "14px 18px" }}>
                  <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--acc)" }}>{cp.composition}</div>
                  <div style={{ display: "flex", height: 10, borderRadius: 100, overflow: "hidden", marginTop: 12 }}>
                    <div style={{ width: `${cp.expertPct}%`, background: "var(--acc)" }} />
                    <div style={{ flex: 1, background: "var(--acc-dim)" }} />
                  </div>
                  <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--t6)", marginTop: 8 }}>
                    <span>{cp.expertN} EXPERTS</span>
                    <span>{cp.residentN.toLocaleString()} CONSUMERS / RESIDENTS</span>
                    <span style={{ color: "var(--acc)" }}>{cp.mode}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {cp.seats.map((s) => (
                    <div key={s.role} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", border: "1px solid var(--ln2)", borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.role}</div>
                        <div style={{ fontSize: 12, color: "var(--t6)", marginTop: 2, lineHeight: 1.5 }}>{s.why}</div>
                      </div>
                      <Tag color={s.tagColor ?? "var(--t7)"}>{s.tag}</Tag>
                    </div>
                  ))}
                </div>
                <p style={{ ...mono, margin: "auto 0 0", paddingTop: 16, fontSize: 10.5, lineHeight: 1.7, color: "var(--t7)" }}>
                  CAST FROM A 1,100+ PERSONA LIBRARY · EVERY SEAT EDITABLE · SAVE PANELS FOR REUSE
                </p>
              </div>
            </div>
          )}
          {stage === 3 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>
                <span>DAY 13 / 14 · THREAD 47-A · POWER</span>
                <span style={{ color: "var(--acc)" }}>● LIVE</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "13px 16px", background: "var(--sf2)" }}>
                  <div style={{ fontSize: 12, color: "var(--t5)" }}><strong style={{ color: "var(--t1)", fontWeight: 600 }}>Rosa M.</strong> · grid interconnection planner · <span style={{ ...mono, fontSize: 10, color: "var(--acc)" }}>POST 2</span></div>
                  <p style={{ margin: "7px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--t2)" }}>The OM is fiction. Nearest 230kV circuit is 1.8 miles north with no spare substation capacity — full energization is 2030–31, realistically.</p>
                </div>
                <div style={{ border: "1px solid var(--acc)", borderRadius: 12, padding: "13px 16px", background: "var(--acc-dim)" }}>
                  <div style={{ fontSize: 12, color: "var(--t5)" }}><strong style={{ color: "var(--t1)", fontWeight: 600 }}>You</strong> · <span style={{ ...mono, fontSize: 10, color: "var(--acc)" }}>TAKING THE FLOOR</span></div>
                  <p style={{ margin: "7px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--t2)" }}><span style={{ color: "var(--acc)", fontWeight: 600 }}>@Rosa M.</span> — two speculative positions sit ahead of us in the queue. If both wash out at the next refresh, what does that do to your timeline?</p>
                </div>
                <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "13px 16px", background: "var(--sf2)", marginLeft: 24 }}>
                  <div style={{ fontSize: 12, color: "var(--t5)" }}><strong style={{ color: "var(--t1)", fontWeight: 600 }}>Rosa M.</strong> · <span style={{ ...mono, fontSize: 10, color: "var(--t7)" }}>REPLY · CITES SRP QUEUE FILINGS</span></div>
                  <p style={{ margin: "7px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--t2)" }}>Everything moves left about a year — call it 2029–30. Plausible, not bankable: neither position ahead of you has land control, but I wouldn&apos;t underwrite on their failure.</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                {["AGORA", "ROUNDTABLE", "TRIBUNAL", "CHAMBER", "JURY", "DESK", "EXPEDITION"].map((m, i) => (
                  <span key={m} style={{ ...mono, fontSize: 10, padding: "5px 11px", borderRadius: 100, border: `1px solid ${i === 0 ? "var(--acc)" : "var(--ln6)"}`, color: i === 0 ? "var(--acc)" : "var(--t6)" }}>{m}</span>
                ))}
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 18, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                Seven ways to run the room — and you&apos;re a participant in all of them, not a spectator.
              </p>
            </div>
          )}
          {stage === 4 && (
            <div style={{ animation: "fadeUp .4s ease both", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>
                <span>SITE 47-A · TECHNICAL ASSESSMENT</span>
              </div>
              <div style={{ marginTop: 14, display: "inline-flex" }}>
                <span style={{ ...mono, border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)", borderRadius: 100, padding: "8px 16px", fontSize: 11.5, letterSpacing: ".04em" }}>
                  CONDITIONAL GO — OPTION, DON&apos;T BUY
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
                {[
                  ["Fiber & latency", "90%", "var(--acc)", "9 / 10"],
                  ["Entitlement path", "70%", "var(--acc)", "7 / 10"],
                  ["Power, pre-2030", "30%", "var(--warn)", "3 / 10"],
                ].map(([label, w, fill, val]) => (
                  <div key={label as string}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      <span style={{ ...mono, fontSize: 11, color: "var(--t6)" }}>{val}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 100, background: "var(--sf2)" }}>
                      <div style={{ width: w as string, height: 8, borderRadius: 100, background: fill as string, transformOrigin: "left", animation: "grow .8s ease both" }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "13px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--t7)" }}>DISSENTS · PRESERVED</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>3 panelists maintain NO-GO, on the record</span>
                </div>
                <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "13px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--t7)" }}>CITED</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Every finding links to posts, docs, or data</span>
                </div>
                <div style={{ border: "1px dashed var(--ln6)", borderRadius: 12, padding: "13px 16px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".06em", color: "var(--acc)" }}>ASK THE PANEL</span>
                  <span style={{ fontSize: 13, color: "var(--t4)" }}>Follow-ups reopen the room · forks diff the answer</span>
                </div>
              </div>
              <p style={{ margin: "auto 0 0", paddingTop: 18, fontSize: 13, lineHeight: 1.65, color: "var(--t5)" }}>
                See the full report grammar in the <a href="/demo.html" style={{ color: "var(--acc)" }}>live demo</a> — verdict, risk register, critical path, analytics, and the transcript behind it all.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
