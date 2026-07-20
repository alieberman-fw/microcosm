"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

type Msg = { name: string; role: string; text: string };
type Scenario = {
  label: string;
  header: string;
  msgs: Msg[];
  verdict: { metric: string; label: string; points: string[]; conf: string; cls: string };
};

const scenarios: Scenario[] = [
  {
    label: "FLOOR-PLAN PANEL",
    header: "run_04182 · 2,400 buyer agents · Raleigh–Durham MSA · Plan A (flex room) vs Plan B (4th bedroom)",
    msgs: [
      { name: "Dana R.", role: "First-move-up · HH income $128K · 2 kids", text: "Plan B on paper — but that fourth bedroom is 10'×10'. My kids share fine today; what I don't have is anywhere to work. Plan A's flex room wins my walkthrough." },
      { name: "Marcus T.", role: "Relocating from Chicago · remote-first", text: "Everyone in my thread keeps saying 'bedroom count for resale.' That's 2019 thinking. Both of us work from home. Plan A, and I'd pay the $8K premium for the built-ins." },
      { name: "Priya S.", role: "Multigenerational household · dual income", text: "Disagree with the room — we need the fourth bedroom for my mother. But I notice I'm the only one here who does. That tells you the mix, not the winner." },
      { name: "Jon K.", role: "First-time buyer · rate-sensitive", text: "Honestly, neither premium matters if the payment breaks $2,900. Plan A base spec, skip the upgrade package. I'm the marginal buyer you're modeling for." },
      { name: "Elaine W.", role: "Empty-nester downsizing", text: "The flex room converts to a hobby space or a guest room. The bedroom is only ever a bedroom. Optionality is worth more than a label on a listing." },
    ],
    verdict: {
      metric: "64 / 36", label: "Preference split, Plan A over Plan B",
      points: [
        "Flex-room appeal concentrated in dual-remote and downsizer segments; bedroom demand isolated to multigen households (~14% of pool)",
        "Willingness-to-pay for Plan A premium clears $6–9K in top two segments",
        "Recommend Plan A as base with a bedroom-conversion option — captures both without a second SKU",
      ],
      conf: "0.81 · HIGH", cls: "CONVERGENT",
    },
  },
  {
    label: "ENTITLEMENT HEARING",
    header: "run_04203 · 340 resident + 7 council agents · infill parcel · 96-unit proposal, 4 stories",
    msgs: [
      { name: "Ruth B.", role: "Adjacent homeowner · 22 yrs · public comment", text: "Four stories shades my garden by 3pm in winter. I've read the massing study. Step the top floor back from the west edge and I go from opponent to neutral." },
      { name: "Coalition, 14 agents", role: "Organized opposition · traffic focus", text: "Our objection is trip generation at the school crossing, not height. If the TIA is honest about the 8am peak, say so at the podium before we do." },
      { name: "Derek M.", role: "Renter in district · YIMBY", text: "I'll speak in favor, and I'll bring people. But the applicant keeps leading with 'housing crisis' — lead with the traffic mitigation, that's what's actually contested here." },
      { name: "Councilmember 3", role: "Swing vote · re-election cycle", text: "I can defend 4 stories with the setback and a crossing guard commitment. I cannot defend it against an unanswered shadow study. Bring the revision, not the argument." },
      { name: "Planning staff", role: "Recommending body", text: "Staff report supports with conditions. The Ruth B. concession costs the project 4 units. The alternative costs it 6 months. That math should be in your pro forma tonight." },
    ],
    verdict: {
      metric: "72%", label: "Predicted approval odds, with west setback + TIA commitment",
      points: [
        "Opposition is negotiable: shadow (1 concession) and school crossing (1 commitment) resolve 80% of objection volume",
        "Height itself is a proxy grievance — do not concede stories",
        "Messaging playbook: open with traffic mitigation, not housing need",
      ],
      conf: "0.66 · MODERATE", cls: "CONVERGENT",
    },
  },
  {
    label: "LEASE-UP PRICING",
    header: "run_04191 · 1,800 renter agents · 212-unit multifamily · concession ladder test",
    msgs: [
      { name: "Amara J.", role: "Renter · 27 · price ceiling $2,100", text: "'One month free' is a spreadsheet trick — I still budget on face rent. Cut $150 off the ask and I tour this weekend. Concessions read like a warning sign to me." },
      { name: "Tom & Lisa V.", role: "Couple · comparing 3 properties", text: "We built a comparison sheet. Your competitor's effective rent beats yours by $84 after their 6-week special. You're not losing on product, you're losing on arithmetic." },
      { name: "Sofia R.", role: "Corporate relocation · low sensitivity", text: "I book on unit + move-in date, full stop. Stop discounting people like me — I'm 15% of your pool and you're giving me free money." },
      { name: "Devon P.", role: "Renter · 34 · lease expiring in 60 days", text: "The rooftop lounge photos are doing nothing. In-unit W/D and the parking bundle are the whole decision. Price the parking in and I stop comparison shopping." },
      { name: "Jae L.", role: "Grad student pair · co-signing", text: "We'd take the smallest 2BR at $2,350 today, but your floor is $2,495. That $145 gap is the difference between 94% and 88% leased by month nine. Your call." },
    ],
    verdict: {
      metric: "+11 wks", label: "Projected lease-up acceleration vs. flat-concession baseline",
      points: [
        "Face-rent cuts outperform free-month concessions in 3 of 5 segments — concessions signal distress to the most price-anchored renters",
        "Segment-gated concessions (skip corporate relo) recover ~$310K of giveaway",
        "Parking bundle moves conversion more than any amenity message tested",
      ],
      conf: "0.74 · HIGH", cls: "CONVERGENT",
    },
  },
  {
    label: "LP SENTIMENT",
    header: "run_04210 · 120 allocator agents · Fund III strategy letter · pre-distribution read",
    msgs: [
      { name: "Pension CIO", role: "$40B AUM · existing LP · risk committee", text: "Page 4 buries the DPI conversation under deployment pace. My committee reads the letter in reverse — distributions first. Restructure or expect the call." },
      { name: "Endowment MD", role: "First-close prospect · diligence mode", text: "The strategy pivot is defensible but you've framed it as continuity. Name the pivot. LPs forgive a change of mind; they don't forgive discovering one." },
      { name: "Family office", role: "Existing LP · relationship-driven", text: "The co-invest language got vaguer than Fund II's. That's the first thing our counsel flagged. Was that intentional? Because it reads intentional." },
      { name: "Consultant gatekeeper", role: "Advises 6 of your prospects", text: "I will be asked one question by every client: why is the sector allocation moving now. The letter answers everything except that. Prepare the two-paragraph answer." },
      { name: "Sovereign fund analyst", role: "Prospective · quant screen first", text: "Your net-vs-gross spread widened 90bps against the fee schedule you published. Someone will build that table. Better it appears in your letter than in theirs." },
    ],
    verdict: {
      metric: "8 / 10", label: "Predicted LP questions matched to prepared answers",
      points: [
        "Three passages flagged as trust-erosion risks; two are one-line fixes",
        "DPI framing is the dominant sentiment driver across 70% of allocator agents",
        "Recommend naming the strategy pivot explicitly — continuity framing tests worse with every sophisticated segment",
      ],
      conf: "0.69 · MODERATE", cls: "DIVERGENT — pair with human read",
    },
  },
];

