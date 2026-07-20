import { CSSProperties } from "react";
import Nav, { Logo } from "@/components/Nav";
import Hero from "@/components/Hero";
import ProductTour from "@/components/ProductTour";
import Modes from "@/components/Modes";
import LiveDemo from "@/components/LiveDemo";
import UseCases from "@/components/UseCases";
import Access from "@/components/Access";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const tickerItems = [
  { k: "POPULATION", v: "1,100+ specialized personas across the built world, cast per question" },
  { k: "SEEDING", v: "consumer crowds sampled from Census records for your actual ZIP codes" },
  { k: "MODES", v: "Agora · Roundtable · Tribunal · Chamber · Jury · Desk · Expedition" },
  { k: "VERIFIER", v: "every numeric claim checked against your documents, live" },
  { k: "DISSENT", v: "preserved and attributed — never averaged away" },
  { k: "CALIBRATION", v: "every prediction logged and scored when reality arrives" },
];

const steps = [
  {
    num: "STEP 1", t: "Ask a hard question",
    d: "State it the way you'd ask a partner: \"Should we buy this parcel?\" \"Which floor plan wins?\" \"Will this rezoning pass?\" Attach the documents you already have — the survey, the plans, the pricing sheet.",
  },
  {
    num: "STEP 2", t: "Meet your panel",
    d: "Microcosm casts the room your question needs from a library of 1,100+ specialized personas — engineers, lenders, planners, brokers — plus a crowd of buyers, renters, and neighbors built from Census records for your actual market. Edit any seat, add your own.",
  },
  {
    num: "STEP 3", t: "Watch, join, then read",
    d: "The panel deliberates in front of you — live and visible. Step in whenever you want: post a question, tag an agent, challenge a claim. Then read the report: the verdict, the reasoning, the risks, and who disagreed.",
  },
];

const whyCards = [
  {
    num: "01", t: "Many specialized minds, one argument",
    d: "A single AI gives you one plausible answer. A swarm gives you a contest: specialists reasoning from different facts and incentives, challenging each other until weak claims die and strong ones survive. The answer that emerges has already been argued with — before you rely on it.",
  },
  {
    num: "02", t: "1,100+ experts, cast per question",
    d: "Microcosm maintains a persona library spanning the entire built world — capital, construction, power, water, civic, legal, community. A casting pass reads your question and fills each seat with the specialist who owns it. You can edit every seat, write your own experts, or reuse panels you've saved.",
  },
  {
    num: "03", t: "A crowd that matches your market",
    d: "Consumer and resident cohorts are sampled from public Census microdata for your actual geography — real income distributions, ages, household types, commutes. The crowd judging your project statistically resembles the market that will.",
  },
  {
    num: "04", t: "Skeptics on the payroll",
    d: "Every panel seats at least one agent instructed to oppose you — the organized neighbor, the wary lender, the tough council vote. And when panelists still disagree at the end, the report preserves the dissent by name instead of averaging it away. The objection you rehearse can't ambush you.",
  },
  {
    num: "05", t: "Claims don't pass unchecked",
    d: "An independent verifier runs behind the deliberation, testing every numeric claim against your uploaded documents and connected data. Contradictions are flagged into the record — whether they come from an agent or from the seller's marketing package.",
  },
  {
    num: "06", t: "A leading indicator, honestly labeled",
    d: "The market tells you whether you were right 12–24 months after the capital is committed. A calibrated simulation tells you before — and every prediction is logged and scored when reality arrives, so the track record is auditable. Outputs are always labeled synthetic and directional: an instrument for the decision-maker, never a replacement.",
  },
];

