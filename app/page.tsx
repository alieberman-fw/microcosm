import { CSSProperties } from "react";
import Nav, { Logo } from "@/components/Nav";
import Hero from "@/components/Hero";
import Pipeline from "@/components/Pipeline";
import Modes from "@/components/Modes";
import LiveDemo from "@/components/LiveDemo";
import Access from "@/components/Access";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const tickerItems = [
  { k: "STANFORD n=1,052", v: "interview-grounded agents hit 85% of human test-retest consistency" },
  { k: "SCALE", v: "5,000-agent population runs resolve in 30–90 seconds" },
  { k: "COST", v: "under 1/10th the cost of fielded human studies" },
  { k: "FEEDBACK LOOP", v: "12–24 month market feedback compressed to minutes" },
  { k: "MODES", v: "panel · forum · adversarial debate · longitudinal market" },
  { k: "CALIBRATION", v: "every prediction logged and scored against realized outcomes" },
];

const steps = [
  {
    num: "STEP 1", t: "Ask a hard question",
    d: "Type it the way you'd say it: \"Should we buy this parcel?\" \"Which floor plan wins?\" \"Will this rezoning pass?\" Attach the documents you already have — surveys, plans, pricing sheets. That's the whole setup.",
  },
  {
    num: "STEP 2", t: "Meet your panel",
    d: "Microcosm assembles the room your question needs: AI experts who reason from engineering, zoning, and market facts, and AI locals — buyers, renters, neighbors — built from real Census data for your actual ZIP codes. Edit anyone, add anyone.",
  },
  {
    num: "STEP 3", t: "Watch, then read",
    d: "The panel argues it out in front of you — live, visible, interruptible. Then you get a clear report: the verdict, what they'd pay, what they'd fight, who disagreed and why, and what to change before you spend real money.",
  },
];

const stats = [
  { n: "85%", d: "of humans' own two-week test-retest consistency, matched by interview-grounded agents (Stanford, n=1,052)" },
  { n: "5,000+", d: "agents per population run — reactions, debate, and synthesis in under 90 seconds" },
  { n: "<1/10", d: "the cost of fielding an equivalent human study — the marginal question becomes nearly free" },
  { n: "24 mo → min", d: "the feedback loop on product, pricing, and entitlement decisions, compressed" },
];

const whyCards = [
  {
    num: "01", t: "It's an argument, not an answer",
    d: "Ask one AI and you get its first guess. Ask a few hundred — each with different jobs, budgets, and biases — and let them argue, and the answer that survives the fight is far stronger than any single opinion. That's the swarm advantage, and it's why high-stakes fields from aviation to medicine rehearse decisions with many minds, not one.",
  },
  {
    num: "02", t: "The crowd matches your market",
    d: "Our simulated people aren't generic internet averages. They're built from public Census data for your actual ZIP codes — real incomes, ages, households, commutes — so the crowd reacting to your project looks like the market that will actually judge it.",
  },
  {
    num: "03", t: "We hire the critics",
    d: "Every panel includes voices instructed to oppose you — the organized neighbor, the skeptical lender, the tough councilmember. The objection you rehearse in simulation is the one that can't ambush you at the hearing. And when panelists still disagree at the end, the report says so instead of averaging it away.",
  },
  {
    num: "04", t: "It's checked against reality",
    d: "Every factual claim an agent makes is verified against your documents. Every prediction is logged and scored when the real outcome arrives. And every report labels its own confidence — including the questions simulation isn't good at. An honest instrument, honestly labeled.",
  },
];

const whyNow = [
  {
    num: "01", t: "The science landed",
    d: "Generative-agent research proved AI populations exhibit believable social behavior — memory, reflection, and influence included. By 2024, interview-grounded agents replicated real individuals' survey responses at 85% of their own test-retest consistency.",
    tag: "SMALLVILLE 2023 · STANFORD 2024",
  },
  {
    num: "02", t: "The economics flipped",
    d: "AI inference costs have collapsed by orders of magnitude. A 5,000-agent submarket deliberation now costs less than recruiting a single human respondent — and resolves before the coffee is cold.",
    tag: "30–90 SECONDS PER RUN",
  },
  {
    num: "03", t: "The ground truth exists",
    d: "Census, ACS, MLS, migration, and lending data are digitized down to the submarket. For the first time, a synthetic population can be seeded to match a real place — and scored against what that place actually did.",
    tag: "SEEDED, THEN BACKTESTED",
  },
];

