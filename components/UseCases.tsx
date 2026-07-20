"use client";

import { CSSProperties, useEffect, useState } from "react";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

type Seat = { s: string; tag: string; warn?: boolean };
type UseCase = {
  t: string; d: string; out: string;
  q: string; mode: string;
  seats: Seat[];
  get: string[];
};

const useCases: UseCase[] = [
  {
    t: "Land go/no-go & site diligence",
    d: "The full expert panel — power, water, entitlement, capital, community — on a parcel decision.",
    out: "verdict · risk register",
    q: "Is ±212 acres at Signal Butte & Pecos suitable for a 300MW data center campus at $385K/acre?",
    mode: "AGORA · MIXED PANEL",
    seats: [
      { s: "Grid interconnection planner", tag: "POWER" },
      { s: "Water resources engineer", tag: "WATER" },
      { s: "Powered-land investor", tag: "CAPITAL" },
      { s: "City planner, econ development", tag: "CIVIC" },
      { s: "Industrial land broker", tag: "LAND" },
      { s: "Community advocate", tag: "ADVERSARIAL", warn: true },
      { s: "400 residents · ACS PUMS, actual ZIPs", tag: "CENSUS" },
    ],
    get: ["Go / no-go / conditional verdict with the deal structure that makes it work", "Risk register with mitigations and early-warning signals", "Dissents preserved and attributed — the no votes and their reasons"],
  },
  {
    t: "Floor-plan & product mix",
    d: "Which plans, elevations, and options maximize appeal and willingness-to-pay in a target submarket.",
    out: "ranked plans · feature heatmap",
    q: "Which floor-plan mix should we build for a 300-lot community in Raleigh–Durham — and what will buyers pay extra for?",
    mode: "JURY → AGORA · CONSUMERS FIRST",
    seats: [
      { s: "2,400 buyer agents · census-seeded for the MSA", tag: "CENSUS" },
      { s: "Move-up, first-time, relocating & downsizer cohorts", tag: "SEGMENTS" },
      { s: "Homebuilder division president", tag: "EXPERT" },
      { s: "New-home sales counselor", tag: "EXPERT" },
      { s: "Skeptical residential appraiser", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Ranked plans with preference splits and confidence ranges by segment", "Willingness-to-pay for each option and upgrade package", "The dissent: which segment disagrees and how big it is"],
  },
  {
    t: "Land acquisition demand depth",
    d: "Latent demand and price sensitivity for a proposed product on a parcel — before the bid.",
    out: "demand curve · absorption est.",
    q: "If we build 240 townhomes on this Gilbert parcel, who shows up, at what price, how fast?",
    mode: "AGORA · CONSUMERS + EXPERT BENCH",
    seats: [
      { s: "1,800 buyer agents · ACS-seeded for surrounding ZIPs", tag: "CENSUS" },
      { s: "Migration-flow cohort (CA in-movers)", tag: "SEGMENTS" },
      { s: "Land acquisition lead", tag: "EXPERT" },
      { s: "Submarket broker", tag: "EXPERT" },
      { s: "Bearish market economist", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Demand curve by price point with segment depth", "Absorption estimate as a direct pro forma input", "The price ceiling — where demand actually breaks"],
  },
  {
    t: "Pre-leasing & absorption",
    d: "Projected velocity and achievable rents as an underwriting input, segment by segment.",
    out: "lease-up curve · pro forma feed",
    q: "What rents and lease-up pace should we underwrite for a 212-unit multifamily delivering next spring?",
    mode: "AGORA · RENTER COHORTS",
    seats: [
      { s: "1,800 renter agents · census-seeded, income-banded", tag: "CENSUS" },
      { s: "Corporate-relocation & student segments", tag: "SEGMENTS" },
      { s: "Multifamily research head", tag: "EXPERT" },
      { s: "Lease-up marketing lead", tag: "EXPERT" },
      { s: "Competitor property manager", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Lease-up curve with month-by-month velocity", "Achievable rent bands by unit type and segment", "What actually converts tours — and what's an expensive photo"],
  },
  {
    t: "Entitlement & hearing rehearsal",
    d: "Simulated public comment and council deliberation: objections, concessions, approval odds.",
    out: "objection map · playbook",
    q: "Will our 96-unit, 4-story infill proposal survive the planning commission — and what does approval cost?",
    mode: "TRIBUNAL · RESIDENT-HEAVY",
    seats: [
      { s: "340 residents in the notice radius · ACS PUMS", tag: "CENSUS" },
      { s: "Organized-opposition coalition", tag: "ADVERSARIAL", warn: true },
      { s: "Council member archetypes (pro-growth, slow-growth, swing)", tag: "CIVIC" },
      { s: "Planning staff reviewer", tag: "CIVIC" },
      { s: "Land-use counsel", tag: "EXPERT" },
      { s: "YIMBY renter cohort", tag: "CENSUS" },
    ],
    get: ["Approval odds with and without each concession", "Objection map: what's negotiable, what's a proxy fight", "The messaging playbook for the actual hearing"],
  },
  {
    t: "Pricing & concession strategy",
    d: "Elasticity by renter segment; which concessions convert and which give money away.",
    out: "pricing grid · concession ROI",
    q: "Face-rent cut or six weeks free — which fills this building faster, and what does each really cost?",
    mode: "JURY → AGORA · RENTERS",
    seats: [
      { s: "1,500 renter agents across price sensitivities", tag: "CENSUS" },
      { s: "Comparison-shopper & lease-expiring segments", tag: "SEGMENTS" },
      { s: "Revenue-management analyst", tag: "EXPERT" },
      { s: "Rival leasing agent", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Concession ROI by segment — who converts, who pockets it", "Effective-rent ladder vs. the comp set", "Projected weeks saved against the baseline plan"],
  },
  {
    t: "Unit mix & amenity programming",
    d: "Which amenities renters actually pay for — and which are expensive photos.",
    out: "amenity ROI ranking",
    q: "Co-working lounge, pickleball, or bigger units — what does this submarket actually reward?",
    mode: "ROUNDTABLE · RENTER COHORTS",
    seats: [
      { s: "1,200 renter agents · lifestyle-segmented", tag: "CENSUS" },
      { s: "Remote-worker & pet-owner cohorts", tag: "SEGMENTS" },
      { s: "Unit mix & amenity programming consultant", tag: "EXPERT" },
      { s: "Value engineer with a red pen", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Amenity ROI ranking: rent premium vs. cost to build and run", "Unit-mix recommendation with demand depth per type", "The amenity nobody will pay for — before you pour it"],
  },
  {
    t: "Design & rendering critique",
    d: "Agents react to kitchens, façades, and amenity renders through target-buyer eyes.",
    out: "preference scores · A/B ranking",
    q: "Which elevation and kitchen package wins our target buyer — A, B, or C?",
    mode: "PANEL · MULTIMODAL",
    seats: [
      { s: "800 buyer agents matched to the community's profile", tag: "CENSUS" },
      { s: "Production home plan designer", tag: "EXPERT" },
      { s: "Model-home merchandiser", tag: "EXPERT" },
      { s: "Cost-conscious contrarian buyer", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["A/B/C ranking with preference scores and the why behind each", "Segment splits — who loves what you're building, who shrugs", "The objection heatmap on each render"],
  },
  {
    t: "Investor & LP sentiment",
    d: "How allocators will read a strategy letter or pivot — and their questions before they ask them.",
    out: "predicted Q&A · sentiment read",
    q: "How will our LPs read the Fund III strategy letter — and what will the gatekeepers ask?",
    mode: "CHAMBER · ALLOCATOR PANEL",
    seats: [
      { s: "120 allocator agents: pensions, endowments, family offices", tag: "LIBRARY" },
      { s: "Consultant gatekeeper", tag: "EXPERT" },
      { s: "Skeptical quant screener", tag: "ADVERSARIAL", warn: true },
      { s: "IR / LP-relations lead", tag: "EXPERT" },
    ],
    get: ["The predicted Q&A — matched to prepared answers, gaps flagged", "Trust-erosion passages identified line by line", "Sentiment drivers ranked across allocator types"],
  },
  {
    t: "Retail site & tenant mix",
    d: "Will shoppers show up for this concept at this corner — and which tenant mix fits the trade area.",
    out: "demand estimate · concept fit",
    q: "Does a food-hall anchor work at this intersection, and what tenant mix holds the trade area?",
    mode: "AGORA · SHOPPER COHORTS",
    seats: [
      { s: "1,000 trade-area shopper agents · census-seeded", tag: "CENSUS" },
      { s: "Restaurant site-selection broker", tag: "EXPERT" },
      { s: "Grocery-anchored center developer", tag: "EXPERT" },
      { s: "Incumbent center owner nearby", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Visit-intent demand estimate by daypart and segment", "Tenant-mix fit ranking for the actual trade area", "The cannibalization read the broker won't give you"],
  },
  {
    t: "Office-to-residential conversion",
    d: "Does the conversion pencil with real renter demand — or only on the architect's board.",
    out: "demand read · unit-mix fit",
    q: "Do renters actually want the units this floor plate can produce — deep, low-light, odd layouts and all?",
    mode: "AGORA · RENTERS + EXPERTS",
    seats: [
      { s: "1,200 downtown renter agents · census-seeded", tag: "CENSUS" },
      { s: "Office-to-residential conversion specialist", tag: "EXPERT" },
      { s: "Architect (adaptive reuse)", tag: "EXPERT" },
      { s: "Skeptical construction lender", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Demand read on the actual unit shapes, not idealized ones", "Rent bands renters will pay for the compromised layouts", "The kill-criteria: what the lender's skeptic couldn't get past"],
  },
  {
    t: "Build-to-rent community design",
    d: "Lot sizes, layouts, garages, pet policy: what BTR renters trade off, and what they walk over.",
    out: "preference map · rent bands",
    q: "What do BTR renters in this metro trade off — yard vs. garage vs. $150 of rent?",
    mode: "ROUNDTABLE · BTR COHORTS",
    seats: [
      { s: "1,600 renter-household agents · family-stage segmented", tag: "CENSUS" },
      { s: "Pet-owner & remote-worker cohorts", tag: "SEGMENTS" },
      { s: "BTR/SFR community developer", tag: "EXPERT" },
      { s: "Single-family landlord competitor", tag: "ADVERSARIAL", warn: true },
    ],
    get: ["Preference map: the trade-offs renters actually make", "Rent bands by product type and lot configuration", "The walk-away lines — policies that lose the lease"],
  },
];

const VISIBLE = 8;

export default function UseCases() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenIdx(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = openIdx !== null ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [openIdx]);

  const u = openIdx !== null ? useCases[openIdx] : null;

  return (
    <section id="usecases" className="section">
      <div className="kicker">Across the value chain</div>
      <h2 className="h2" style={{ maxWidth: 780 }}>Every irreversible decision deserves a rehearsal.</h2>
      <p style={{ margin: "20px 0 0", maxWidth: 640, fontSize: 16, lineHeight: 1.65, color: "var(--t5)" }}>
        Land is bought once. Product is entitled once. There is no A/B test for a master-planned community — so rehearse instead. Select any card to see the question, the panel it seeds, and what comes back.
      </p>
      <div className="grid4" style={{ marginTop: 56 }}>
        {useCases.map((uc, i) => {
          if (!expanded && i >= VISIBLE) return null;
          return (
            <button
              key={uc.t}
              onClick={() => setOpenIdx(i)}
              className="card cardHover"
              style={{ textAlign: "left", padding: "26px 24px", minHeight: 190, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 18, cursor: "pointer", animation: i >= VISIBLE ? "fadeUp .4s ease both" : undefined }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.3, color: "var(--t1)" }}>{uc.t}</h3>
                <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--t5)" }}>{uc.d}</p>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ ...mono, fontSize: 10.5, color: "var(--t7)", textTransform: "uppercase", letterSpacing: ".06em" }}>{uc.out}</span>
                <span style={{ ...mono, fontSize: 10.5, color: "var(--acc)", flex: "none" }}>DETAILS →</span>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="btnGhost"
          style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "13px 26px", fontSize: 14 }}
        >
          {expanded ? "Show fewer" : `See ${useCases.length - VISIBLE} more use cases`}
          <span style={{ ...mono, fontSize: 11, color: "var(--acc)" }}>{expanded ? "↑" : "↓"}</span>
        </button>
      </div>

      {/* detail overlay */}
      {u && (
        <div
          onClick={() => setOpenIdx(null)}
          style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(10,11,12,.66)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label={u.t}
            style={{ background: "var(--sf)", border: "1px solid var(--ln5)", borderRadius: 18, maxWidth: 640, width: "100%", maxHeight: "86vh", overflowY: "auto", padding: "34px 36px", animation: "fadeUp .3s ease both" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <h3 style={{ margin: 0, fontSize: 23, fontWeight: 600, letterSpacing: "-.02em" }}>{u.t}</h3>
              <button onClick={() => setOpenIdx(null)} aria-label="Close" style={{ border: "1px solid var(--ln6)", background: "transparent", color: "var(--t4)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ ...mono, marginTop: 8, fontSize: 10.5, letterSpacing: ".08em", color: "var(--acc)" }}>{u.mode}</div>

            <div style={{ ...mono, marginTop: 24, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>THE QUESTION, AS YOU&apos;D TYPE IT</div>
            <p style={{ margin: "10px 0 0", fontSize: 15.5, lineHeight: 1.6, fontStyle: "italic", color: "var(--t2)" }}>&quot;{u.q}&quot;</p>

            <div style={{ ...mono, marginTop: 24, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>THE PANEL IT SEEDS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {u.seats.map((s) => (
                <div key={s.s} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", border: "1px solid var(--ln2)", borderRadius: 10, padding: "10px 14px" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.s}</span>
                  <span style={{ ...mono, fontSize: 10, letterSpacing: ".05em", color: s.warn ? "var(--warn)" : "var(--t7)", flex: "none" }}>{s.tag}</span>
                </div>
              ))}
            </div>

            <div style={{ ...mono, marginTop: 24, fontSize: 11, letterSpacing: ".1em", color: "var(--t6)" }}>WHAT COMES BACK</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              {u.get.map((g) => (
                <div key={g} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.6, color: "var(--t2)" }}>
                  <span style={{ color: "var(--acc)", flex: "none" }}>→</span>{g}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <a href="/#access" className="btnAcc" style={{ padding: "12px 24px", fontSize: 14 }}>Run this on your project</a>
              <a href="/demo.html" className="btnGhost" style={{ padding: "12px 24px", fontSize: 14 }}>See the demo</a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