const hues = ["#8ecfae", "#a9b6c9", "#c9bfa9", "#b3a9c9", "#9cc4c9"];

export default function LiveDemo() {
  const [scenario, setScenario] = useState(0);
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(true);
  const [verdict, setVerdict] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = (i: number) => {
    if (timer.current) clearTimeout(timer.current);
    setScenario(i); setShown(0); setTyping(true); setVerdict(false);
    const sc = scenarios[i];
    const reveal = (n: number) => {
      timer.current = setTimeout(() => {
        if (n < sc.msgs.length) {
          setShown(n + 1);
          setTyping(n + 1 < sc.msgs.length);
          reveal(n + 1);
        } else {
          setTyping(false);
          setVerdict(true);
        }
      }, n === 0 ? 700 : 1500);
    };
    reveal(0);
  };

  useEffect(() => {
    start(0);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sc = scenarios[scenario];

  return (
    <section id="demo" style={{ background: "var(--sf)", borderTop: "1px solid var(--ln1)", borderBottom: "1px solid var(--ln1)" }}>
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 30, flexWrap: "wrap" }}>
          <div>
            <div className="kicker">Live deliberation</div>
            <h2 className="h2">Pick a decision.<br />Watch the population work it.</h2>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {scenarios.map((x, i) => (
              <button
                key={x.label}
                onClick={() => start(i)}
                style={{
                  ...mono, fontSize: 12, padding: "10px 18px", borderRadius: 100,
                  border: `1px solid ${i === scenario ? "var(--acc)" : "var(--ln6)"}`,
                  background: i === scenario ? "var(--acc-dim)" : "transparent",
                  color: i === scenario ? "var(--acc)" : "var(--t5)",
                  cursor: "pointer", transition: "all .2s",
                }}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 28, marginTop: 52, alignItems: "start" }}>
          <div style={{ border: "1px solid var(--ln3)", borderRadius: 16, background: "var(--bg)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid var(--ln1)" }}>
              <span style={{ ...mono, fontSize: 11.5, color: "var(--t6)" }}>{sc.header}</span>
              <span style={{ ...mono, display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--acc)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.6s infinite" }} />
                SIMULATING
              </span>
            </div>
            <div style={{ padding: "26px 24px", display: "flex", flexDirection: "column", gap: 20, minHeight: 420 }}>
              {sc.msgs.slice(0, shown).map((m, i) => (
                <div key={`${scenario}-${i}`} style={{ display: "flex", gap: 14, animation: "fadeUp .45s ease both" }}>
                  <div style={{ flex: "none", width: 34, height: 34, borderRadius: "50%", background: hues[i % hues.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "#14231c" }}>
                    {m.name.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("")}
                  </div>
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</span>
                      <span style={{ ...mono, fontSize: 10.5, color: "var(--t7)" }}>{m.role}</span>
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--t2)", maxWidth: 560 }}>{m.text}</p>
                  </div>
                </div>
              ))}
              {typing && (
                <div style={{ ...mono, fontSize: 11.5, color: "var(--t7)", paddingLeft: 48 }}>
                  {sc.msgs[Math.min(shown, sc.msgs.length - 1)].name} is responding<span style={{ animation: "blink 1s step-end infinite" }}>…</span>
                </div>
              )}
            </div>
          </div>
          <div className="stickyCol" style={{ border: `1px solid ${verdict ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 16, background: "var(--bg)", padding: "30px 28px", transition: "border-color .5s" }}>
            <div style={{ ...mono, fontSize: 11, letterSpacing: ".12em", color: "var(--t6)", textTransform: "uppercase" }}>ReportAgent · synthesis</div>
            {verdict ? (
              <div style={{ animation: "fadeUp .5s ease both" }}>
                <div style={{ marginTop: 20, fontSize: 34, fontWeight: 600, letterSpacing: "-.03em", color: "var(--acc)" }}>{sc.verdict.metric}</div>
                <div style={{ fontSize: 13.5, color: "var(--t5)", marginTop: 4 }}>{sc.verdict.label}</div>
                <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12 }}>
                  {sc.verdict.points.map((v) => (
                    <div key={v} style={{ display: "flex", gap: 10, fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)" }}>
                      <span style={{ color: "var(--acc)", flex: "none" }}>→</span>{v}
                    </div>
                  ))}
                </div>
                <div style={{ ...mono, marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--ln2)", display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--t7)" }}>CONFIDENCE</span><span style={{ color: "var(--acc)" }}>{sc.verdict.conf}</span>
                </div>
                <div style={{ ...mono, marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--t7)" }}>CLASSIFICATION</span><span style={{ color: "var(--t1)" }}>{sc.verdict.cls}</span>
                </div>
              </div>
            ) : (
              <div style={{ ...mono, marginTop: 20, fontSize: 12, color: "var(--t7)" }}>
                Awaiting convergence<span style={{ animation: "blink 1s step-end infinite" }}>…</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
