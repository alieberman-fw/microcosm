"use client";

/**
 * The interactive report (CLAUDE.md §2 Stage 5, demo Stage 04 grammar):
 * verdict chip, executive summary, stat tiles, dimension scores, findings
 * per question with POST citations that jump to the transcript, risk
 * register, preserved dissents, tripwires, methodology & limitations.
 * Never a wall of markdown — structured JSON rendered in tokens.
 */

import { CSSProperties, useState } from "react";
import Link from "next/link";
import { ReportSpec, VERDICT_STYLE } from "@/lib/report";
import { LivePost } from "@/components/app/LiveRun";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

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

export default function ReportView({
  simId, problem, spec, posts, version, versions = [],
}: {
  simId: string;
  problem: string;
  spec: ReportSpec;
  posts: LivePost[];
  version: number;
  versions?: number[];
}) {
  const [flash, setFlash] = useState<number | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
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
  const label: CSSProperties = { ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" };
  const m = spec.methodology;

  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: "POSTS", value: String(m.posts), sub: `${m.leads} LEADS · ${m.mode.toUpperCase()}` },
    { label: "CROWD POLLED", value: m.polls ? String(m.polls) : "—", sub: m.crowd ? `${m.crowd} MEMBERS` : "NO CROWD" },
    ...(spec.verification
      ? [{ label: "CLAIMS CHECKED", value: String(spec.verification.checks), sub: `${spec.verification.contradicted} CONTRADICTED` }]
      : []),
    { label: "CONVERGENCE", value: m.converged ? "REACHED" : "OPEN", sub: `${spec.dissents.length} DISSENT${spec.dissents.length === 1 ? "" : "S"} PRESERVED` },
  ];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 40px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Link href={`/sim/${simId}`} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>← WORKSPACE</Link>
        <Link href={`/sim/${simId}/run`} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)" }}>VIEW THE RUN →</Link>
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

      {/* verdict */}
      <div style={{ marginTop: 22 }}>
        <span style={{ ...mono, fontSize: 11, letterSpacing: ".1em", padding: "7px 16px", borderRadius: 100, border: `1px solid ${v.color}`, background: v.bg, color: v.color }}>
          {spec.verdict.label}
        </span>
        <h1 style={{ fontSize: "clamp(22px, 2.8vw, 32px)", fontWeight: 600, letterSpacing: "-.025em", lineHeight: 1.25, margin: "16px 0 0", maxWidth: 860 }}>
          {spec.verdict.headline}
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--t6)" }}>{problem}</p>
      </div>

      {/* executive summary */}
      <p style={{ margin: "22px 0 0", fontSize: 15, lineHeight: 1.75, color: "var(--t2)", maxWidth: 900 }}>{spec.executive_summary}</p>

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

      {/* findings per question */}
      <div style={{ marginTop: 36 }}>
        <div style={label}>FINDINGS · ONE PER QUESTION TO RESOLVE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}>
          {spec.sections.map((sct, i) => (
            <div key={i} className="card" style={{ padding: "20px 24px" }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--acc)" }}>
                {String(i + 1).padStart(2, "0")} · {sct.question.toUpperCase()}
                <CiteChips cites={sct.cites} onJump={jump} />
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.7, color: "var(--t3)" }}>{sct.finding}</p>
            </div>
          ))}
        </div>
      </div>

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
          onClick={() => setTranscriptOpen((v) => !v)}
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
    </div>
  );
}