const whyNow = [
  {
    num: "01", t: "The science landed",
    d: "Generative-agent research demonstrated that AI populations exhibit believable social behavior — memory, reflection, and influence included. By 2024, interview-grounded agents replicated real individuals' survey responses at 85% of their own test-retest consistency.",
    tag: "SMALLVILLE 2023 · STANFORD 2024",
  },
  {
    num: "02", t: "The economics flipped",
    d: "Model inference costs have collapsed by orders of magnitude. A deliberation among hundreds of specialized agents now costs less than recruiting a single human respondent — and finishes the same afternoon.",
    tag: "RUNS IN MINUTES, NOT WEEKS",
  },
  {
    num: "03", t: "The ground truth exists",
    d: "Census, ACS, market, migration, and lending data are digitized down to the submarket. For the first time, a synthetic population can be seeded to match a real place — and scored against what that place actually did.",
    tag: "SEEDED, THEN BACKTESTED",
  },
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

      {/* WHAT IT DOES — PLAIN ENGLISH */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "110px 40px 30px" }}>
        <Kicker>What it does</Kicker>
        <h2 className="h2" style={{ maxWidth: 760 }}>A rehearsal room for real estate&apos;s hardest decisions.</h2>
        <p style={{ margin: "20px 0 0", maxWidth: 680, fontSize: 16, lineHeight: 1.65, color: "var(--t5)" }}>
          Before you buy the land, set the rents, or walk into the hearing — put the decision in front of a simulated market first: a panel of AI experts and a census-grounded crowd that reads your documents, argues in the open, and reports back with reasons.
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

      <ProductTour />
      <Modes />
      <LiveDemo />

      {/* TAKE THE FLOOR */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "110px 40px" }}>
        <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
          <div>
            <Kicker>Take the floor</Kicker>
            <h2 style={{ margin: "16px 0 0", fontSize: "clamp(28px,3.2vw,44px)", fontWeight: 600, letterSpacing: "-.03em" }}>
              You&apos;re in the room, not in the audience.
            </h2>
            <p style={{ margin: "20px 0 0", fontSize: 15.5, lineHeight: 1.7, color: "var(--t5)" }}>
              When the panel converges — or any time you pause it — the forum is yours. Post directly into the thread, tag any agent by name, and get an answer grounded in everything said so far. Challenge the claim that bothers you. Add the context only you have. Redirect the room before the report is written.
            </p>
            <p style={{ margin: "14px 0 0", fontSize: 15.5, lineHeight: 1.7, color: "var(--t5)" }}>
              And the room stays open after the report ships: come back with follow-up questions, and the panel answers with full memory of the run. Material threads append to the report as a dated addendum.
            </p>
          </div>
          <div className="card" style={{ borderRadius: 18, padding: "28px 30px" }}>
            <div style={{ ...mono, display: "flex", justifyContent: "space-between", fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)" }}>
              <span>RUN 47-A · CONVERGED · FORUM OPEN</span>
              <span style={{ color: "var(--acc)" }}>FOLLOW-UP THREAD</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
              <div style={{ border: "1px solid var(--acc)", borderRadius: 12, padding: "13px 16px", background: "var(--acc-dim)" }}>
                <div style={{ fontSize: 12, color: "var(--t5)" }}><strong style={{ color: "var(--t1)", fontWeight: 600 }}>You</strong> · <span style={{ ...mono, fontSize: 10, color: "var(--acc)" }}>TAKING THE FLOOR</span></div>
                <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)" }}>
                  <span style={{ color: "var(--acc)", fontWeight: 600 }}>@Jonah B.</span> — if the seller counters at $450K/acre, does your option structure still work?
                </p>
              </div>
              <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "13px 16px", background: "var(--sf2)", marginLeft: 24 }}>
                <div style={{ fontSize: 12, color: "var(--t5)" }}><strong style={{ color: "var(--t1)", fontWeight: 600 }}>Jonah B.</strong> · powered-land investor · <span style={{ ...mono, fontSize: 10, color: "var(--t7)" }}>REPLY · CITES POST 3, COMPS THREAD</span></div>
                <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)" }}>
                  It works to about $500K/acre — beyond that the spread stops compensating queue risk. At $450K I&apos;d push the milestone payments later and cap the option premium. Below $500K: sign it.
                </p>
              </div>
              <div style={{ border: "1px solid var(--ln4)", borderRadius: 12, padding: "13px 16px", background: "var(--sf2)", marginLeft: 24 }}>
                <div style={{ fontSize: 12, color: "var(--t5)" }}><strong style={{ color: "var(--t1)", fontWeight: 600 }}>Elena R.</strong> · community advocate · <span style={{ ...mono, fontSize: 10, color: "var(--warn)" }}>UNPROMPTED · DISSENT MAINTAINED</span></div>
                <p style={{ margin: "7px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)" }}>
                  Whatever you pay for the land, the community package isn&apos;t the line item you trim to make the counter work.
                </p>
              </div>
            </div>
            <div style={{ ...mono, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--ln2)", fontSize: 10.5, color: "var(--t7)" }}>
              THREAD APPENDS TO THE REPORT AS A DATED ADDENDUM
            </div>
          </div>
        </div>
      </section>

      {/* WHY IT WORKS */}
      <section id="why" style={{ background: "var(--sf)", borderTop: "1px solid var(--ln1)", borderBottom: "1px solid var(--ln1)" }}>
        <div className="section">
          <Kicker>Why it works</Kicker>
          <h2 className="h2" style={{ maxWidth: 800 }}>Why an agent swarm answers what one AI — and one gut call — can&apos;t.</h2>
          <div className="grid3" style={{ marginTop: 52, gap: 14 }}>
            {whyCards.map((c) => (
              <div key={c.num} style={{ border: "1px solid var(--ln3)", borderRadius: 14, padding: "30px 28px", background: "var(--bg)" }}>
                <div style={{ ...mono, fontSize: 12, color: "var(--acc)" }}>{c.num}</div>
                <h3 style={{ margin: "14px 0 0", fontSize: 18.5, fontWeight: 600, letterSpacing: "-.01em" }}>{c.t}</h3>
                <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.68, color: "var(--t5)" }}>{c.d}</p>
              </div>
            ))}
          </div>
          <p style={{ ...mono, margin: "26px 0 0", fontSize: 11.5, lineHeight: 1.7, color: "var(--t7)" }}>
            RESEARCH ANCHOR · INTERVIEW-GROUNDED AI AGENTS MATCHED REAL PEOPLE&apos;S SURVEY ANSWERS AT 85% OF THEIR OWN TWO-WEEK CONSISTENCY (STANFORD, N=1,052). EVERY MICROCOSM OUTPUT IS LABELED SYNTHETIC AND DIRECTIONAL.
          </p>
        </div>
      </section>

      {/* WHY NOW */}
      <section style={{ maxWidth: 1240, margin: "0 auto", padding: "110px 40px" }}>
        <Kicker>Why now</Kicker>
        <h2 className="h2" style={{ maxWidth: 780 }}>Three curves crossed. Real estate is where they land hardest.</h2>
        <div className="grid3" style={{ marginTop: 56 }}>
          {whyNow.map((c) => (
            <div key={c.num} className="card cardHoverQuiet" style={{ padding: "30px 28px" }}>
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
          <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.7, color: "var(--t2)", maxWidth: 860 }}>
            Real estate&apos;s hardest questions — what to build, where, for whom, at what price, and whether the community will allow it — are hard because the feedback arrives years after the commitment. A simulation grounded in a submarket&apos;s actual demographics, transactions, and documents moves that feedback ahead of the decision. Not a crystal ball: a wind tunnel, with a scorecard.
          </p>
        </div>
      </section>

      <UseCases />

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
              Watch 48 AI experts and 400 census-seeded residents work a real-shaped question end to end — brief, panel, deliberation, and the full decision-grade report.
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
