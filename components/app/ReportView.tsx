"use client";

/**
 * The interactive report (CLAUDE.md §2 Stage 5, demo Stage 04 grammar):
 * verdict chip, executive summary, stat tiles, dimension scores, findings
 * per question with POST citations that jump to the transcript, risk
 * register, preserved dissents, tripwires, methodology & limitations.
 * Never a wall of markdown — structured JSON rendered in tokens.
 *
 * SIMPLIFY renders a genuinely DIFFERENT page (PlainBody below): answer-first
 * hero, Q&A cards, word grades instead of decimal score bars, card risks
 * instead of tables, the crowd poll in everyday labels — not the expert
 * layout with swapped strings.
 */

import { CSSProperties, useState } from "react";
import Link from "next/link";
import { LEAD_KIND_LABEL, ReportLead, ReportPlain, ReportSpec, VERDICT_STYLE, fmtMoney } from "@/lib/report";
import { LivePost } from "@/components/app/LiveRun";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };
const label: CSSProperties = { ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" };

/** one instrument, two vocabularies: expert labels for the full report,
 *  everyday labels for the simplified read */
const STANCES: { key: string; label: string; plain: string; color: string }[] = [
  { key: "support", label: "SUPPORT", plain: "WOULD SAY YES", color: "var(--acc)" },
  { key: "conditional", label: "CONDITIONAL", plain: "YES, IF CONCERNS ARE MET", color: "var(--t5)" },
  { key: "oppose", label: "OPPOSE", plain: "WOULD SAY NO", color: "var(--warn)" },
  { key: "disengaged", label: "DISENGAGED", plain: "NOT AFFECTED / NO OPINION", color: "var(--ln6)" },
];

const totalOf = (d: Record<string, number>) => Math.max(Object.values(d).reduce((a, b) => a + b, 0), 1);
const pctOf = (d: Record<string, number>, k: string) => Math.round(((d[k] ?? 0) / totalOf(d)) * 100);

/** one slider, one set of bars: scrub through the rounds and watch the crowd
 *  move — with an expandable table of the percentages over time */
function SentimentSlider({ sentiment, question }: { sentiment: NonNullable<ReportSpec["sentiment"]>; question?: string }) {
  const [idx, setIdx] = useState(sentiment.length - 1); // land on the final round
  const [tableOpen, setTableOpen] = useState(false);
  const s = sentiment[idx];
  const prev = idx > 0 ? sentiment[idx - 1] : null;
  return (
    <div className="card" style={{ marginTop: 14, padding: "20px 24px", maxWidth: 760 }}>
      {question && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--acc)" }}>THE CROWD WAS ASKED</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)", marginTop: 4 }}>“{question}”</div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {STANCES.map(({ key, label: sl, color }) => {
          const p = pctOf(s.dist, key);
          const delta = prev ? p - pctOf(prev.dist, key) : 0;
          return (
            <div key={key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>{sl}</span>
                <span style={{ ...mono, fontSize: 11, color: "var(--t2)" }}>
                  {p}%
                  {prev && delta !== 0 && (
                    <span style={{ fontSize: 8.5, marginLeft: 6, color: delta > 0 ? (key === "oppose" ? "var(--warn)" : "var(--acc)") : "var(--t6)" }}>
                      {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} PTS
                    </span>
                  )}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 100, background: "var(--sf2)", marginTop: 5, overflow: "hidden" }}>
                <div style={{ width: `${p}%`, height: "100%", borderRadius: 100, background: color, transition: "width .35s ease" }} />
              </div>
            </div>
          );
        })}
      </div>
      {/* the scrubber — §10 slider grammar (thin track, accent thumb) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18 }}>
        <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t5)", flex: "none" }}>ROUND {s.round}</span>
        <input
          type="range"
          min={0}
          max={sentiment.length - 1}
          step={1}
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          style={{ flex: 1, accentColor: "var(--acc)", height: 4, cursor: "pointer" }}
          aria-label="Scrub crowd sentiment by round"
        />
        <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)", flex: "none" }}>{s.polled} POLLED · {sentiment.length} ROUNDS</span>
      </div>
      <button
        onClick={() => setTableOpen((v) => !v)}
        style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", marginTop: 14, background: "none", border: "none", padding: 0, color: "var(--t6)", cursor: "pointer" }}
      >
        PERCENTAGES BY ROUND {tableOpen ? "▴" : "▾"}
      </button>
      {tableOpen && (
        <div style={{ overflowX: "auto", marginTop: 10, animation: "fadeUp .2s ease both" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["ROUND", ...STANCES.map((x) => x.label), "POLLED"].map((h) => (
                  <th key={h} style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--ln3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sentiment.map((row, ri) => (
                <tr key={row.round} style={ri === idx ? { background: "var(--acc-dim)" } : undefined}
                  onClick={() => setIdx(ri)} className="rowGo">
                  <td style={{ ...mono, fontSize: 10, padding: "7px 10px", borderBottom: "1px solid var(--ln1)", color: "var(--t2)", cursor: "pointer" }}>R{row.round}</td>
                  {STANCES.map(({ key }) => (
                    <td key={key} style={{ ...mono, fontSize: 10, padding: "7px 10px", borderBottom: "1px solid var(--ln1)", color: "var(--t4)", cursor: "pointer" }}>{pctOf(row.dist, key)}%</td>
                  ))}
                  <td style={{ ...mono, fontSize: 10, padding: "7px 10px", borderBottom: "1px solid var(--ln1)", color: "var(--t6)" }}>{row.polled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CiteChips({ cites, onJump }: { cites: number[]; onJump: (seq: number) => void }) {
  if (!cites.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap", marginLeft: 8, verticalAlign: "middle" }}>
      {cites.map((c) => (
        <button
          key={c}
          onClick={() => onJump(c)}
          style={{ ...mono, fontSize: 8, letterSpacing: ".05em", border: "1px solid var(--ln4)", borderRadius: 100, padding: "2px 8px", color: "var(--acc)", background: "transparent", cursor: "pointer" }}
        >
          POST {c}
        </button>
      ))}
    </span>
  );
}

/** 3b — the price band: a defended range with central estimate and the
 *  walk-away marker. Pure CSS percentages over the padded domain. */
function PriceBand({ lead }: { lead: ReportLead }) {
  const cur = lead.currency ?? "$";
  const lo = lead.low!, hi = lead.high!;
  const wa = lead.walk_away?.value;
  const pt = lead.point;
  const dMin = Math.min(lo, wa ?? lo, pt ?? lo);
  const dMax = Math.max(hi, wa ?? hi, pt ?? hi);
  const pad = (dMax - dMin) * 0.1 || dMax * 0.05 || 1;
  const min = dMin - pad, max = dMax + pad;
  const pct = (x: number) => Math.min(Math.max(((x - min) / (max - min)) * 100, 0), 100);
  return (
    <div className="card" style={{ marginTop: 18, padding: "22px 26px", maxWidth: 760 }}>
      <div style={{ position: "relative", height: 26 }}>
        <span style={{ ...mono, position: "absolute", left: `${pct(lo)}%`, transform: "translateX(-50%)", fontSize: 15, color: "var(--t0)" }}>{fmtMoney(lo, cur)}</span>
        <span style={{ ...mono, position: "absolute", left: `${pct(hi)}%`, transform: "translateX(-50%)", fontSize: 15, color: "var(--t0)" }}>{fmtMoney(hi, cur)}</span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 100, background: "var(--sf2)", marginTop: 4 }}>
        <div style={{ position: "absolute", left: `${pct(lo)}%`, width: `${Math.max(pct(hi) - pct(lo), 0.5)}%`, top: 0, bottom: 0, borderRadius: 100, background: "var(--acc)", animation: "grow .8s ease both", transformOrigin: "left" }} />
        {typeof pt === "number" && (
          <div title={`Central estimate ${fmtMoney(pt, cur)}`} style={{ position: "absolute", left: `calc(${pct(pt)}% - 1.5px)`, top: -4, width: 3, height: 16, borderRadius: 2, background: "var(--t0)" }} />
        )}
        {typeof wa === "number" && (
          <div title={lead.walk_away!.label} style={{ position: "absolute", left: `calc(${pct(wa)}% - 1px)`, top: -6, width: 2, height: 20, background: "var(--warn)" }} />
        )}
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14, alignItems: "baseline" }}>
        {typeof pt === "number" && (
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--t3)" }}>CENTRAL ESTIMATE · {fmtMoney(pt, cur)}</span>
        )}
        {lead.walk_away && (
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: "var(--warn)" }}>▲ {lead.walk_away.label.toUpperCase()}</span>
        )}
      </div>
      {lead.basis && (
        <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t6)", marginTop: 8 }}>
          TRIANGULATED FROM · {lead.basis.toUpperCase()}
        </div>
      )}
    </div>
  );
}

