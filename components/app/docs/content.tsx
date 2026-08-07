"use client";

/**
 * The in-app documentation (CLAUDE.md §12 convention: every feature PR that
 * changes user-facing behavior updates these pages). Six pages, registered in
 * DOC_PAGES, rendered by /docs and /docs/[slug]. Interactive pieces reuse the
 * app's own visual grammar (ModeDiagram, MiniSwarm, CrowdBand).
 */

import { CSSProperties, ReactNode, useState } from "react";
import Link from "next/link";
import ModeDiagram, { ModeKey } from "@/components/app/docs/ModeDiagram";
import { CrowdBand } from "@/components/app/CastingTheater";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

/* ------------------------------ primitives ------------------------------ */

function K({ children }: { children: ReactNode }) {
  return <div style={{ ...mono, fontSize: 11, letterSpacing: ".12em", color: "var(--acc)", textTransform: "uppercase", marginBottom: 10 }}>{children}</div>;
}

function H({ children }: { children: ReactNode }) {
  return <h2 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.02em", margin: "38px 0 12px" }}>{children}</h2>;
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--t4)", margin: "0 0 14px", maxWidth: 720 }}>{children}</p>;
}

function B({ children }: { children: ReactNode }) {
  return <strong style={{ color: "var(--t1)", fontWeight: 600 }}>{children}</strong>;
}

function Callout({ label, children, warn }: { label: string; children: ReactNode; warn?: boolean }) {
  return (
    <div style={{ border: `1px solid ${warn ? "var(--warn)" : "var(--acc)"}`, background: warn ? "var(--warn-dim)" : "var(--acc-dim)", borderRadius: 12, padding: "14px 18px", margin: "18px 0", maxWidth: 720 }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: warn ? "var(--warn)" : "var(--acc)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--t3)" }}>{children}</div>
    </div>
  );
}

function Term({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--ln2)", maxWidth: 720 }}>
      <div style={{ ...mono, fontSize: 11, letterSpacing: ".06em", color: "var(--t1)", width: 150, flex: "none", paddingTop: 2, textTransform: "uppercase" }}>{term}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--t4)" }}>{children}</div>
    </div>
  );
}