const useCases = [
  { t: "Land go/no-go & site diligence", d: "Convene the full expert panel — power, water, entitlement, capital, community — for a verdict on a parcel before the bid.", out: "verdict · risk register" },
  { t: "Floor-plan & product mix", d: "Which plan, elevation, and option mix maximizes appeal and willingness-to-pay for a target submarket.", out: "ranked plans · feature heatmap" },
  { t: "Land acquisition demand depth", d: "Latent demand and price sensitivity for a proposed product on a parcel — before the bid, not after.", out: "demand curve · absorption est." },
  { t: "Pre-leasing & absorption", d: "Projected velocity and achievable rents as a direct underwriting input, segment by segment.", out: "lease-up curve · pro forma feed" },
  { t: "Entitlement & hearing rehearsal", d: "Simulated public comment and council deliberation: objections, concessions, and approval odds.", out: "objection map · messaging playbook" },
  { t: "Pricing & concession strategy", d: "Elasticity by renter segment; which concessions convert and which just give money away.", out: "pricing grid · concession ROI" },
  { t: "Unit mix & amenity programming", d: "Which amenities renters actually pay for — and which are expensive photos. Test the package before you pour it.", out: "amenity ROI ranking" },
  { t: "Design & rendering critique", d: "Multimodal agents react to kitchens, façades, and amenity renders through target-buyer eyes.", out: "preference scores · A/B ranking" },
  { t: "Investor & LP sentiment", d: "How allocators will read a strategy letter or pivot — and the questions they'll ask before they ask them.", out: "predicted Q&A · sentiment read" },
  { t: "Retail site & tenant mix", d: "Will shoppers actually show up for this concept, at this corner, at these prices — and which tenant mix fits the trade area.", out: "demand estimate · concept fit" },
  { t: "Office-to-residential conversion", d: "Does the conversion pencil with real renter demand — unit sizes, light, layouts — or only on the architect's board.", out: "demand read · unit-mix fit" },
  { t: "Build-to-rent community design", d: "Lot sizes, layouts, garages, pet policy: what BTR renters trade off, and what they walk away over.", out: "preference map · rent bands" },
];

