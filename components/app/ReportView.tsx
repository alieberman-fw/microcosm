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

import { CSSProperties, useEffect, useState } from "react";
import Link from "next/link";
import { markReportSeen } from "@/components/app/ReportsBadge";
import { LEAD_KIND_LABEL, ReportBlock, ReportLead, ReportPlain, ReportSpec, VERDICT_STYLE, fmtMoney } from "@/lib/report";
import { LivePost } from "@/components/app/LiveRun";
import Markdown from "@/components/app/Markdown";
import { distShares } from "@/lib/dist";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };
const label: CSSProperties = { ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" };

/** one instrument, two vocabularies: expert labels for the full report,
 *  everyday labels for the simplified read */
type Stance = { key: string; label: string; plain: string; color: string };
const STANCES: Stance[] = [
  { key: "support", label: "SUPPORT", plain: "WOULD SAY YES", color: "var(--acc)" },
  { key: "conditional", label: "CONDITIONAL", plain: "YES, IF CONCERNS ARE MET", color: "var(--t5)" },
  { key: "oppose", label: "OPPOSE", plain: "WOULD SAY NO", color: "var(--warn)" },
  { key: "disengaged", label: "DISENGAGED", plain: "NOT AFFECTED / NO OPINION", color: "var(--ln6)" },
];

/** choice instruments (PR-B) swap the four stances for the brief's actual
 *  alternatives — "which photo leads the listing?" tallies green.png vs
 *  red.png, not support vs oppose. Undecideds show only when they exist. */
const CHOICE_PALETTE = ["var(--acc)", "var(--warn)", "var(--t5)", "var(--ln7)", "var(--ln4)"];
function instrumentOf(spec: Pick<ReportSpec, "poll_options" | "sentiment">): Stance[] {
  if (!spec.poll_options?.length) return STANCES;
  const rows: Stance[] = spec.poll_options.map((o, i) => ({
    key: o, label: o.toUpperCase(), plain: o, color: CHOICE_PALETTE[i % CHOICE_PALETTE.length],
  }));
  if ((spec.sentiment ?? []).some((s) => (s.dist.undecided ?? 0) > 0)) {
    rows.push({ key: "undecided", label: "UNDECIDED", plain: "COULDN'T PICK ONE", color: "var(--ln6)" });
  }
  return rows;
}

/** 6-PR3 — adaptive poll plans vary the question across the run: group the
 *  polls by angle (falling back to the question text) so every slider's
 *  percentages share one referent. A single-instrument run = one group. */
function sentimentGroups(spec: Pick<ReportSpec, "poll_question" | "poll_options" | "sentiment">): { key: string; question?: string; entries: NonNullable<ReportSpec["sentiment"]>; stances: Stance[] }[] {
  const entries = spec.sentiment ?? [];
  const byKey = new Map<string, NonNullable<ReportSpec["sentiment"]>>();
  for (const s of entries) {
    const key = s.angle ?? s.question ?? "POLL";
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }
  return [...byKey.entries()].map(([key, group]) => {
    const options = group.find((g) => g.options?.length)?.options ?? (byKey.size === 1 ? spec.poll_options ?? undefined : undefined);
    return {
      key,
      question: group.find((g) => g.question)?.question ?? (byKey.size === 1 ? spec.poll_question ?? undefined : undefined),
      entries: group,
      stances: instrumentOf({ poll_options: options, sentiment: group }),
    };
  });
}


/** one slider, one set of bars: scrub through the rounds and watch the crowd
 *  move — with an expandable table of the percentages over time */
function SentimentSlider({ sentiment, question, stances = STANCES }: { sentiment: NonNullable<ReportSpec["sentiment"]>; question?: string; stances?: Stance[] }) {
  const [idx, setIdx] = useState(sentiment.length - 1); // land on the final round
  const [tableOpen, setTableOpen] = useState(false);
  const [votesOpen, setVotesOpen] = useState(false);
  const s = sentiment[idx];
  const prev = idx > 0 ? sentiment[idx - 1] : null;
  // largest-remainder shares (C1): the displayed percentages sum to exactly 100
  const keys = stances.map((x) => x.key);
  const shareOf = (row: { dist: Record<string, number> }) =>
    Object.fromEntries(distShares(row.dist, keys).map((x) => [x.key, x]));
  const cur = shareOf(s);
  const before = prev ? shareOf(prev) : null;
  return (
    <div className="card" style={{ marginTop: 14, padding: "20px 24px", maxWidth: 760 }}>
      {question && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--acc)" }}>THE CROWD WAS ASKED</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--t2)", marginTop: 4 }}>“{question}”</div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {stances.map(({ key, label: sl, color }) => {
          const p = cur[key]?.pct ?? 0;
          const delta = before ? p - (before[key]?.pct ?? 0) : 0;
          return (
            <div key={key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ ...mono, fontSize: 9, letterSpacing: ".08em", color: "var(--t6)" }}>{sl}</span>
                <span style={{ ...mono, fontSize: 11, color: "var(--t2)" }}>
                  {p}% <span style={{ fontSize: 8.5, color: "var(--t7)" }}>({cur[key]?.count ?? 0})</span>
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
      <div style={{ display: "flex", gap: 18, marginTop: 14 }}>
        <button
          onClick={() => setTableOpen((v) => !v)}
          style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", background: "none", border: "none", padding: 0, color: "var(--t6)", cursor: "pointer" }}
        >
          PERCENTAGES BY ROUND {tableOpen ? "▴" : "▾"}
        </button>
        {(s.ballots?.length ?? 0) > 0 && (
          <button
            onClick={() => setVotesOpen((v) => !v)}
            style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", background: "none", border: "none", padding: 0, color: "var(--t6)", cursor: "pointer" }}
          >
            EVERY VOTE · ROUND {s.round} ({s.ballots!.length}) {votesOpen ? "▴" : "▾"}
          </button>
        )}
      </div>
      {votesOpen && (s.ballots?.length ?? 0) > 0 && (
        <div style={{ marginTop: 10, maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 9, paddingRight: 6, animation: "fadeUp .2s ease both" }}>
          {stances.filter((st) => s.ballots!.some((b) => b.stance === st.key)).map((st) => (
            <div key={st.key}>
              <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t5)", marginBottom: 3 }}>
                {st.label} · {s.ballots!.filter((b) => b.stance === st.key).length}
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--t5)" }}>
                {s.ballots!.filter((b) => b.stance === st.key).map((b) => b.name).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}
      {tableOpen && (
        <div style={{ overflowX: "auto", marginTop: 10, animation: "fadeUp .2s ease both" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["ROUND", ...stances.map((x) => x.label), "POLLED"].map((h) => (
                  <th key={h} style={{ ...mono, fontSize: 8, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--ln3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sentiment.map((row, ri) => (
                <tr key={row.round} style={ri === idx ? { background: "var(--acc-dim)" } : undefined}
                  onClick={() => setIdx(ri)} className="rowGo">
                  <td style={{ ...mono, fontSize: 10, padding: "7px 10px", borderBottom: "1px solid var(--ln1)", color: "var(--t2)", cursor: "pointer" }}>R{row.round}</td>
                  {(() => { const rs = shareOf(row); return stances.map(({ key }) => (
                    <td key={key} style={{ ...mono, fontSize: 10, padding: "7px 10px", borderBottom: "1px solid var(--ln1)", color: "var(--t4)", cursor: "pointer" }}>{rs[key]?.pct ?? 0}%</td>
                  )); })()}
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

/** PR-A — the uploaded files the decision turned on: images render inline
 *  (the winning listing photo IS the finding), documents open signed */
/** C7 (field-report 2): a uniform grid — equal columns, fixed image height,
 *  captions clamped to two lines (click a card's caption to expand) — so a
 *  mixed set of portrait/landscape uploads still reads as one composed row. */
function KeyMaterials({ media, urls }: { media: NonNullable<ReportSpec["media"]>; urls: Record<string, string> }) {
  const [openCaption, setOpenCaption] = useState<number | null>(null);
  return (
    <div style={{ marginTop: 34 }}>
      <div style={label}>KEY MATERIALS · WHAT THE DECISION TURNED ON</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14, marginTop: 14, maxWidth: 1080 }}>
        {media.map((m, i) => {
          const url = urls[m.path];
          if (m.kind === "image" && url) {
            const clamped = openCaption !== i;
            return (
              <figure key={i} style={{ margin: 0, border: "1px solid var(--ln3)", borderRadius: 14, overflow: "hidden", background: "var(--sf)", display: "flex", flexDirection: "column" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
                <img src={url} alt={m.name} style={{ display: "block", width: "100%", height: 180, objectFit: "cover", flex: "none" }} />
                <figcaption style={{ padding: "12px 16px", cursor: "pointer" }} onClick={() => setOpenCaption(clamped ? i : null)} title={clamped ? m.caption : undefined}>
                  <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--acc)" }}>{m.name.toUpperCase()}</div>
                  <div style={{
                    fontSize: 12.5, lineHeight: 1.55, color: "var(--t4)", marginTop: 4,
                    ...(clamped ? { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" } : {}),
                  }}>{m.caption}</div>
                </figcaption>
              </figure>
            );
          }
          return (
            <a key={i} href={url ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 120, border: "1px solid var(--ln3)", borderRadius: 14, padding: "16px 18px", background: "var(--sf)", textDecoration: "none" }}>
              <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--acc)" }}>↗ {m.name.toUpperCase()}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--t4)", marginTop: 5 }}>{m.caption}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** decimal scores → word grades for the simplified read */
/** 6-PR4 (§6e) — the answer's ARTIFACTS: contract-driven blocks. One flat
 *  shape, three renderings: ranked list (numbered wrapping rows), matrix
 *  (a real table, horizontally scrollable), comparison (side-by-side cards). */
function BlocksSection({ blocks, onJump }: { blocks: ReportBlock[]; onJump?: (seq: number) => void }) {
  const label: CSSProperties = { fontFamily: "var(--font-mono), monospace", fontSize: 10, letterSpacing: ".1em", color: "var(--t6)" };
  const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };
  const kindLabel = { ranked_list: "RANKED LIST", matrix: "MATRIX", comparison: "COMPARISON" } as const;
  return (
    <div style={{ marginTop: 30 }}>
      <div style={label}>THE ANSWER, AS ARTIFACTS</div>
      {blocks.map((b, bi) => (
        <div key={bi} className="card" style={{ marginTop: 14, padding: "20px 24px" }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".09em", color: "var(--acc)" }}>
            {kindLabel[b.kind]} · {b.title.toUpperCase()}
          </div>
          {b.kind === "matrix" ? (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: Math.max(560, 170 * (b.columns.length + 1)) }}>
                <thead>
                  <tr>
                    <th style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "8px 12px 8px 0", borderBottom: "1px solid var(--ln4)" }} />
                    {b.columns.map((c, ci) => (
                      <th key={ci} style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--ln4)", textTransform: "uppercase" }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>
                      <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t1)", padding: "9px 12px 9px 0", borderBottom: "1px solid var(--ln2)", verticalAlign: "top", minWidth: 140 }}>{r.label}</td>
                      {b.columns.map((_, ci) => (
                        <td key={ci} style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--t4)", padding: "9px 12px", borderBottom: "1px solid var(--ln2)", verticalAlign: "top", minWidth: 150 }}>
                          {r.cells[ci] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : b.kind === "comparison" ? (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, gap: 12, marginTop: 12 }}>
              {b.rows.map((r, ri) => (
                <div key={ri} style={{ border: "1px solid var(--ln3)", borderRadius: 12, padding: "14px 16px", background: "var(--sf2)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--t1)" }}>{r.label}</div>
                  {b.columns.map((c, ci) => (r.cells[ci] ? (
                    <div key={ci} style={{ marginTop: 9 }}>
                      <div style={{ ...mono, fontSize: 7.5, letterSpacing: ".08em", color: "var(--t6)", textTransform: "uppercase" }}>{c}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--t4)", marginTop: 3 }}>{r.cells[ci]}</div>
                    </div>
                  ) : null))}
                  {onJump && r.cites && r.cites.length > 0 && <div style={{ marginTop: 8 }}><CiteChips cites={r.cites} onJump={onJump} /></div>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {b.rows.map((r, ri) => (
                <div key={ri} style={{ border: "1px solid var(--ln3)", borderRadius: 10, padding: "11px 14px", background: "var(--sf2)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ ...mono, fontSize: 11, color: "var(--acc)", flex: "none", fontWeight: 500 }}>{r.label}</span>
                    <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t2)", minWidth: 0, flex: 1 }}>{r.cells[0] ?? ""}</span>
                    {onJump && r.cites && r.cites.length > 0 && <CiteChips cites={r.cites} onJump={onJump} />}
                  </div>
                  {r.note && <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--t5)", marginTop: 6 }}>{r.note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function gradeOf(score: number): { word: string; color: string } {
  if (score >= 7) return { word: "STRONG", color: "var(--acc)" };
  if (score > 4.5) return { word: "MIXED", color: "var(--t4)" };
  return { word: "WEAK", color: "var(--warn)" };
}

/** SIMPLIFY: a different page, not the expert page with softer words.
 *  Answer-first hero, Q&A cards, word grades, everyday crowd labels,
 *  card risks — nothing that needs a finance or engineering vocabulary. */
function PlainBody({ spec, plain, problem, onExpert, mediaUrls = {} }: {
  spec: ReportSpec; plain: ReportPlain; problem: string; onExpert: () => void;
  mediaUrls?: Record<string, string>;
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

      {/* PR-A — the winning photo / key file speaks for itself in plain view too */}
      {(spec.media?.length ?? 0) > 0 && <KeyMaterials media={spec.media!} urls={mediaUrls} />}

      {/* 6-PR4 — the artifacts read plainly already (short verdicts per cell) */}
      {(spec.blocks?.length ?? 0) > 0 && <BlocksSection blocks={spec.blocks!} />}

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
            {(finalPoll.question ?? spec.poll_question) && (
              <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.6, color: "var(--t2)" }}>
                We asked {finalPoll.polled} simulated locals: <span style={{ fontWeight: 600, color: "var(--t1)" }}>“{finalPoll.question ?? spec.poll_question}”</span>
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* 6-PR3: the final poll answers ITS OWN question — an adaptive
                  plan's closer, not necessarily the spec-level instrument */}
              {(() => { const inst = instrumentOf({ poll_options: finalPoll.options ?? spec.poll_options, sentiment: [finalPoll] }); const fs = Object.fromEntries(distShares(finalPoll.dist, inst.map((x) => x.key)).map((x) => [x.key, x.pct])); return inst.map(({ key, plain: pl, color }) => {
                const p = fs[key] ?? 0;
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
              }); })()}
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

/** C6 (field-report 2): every upload in canonical corpus order, carrying the
 *  SAME "IMAGE n" ordinal agents see — user language ("image 2"), filenames
 *  ("3.webp"), and the panel's perception finally point at one thing.
 *  Collapsible floating rail; click an image for the lightbox. */
export interface ReportFile { name: string; kind: "image" | "document"; ordinal: number | null; url?: string }
function FileRail({ files }: { files: ReportFile[] }) {
  const [open, setOpen] = useState(false);
  const [lightbox, setLightbox] = useState<ReportFile | null>(null);
  if (!files.length) return null;
  return (
    <>
      <div style={{ position: "fixed", right: 18, top: 96, zIndex: 44, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ ...mono, fontSize: 9, letterSpacing: ".08em", padding: "6px 14px", borderRadius: 100, border: `1px solid ${open ? "var(--acc)" : "var(--ln5)"}`, background: open ? "var(--acc-dim)" : "var(--sf)", color: open ? "var(--acc)" : "var(--t5)", cursor: "pointer" }}
        >
          FILES ({files.length}) {open ? "▴" : "▾"}
        </button>
        {open && (
          <div style={{ marginTop: 8, width: 240, maxHeight: "min(60vh, 520px)", overflowY: "auto", border: "1px solid var(--ln4)", borderRadius: 14, background: "var(--sf)", padding: 10, boxShadow: "0 18px 44px rgba(0,0,0,.35)", animation: "fadeUp .15s ease both" }}>
            <div style={{ ...mono, fontSize: 8, letterSpacing: ".1em", color: "var(--t6)", padding: "2px 6px 8px" }}>WHAT THE PANEL SAW · CORPUS ORDER</div>
            {files.map((f, i) => (
              <button
                key={i}
                onClick={() => { if (f.kind === "image" && f.url) setLightbox(f); else if (f.url) window.open(f.url, "_blank", "noopener"); }}
                style={{ display: "flex", width: "100%", alignItems: "center", gap: 9, textAlign: "left", cursor: f.url ? "pointer" : "default", borderRadius: 9, padding: "6px 6px", background: "transparent", border: "none" }}
              >
                {f.kind === "image" && f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                  <img src={f.url} alt="" style={{ width: 44, height: 32, objectFit: "cover", borderRadius: 6, border: "1px solid var(--ln4)", flex: "none" }} />
                ) : (
                  <span style={{ width: 44, height: 32, borderRadius: 6, border: "1px solid var(--ln3)", background: "var(--sf2)", display: "inline-flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 9, color: "var(--t6)", flex: "none" }}>DOC</span>
                )}
                <span style={{ minWidth: 0 }}>
                  {f.ordinal !== null && (
                    <span style={{ display: "block", ...mono, fontSize: 7.5, letterSpacing: ".09em", color: "var(--acc)" }}>IMAGE {f.ordinal}</span>
                  )}
                  <span style={{ display: "block", ...mono, fontSize: 10, color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 96, background: "rgba(0,0,0,.78)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, cursor: "zoom-out" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "86vw", maxHeight: "80vh", borderRadius: 12, border: "1px solid var(--ln6)" }} />
          <div style={{ ...mono, fontSize: 10, letterSpacing: ".07em", color: "#eaeaea" }}>
            {lightbox.ordinal !== null ? `IMAGE ${lightbox.ordinal} · ` : ""}{lightbox.name.toUpperCase()} — CLICK ANYWHERE TO CLOSE
          </div>
        </div>
      )}
    </>
  );
}

export default function ReportView({
  simId, problem, spec, posts, version, versions = [], reportId, mediaUrls = {}, files = [],
}: {
  simId: string;
  problem: string;
  spec: ReportSpec;
  posts: LivePost[];
  version: number;
  versions?: number[];
  reportId?: string;
  /** PR-A — signed URLs for spec.media, keyed by storage path */
  mediaUrls?: Record<string, string>;
  /** C6 — every upload, corpus order, IMAGE-n ordinals + signed URLs */
  files?: ReportFile[];
}) {
  const [flash, setFlash] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // unread-reports badge: opening a report IS reading it
  useEffect(() => { if (reportId) markReportSeen(reportId); }, [reportId]);
  // SIMPLIFY toggle (3a): a cached TRANSLATION of the frozen spec —
  // generated on first use, identical answers and numbers, jargon-free.
  // 6-PR4 (§6f): the contract's REGISTER decides which voice LEADS — an
  // executive-audience report opens in the plain view (translated eagerly
  // at synthesis); one click flips to the full technical read either way.
  const [view, setView] = useState<"expert" | "plain">(spec.audience === "executive" && spec.plain ? "plain" : "expert");
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
      // platform timeouts return PLAIN TEXT ("An error occurred…") — never
      // JSON.parse blind, or the user sees "Unexpected token 'A'" instead of
      // an actionable message
      const raw = await res.text();
      let data: { error?: string; plain?: ReportPlain } = {};
      try { data = JSON.parse(raw); } catch { /* non-JSON body — handled below */ }
      if (!res.ok || !data.plain) throw new Error(data.error ?? `Translation failed (${res.status || "network"}) — hit SIMPLIFY to retry`);
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
    ...(spec.tool_calls
      ? [{ label: "TOOL CALLS", value: String(spec.tool_calls), sub: `WEB RESEARCH · ${spec.web_sources?.length ?? 0} SOURCES` }]
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
              color: view === "plain" ? "var(--acc)" : "var(--t5)", cursor: plainBusy ? "progress" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 7,
            }}
          >
            {plainBusy && <span style={{ width: 6, height: 6, borderRadius: 100, background: "var(--acc)", animation: "pulseDot 1s ease infinite", flex: "none" }} />}
            {plainBusy ? "SIMPLIFYING" : view === "plain" ? "SIMPLIFIED ✓ · BACK TO EXPERT" : "SIMPLIFY"}
          </button>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {versions.length > 1 && versions.length <= 6 && versions.map((vn) => (
            <Link key={vn} href={`/sim/${simId}/report?v=${vn}`} style={{
              ...mono, fontSize: 8.5, letterSpacing: ".05em", padding: "3px 10px", borderRadius: 100,
              border: `1px solid ${vn === version ? "var(--acc)" : "var(--ln4)"}`,
              color: vn === version ? "var(--acc)" : "var(--t6)",
              background: vn === version ? "var(--acc-dim)" : "transparent",
            }}>
              V{vn}
            </Link>
          ))}
          {versions.length > 6 && (
            /* twenty versions would mean twenty pills — past six, a picker */
            <select
              value={version}
              onChange={(e) => (window.location.href = `/sim/${simId}/report?v=${e.target.value}`)}
              aria-label="Open a report version"
              style={{ ...mono, fontSize: 9, letterSpacing: ".05em", padding: "4px 8px", borderRadius: 8, background: "var(--sf2)", border: "1px solid var(--ln4)", color: "var(--acc)", cursor: "pointer" }}
            >
              {versions.map((vn) => <option key={vn} value={vn}>V{vn}{vn === versions[0] ? " · LATEST" : ""}</option>)}
            </select>
          )}
          <span style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: "var(--t7)" }}>
            {versions.length > 1 ? "· " : `REPORT V${version} · `}SYNTHETIC & DIRECTIONAL
          </span>
        </span>
      </div>

      {plainErr && <div style={{ ...mono, fontSize: 10, color: "var(--warn)", marginTop: 10 }}>{plainErr}</div>}

      <FileRail files={files} />

      {/* C4: while the translation pass runs, the page becomes a shimmer
          skeleton of the simplified layout — never the OS busy cursor alone */}
      {plainBusy && (() => {
        const shim: CSSProperties = {
          background: "linear-gradient(90deg, var(--sf2) 25%, var(--ln2) 50%, var(--sf2) 75%)",
          backgroundSize: "400px 100%", animation: "shim 1.2s linear infinite",
        };
        return (
          <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 14, animation: "fadeUp .2s ease both" }}>
            <div style={{ ...mono, fontSize: 9, letterSpacing: ".1em", color: "var(--t6)", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: 100, background: "var(--acc)", animation: "pulseDot 1s ease infinite" }} />
              TRANSLATING FOR A NON-TECHNICAL READER — SAME ANSWERS, SAME NUMBERS…
            </div>
            <div style={{ ...shim, height: 34, width: "58%", borderRadius: 10 }} />
            <div style={{ ...shim, height: 90, maxWidth: 860, borderRadius: 14 }} />
            <div style={{ display: "flex", gap: 12, maxWidth: 860 }}>
              {[0, 1, 2].map((i) => <div key={i} style={{ ...shim, height: 120, flex: 1, borderRadius: 14 }} />)}
            </div>
            <div style={{ ...shim, height: 70, maxWidth: 860, borderRadius: 14 }} />
          </div>
        );
      })()}

      {plainBusy ? null : showPlain ? (
        <PlainBody spec={spec} plain={plain!} problem={problem} onExpert={() => setView("expert")} mediaUrls={mediaUrls} />
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
                      // maxWidth + wrapping: ranking entries ("#1 item — reason")
                      // ride here too — text must never clip mid-word
                      <span key={ni} style={{ border: "1px solid var(--ln3)", borderRadius: 10, padding: "6px 12px", background: "var(--sf2)", maxWidth: 420 }}>
                        <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".08em", color: "var(--t6)", display: "block" }}>{n.label.toUpperCase()}</span>
                        <span style={{ ...mono, fontSize: n.value.length > 44 ? 11 : 13, lineHeight: 1.5, color: "var(--t1)", overflowWrap: "anywhere" }}>{n.value}</span>
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

          {/* 6-PR4 — the answer's artifacts (ranked list / matrix / comparison) */}
          {(spec.blocks?.length ?? 0) > 0 && <BlocksSection blocks={spec.blocks!} onJump={jump} />}

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

          {/* PR-A — decision-critical uploads, shown not just cited */}
          {(spec.media?.length ?? 0) > 0 && <KeyMaterials media={spec.media!} urls={mediaUrls} />}

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
                  {(sct.numbers?.length ?? 0) > 0 && (() => {
                    // field fix: stat chips clipped an 11-item ranking mid-word —
                    // short figures stay chips; list entries (rankings, ordered
                    // items) render as full-width rows that WRAP
                    const stats = sct.numbers!.filter((n) => n.value.length <= 44);
                    const rows = sct.numbers!.filter((n) => n.value.length > 44);
                    return (
                      <>
                        {stats.length > 0 && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                            {stats.map((n, ni) => (
                              <span key={ni} style={{ border: "1px solid var(--ln3)", borderRadius: 10, padding: "6px 12px", background: "var(--sf2)" }}>
                                <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".08em", color: "var(--t6)", display: "block" }}>{n.label.toUpperCase()}</span>
                                <span style={{ ...mono, fontSize: 13, color: "var(--t1)" }}>{n.value}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {rows.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                            {rows.map((n, ni) => (
                              <div key={ni} style={{ display: "flex", alignItems: "baseline", gap: 12, border: "1px solid var(--ln3)", borderRadius: 10, padding: "9px 14px", background: "var(--sf2)" }}>
                                <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--acc)", flex: "none" }}>{n.label.toUpperCase()}</span>
                                <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t2)", minWidth: 0 }}>{n.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.7, color: sct.answer ? "var(--t4)" : "var(--t3)" }}>{sct.finding}</p>
                </div>
              ))}
            </div>
          </div>

          {/* crowd sentiment — scrub the rounds, watch the crowd move.
              6-PR3: adaptive plans get one slider PER ANGLE, so every trend's
              percentages share a single referent question */}
          {(spec.sentiment?.length ?? 0) >= 2 && (
            <div style={{ marginTop: 34 }}>
              <div style={label}>CROWD SENTIMENT · SCRUB THE ROUNDS</div>
              {sentimentGroups(spec).map((g) => (
                <div key={g.key} style={{ marginTop: 6 }}>
                  {sentimentGroups(spec).length > 1 && (
                    <div style={{ ...mono, fontSize: 9, letterSpacing: ".09em", color: "var(--acc)", marginTop: 12 }}>
                      {g.key.toUpperCase()}{g.entries.length === 1 ? " · ONE ROUND" : ""}
                    </div>
                  )}
                  <SentimentSlider sentiment={g.entries} question={g.question} stances={g.stances} />
                </div>
              ))}
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

          {/* 3d — web sources: the deduped URLs the panel actually pulled */}
          {(spec.web_sources?.length ?? 0) > 0 && (
            <div style={{ marginTop: 36 }}>
              <div style={label}>WEB SOURCES · WHAT THE PANEL PULLED FROM THE LIVE WEB</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, maxWidth: 860 }}>
                {spec.web_sources!.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--ln1)", textDecoration: "none", minWidth: 0 }}>
                    <span style={{ ...mono, fontSize: 8, color: "var(--acc)", flex: "none" }}>↗</span>
                    <span style={{ fontSize: 12.5, color: "var(--t3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
                    <span style={{ ...mono, fontSize: 8, letterSpacing: ".03em", color: "var(--t7)", flex: "none" }}>
                      {(() => { try { return new URL(s.url).hostname.replace(/^www\./, "").toUpperCase(); } catch { return ""; } })()}
                      {s.uses > 1 ? ` · ×${s.uses}` : ""}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* methodology & limitations */}
          <div style={{ marginTop: 40, padding: "18px 22px", border: "1px solid var(--ln2)", borderRadius: 14, background: "var(--sf2)" }}>
            <div style={label}>METHODOLOGY & LIMITATIONS</div>
            <p style={{ margin: "10px 0 0", fontSize: 12, lineHeight: 1.7, color: "var(--t5)" }}>
              {m.mode} deliberation · {m.leads} leads + {m.crowd} crowd · {m.rounds} round cap · {m.posts} posts · {m.polls} member-polls · {m.tier} tier ({m.models.join(", ")}) ·
              {(m.tools?.length ?? 0) > 0 ? ` tools enabled: ${m.tools!.join(", ")} (${spec.tool_calls ?? 0} calls) · ` : " no agent tools enabled · "}
              {m.docs.length ? ` grounded in: ${m.docs.join(", ")} · ` : " no documents attached · "}
              generated {new Date(m.generated_at).toLocaleString()}
            </p>
            {/* 6-PR4 — the completeness judge's receipt: an honest instrument
                says whether the answer was CHECKED against the brief */}
            {spec.judge && (
              <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.7, color: spec.judge.pass || spec.judge.fixed > 0 ? "var(--t5)" : "var(--warn)" }}>
                <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>ANSWER-COMPLETENESS JUDGE · </span>
                {spec.judge.pass
                  ? "passed — every sub-ask answered, every required artifact complete"
                  : spec.judge.fixed > 0
                  ? `flagged ${spec.judge.notes?.length ?? 0} gap${(spec.judge.notes?.length ?? 0) > 1 ? "s" : ""}; ${spec.judge.fixed} piece${spec.judge.fixed > 1 ? "s" : ""} repaired before delivery`
                  : `flagged gaps the repair pass could not close: ${(spec.judge.notes ?? []).slice(0, 3).join("; ")}`}
              </p>
            )}
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
                          <div style={{ margin: "7px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t3)", display: "flex", flexDirection: "column", gap: 6 }}>
                            <Markdown text={p.content} />
                          </div>
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