/** 3b — approval odds: a committed number with a band meter and its drivers */
function OddsMeter({ lead }: { lead: ReportLead }) {
  const odds = Math.round(lead.odds ?? 0);
  const color = lead.band === "likely" ? "var(--acc)" : lead.band === "unlikely" ? "var(--warn)" : "var(--t4)";
  return (
    <div className="card" style={{ marginTop: 18, padding: "22px 26px", maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span style={{ ...mono, fontSize: 40, color }}>{odds}%</span>
        {lead.band && <span style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color, border: `1px solid ${color}`, borderRadius: 100, padding: "4px 12px" }}>{lead.band.toUpperCase()}</span>}
        <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--t6)" }}>ODDS OF APPROVAL · PANEL-JUDGED</span>
      </div>
      <div style={{ height: 8, borderRadius: 100, background: "var(--sf2)", marginTop: 12, overflow: "hidden" }}>
        <div style={{ width: `${odds}%`, height: "100%", borderRadius: 100, background: color, animation: "grow .8s ease both", transformOrigin: "left" }} />
      </div>
      {(lead.drivers?.length ?? 0) > 0 && (
        <div style={{ marginTop: 14 }}>
          <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>WHAT MOVES IT</span>
          <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>
            {lead.drivers!.map((d, i) => (
              <li key={i} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 13, lineHeight: 1.55, color: "var(--t3)" }}>
                <span style={{ color, flex: "none" }}>·</span>{d}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** decimal scores → word grades for the simplified read */
function gradeOf(score: number): { word: string; color: string } {
  if (score >= 7) return { word: "STRONG", color: "var(--acc)" };
  if (score > 4.5) return { word: "MIXED", color: "var(--t4)" };
  return { word: "WEAK", color: "var(--warn)" };
}

/** SIMPLIFY: a different page, not the expert page with softer words.
 *  Answer-first hero, Q&A cards, word grades, everyday crowd labels,
 *  card risks — nothing that needs a finance or engineering vocabulary. */
function PlainBody({ spec, plain, problem, onExpert }: {
  spec: ReportSpec; plain: ReportPlain; problem: string; onExpert: () => void;
}) {
  const v = VERDICT_STYLE[spec.verdict.tone] ?? VERDICT_STYLE.split;
  const m = spec.methodology;
  const finalPoll = spec.sentiment?.length ? spec.sentiment[spec.sentiment.length - 1] : null;
  return (
    <>
      {/* the answer IS the headline */}
      <div style={{ marginTop: 22 }}>
        <span style={{ ...mono, fontSize: 11, letterSpacing: ".1em", padding: "7px 16px", borderRadius: 100, border: `1px solid ${v.color}`, background: v.bg, color: v.color }}>
          {spec.verdict.label}
        </span>
        <h1 style={{ fontSize: "clamp(22px, 2.8vw, 30px)", fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.35, margin: "16px 0 0", maxWidth: 840 }}>
          {plain.bottom_line.answer}
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--t6)" }}>You asked: {problem}</p>
      </div>

      <div style={{ marginTop: 22, border: "1px solid var(--acc)", borderRadius: 14, background: "var(--sf)", padding: "18px 22px", maxWidth: 860 }}>
        {([
          ["WHAT WOULD CHANGE THE ANSWER", plain.bottom_line.changes_it],
          ["WHAT TO DO NEXT", plain.bottom_line.next_step],
        ] as const).map(([k, val], i) => (
          <div key={k} style={{ display: "flex", gap: 14, alignItems: "baseline", marginTop: i === 0 ? 0 : 12 }}>
            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--acc)", width: 190, flex: "none" }}>{k}</span>
            <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--t1)", minWidth: 0 }}>{val}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 30 }}>
        <div style={label}>IN SHORT</div>
        <p style={{ margin: "10px 0 0", fontSize: 15.5, lineHeight: 1.8, color: "var(--t2)", maxWidth: 860 }}>
          {plain.executive_summary}
        </p>
      </div>

      {/* every brief question, answered like a person would */}
      <div style={{ marginTop: 34 }}>
        <div style={label}>YOUR QUESTIONS, ANSWERED</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
          {plain.sections.map((sct, i) => (
            <div key={i} className="card" style={{ padding: "22px 26px" }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>
                {String(i + 1).padStart(2, "0")} · {sct.question.toUpperCase()}
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 16, lineHeight: 1.6, fontWeight: 600, color: "var(--t1)" }}>{sct.answer}</p>
              <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.75, color: "var(--t4)" }}>{sct.explanation}</p>
            </div>
          ))}
        </div>
      </div>

      {/* decimal score bars become words a first-time reader can weigh */}
      {spec.dimension_scores.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={label}>HOW STRONG IS EACH PART OF THE CASE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 14, maxWidth: 860 }}>
            {spec.dimension_scores.map((d) => {
              const g = gradeOf(d.score);
              return (
                <div key={d.name} className="card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>{d.name}</span>
                  <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", flex: "none", padding: "4px 12px", borderRadius: 100, border: `1px solid ${g.color}`, color: g.color }}>{g.word}</span>
                </div>
              );
            })}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.65, color: "var(--t5)", maxWidth: 860 }}>
            {m.leads} simulated experts argued this over {m.posts} posts.
            {spec.dissents.length > 0
              ? ` ${spec.dissents.length} of them still disagreed with the final answer — their objections are below.`
              : " By the end, none of them held out against the final answer."}
          </p>
        </div>
      )}

      {/* the crowd, in everyday words — final poll only, question up front */}
      {finalPoll && (
        <div style={{ marginTop: 34 }}>
          <div style={label}>WHAT THE CROWD SAID</div>
          <div className="card" style={{ marginTop: 14, padding: "20px 24px", maxWidth: 760 }}>
            {spec.poll_question && (
              <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.6, color: "var(--t2)" }}>
                We asked {finalPoll.polled} simulated locals: <span style={{ fontWeight: 600, color: "var(--t1)" }}>“{spec.poll_question}”</span>
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {STANCES.map(({ key, plain: pl, color }) => {
                const p = pctOf(finalPoll.dist, key);
                return (
                  <div key={key}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t5)" }}>{pl}</span>
                      <span style={{ ...mono, fontSize: 11, color: "var(--t2)" }}>{p}%</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 100, background: "var(--sf2)", marginTop: 5, overflow: "hidden" }}>
                      <div style={{ width: `${p}%`, height: "100%", borderRadius: 100, background: color, transition: "width .35s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {(spec.sentiment?.length ?? 0) > 1 && (
              <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--t6)" }}>
                This is where the crowd landed after hearing the whole debate. The full report shows how they moved round by round.
              </p>
            )}
          </div>
        </div>
      )}

      {/* risks as cards — tables read like homework */}
      {plain.risks.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={label}>WHAT COULD GO WRONG</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14, maxWidth: 860 }}>
            {plain.risks.map((r, i) => (
              <div key={i} className="card" style={{ padding: "18px 22px" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)", lineHeight: 1.5 }}>{r.risk}</div>
                <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginTop: 10 }}>
                  <span style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--t6)", width: 92, flex: "none" }}>THE PLAN</span>
                  <span style={{ fontSize: 13, lineHeight: 1.6, color: "var(--t4)", minWidth: 0 }}>{r.mitigation}</span>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginTop: 6 }}>
                  <span style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--warn)", width: 92, flex: "none" }}>WATCH FOR</span>
                  <span style={{ fontSize: 13, lineHeight: 1.6, color: "var(--t4)", minWidth: 0 }}>{r.watch_signal}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {plain.tripwires.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={label}>IF YOU SEE THIS HAPPEN, REVISIT THE DECISION</div>
          <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", maxWidth: 820 }}>
            {plain.tripwires.map((t, i) => (
              <li key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--ln1)", fontSize: 13.5, lineHeight: 1.65, color: "var(--t3)" }}>
                <span style={{ color: "var(--warn)", flex: "none" }}>▲</span>{t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {spec.dissents.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={label}>WHO STILL DISAGREED, AND WHY</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
            {spec.dissents.map((d, i) => (
              <div key={i} style={{ border: "1px solid var(--warn)", borderRadius: 14, padding: "16px 20px", background: "var(--sf)" }}>
                <div style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--warn)" }}>{d.name.toUpperCase()} · {d.role.toUpperCase()}</div>
                <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--t3)" }}>{d.position}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {plain.glossary.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={label}>TERMS USED, IN PLAIN WORDS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10, marginTop: 12 }}>
            {plain.glossary.map((g, i) => (
              <div key={i} style={{ border: "1px solid var(--ln2)", borderRadius: 12, padding: "12px 16px", background: "var(--sf2)" }}>
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t2)" }}>{g.term}</span>
                <p style={{ margin: "5px 0 0", fontSize: 12, lineHeight: 1.55, color: "var(--t5)" }}>{g.meaning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* one honest line instead of the methodology block */}
      <div style={{ marginTop: 38, padding: "18px 22px", border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf2)", maxWidth: 860 }}>
        <div style={label}>HOW THIS WAS MADE</div>
        <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.7, color: "var(--t5)" }}>
          {m.leads} simulated experts{m.crowd ? ` and ${m.crowd} simulated locals` : ""} debated your question for {m.posts} posts.
          Every person here is AI-generated — treat this as a well-argued starting point, not a survey or a guarantee.
        </p>
        <button
          onClick={onExpert}
          style={{ ...mono, fontSize: 9, letterSpacing: ".07em", marginTop: 12, padding: "6px 16px", borderRadius: 100, border: "1px solid var(--ln7)", background: "transparent", color: "var(--t3)", cursor: "pointer" }}
        >
          READ THE FULL EXPERT REPORT →
        </button>
      </div>
    </>
  );
}

export default function ReportView({
  simId, problem, spec, posts, version, versions = [], reportId,
}: {
  simId: string;
  problem: string;
  spec: ReportSpec;
  posts: LivePost[];
  version: number;
  versions?: number[];
  reportId?: string;
}) {
  const [flash, setFlash] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // SIMPLIFY toggle (3a): a cached TRANSLATION of the frozen spec —
  // generated on first use, identical answers and numbers, jargon-free
  const [view, setView] = useState<"expert" | "plain">("expert");
  const [plain, setPlain] = useState<ReportPlain | null>(spec.plain ?? null);
  const [plainBusy, setPlainBusy] = useState(false);
  const [plainErr, setPlainErr] = useState<string | null>(null);
  const showPlain = view === "plain" && !!plain;
  const togglePlain = async () => {
    if (view === "plain") { setView("expert"); return; }
    setPlainErr(null);
    if (plain || !reportId) { setView("plain"); return; }
    setPlainBusy(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/plain`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Translation failed");
      setPlain((data as { plain: ReportPlain }).plain);
      setView("plain");
    } catch (e) {
      setPlainErr(e instanceof Error ? e.message : "Translation failed");
    } finally {
      setPlainBusy(false);
    }
  };
  const v = VERDICT_STYLE[spec.verdict.tone] ?? VERDICT_STYLE.split;
  const jump = (seq: number) => {
    setTranscriptOpen(true); // citations open the transcript, then scroll
    setTimeout(() => {
      const el = document.getElementById(`post-${seq}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlash(seq);
        setTimeout(() => setFlash(null), 2200);
      }
    }, 60);
  };
  const m = spec.methodology;

  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: "POSTS", value: String(m.posts), sub: `${m.leads} LEADS · ${m.mode.toUpperCase()}` },
    { label: "CROWD POLLED", value: m.polls ? String(m.polls) : "—", sub: m.crowd ? `${m.crowd} MEMBERS` : "NO CROWD" },
    ...(spec.verification
      ? [{ label: "CLAIMS CHECKED", value: String(spec.verification.checks), sub: `${spec.verification.contradicted} CONTRADICTED` }]
      : []),
    {
      label: "HOW IT ENDED",
      value: m.converged ? "CONVERGED" : m.stop === "choreography" ? "PHASES DONE" : m.stop === "budget" ? "BUDGET CAP" : m.stop === "rounds" ? "ALL ROUNDS" : m.stop === "stopped" ? "STOPPED" : "OPEN",
      sub: `${spec.dissents.length} DISSENT${spec.dissents.length === 1 ? "" : "S"} PRESERVED`,
    },
  ];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 40px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/sim/${simId}`} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>← WORKSPACE</Link>
        <Link href={`/sim/${simId}/run`} prefetch={false} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>VIEW THE RUN →</Link>
        {reportId && (
          <button
            onClick={() => void togglePlain()}
            disabled={plainBusy}
            title={view === "plain" ? "Back to the full technical report" : "Translate this report for a non-technical reader — same answers, same numbers"}
            style={{
              ...mono, fontSize: 9, letterSpacing: ".07em", padding: "5px 14px", borderRadius: 100,
              border: `1px solid ${view === "plain" ? "var(--acc)" : "var(--ln5)"}`,
              background: view === "plain" ? "var(--acc-dim)" : "transparent",
              color: view === "plain" ? "var(--acc)" : "var(--t5)", cursor: plainBusy ? "wait" : "pointer",
            }}
          >
            {plainBusy ? "SIMPLIFYING…" : view === "plain" ? "SIMPLIFIED ✓ · BACK TO EXPERT" : "SIMPLIFY"}
          </button>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {versions.length > 1 && versions.map((vn) => (
            <Link key={vn} href={`/sim/${simId}/report?v=${vn}`} style={{
              ...mono, fontSize: 8.5, letterSpacing: ".05em", padding: "3px 10px", borderRadius: 100,
              border: `1px solid ${vn === version ? "var(--acc)" : "var(--ln4)"}`,
              color: vn === version ? "var(--acc)" : "var(--t6)",
              background: vn === version ? "var(--acc-dim)" : "transparent",
            }}>
              V{vn}
            </Link>
          ))}
          <span style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--t7)" }}>
            {versions.length > 1 ? "· " : `REPORT V${version} · `}SYNTHETIC & DIRECTIONAL
          </span>
        </span>
      </div>

      {plainErr && <div style={{ ...mono, fontSize: 10, color: "var(--warn)", marginTop: 10 }}>{plainErr}</div>}

      {showPlain ? (
        <PlainBody spec={spec} plain={plain!} problem={problem} onExpert={() => setView("expert")} />
      ) : (
        <>
          {/* the lead — its kind matches the ask (3b); pre-3b reports and
              decision briefs render exactly as before */}
          {(() => {
            const lead = spec.lead;
            const kind = lead?.kind ?? "decision";
            if (kind === "decision") {
              return (
                <div style={{ marginTop: 22 }}>
                  <span style={{ ...mono, fontSize: 11, letterSpacing: ".1em", padding: "7px 16px", borderRadius: 100, border: `1px solid ${v.color}`, background: v.bg, color: v.color }}>
                    {spec.verdict.label}
                  </span>
                  <h1 style={{ fontSize: "clamp(22px, 2.8vw, 32px)", fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.25, margin: "16px 0 0", maxWidth: 860 }}>
                    {spec.verdict.headline}
                  </h1>
                  <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--t6)" }}>{problem}</p>
                </div>
              );
            }
            const chipColor = kind === "approval_odds"
              ? (lead!.band === "likely" ? "var(--acc)" : lead!.band === "unlikely" ? "var(--warn)" : "var(--t4)")
              : "var(--acc)";
            const chipBg = chipColor === "var(--acc)" ? "var(--acc-dim)" : chipColor === "var(--warn)" ? "var(--warn-dim)" : "var(--sf2)";
            return (
              <div style={{ marginTop: 22 }}>
                <span style={{ ...mono, fontSize: 11, letterSpacing: ".1em", padding: "7px 16px", borderRadius: 100, border: `1px solid ${chipColor}`, background: chipBg, color: chipColor }}>
                  {LEAD_KIND_LABEL[kind]}
                </span>
                <h1 style={{ fontSize: "clamp(22px, 2.8vw, 32px)", fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.3, margin: "16px 0 0", maxWidth: 860 }}>
                  {kind === "key_finding" ? (lead!.finding ?? spec.verdict.headline) : spec.verdict.headline}
                </h1>
                {kind === "key_finding" && lead!.so_what && (
                  <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--t3)", maxWidth: 820 }}>{lead!.so_what}</p>
                )}
                {kind === "key_finding" && (lead!.magnitude?.length ?? 0) > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    {lead!.magnitude!.map((n, ni) => (
                      <span key={ni} style={{ border: "1px solid var(--ln3)", borderRadius: 10, padding: "6px 12px", background: "var(--sf2)" }}>
                        <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".08em", color: "var(--t6)", display: "block" }}>{n.label.toUpperCase()}</span>
                        <span style={{ ...mono, fontSize: 13, color: "var(--t1)" }}>{n.value}</span>
                      </span>
                    ))}
                  </div>
                )}
                {kind === "price_range" && <PriceBand lead={lead!} />}
                {kind === "approval_odds" && <OddsMeter lead={lead!} />}
                <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--t6)" }}>{problem}</p>
              </div>
            );
          })()}

          {/* THE BOTTOM LINE — three plain sentences, read this and stop */}
          {spec.bottom_line && (
            <div style={{ marginTop: 24, border: "1px solid var(--acc)", borderRadius: 14, background: "var(--sf)", padding: "18px 22px", maxWidth: 900 }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)" }}>THE BOTTOM LINE</div>
              {([
                ["THE ANSWER", spec.bottom_line.answer],
                ["WHAT WOULD CHANGE IT", spec.bottom_line.changes_it],
                ["DO NEXT", spec.bottom_line.next_step],
              ] as const).map(([k, val]) => (
                <div key={k} style={{ display: "flex", gap: 14, alignItems: "baseline", marginTop: 10 }}>
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)", width: 150, flex: "none" }}>{k}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.6, color: "var(--t1)", minWidth: 0 }}>{val}</span>
                </div>
              ))}
            </div>
          )}

          {/* executive summary */}
          <p style={{ margin: "22px 0 0", fontSize: 15, lineHeight: 1.75, color: "var(--t2)", maxWidth: 900 }}>
            {spec.executive_summary}
          </p>

          {/* stat tiles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 26 }}>
            {tiles.map((t) => (
              <div key={t.label} className="card" style={{ padding: "16px 18px" }}>
                <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t6)" }}>{t.label}</div>
                <div style={{ ...mono, fontSize: 24, color: "var(--t0)", marginTop: 6 }}>{t.value}</div>
                {t.sub && <div style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)", marginTop: 4 }}>{t.sub}</div>}
              </div>
            ))}
          </div>

          {/* dimension scores */}
          {spec.dimension_scores.length > 0 && (
            <div style={{ marginTop: 34 }}>
              <div style={label}>DIMENSION SCORES · PANEL-WEIGHTED</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14, maxWidth: 760 }}>
                {spec.dimension_scores.map((d) => (
                  <div key={d.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                      <span style={{ ...mono, fontSize: 11, color: d.score >= 7 ? "var(--acc)" : d.score <= 4 ? "var(--warn)" : "var(--t4)" }}>{d.score.toFixed(1)} / 10</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 100, background: "var(--sf2)", marginTop: 6, overflow: "hidden" }}>
                      <div style={{ width: `${d.score * 10}%`, height: "100%", borderRadius: 100, background: d.score >= 7 ? "var(--acc)" : d.score <= 4 ? "var(--warn)" : "var(--t5)", animation: "grow .8s ease both", transformOrigin: "left" }} />
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--t6)", marginTop: 4 }}>{d.note}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* findings per question + per success criterion — ANSWER FIRST */}
          <div style={{ marginTop: 36 }}>
            <div style={label}>FINDINGS · YOUR QUESTIONS AND SUCCESS CRITERIA</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}>
              {spec.sections.map((sct, i) => (
                <div key={i} className="card" style={{ padding: "20px 24px" }}>
                  <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--acc)" }}>
                    {String(i + 1).padStart(2, "0")} · {sct.question.toUpperCase()}
                    <CiteChips cites={sct.cites} onJump={jump} />
                  </div>
                  {sct.answer && (
                    <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.65, fontWeight: 600, color: "var(--t1)" }}>{sct.answer}</p>
                  )}
                  {(sct.numbers?.length ?? 0) > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      {sct.numbers!.map((n, ni) => (
                        <span key={ni} style={{ border: "1px solid var(--ln3)", borderRadius: 10, padding: "6px 12px", background: "var(--sf2)" }}>
                          <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".08em", color: "var(--t6)", display: "block" }}>{n.label.toUpperCase()}</span>
                          <span style={{ ...mono, fontSize: 13, color: "var(--t1)" }}>{n.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.7, color: sct.answer ? "var(--t4)" : "var(--t3)" }}>{sct.finding}</p>
                </div>
              ))}
            </div>
          </div>

          {/* crowd sentiment — scrub the rounds, watch the crowd move */}
          {(spec.sentiment?.length ?? 0) >= 2 && (
            <div style={{ marginTop: 34 }}>
              <div style={label}>CROWD SENTIMENT · SCRUB THE ROUNDS</div>
              <SentimentSlider sentiment={spec.sentiment!} question={spec.poll_question} />
            </div>
          )}

          {/* success criteria — the delivery receipt */}
          {(spec.criteria?.length ?? 0) > 0 && (
            <div style={{ marginTop: 34 }}>
              <div style={label}>SUCCESS CRITERIA · WHAT YOU ASKED FOR, WHERE IT'S DELIVERED</div>
              <div className="card" style={{ marginTop: 14, padding: "18px 24px" }}>
                {spec.criteria!.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 0", borderBottom: i < spec.criteria!.length - 1 ? "1px solid var(--ln2)" : "none" }}>
                    <span style={{ ...mono, fontSize: 11, color: "var(--acc)", flex: "none" }}>✓</span>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--t2)", flex: 1, minWidth: 0 }}>{c.criterion}</span>
                    <span style={{ ...mono, fontSize: 9, letterSpacing: ".04em", color: "var(--t6)", flex: "none", maxWidth: 300, textAlign: "right" }}>{c.where.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* risk register */}
          {spec.risks.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div style={label}>RISK REGISTER</div>
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["RISK", "SEVERITY", "MITIGATION", "WATCH SIGNAL"].map((h) => (
                        <th key={h} style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--ln3)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spec.risks.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12.5, fontWeight: 600, padding: "10px 12px", borderBottom: "1px solid var(--ln1)", color: "var(--t2)" }}>{r.risk}</td>
                        <td style={{ ...mono, fontSize: 9, letterSpacing: ".06em", padding: "10px 12px", borderBottom: "1px solid var(--ln1)", color: r.severity === "high" ? "var(--warn)" : r.severity === "medium" ? "var(--t4)" : "var(--t6)" }}>{r.severity.toUpperCase()}</td>
                        <td style={{ fontSize: 12, padding: "10px 12px", borderBottom: "1px solid var(--ln1)", color: "var(--t4)" }}>{r.mitigation}</td>
                        <td style={{ fontSize: 12, padding: "10px 12px", borderBottom: "1px solid var(--ln1)", color: "var(--t5)" }}>{r.watch_signal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* verification */}
          {spec.verification && (
            <div style={{ marginTop: 36 }}>
              <div style={label}>CONSTRAINT CHECKS · CLAIMS VS YOUR DOCUMENTS</div>
              <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".05em", color: "var(--t4)", marginTop: 10 }}>
                {spec.verification.checks} CHECKED · <span style={{ color: "var(--acc)" }}>{spec.verification.supported} SUPPORTED</span> · <span style={{ color: spec.verification.contradicted ? "var(--warn)" : "var(--t6)" }}>{spec.verification.contradicted} CONTRADICTED</span> · {spec.verification.unverifiable} SILENT
              </div>
              {spec.verification.contradictions.map((c, i) => (
                <div key={i} style={{ marginTop: 10, padding: "12px 16px", border: "1px solid var(--warn)", background: "var(--warn-dim)", borderRadius: 12, maxWidth: 860 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>
                    “{c.claim}” {c.seq > 0 && <CiteChips cites={[c.seq]} onJump={jump} />}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--t4)", marginTop: 4 }}>{c.note}</div>
                </div>
              ))}
            </div>
          )}

          {/* preserved dissents */}
          {spec.dissents.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div style={label}>PRESERVED DISSENTS · NEVER AVERAGED AWAY</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
                {spec.dissents.map((d, i) => (
                  <div key={i} style={{ border: "1px solid var(--warn)", borderRadius: 14, padding: "18px 20px", background: "var(--sf)" }}>
                    <div style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--warn)" }}>{d.name.toUpperCase()} · {d.role.toUpperCase()}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, margin: "8px 0 6px", color: "var(--t2)" }}>{d.position}</div>
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--t4)", fontStyle: "italic" }}>“{d.quote}”</p>
                    {d.seq > 0 && <div style={{ marginTop: 8 }}><CiteChips cites={[d.seq]} onJump={jump} /></div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* tripwires */}
          {spec.tripwires.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div style={label}>TRIPWIRES · WHAT WOULD CHANGE THIS ANSWER</div>
              <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", maxWidth: 820 }}>
                {spec.tripwires.map((t, i) => (
                  <li key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--ln1)", fontSize: 13, lineHeight: 1.6, color: "var(--t3)" }}>
                    <span style={{ color: "var(--warn)", flex: "none" }}>▲</span>{t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* methodology & limitations */}
          <div style={{ marginTop: 40, padding: "18px 22px", border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf2)" }}>
            <div style={label}>METHODOLOGY & LIMITATIONS</div>
            <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.7, color: "var(--t5)" }}>
              {m.mode} deliberation · {m.leads} leads + {m.crowd} crowd · {m.rounds} round cap · {m.posts} posts · {m.polls} member-polls · {m.tier} tier ({m.models.join(", ")}) ·
              {m.docs.length ? ` grounded in: ${m.docs.join(", ")} · ` : " no documents attached · "}
              generated {new Date(m.generated_at).toLocaleString()}
            </p>
            {spec.cast && spec.cast.length > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.7, color: "var(--t5)" }}>
                <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>THE PANEL THAT RAN · </span>
                {spec.cast.map((c) => `${c.name} (${c.role}${c.adversarial ? " · adversarial" : ""})`).join(" · ")}
                {spec.run_config && ` — frozen with this report: ${spec.run_config.mode}, ${spec.run_config.rounds} rounds, ${spec.run_config.tier} tier, ${spec.run_config.temperature}`}
              </p>
            )}
            <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.7, color: "var(--t6)" }}>{spec.limitations}</p>
          </div>

          {/* transcript: collapsed by default, forum-style when open; citations auto-expand it */}
          <div style={{ marginTop: 40 }}>
            <button
              onClick={() => setTranscriptOpen((v2) => !v2)}
              style={{ ...label, background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
            >
              TRANSCRIPT · {posts.length} POSTS — RE-READ THE FORUM {transcriptOpen ? "▴" : "▾"}
            </button>
            {transcriptOpen && (
              <div style={{ marginTop: 14, border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf)", padding: "18px 22px", animation: "fadeUp .25s ease both" }}>
                {(() => {
                  let lastRound = 0;
                  return posts.map((p) => {
                    const divider = p.round !== lastRound;
                    lastRound = p.round;
                    const reply = p.tag === "REPLY" || p.tag === "REBUTTAL";
                    return (
                      <div key={p.seq}>
                        {divider && (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 4px" }}>
                            <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                            <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>ROUND {p.round}</span>
                            <span style={{ flex: 1, height: 1, background: "var(--ln2)" }} />
                          </div>
                        )}
                        <div
                          id={`post-${p.seq}`}
                          style={{
                            marginTop: 14,
                            marginLeft: reply ? 36 : 0,
                            paddingLeft: reply ? 14 : 0,
                            borderLeft: reply ? "1px solid var(--ln2)" : "none",
                            borderRadius: 10,
                            background: flash === p.seq ? "var(--acc-dim)" : "transparent",
                            outline: flash === p.seq ? "1px solid var(--acc)" : "none",
                            transition: "all .4s", scrollMarginTop: 90, padding: flash === p.seq ? "10px 12px" : undefined,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--sf2)", border: `1px solid ${p.adversarial ? "var(--warn)" : "var(--ln5)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 9, color: "var(--t3)", flex: "none" }}>{p.initials}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>
                                {p.name}
                                <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", marginLeft: 8, padding: "2px 7px", borderRadius: 100, border: `1px solid ${p.adversarial ? "var(--warn)" : "var(--ln4)"}`, color: p.adversarial ? "var(--warn)" : p.tag.startsWith("POST") ? "var(--acc)" : "var(--t6)" }}>
                                  [{p.seq}] {p.tag}
                                </span>
                              </div>
                              <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t6)", marginTop: 2 }}>{p.role.toUpperCase()}</div>
                            </div>
                          </div>
                          <p style={{ margin: "7px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t3)" }}>{p.content}</p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