function Kicker({ children }: { children: React.ReactNode }) {
  return <div className="kicker">{children}</div>;
}

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />

      {/* TICKER */}
      <div style={{ borderTop: "1px solid var(--ln1)", borderBottom: "1px solid var(--ln1)", background: "var(--sf)", overflow: "hidden", padding: "14px 0", whiteSpace: "nowrap" }}>
        <div style={{ display: "inline-flex", gap: 56, animation: "tick 46s linear infinite", paddingRight: 56 }}>
          {[...tickerItems, ...tickerItems].map((t, i) => (
            <span key={i} style={{ ...mono, fontSize: 12, color: "var(--t6)", display: "inline-flex", gap: 10, alignItems: "center" }}>
              <span style={{ color: "var(--acc)" }}>{t.k}</span>{t.v}
            </span>
          ))}
        </div>
      </div>

      {/* PLAIN-ENGLISH THREE STEPS */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "110px 40px 30px" }}>
        <Kicker>What it does</Kicker>
        <h2 className="h2" style={{ maxWidth: 760 }}>A rehearsal room for real estate&apos;s biggest decisions.</h2>
        <p style={{ margin: "20px 0 0", maxWidth: 660, fontSize: 16, lineHeight: 1.65, color: "var(--t5)" }}>
          Before you buy the land, set the rents, or walk into the hearing — run it past a small city of AI people first. No dashboards to learn, no data science required.
        </p>
        <div className="grid3" style={{ marginTop: 52 }}>
          {steps.map((s) => (
            <div key={s.num} className="card cardHoverQuiet" style={{ padding: "30px 28px" }}>
              <div style={{ ...mono, fontSize: 11.5, letterSpacing: ".1em", color: "var(--acc)" }}>{s.num}</div>
              <h3 style={{ margin: "14px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-.01em" }}>{s.t}</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "var(--t5)" }}>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* STATS */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "60px 40px 30px" }}>
        <div className="grid4" style={{ gap: 1, background: "var(--ln2)", border: "1px solid var(--ln2)", borderRadius: 14, overflow: "hidden" }}>
          {stats.map((s) => (
            <div key={s.n} style={{ background: "var(--sf)", padding: "34px 30px" }}>
              <div style={{ fontSize: 42, fontWeight: 600, letterSpacing: "-.03em", color: "var(--t0)" }}>{s.n}</div>
              <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.5, color: "var(--t5)" }}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <Pipeline />
      <Modes />
      <LiveDemo />

      {/* WHY IT WORKS */}
      <section id="why" className="section">
        <Kicker>Why it works</Kicker>
        <h2 className="h2" style={{ maxWidth: 780 }}>Why a swarm of AI minds beats one AI — and one gut call.</h2>
        <p style={{ margin: "20px 0 0", maxWidth: 680, fontSize: 16, lineHeight: 1.65, color: "var(--t5)" }}>
          The plain-English version of the science — no PhD required.
        </p>
        <div className="grid2" style={{ marginTop: 52, gap: 14 }}>
          {whyCards.map((c) => (
            <div key={c.num} className="card cardHoverQuiet" style={{ padding: "30px 28px" }}>
              <div style={{ ...mono, fontSize: 12, color: "var(--acc)" }}>{c.num}</div>
              <h3 style={{ margin: "14px 0 0", fontSize: 19, fontWeight: 600, letterSpacing: "-.01em" }}>{c.t}</h3>
              <p style={{ margin: "12px 0 0", fontSize: 14.5, lineHeight: 1.68, color: "var(--t5)" }}>{c.d}</p>
            </div>
          ))}
        </div>
        <p style={{ ...mono, margin: "26px 0 0", fontSize: 11.5, lineHeight: 1.7, color: "var(--t7)" }}>
          RESEARCH ANCHOR · INTERVIEW-GROUNDED AI AGENTS MATCHED REAL PEOPLE&apos;S SURVEY ANSWERS AT 85% OF THEIR OWN TWO-WEEK CONSISTENCY (STANFORD, N=1,052). EVERY MICROCOSM OUTPUT IS LABELED SYNTHETIC AND DIRECTIONAL.
        </p>
      </section>

      {/* WHY NOW */}
      <section style={{ background: "var(--sf)", borderTop: "1px solid var(--ln1)", borderBottom: "1px solid var(--ln1)" }}>
        <div className="section">
          <Kicker>Why now</Kicker>
          <h2 className="h2" style={{ maxWidth: 780 }}>Three curves crossed. Real estate is where they land hardest.</h2>
          <div className="grid3" style={{ marginTop: 56 }}>
            {whyNow.map((c) => (
              <div key={c.num} style={{ border: "1px solid var(--ln3)", borderRadius: 14, padding: "30px 28px", background: "var(--bg)" }}>
                <div style={{ ...mono, fontSize: 12, color: "var(--acc)" }}>{c.num}</div>
                <h3 style={{ margin: "14px 0 0", fontSize: 19, fontWeight: 600, letterSpacing: "-.01em" }}>{c.t}</h3>
                <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.65, color: "var(--t5)" }}>{c.d}</p>
                <div style={{ ...mono, marginTop: 16, fontSize: 11, color: "var(--t7)" }}>{c.tag}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 28, border: "1px solid var(--acc)", borderRadius: 16, background: "var(--acc-dim)", padding: "44px 40px" }}>
            <div style={{ fontSize: "clamp(22px,2.4vw,30px)", fontWeight: 600, letterSpacing: "-.02em", maxWidth: 820 }}>
              A grounded swarm is a leading indicator.
            </div>
            <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.7, color: "var(--t2)", maxWidth: 820 }}>
              The market reveals demand 12–24 months after capital is committed. A simulated population — grounded in a submarket&apos;s actual demographics, transactions, and migration — reveals it before. What to build, where, for whom, at what price: the hardest questions in real estate stop being answered in hindsight.
            </p>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section id="usecases" className="section">
        <Kicker>Across the value chain</Kicker>
        <h2 className="h2" style={{ maxWidth: 780 }}>Every irreversible decision deserves a rehearsal.</h2>
        <p style={{ margin: "20px 0 0", maxWidth: 640, fontSize: 16, lineHeight: 1.65, color: "var(--t5)" }}>
          You can&apos;t A/B test a master-planned community. Land is bought once. Product is entitled once. Microcosm makes the marginal research question nearly free.
        </p>
        <div className="grid4" style={{ marginTop: 56 }}>
          {useCases.map((u) => (
            <div key={u.t} className="card cardHover" style={{ padding: "26px 24px", minHeight: 190, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.3 }}>{u.t}</h3>
                <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--t5)" }}>{u.d}</p>
              </div>
              <div style={{ ...mono, fontSize: 10.5, color: "var(--t7)", textTransform: "uppercase", letterSpacing: ".06em" }}>{u.out}</div>
            </div>
          ))}
        </div>
      </section>

      {/* SEE IT IN ACTION */}
      <section id="action" style={{ maxWidth: 1240, margin: "0 auto", padding: "0 40px 20px" }}>
        <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
          <div>
            <Kicker>See it in action</Kicker>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(28px,3.2vw,44px)", fontWeight: 600, letterSpacing: "-.03em" }}>
              Convene the panel that never sits in one room.
            </h2>
            <p style={{ margin: "20px 0 0", fontSize: 15.5, lineHeight: 1.7, color: "var(--t5)" }}>
              Data center site selection is the highest-stakes land decision in the market right now — and the expertise needed to evaluate one parcel is scattered across eight disciplines: grid interconnection, water, fiber, entitlement, land economics, capital structure, community politics.
            </p>
            <p style={{ margin: "14px 0 0", fontSize: 15.5, lineHeight: 1.7, color: "var(--t5)" }}>
              Watch 48 AI experts and 400 AI residents work a real-shaped question end to end — and read the report they produce.
            </p>
            <a href="/demo.html" className="btnAcc" style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 30, padding: "14px 28px", fontSize: 15 }}>
              Launch the interactive demo <span>→</span>
            </a>
          </div>
          <a href="/demo.html" className="card cardHover" style={{ display: "block", borderRadius: 18, padding: "30px 32px", color: "var(--t1)" }}>
            <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)" }}>
              <span>SITE 47-A · MESA, AZ</span><span style={{ color: "var(--acc)" }}>● LIVE RUN</span>
            </div>
            <div style={{ marginTop: 16, fontSize: 19, fontWeight: 600, letterSpacing: "-.015em", lineHeight: 1.35 }}>
              Is ±212 acres at Signal Butte &amp; Pecos suitable for a 300MW data center campus?
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
              {["RM · GRID", "AS · WATER", "JB · CAPITAL", "MG · ENTITLEMENT", "ER · COMMUNITY", "+43"].map((c) => (
                <span key={c} style={{ ...mono, fontSize: 10.5, padding: "6px 12px", borderRadius: 100, border: "1px solid var(--ln6)", color: "var(--t5)" }}>{c}</span>
              ))}
            </div>
            <div style={{ ...mono, marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--ln2)", display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--t6)" }}>
              <span>48 EXPERTS · 8 DISCIPLINES</span><span>400 RESIDENTS</span><span>14 SIM DAYS</span>
            </div>
          </a>
        </div>
      </section>

      <Access />

      {/* FOOTER */}
      <footer style={{ borderTop: "1px solid var(--ln1)", padding: "44px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1240, margin: "0 auto", flexWrap: "wrap", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={22} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>microcosm</span>
          <span style={{ ...mono, fontSize: 11, color: "var(--t7)", marginLeft: 10 }}>© 2026 Microcosm Research, Inc.</span>
        </div>
        <div style={{ display: "flex", gap: 26, fontSize: 13, color: "var(--t6)" }}>
          <a href="/#product" style={{ color: "var(--t6)" }}>How it works</a>
          <a href="/#usecases" style={{ color: "var(--t6)" }}>Use cases</a>
          <a href="/demo.html" style={{ color: "var(--t6)" }}>Live demo</a>
          <a href="/#access" style={{ color: "var(--t6)" }}>Get started</a>
        </div>
      </footer>
    </>
  );
}