function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, margin: "16px 0", maxWidth: 720 }}>
      {items.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 16, padding: "14px 0", borderBottom: i < items.length - 1 ? "1px solid var(--ln2)" : "none" }}>
          <div style={{ ...mono, fontSize: 11, color: "var(--acc)", width: 26, flex: "none", paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--t5)" }}>{s.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------- interactive: kind × tier matrix --------------------- */

const MATRIX: Record<string, Record<string, string>> = {
  expert: {
    lead: "A grid engineer arguing interconnection timelines in the forum — cited by name in the report.",
    crowd: "One of 200 professionals polled between rounds: “would your firm underwrite this at a 6.5% cap?”",
  },
  consumer: {
    lead: "A prospective renter at the table, pushing back on the $180/mo amenity premium directly.",
    crowd: "One of 500 renters whose willingness-to-pay becomes the demand distribution in the report.",
  },
  resident: {
    lead: "A neighbor two parcels over, raising traffic and noise in the deliberation itself.",
    crowd: "One of the polled locals whose support/oppose split becomes the community-consent read.",
  },
  stakeholder: {
    lead: "A city planning official speaking to what the council will actually approve.",
    crowd: "Rarely crowd-tier — stakeholders are usually few and specific, so they sit as leads.",
  },
  adversarial: {
    lead: "The seeded skeptic (every panel gets one) — instructed to attack the thesis with credibility.",
    crowd: "Not used — opposition works by arguing in the room, not by being polled.",
  },
};

function KindTierMatrix() {
  const [sel, setSel] = useState<{ kind: string; tier: string }>({ kind: "expert", tier: "lead" });
  const kinds = Object.keys(MATRIX);
  return (
    <div style={{ border: "1px solid var(--ln3)", borderRadius: 14, padding: "18px 20px", margin: "18px 0", maxWidth: 720, background: "var(--sf)" }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--t6)", marginBottom: 12 }}>
        KIND × TIER — CLICK ANY COMBINATION
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 6, alignItems: "stretch" }}>
        <div />
        {["lead", "crowd"].map((t) => (
          <div key={t} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t5)", textAlign: "center", padding: "4px 0" }}>
            {t === "lead" ? "LEAD — SPEAKS" : "CROWD — POLLED"}
          </div>
        ))}
        {kinds.map((k) => (
          <div key={k} style={{ display: "contents" }}>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: k === "adversarial" ? "var(--warn)" : "var(--t4)", textTransform: "uppercase", display: "flex", alignItems: "center" }}>{k}</div>
            {["lead", "crowd"].map((t) => {
              const on = sel.kind === k && sel.tier === t;
              return (
                <button
                  key={t}
                  onClick={() => setSel({ kind: k, tier: t })}
                  style={{
                    border: `1px solid ${on ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 8, height: 30,
                    background: on ? "var(--acc-dim)" : "transparent", cursor: "pointer", transition: "all .15s",
                  }}
                  aria-label={`${k} as ${t}`}
                >
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: on ? "var(--acc)" : "var(--t7)" }} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--sf2)", borderRadius: 10, fontSize: 13, lineHeight: 1.6, color: "var(--t3)", minHeight: 58 }}>
        <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--acc)", textTransform: "uppercase" }}>{sel.kind} · {sel.tier} — </span>
        {MATRIX[sel.kind][sel.tier]}
      </div>
    </div>
  );
}

/* ------------------------- round semantics table -------------------------- */
/* The canonical "what is a round" table — same content as README.md and the
 * engine test matrix (tests/engine/modes.test.ts). Change all three together. */

const ROUND_SEMANTICS: { mode: string; round: string; ends: string; runEnds: string }[] = [
  { mode: "Agora", round: "One lead opens (rotating each round) + replies routed to ANY substantive post — this round at full weight, earlier rounds decayed, so lively/bustling can REVIVE old threads (capped at ~25%/35% of replies; revivals carry an 'update, don't reopen' order and a ↩ breadcrumb chip). Replies land in parallel waves of 2–3 sharing one snapshot — focused: up to 6 serial replies · lively: ~1.5× leads · bustling: 2× leads", ends: "Reply budget for the round is spent → crowd poll → interjections → votes", runEnds: "Rounds cap · positions stable twice in a row (from round 3) · post budget" },
  { mode: "Roundtable", round: "Every lead speaks once, in order — then a density-scaled CROSSFIRE half-round (lively: ½ the panel · bustling: everyone) challenges specific posts", ends: "Crossfire closes → crowd poll → interjections → votes", runEnds: "Same as Agora" },
  { mode: "Tribunal", round: "Up to 3 FOR arguments → up to 3 AGAINST rebuttals → a COUNTER volley alternating benches (lively: 2 · bustling: 4) → the judge rules", ends: "Judge's note → crowd poll → interjections → votes", runEnds: "Rounds cap · post budget — always adversarial, never a stability stop" },
  { mode: "Jury", round: "Every juror verdicts (blind + parallel in round 1; sees the tally after) + a code-computed TALLY. Proposition briefs SCORE 0–10; choose-between briefs PICK one of the brief's actual options with a confidence score — density never adds deliberation posts here; verdict integrity is the mode", ends: "Tally posts → crowd poll → interjections → votes", runEnds: "Scores stop moving / nobody switches picks · rounds cap · post budget" },
  { mode: "Chamber", round: "Phases, not rounds: takes → blind review → chair synthesis (crowd reacts + votes after the takes and after the synthesis)", ends: "Phase completes", runEnds: "Choreography completes — never “converged”" },
  { mode: "Desk", round: "Phases: assignment → section drafts → director's memo — research choreography: no polls, no bursts, no votes", ends: "Phase completes", runEnds: "Choreography completes" },
  { mode: "Expedition", round: "Phases: questions → research → analysis → alternatives → verify — research choreography: no polls, no bursts, no votes", ends: "Phase completes", runEnds: "Choreography completes" },
];

function RoundSemanticsTable() {
  const th: CSSProperties = { ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t6)", textTransform: "uppercase", textAlign: "left", padding: "8px 12px 8px 0", borderBottom: "1px solid var(--ln3)", whiteSpace: "nowrap" };
  const td: CSSProperties = { fontSize: 12.5, lineHeight: 1.55, color: "var(--t4)", padding: "9px 12px 9px 0", borderBottom: "1px solid var(--ln2)", verticalAlign: "top" };
  return (
    <div style={{ overflowX: "auto", margin: "14px 0 18px" }}>
      <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
        <thead>
          <tr><th style={th}>Mode</th><th style={th}>One round =</th><th style={th}>Round ends when</th><th style={th}>Run ends when</th></tr>
        </thead>
        <tbody>
          {ROUND_SEMANTICS.map((r) => (
            <tr key={r.mode}>
              <td style={{ ...td, ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--t1)", whiteSpace: "nowrap" }}>{r.mode.toUpperCase()}</td>
              <td style={td}>{r.round}</td>
              <td style={td}>{r.ends}</td>
              <td style={td}>{r.runEnds}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ mode gallery ------------------------------ */

const MODES: { key: ModeKey; name: string; when: string; speaks: string; crowd: string }[] = [
  { key: "agora", name: "Agora", when: "The default. Open questions with many angles — the full site go/no-go.", speaks: "Most relevant lead speaks next; threads and replies form organically.", crowd: "Polled between rounds; sampled voices interject in the feed." },
  { key: "roundtable", name: "Roundtable", when: "Panels of equals; brainstorms; when loud voices must not dominate.", speaks: "Every lead speaks once per round, in order.", crowd: "Polled between rounds." },
  { key: "tribunal", name: "Tribunal", when: "A genuinely two-sided dispute — “build it” vs “kill it”.", speaks: "Leads split into two benches and volley (rotating so everyone argues); lopsided casts auto-balance at launch. A judge rules each round.", crowd: "Polls read as the jury pool’s temperature." },
  { key: "chamber", name: "Chamber", when: "When groupthink is the enemy — contested valuations, forecasts.", speaks: "Independent takes first, then anonymized peer review, then a chair synthesizes.", crowd: "Polled once per phase." },
  { key: "jury", name: "Jury", when: "Fast, cheap first pass — score the question before deliberating it.", speaks: "Each lead scores independently; verdicts aggregate. No cross-talk.", crowd: "The crowd IS the point — big-sample scoring." },
  { key: "desk", name: "Desk", when: "You want a memo, not a debate — investment-memo shape.", speaks: "A director assigns sections; worker leads draft; director merges.", crowd: "Polled for the demand section." },
  { key: "expedition", name: "Expedition", when: "Before the real run — build the background research pack.", speaks: "Scouts fan out per phase: question → research → analyze → verify → synthesize.", crowd: "Not used — this is research, not deliberation." },
];

function ModeGallery() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, margin: "18px 0" }}>
      {MODES.map((m) => (
        <div key={m.key} className="card" style={{ padding: "18px 20px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 15.5, fontWeight: 600 }}>{m.name}</div>
            <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)" }}>{m.key.toUpperCase()}</div>
          </div>
          <div style={{ margin: "10px 0 6px", borderRadius: 10, background: "var(--sf2)", overflow: "hidden" }}>
            <ModeDiagram mode={m.key} height={110} />
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t4)", marginTop: 8 }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--acc)" }}>WHO SPEAKS · </span>{m.speaks}
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t5)", marginTop: 6 }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--t6)" }}>THE CROWD · </span>{m.crowd}
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t5)", marginTop: 6 }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--t6)" }}>USE WHEN · </span>{m.when}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------- vignettes: the app's own screens, in miniature ----------------- */

function Vignette({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--ln3)", borderRadius: 14, background: "var(--sf)", margin: "18px 0", maxWidth: 720, overflow: "hidden" }}>
      <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t7)", padding: "10px 16px", borderBottom: "1px solid var(--ln2)" }}>
        {label} — AS IT LOOKS IN THE APP
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

function ChatVignette() {
  const bubble: CSSProperties = { borderRadius: 14, padding: "10px 14px", fontSize: 13, lineHeight: 1.55, maxWidth: 440 };
  const who = (initials: string, name: string, role: string, tier: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 8, color: "var(--t3)" }}>{initials}</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
      <span style={{ ...mono, fontSize: 8, letterSpacing: ".05em", color: "var(--t6)" }}>{role.toUpperCase()}</span>
      <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", color: "var(--t7)", border: "1px solid var(--ln4)", borderRadius: 100, padding: "1px 6px" }}>{tier}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ alignSelf: "flex-end", ...bubble, background: "var(--acc-dim)", border: "1px solid var(--acc)" }}>
        <span style={{ color: "var(--acc)", fontWeight: 600 }}>@Priya Desai</span> — will the $180/mo pool premium actually hold?
        Everyone else, weigh in after her.
      </div>
      <div>
        {who("PD", "Priya Desai", "BTR market analyst", "SONNET 5")}
        <div style={{ ...bubble, background: "var(--sf2)" }}>
          At your rent band it holds for the amenity-seeker segment but compresses to ~$120 for families —
          the comps in your <span style={{ color: "var(--acc)" }}>offering memo (p. 14)</span> already show that split.
        </div>
      </div>
      <div>
        {who("MC", "Marcus Chen", "Competing developer · skeptic", "HAIKU 4.5")}
        <div style={{ ...bubble, background: "var(--sf2)" }}>
          I'd underwrite $0 premium, honestly. Two competitors deliver pools within 3 miles in 2027.
        </div>
      </div>
      <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)", display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.1s ease infinite" }} />
        DELORES V. IS TYPING…
      </div>
    </div>
  );
}

function PersonaCardVignette() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
      <div style={{ border: "1px solid var(--ln3)", borderRadius: 14, padding: "18px 18px", background: "var(--sf)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 10, color: "var(--t3)" }}>RM</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Rosa Menendez</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "var(--t3)" }}>Grid interconnection planner</div>
        <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.5, color: "var(--t5)" }}>22 yrs utility transmission · skeptical of broker timelines</div>
        <div style={{ marginTop: 11, ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t6)" }}>LIBRARY PERSONA · SYNTHETIC COMPOSITE</div>
      </div>
      <div style={{ border: "1px solid var(--ln3)", borderRadius: 14, padding: "18px 18px", background: "var(--sf)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--sf2)", border: "1px solid var(--acc)", display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 10, color: "var(--acc)" }}>JP</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Jordan Pike</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "var(--t3)" }}>Texas construction lender</div>
        <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.5, color: "var(--t5)" }}>Your remix — tighter covenants, Sun Belt focus</div>
        <div style={{ marginTop: 11, ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--acc)" }}>⑂ REMIX · DELORES V. → JORDAN P.</div>
      </div>
    </div>
  );
}

function MonitoringVignette() {
  const rows = [
    { surface: "casting.plan", model: "claude-sonnet-5", tokens: "2.4K → 3.1K", ms: "18.2s", est: "$0.054" },
    { surface: "crowd.generate", model: "claude-haiku-4-5", tokens: "0.4K → 4.5K", ms: "35.7s", est: "$0.023" },
    { surface: "conversation.reply", model: "claude-haiku-4-5", tokens: "1.1K → 0.6K", ms: "4.1s", est: "$0.004" },
    { surface: "corpus.ask", model: "claude-haiku-4-5", tokens: "37K → 0.9K", ms: "9.8s", est: "$0.041" },
  ];
  const th: CSSProperties = { ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--ln3)" };
  const td: CSSProperties = { fontSize: 11.5, padding: "8px 10px", borderBottom: "1px solid var(--ln1)", color: "var(--t4)" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={th}>SURFACE</th><th style={th}>MODEL</th><th style={th}>TOKENS IN → OUT</th><th style={th}>LATENCY</th><th style={th}>EST. SPEND</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.surface}>
              <td style={{ ...td, ...mono, fontSize: 10, color: "var(--t2)" }}>{r.surface}</td>
              <td style={{ ...td, ...mono, fontSize: 10 }}>{r.model}</td>
              <td style={td}>{r.tokens}</td>
              <td style={td}>{r.ms}</td>
              <td style={{ ...td, color: "var(--acc)" }}>{r.est}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PopulationMathVignette() {
  const box = (n: string, l: string, accent?: boolean): ReactNode => (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, border: `1px solid ${accent ? "var(--acc)" : "var(--ln4)"}`, borderRadius: 10, padding: "10px 16px", background: accent ? "var(--acc-dim)" : "var(--sf2)" }}>
      <span style={{ ...mono, fontSize: 16, color: accent ? "var(--acc)" : "var(--t1)" }}>{n}</span>
      <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".07em", color: "var(--t6)" }}>{l}</span>
    </span>
  );
  const op = (s: string) => <span style={{ ...mono, fontSize: 14, color: "var(--t6)" }}>{s}</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center", padding: "6px 0" }}>
      {box("30", "TOTAL EXPERTS", true)}{op("+")}{box("60", "TOTAL RESIDENTS", true)}{op("=")}
      {box("6", "LEADS · SPEAK")}{op("+")}{box("84", "CROWD · POLLED")}
    </div>
  );
}

/* -------------------------------- pages -------------------------------- */

function WhatIsMicrocosm() {
  return (
    <>
      <P><B>Microcosm is an agent-swarm simulation platform for the built world.</B> You pose a hard real-estate question — is this parcel worth $40M, will renters pay the premium, will the council approve the rezoning — upload your diligence documents, and cast a population of AI personas: engineers, lenders, brokers, renters, neighbors, skeptics. They deliberate in real time while you watch, and the argument becomes a decision-grade interactive report.</P>
      <P>It replaces the $15–50K, six-week feasibility study with a same-day simulation run — not by asking one model for an answer, but by making dozens of grounded, disagreeing perspectives argue until the shape of the truth shows.</P>
      <H>The five stages</H>
      <Steps items={[
        { title: "Brief", body: "Write everything you want the simulation to cover, answer, or research — one clear question or a messy multi-part ask, with your files attached right on the prompt. The system reads it all and shows WHAT I UNDERSTOOD: the intent, every sub-ask, the report shape, and how each document will be used — correctable in seconds, held to at synthesis." },
        { title: "Corpus", body: "Your files ride WITH the brief — drop them on the prompt when you create, or add more anytime from the + next to the file circles under your brief (click the count for the full detail list). Agents cite every document by name and page; images are named too, so 'describe 4.jpg' just works. Files the decision turns on (the winning listing photo, the key plan page) can appear inside the report itself. Adding files after the reading flags the WHAT I UNDERSTOOD card to re-derive. No documents? Write what you know and it becomes one." },
        { title: "Population", body: "Cast the leads (the voices that speak) and the crowd (the population behind them). Auto-cast from your brief, or hand-pick from the 1,800-persona library." },
        { title: "Run", body: "Pick an interaction mode and watch the deliberation live — a network graph of who's talking to whom, and a forum feed of every post. You can take the floor yourself. And you can walk away: the run lives server-side, so closing the tab never stops it — reopen the simulation (or follow Home's in-progress strip) and you're watching the same run live, from any device. A STOP button ends a run gracefully at the next safe point, keeping the transcript for the report." },
        { title: "Report", body: "One click after the run: verdict chip, dimension scores, findings cited to specific posts (click a citation — the transcript scrolls to it), risk register, claims checked against your documents, and — deliberately — the preserved dissents." },
      ]} />
      <H>Why it works — four principles</H>
      <Term term="Show the argument">You watch the deliberation, not just the answer. Every claim in the report links to the post and the document behind it.</Term>
      <Term term="Dissent is a feature">Disagreement is never averaged away. Every panel seats at least one credible skeptic on purpose — we hire our own critics.</Term>
      <Term term="Honest instrument">Every output is labeled synthetic and directional. Confidence, convergence, and known failure modes are always displayed. We simulate markets and decisions — never individual tenant or buyer screening.</Term>
      <Term term="Zero config, infinite config">Every stage auto-generates a strong default from your brief and documents. Every default is editable.</Term>
    </>
  );
}

function SimulationsAndSwarms() {
  return (
    <>
      <P>A single AI model asked “should I build this?” gives you one articulate opinion with unknown blind spots. A <B>simulation</B> is different: many model instances, each locked into a distinct persona — a grid engineer who distrusts broker timelines, a renter with a $2,000 budget, a developer competing for the same site — reasoning from different priors, checking each other in public.</P>
      <P>The research behind this is consistent: persona-grounded agent populations reproduce real survey distributions surprisingly well, panels with seeded opposition catch failure modes single models miss, and structured deliberation (rounds, evidence, position changes) outperforms one-shot answers on judgment-heavy questions. That's the bet Microcosm industrializes for real estate.</P>
      <H>What a “swarm” means here</H>
      <P>A swarm is a set of agents plus a <B>choreography</B> — the rules of who speaks when, who sees what, and how positions aggregate. The seven interaction modes are seven choreographies over the same cast. Underneath, Microcosm orchestrates each agent as its own model call with its own persona, memory of the transcript, and access to your documents.</P>
      <H>Grounding — why agents don't just make things up</H>
      <Term term="Your corpus">Documents are passed to agents natively with citations enabled — claims come back pinned to a file and page.</Term>
      <Term term="Persona discipline">Each agent's backstory, stances, and traits are compiled into its system prompt. The renter doesn't suddenly know transformer lead times.</Term>
      <Term term="Census grounding">Resident and consumer cohorts get seeded from real demographic distributions (Census ACS microdata) so the crowd looks like the actual market — landing with the demographic-seeding build.</Term>
      <Term term="Verifier pass">A fact-checking agent runs behind the deliberation, testing numeric claims against your documents and flagging contradictions into the transcript — landing with the run engine.</Term>
      <Callout label="THE HONEST-INSTRUMENT LINE">
        Simulations are directional instruments, not oracles. They're best at surfacing the <B>structure</B> of a decision — which risks dominate, where the disagreement lives, what would change the answer — and they always ship with their limitations printed on them.
      </Callout>
    </>
  );
}

function CoreConcepts() {
  return (
    <>
      <P>Every persona in a simulation has two independent properties. <B>Kind</B> is who they are — expert, consumer, resident, stakeholder, or adversarial. <B>Tier</B> is how they participate — a <B>lead</B> speaks in the forum; a <B>crowd</B> member is sampled and polled. Any combination is valid: a renter can be a lead, an economist can be crowd.</P>
      <KindTierMatrix />
      <H>Why two tiers?</H>
      <P>Deliberation quality comes from a small room — beyond ~20 voices, a forum turns to noise. Market truth comes from a big sample — 500 polled renters, not 5. So the leads argue (up to 20 of them), and the crowd makes the numbers real (up to 500 experts and 1,000 residents). Between rounds the crowd is polled in cheap parallel batches, and a rotating handful of crowd voices are quoted into the feed.</P>
      <H>Glossary</H>
      <Term term="Brief">Your problem statement, questions to resolve, and success criteria. The report's structure comes from these — there is no fixed template.</Term>
      <Term term="What I understood">After you write a brief, an understanding pass reads it (plus your documents) and mirrors back what it captured: the intent, every distinct sub-ask, the shape the answer should take (ranked list, matrix, verdict, range…), each document's role (evidence vs framework instructions), and — when your prompt described who to simulate ("homebuyers aged 35-45 in Beverly Hills") — the population, which casting honors. Every piece is an editable chip; when the pass is genuinely unsure it asks at most two one-tap clarifiers, never blocking. Edit the brief and the card flags itself stale with one-click RE-DERIVE.</Term>
      <Term term="Corpus">The documents this simulation can cite. Parsed, tokenized, and handed to agents natively — with page-level citations.</Term>
      <Term term="Lead">One of ≤20 personas who speak in the forum. Fully authored: backstory, stances, traits, library provenance.</Term>
      <Term term="Crowd">The population behind the leads — compact personas generated at scale, browsable and editable, sampled and polled at run time.</Term>
      <Term term="Composition">Experts only, residents/consumers only, or mixed — who the question needs. Auto-decided from the brief; overridable with one click.</Term>
      <Term term="Adversarial seed">Every panel gets exactly one credible skeptic instructed to attack the thesis. Without seeded opposition, AI panels drift agreeable — and you ship a blind spot.</Term>
      <Term term="Interaction mode">The choreography of the deliberation — Agora, Roundtable, Tribunal, Chamber, Jury, Desk, or Expedition. See the modes page.</Term>
      <Term term="Provenance">Where each persona came from: YOUR LIBRARY (your customs), LIBRARY MATCH (the 1,800-persona catalog), or GENERATED (created for this simulation, saved back to your library).</Term>
      <Term term="Agent tools">A rack of live-data tools agents MAY reach for — v1 ships Web research; parcel data, economic series, census, and more land as new cards. All OFF by default: you allowlist tools per simulation (the AGENT TOOLS cards in run config — enable all, pick some, or none) or per chat participant (the same menu as their model tier). Agents decide WHEN an allowed tool is worth using — the lawyer answers from expertise, the economist checks today's rates. Every search shows in the feed as a 🔎 card with clickable sources, persists to the audit trail, and reaches the report (TOOL CALLS tile + WEB SOURCES appendix). In chats, replies that searched show the query and source pills under the bubble.</Term>
      <Term term="Seat vs. person">The casting director first writes the SEAT — the chair the panel needs ("Multifamily Market Analyst") — then finds a real persona to fill it. A card leads with the seat; the profile shows the person. When the two titles differ, the card adds a BY TRADE line and the profile a CAST AS line, so a Rent Comp Analyst sitting in the market-analyst seat reads as a casting decision, not a glitch. Candidates whose own title doesn't name the seat must pass a fit check ("could they hold this seat with first-hand authority?") — rejects are generated fresh instead.</Term>
      <Term term="Take the floor">You are a participant, not a spectator — post into the forum, @mention agents, challenge a claim before the report is written.</Term>
    </>
  );
}

function AgentsAndLibrary() {
  return (
    <>
      <P>An <B>agent</B> (we also say <B>persona</B>) is a synthetic person: a name, a career story, standing positions, personality traits, and demographics, compiled into instructions that lock an AI model into that perspective. Rosa the grid planner doesn't just "know about power" — she distrusts broker timelines, prioritizes reliability, and argues like someone with 22 years at a utility. <B>No persona is ever a real person</B> — every one is a composite, and demographic cohorts are grounded in public statistics, never in anyone's actual records.</P>
      <PersonaCardVignette />
      <H>Where agents come from</H>
      <Term term="The built-in library">~1,800 personas covering the built world: capital and lenders, developers, engineers, construction trades, brokers, appraisers, power/water/zoning officials, attorneys, community voices — plus homeowners and renters across life stages and wealth tiers. Search it in plain English: “under-40 homeowner in Phoenix”, “grid interconnection engineer, skeptical”.</Term>
      <Term term="Your custom agents">Anything you create, plus every persona the Casting Director generates to fill a gap in your panel — those are saved to your library automatically, so your catalog grows with every simulation.</Term>
      <Term term="Remixes">Any persona can be forked and edited — every field, from backstory to trait sliders. Remixes carry a ⑂ lineage chain (“Delores V. → Jordan P.”) so you always know what a persona descends from.</Term>
      <H>What's inside a persona</H>
      <Term term="Identity">Name, role, tagline, discipline — what shows on cards and in the forum.</Term>
      <Term term="Backstory & stances">The career story and standing positions that shape how they argue. The skeptic's stances genuinely attack; the lender's stances price risk.</Term>
      <Term term="Traits">Sliders like risk tolerance, agreeableness, verbosity — the temperament dial.</Term>
      <Term term="Demographics">Age, metro, income band, tenure, household — what makes crowds look like real markets.</Term>
      <Term term="Model tier">Which AI model powers them in a chat — Haiku (fast, default), Sonnet (balanced), Opus (deepest) — switchable per participant.</Term>
      <Callout label="WHY THE LIBRARY MATTERS">
        When you cast a simulation, the director fills seats from <B>your</B> personas first, then the library, and only generates what's missing. A persona you've refined once — a remixed lender with your covenant standards — shows up in every future panel that needs one, tagged YOUR LIBRARY.
      </Callout>
    </>
  );
}

function ConversationsPage() {
  return (
    <>
      <P>Conversations is the direct line: instead of watching agents deliberate in a simulation, you <B>talk to them yourself</B> — one persona or a room of up to 20, in a familiar chat thread. It's the fastest way to feel what the agents know, pressure-test a document, or warm up the exact panel you'll later cast into a simulation.</P>
      <ChatVignette />
      <H>How a room behaves</H>
      <Term term="@mention someone">Type @ and pick from the room — the people you tag are the ones who answer. Tag five, get five replies. Ambiguous first names auto-complete to full names so the right person responds.</Term>
      <Term term="No mention?">A fast router reads your message and picks the most relevant voice(s) to answer — ask a financing question, the lender replies.</Term>
      <Term term="Ask everyone">Say “each of you” or “everyone” and the whole room answers, one reply per participant. Replies stream in as each person finishes, with typing indicators for whoever is still composing.</Term>
      <Term term="They hear each other">Repliers see the full thread including each other's answers in the same round — so you get reactions, not five isolated takes. Nobody ever speaks for anyone else.</Term>
      <Term term="Attachments">Drop images or PDFs onto a message (up to 8) — experts genuinely read and analyze the file, not just its name. Click a chip to view.</Term>
      <Term term="Model tiers">The MODELS strip shows one chip per participant — click to switch anyone between Haiku (default), Sonnet, and Opus. Choices stick per conversation.</Term>
      <Term term="Threads & memory">Every conversation is saved and searchable in history. Memory is per-thread by design: start a fresh thread with the same people and you get a clean slate.</Term>
      <H>When to use it vs a simulation</H>
      <P>Use a <B>conversation</B> when you want answers on demand and you're steering — an interview, a document review, a quick gut-check. Use a <B>simulation</B> when you want the panel to argue <B>autonomously</B> around a decision and produce a report. Same personas, two different rooms.</P>
    </>
  );
}

function MonitoringPage() {
  return (
    <>
      <P>Monitoring is the meter behind everything. Every time the platform calls an AI model on your behalf — drafting your questions, casting a panel, generating crowd members, answering a corpus question, replying in a chat — one row lands here with exactly what it cost.</P>
      <Vignette label="MONITORING · INTERACTIONS">
        <MonitoringVignette />
      </Vignette>
      <H>Reading the table</H>
      <Term term="Surface">Which feature made the call — casting.plan is the Casting Director, crowd.generate is crowd materialization, conversation.reply is a chat answer, corpus.ask is a cited document Q&A.</Term>
      <Term term="Model">The exact model used. High-volume work (crowds, chats) defaults to the fast tier; judgment work (casting, synthesis) runs stronger models.</Term>
      <Term term="Tokens in → out">How much context the model read and how much it wrote — the two numbers that drive cost.</Term>
      <Term term="Est. spend">Estimated from public per-token pricing. Stat tiles up top total it across the org.</Term>
      <Term term="Expand a row">Click any row for context: which simulation, the guidance you gave, the question you asked, and a deep link to open it.</Term>
      <Term term="Date range">FROM/TO pickers in the filter rail bound the table, tiles, and charts to a window. The newest 500 calls load first; the footer pages older history in — and when your FROM date reaches past what's loaded, one click pulls history back to that date.</Term>
      <Callout label="THE NO-SURPRISE-BILLS RULE">
        Costs are visible after the fact here, and <B>before</B> the fact where it matters: big operations (full simulation runs) show a price estimate before you commit. That estimator ships with run configuration.
      </Callout>
    </>
  );
}

function InteractionModes() {
  return (
    <>
      <P>A mode is the shape of the argument among the <B>leads</B>. The crowd never joins the turn-taking — in every mode it participates through sentiment polls between rounds and sampled interjections in the feed. Picking Roundtable with 500 residents means ~10 leads speaking in turn, informed by 500 polled opinions — never 500 people taking turns.</P>
      <ModeGallery />
      <H>Rounds, stopping, and polling — mode by mode</H>
      <P>Two families. <B>Round modes</B> — Agora, Roundtable, Tribunal, and Jury — loop: your ROUNDS setting and stop rule apply, and the crowd is polled between rounds. In Jury, rounds are deliberation layers: round 1 scores blind, every later round the jurors see the tally and re-score (hold or move), and stability means the scores stopped moving. <B>Fixed choreographies</B> — Chamber, Desk, and Expedition — run their phases exactly once: takes→blind review→synthesis, assign→draft→merge, and the five-phase route. Rounds and the stop rule don't apply to them (run config hides those controls), and the run screen says "phases complete", never "converged". Chamber polls the crowd twice (after the raw takes and after the chair's synthesis); Desk and Expedition are research choreographies and don't poll at all.</P>
      <P>What "one round" means, precisely, per mode — this table is the engine's contract, pinned by the offline test matrix:</P>
      <RoundSemanticsTable />
      <P><B>What the poll actually asks.</B> At launch, the engine turns your brief into one plain-language poll question and picks the <B>instrument to match</B>. A proposition brief ("Should the town let the data center be built?") gets the classic stance poll — <B>support</B> = would say yes · <B>conditional</B> = yes, if a named concern is handled · <B>oppose</B> = would say no · <B>disengaged</B> = genuinely unaffected (someone with no strong opinion counts as conditional, never disengaged) — and the buckets are <B>labeled in the question&rsquo;s own language</B>: "would this law push you to consider selling?" tallies "YES — WOULD CONSIDER SELLING / ONLY IF… / NO — HOLDING / DOESN&rsquo;T AFFECT ME", not a generic support/oppose that reads wrong against the question. A <B>choose-between brief</B> ("which of these three photos should lead the listing?") polls the brief's actual alternatives instead — the bars read "44% green.png · 31% red.png · 25% blue.png", with an UNDECIDED bucket only when someone genuinely can't pick. When the understanding pass read your brief, polling gets smarter still: it emits a <B>poll plan</B> of up to three angles matched to the run's arc — early rounds ask the broad gut-read, middle rounds the per-option choice, the last rounds the decision-shaped closer — and each angle holds for at least two rounds so its trend means something (the report shows one trend per angle, each labeled with its exact question). A brief with no genuine sentiment surface (an expert research task) polls <B>not at all</B> — the crowd still interjects and votes, and the WHAT I UNDERSTOOD card says NO CROWD POLL plainly, because a missing poll is a decision, not a bug. Without a contract, every round asks the single launch-derived question, exactly as before. Each polled crowd member answers <B>in character</B>, and — critically — after hearing a digest of what the panel argued that round, so movement between rounds is reaction to the debate, not noise.</P>
      <H>Rounds that walk the brief — agendas and coverage</H>
      <P>When your brief has been read by the understanding pass, rounds stop being undirected passes. Each round opens with an <B>agenda</B>: round 1 opens positions across the full brief, middle rounds target the <B>least-resolved sub-asks by name</B> ("Round 3 focus: 'who are the players?' — still missing: nobody named one"), and the final round forces the panel to commit to the answer. Behind the rounds, a <B>resolution tracker</B> scores every sub-ask 0–100 after each close, and the run screen shows a <B>COVERAGE</B> strip — one chip per sub-ask filling toward resolved — so you can see the deliberation systematically covering what you asked, and convergence means something. Round dividers in the feed carry each round's agenda. The mode's choreography is untouched — the agenda rides inside the opening instruction.</P>
      <P>Every polled round closes the same way: <B>crowd poll</B> (the sentiment bar) → <B>interjection burst</B> (a few crowd members post short reactions threaded under the round's posts) → <B>vote pass</B> (every lead plus a crowd sample votes in character — hover a vote chip to see exactly who). Voting is <B>selective</B>: abstaining is the norm, and every voter has a hard budget per round — at most 2 endorsements ▲ and 1 rejection ▼ — so a vote is a position, not a reflex. At lively and bustling, votes also accumulate <B>in realtime</B>: a rotating sample reacts every few posts, so chips move while the round is still arguing, and the close completes the sweep — each voter votes each post at most once per round, and old posts revived by new replies re-enter the ballot (a voter can flip an earlier vote; latest wins). A poll interrupted by a slice boundary ships its partial tally honestly, and nothing is ever double-polled, double-burst, or double-voted on resume.</P>
      <H>Interaction density</H>
      <P>The <B>DENSITY</B> control in run configuration (FOCUSED · LIVELY · BUSTLING) scales how busy each round gets. <B>Focused</B> is the tight original rhythm — up to 6 Agora replies, no crossfire, no counters, no interjections. <B>Lively</B> (the default) scales Agora replies to ~1.5× the panel, opens Roundtable crossfire for half the panel and two Tribunal counters, and seats three crowd interjectors per round. <B>Bustling</B> doubles Agora replies, gives every Roundtable lead a crossfire turn, runs a four-shot Tribunal counter-volley, and six interjectors. Replies target <B>any post from the round</B> — weighted toward recent and contested — so chains form (Rosa → Tom → Elena → Rosa) instead of a strict relay. The cost estimator prices whatever density you pick before launch, from the same math the engine runs.</P>
      <H>The forum is yours too — Take the Floor</H>
      <P>Once a run pauses or completes, the composer at the bottom of the feed is live: post directly into the forum, <B>@mention</B> any lead (typeahead over the panel), and the mentioned agents answer with full context of the transcript, your documents, and their personas. Your posts render accent-bordered ("YOU · TAKING THE FLOOR"), persist like any other post, and are citable by the report. Challenge a claim before you synthesize; ask a follow-up after the report ships — the room stays open. The <B>N ON THE PANEL</B> rail (top right of the run screen) lists every lead with their seat, stances, and story — click anyone, or click their node on the canvas, for the full profile.</P>
      <H>How a full run composes them</H>
      <P>Big questions chain modes: an optional <B>Expedition</B> builds the background research pack → a <B>Jury</B> pass scores the question cheaply to seed the agenda → the <B>Agora</B> main deliberation runs with crowd polls between rounds → <B>Tribunal</B> spot-runs settle the one or two most contested subquestions → a <B>Desk</B> pass writes the report from the transcript.</P>
      <Callout label="RIGHT-SIZING">
        The Casting Director recommends mode and panel size together — Tribunal wants balanced sides, Roundtable is best at 6–12 voices, Jury tolerates a full bench. Run configuration flags mismatches before launch rather than letting a lopsided Tribunal burn a run.
      </Callout>
    </>
  );
}

function CastingAndPopulation() {
  return (
    <>
      <P>The population stage is where the brief becomes people. Two ways in:</P>
      <H>Auto-cast — the Casting Director</H>
      <P>A frontier-tier model pass reads your brief, questions, success criteria, and document excerpts, then makes three decisions in order:</P>
      <Steps items={[
        { title: "Composition", body: <>Feasibility/engineering/legal questions → <B>experts only</B>. Demand/pricing/sentiment → <B>residents &amp; consumers</B> plus a thin expert bench. Community or political surface, or a big capital decision → <B>mixed</B>. You can force any of these with the composition pills — pre-cast, or re-cast after.</> },
        { title: "Mode + scale", body: "It recommends an interaction mode with a written rationale and a full-run crowd size. The mode is CHOSEN in one place — the animated cards under CONFIGURE THE RUN — where the director's pick comes pre-selected and stays tagged ✦ DIRECTOR'S PICK even if you switch; fit flags warn when your cast doesn't suit the new mode, with a jump back to re-cast." },
        { title: "The lead seats", body: "6–20 seats, every question-to-resolve owned by at least one seat, exactly one adversarial seed. Each seat is filled from your custom personas first, then the 1,800-persona library, and only true gaps are generated fresh — then saved to your library so the catalog self-heals." },
      ]} />
      <H>Hand-pick — zero tokens</H>
      <P>Know exactly who you want in the room? Assemble the leads yourself from your personas and the library with smart search — or open the <B>full-library browser</B> (BROWSE ALL WITH FILTERS) for the complete filter rail, pagination, and multi-select with a running tray of who you&apos;ve seated. No model calls either way. You can still auto-cast later, or mix: hand-pick a core and ADD LEADS around it.</P>
      <H>Working the panel</H>
      <Term term="Re-cast all">Replaces the entire population — leads and crowd. Use when the thesis or composition changes. Guidance steers it: “more first-time buyers; heavier on capital.”</Term>
      <Term term="Add leads">Appends speaking seats without touching the existing panel — “add a school-board voice” — up to the 20-lead ceiling.</Term>
      <Term term="Add from library">Manual seat additions from search, zero tokens.</Term>
      <Term term="Remove / profile">Click any card for the full profile; × removes a seat. Adversarial seats carry an amber tag.</Term>
      <H>The crowd</H>
      <div style={{ border: "1px solid var(--ln2)", borderRadius: 12, padding: "12px 16px", margin: "6px 0 14px", maxWidth: 720 }}>
        <div style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--t6)", marginBottom: 4 }}>
          THE CROWD · <span style={{ color: "var(--acc)" }}>120</span> EXPERTS · <span style={{ color: "var(--acc)" }}>380</span> RESIDENTS — LIVE PREVIEW
        </div>
        <CrowdBand experts={120} residents={380} />
      </div>
      <P><B>GENERATE THE CROWD</B> turns the counts into real members — compact personas created in fast batches, each with a name, role, one-line story, stances, and demographics. The counter ticks and the band lights up as they land. <B>BROWSE THE CROWD</B> opens the full roster: search it, filter experts vs residents, open any profile, remove anyone. Crowds beyond 300 generate a proportional representative sample now and reach full scale at run time. Changing counts after generating shows a COUNTS CHANGED warning — <B>REGENERATE</B> rebuilds to match.</P>
      <Callout label="HONEST LABEL">
        Resident crowd members are narrative-seeded today (marked “ACS PUMS SOON”). When demographic seeding lands, resident cohorts sample real Census microdata for your geography — ages, incomes, tenures that match the actual market.
      </Callout>
      <H>The numbers, precisely</H>
      <P>Every count on the population stage follows one equation. The POPULATION row holds <B>totals</B> — how many experts and residents exist in the whole simulation. Your leads count toward those totals; everyone who isn't a lead is the crowd:</P>
      <Vignette label="POPULATION MATH">
        <PopulationMathVignette />
      </Vignette>
      <Steps items={[
        { title: "Edit the totals", body: "Type a new number in TOTAL EXPERTS or TOTAL RESIDENTS. The “= N LEADS + M CROWD” readout updates live so you see exactly what the change means before committing." },
        { title: "Hit APPLY (or Enter)", body: "Nothing changes until you do — the input border turns green while an edit is pending, and SAVED ✓ confirms the commit." },
        { title: "Regenerate if needed", body: "If you already generated the crowd, changing totals shows COUNTS CHANGED — REGENERATE TO MATCH. The old members stay browsable until you regenerate." },
      ]} />
      <P>Raising TOTAL EXPERTS never adds leads — leads only change via RE-CAST, ADD LEADS, or the library picker. The extra experts become crowd members, generated in the crowd panel.</P>
      <P>One subtlety the leads header spells out (“5 EXPERT-SIDE · 5 RESIDENT-SIDE”): stakeholders count on the expert side of the math, and an adversarial seed counts on whichever side their persona actually is — a skeptical homeowner is resident-side even though the filter chips list them under ADVERSARIAL.</P>
    </>
  );
}

function GettingStarted() {
  return (
    <>
      <P>The fastest way to understand Microcosm is to run something small. Three starting points, cheapest first:</P>
      <H>Talk to a persona (2 minutes)</H>
      <Steps items={[
        { title: "Open Conversations", body: <>Pick anyone from the library — a DSCR lender, a Phoenix zoning attorney, a first-time buyer — and just talk. @mention to direct a group room; attach a PDF and ask them to tear it apart.</> },
        { title: "Build a room", body: "Up to 20 personas in one thread. Each participant's model tier is switchable from the MODELS strip. This is the simulation's cast, warmed up conversationally." },
      ]} />
      <H>Run your first simulation (15 minutes)</H>
      <Steps items={[
        { title: "New simulation → write the brief", body: "Write everything you want covered — multi-part welcome — and drop your files right on the prompt; they upload with the brief. Hit SUGGEST if you want the questions-to-resolve drafted; your draft autosaves. On the workspace, the WHAT I UNDERSTOOD card mirrors back what the system captured — skim it, fix anything in one click, and move on. In a hurry? Hit ⚡ QUICK RUN (top right): one box, config appears as you type (pick a deliberation mode or leave AUTO; rounds ride a 2–20 slider, tier and density as pills, and TOOLS opens a picker — enable web research per run, or everything available, with your picks shown as chips; all off by default), describe WHO to simulate right in the prompt if you want, and RUN starts the pipeline — brief understood, then a CHECKPOINT: the reading comes back to you (the mirror, the population it found, the report shape, and any clarifier questions as one-tap chips) and nothing casts until you hit CAST & RUN. Edit the prompt during review and it asks you to re-derive first. Then the casting-theater swarm plays while the panel forms, the crowd dot-field fills member by member, and you land in the live simulation — cost estimate on the button the whole way. Your view choice sticks." },
        { title: "Add your documents", body: "Drop files right on the prompt when you create — or later from the + next to the file circles under your brief. No files? Use ✎ WRITE WHAT YOU KNOW. The understanding pass reads everything and shows each document's role on the WHAT I UNDERSTOOD card; add files afterwards and the card flags itself to re-derive with one click." },
        { title: "Cast the population", body: "AUTO-CAST and watch the theater. Review the leads, check the rationale, adjust composition or counts. Generate the crowd and browse it. The interaction MODE is chosen once, on the animated cards in CONFIGURE THE RUN — the director's pick comes pre-selected and tagged." },
        { title: "Configure the run", body: "Pick the mode from animated cards, set rounds, budget, temperature, and model tier — every control has plain-language help, mismatches get flagged, and the cost estimate shows before you commit. PROCEED TO LAUNCH saves your settings and opens the run screen." },
        { title: "Launch and watch", body: "One button: ▶ LAUNCH THE RUN. The crowd materializes automatically first if it hasn't been generated. Posts stream in with document citations, reply lines connect who's answering whom on the network canvas, and the crowd is polled between rounds — the whole transcript persists. Scroll up to read at your own pace: the feed holds your place and a ↓ JUMP TO LATEST pill counts what's landing below." },
        { title: "Synthesize the report", body: "When the run completes, hit SYNTHESIZE THE REPORT and watch the progress strip stream its stages — then read it. The report's LEAD matches what you asked: a decision brief opens with the GO/CONDITIONAL/NO-GO chip; a valuation opens with a defended PRICE RANGE band (central estimate + walk-away marker); a rezoning or hearing opens with APPROVAL ODDS; and any other question opens with a committed KEY FINDING — nothing falls outside the system, and every kind commits to an answer. Every report also opens with THE BOTTOM LINE (the answer, what would change it, what to do next) and gives each of your questions a direct answer before the supporting evidence. Hit SIMPLIFY and the report becomes a different page, not the same page with softer words: the answer as the headline, your questions as plain Q&A cards, word grades (STRONG / MIXED / WEAK) instead of decimal score bars, risks as cards, the crowd poll in everyday labels ('would say yes / yes, if concerns are met'), and a mini-glossary — same answers, same numbers underneath. In the expert view, a round slider under the findings lets you scrub through the crowd polls — each poll shows the exact question the crowd was asked, percentages that always sum to 100 with raw counts beside them, and EVERY VOTE expandable to see exactly who answered what (every crowd member is polled, every round). A floating FILES pill lists every upload in the order the panel saw them — with the same IMAGE 1 / IMAGE 2 numbering the agents use, thumbnails, and click-to-zoom. Reports are permanent, versioned run records: find them all in the Reports tab (search, verdict filters, dates). Every report carries a NAME — it follows its simulation's name by default, and you can rename it from the card's ⋯ menu or the ✎ next to the name inside the report; cards stay compact (the full brief expands on demand) and you can delete any version from the ⋯ menu. The Reports item in the sidebar carries an unread count — reports that finished while you were elsewhere — and unread reports show a pulsing green dot: on the card, on each unread VERSION chip (an unopened V1 keeps its dot even after you read V2), and at the left of each row in the all-versions view; each clears as you open that version. When the understanding pass read your brief, three more guarantees kick in: THE ANSWER, AS ARTIFACTS — a brief that asks for a ranking/matrix/comparison gets that exact artifact as a first-class block (a numbered list with every item placed, a real entities-by-criteria table, side-by-side cards), not prose that gestures at one. The ANSWER-COMPLETENESS JUDGE then checks the draft against your brief's contract — every sub-ask answered (not mentioned), every artifact complete, sources cited where your evidence standard demands — and repairs ONLY the failing pieces before delivery; its receipt prints in METHODOLOGY. And the AUDIENCE REGISTER decides which voice leads: a brief written for an executive read opens in plain language (translated during synthesis, instant to read) with the full technical view one click away — same answers, same numbers, always." },
      ]} />
      <H>Browse the Agent Library</H>
      <Steps items={[
        { title: "1,800 built-world personas", body: "Search in plain English — “under-40 homeowner”, “grid interconnection engineer, skeptical”. Filter by kind, category, age, tenure." },
        { title: "Remix anything", body: "Any persona forks into your custom library with every field editable. Remixes carry a ⑂ lineage chain." },
      ]} />
      <H>Monitoring</H>
      <P>Every model call the platform makes — casting, crowd generation, conversations, corpus Q&amp;A — is logged with tokens, latency, and estimated spend. Expand any row for the simulation context and a deep link. No surprise bills: big runs show their price before you commit.</P>
      <Callout label="WHERE TO GO DEEPER">
        <Link href="/docs/core-concepts" style={{ color: "var(--acc)" }}>Core concepts</Link> explains leads, crowd, kinds, and composition. <Link href="/docs/interaction-modes" style={{ color: "var(--acc)" }}>Interaction modes</Link> shows all seven choreographies animated. <Link href="/docs/casting-and-population" style={{ color: "var(--acc)" }}>Casting &amp; population</Link> covers every control on the population stage.
      </Callout>
    </>
  );
}

/* ------------------------------- renderers ------------------------------- */
/* metadata (slugs, titles) lives in registry.ts so server components can read it */

export const DOC_RENDER: Record<string, () => ReactNode> = {
  "what-is-microcosm": WhatIsMicrocosm,
  "simulations-and-swarms": SimulationsAndSwarms,
  "core-concepts": CoreConcepts,
  "agents-and-the-library": AgentsAndLibrary,
  "conversations": ConversationsPage,
  "interaction-modes": InteractionModes,
  "casting-and-population": CastingAndPopulation,
  "monitoring": MonitoringPage,
  "getting-started": GettingStarted,
};
