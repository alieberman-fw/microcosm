"use client";

/**
 * Home: for new users, a getting-started checklist (computed from real
 * activity; clearable, re-enabled from Settings). Once there's activity it
 * becomes a proper overview dashboard — stat tiles, a 14-day activity strip,
 * in-progress runs, recent simulations, latest reports, your personas, and
 * recent conversations. All in the demo's stat-tile / card grammar (§10).
 */

import { CSSProperties, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PersonaSpec } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export interface HomeConversation {
  id: string;
  title: string;
  participants: number;
  messages: number;
  updated_at: string;
}

export interface HomePersona {
  id: string;
  kind: string;
  spec: PersonaSpec;
}

export interface HomeSim {
  id: string;
  problem: string;
  status: string;
  mode: string | null;
  posts: number;
  created_at: string;
}

export interface HomeReport {
  sim_id: string;
  label: string;
  tone: string;
  headline: string;
  created_at: string;
}

export interface HomeStats {
  sims: number;
  runs: number;
  reports: number;
  personas: number;
  conversations: number;
  calls14: number;
  tokens14: number;
}

export interface HomeActivityDay {
  day: string;    // YYYY-MM-DD
  calls: number;
  tokens: number;
}

export interface HomeSeries {
  day: string;    // YYYY-MM-DD
  value: number;
}

export interface ChecklistState {
  conversation: boolean;
  group: boolean;
  persona: boolean;
  search: boolean;
  attachment: boolean;
  simulate: boolean;
}

function timeAgo(ts: string) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n));

const toneColor = (t: string) => (t === "go" ? "var(--acc)" : t === "split" ? "var(--t4)" : "var(--warn)");

const STEPS: { key: keyof ChecklistState; title: string; desc: string; href: string; cta: string }[] = [
  { key: "conversation", title: "Start your first conversation", desc: "Open a direct line to any of 1,800+ built-world personas.", href: "/conversations/new", cta: "BUILD THE ROOM →" },
  { key: "search", title: "Search the library in plain language", desc: "Try “looking to build a data center” or “under 40 homeowner”.", href: "/personas", cta: "OPEN LIBRARY →" },
  { key: "group", title: "Assemble a group chat", desc: "Put a lender, an engineer, and a skeptic in one room — direct with @mentions.", href: "/conversations/new", cta: "PICK A PANEL →" },
  { key: "persona", title: "Create or remix a persona", desc: "Remix any library expert into your own, or write one from scratch.", href: "/personas", cta: "REMIX SOMEONE →" },
  { key: "attachment", title: "Attach a plan or PDF", desc: "Drop a site plan into a chat — experts analyze the actual file.", href: "/conversations", cta: "OPEN A CHAT →" },
  { key: "simulate", title: "Run your first simulation", desc: "Brief → corpus → cast → live deliberation → decision-grade report.", href: "/sim/new", cta: "OPEN THE BRIEF COMPOSER →" },
];

/** small day-bar chart used by every 30-day series card: hover pins the day,
 *  the whole strip clicks through — one visual language across the dashboard */
function MiniBars({ data, unit, href, onNavigate }: {
  data: HomeSeries[];
  unit: string;
  href: string;
  onNavigate: (href: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: hover !== null ? "var(--acc)" : "var(--t7)", marginTop: 10, minHeight: 14 }}>
        {hover !== null
          ? `${data[hover].day.slice(5).replace("-", "/")} · ${data[hover].value.toLocaleString()} ${unit}`
          : `${total.toLocaleString()} ${unit} · 30 DAYS`}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56, marginTop: 8 }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const hot = hover === i;
          return (
            <div
              key={d.day}
              onMouseEnter={() => setHover(i)}
              onClick={() => onNavigate(href)}
              style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", cursor: "pointer" }}
            >
              <div style={{
                height: `${Math.max(d.value > 0 ? 8 : 3, (d.value / max) * 100)}%`,
                borderRadius: 2,
                background: d.value > 0 ? "var(--acc)" : "var(--sf2)",
                opacity: hot ? 1 : d.value > 0 ? 0.35 + 0.55 * (d.value / max) : 1,
                transition: "opacity .12s",
                animation: "grow .6s ease both", transformOrigin: "bottom",
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", color: "var(--t7)" }}>{data[0]?.day.slice(5).replace("-", "/")}</span>
        <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".05em", color: "var(--t7)" }}>{data[data.length - 1]?.day.slice(5).replace("-", "/")}</span>
      </div>
    </div>
  );
}

const VERDICT_ORDER: { key: string; label: string; color: string }[] = [
  { key: "go", label: "GO", color: "var(--acc)" },
  { key: "conditional", label: "CONDITIONAL", color: "var(--warn)" },
  { key: "no-go", label: "NO-GO", color: "var(--warn)" },
  { key: "split", label: "SPLIT", color: "var(--t5)" },
];

function SectionHead({ label, href, cta }: { label: string; href?: string; cta?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" }}>{label}</div>
      {href && cta && <Link href={href} style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--acc)" }}>{cta}</Link>}
    </div>
  );
}

export default function HomeClient({
  email, checklist, hideChecklist, conversations, personas, sims, reports, stats, activity,
  sims30 = [], msgs30 = [], verdictMix = {}, modeMix = [],
}: {
  email: string;
  checklist: ChecklistState;
  hideChecklist: boolean;
  conversations: HomeConversation[];
  personas: HomePersona[];
  sims: HomeSim[];
  reports: HomeReport[];
  stats: HomeStats;
  activity: HomeActivityDay[];
  sims30?: HomeSeries[];
  msgs30?: HomeSeries[];
  verdictMix?: Record<string, number>;
  modeMix?: { mode: string; count: number }[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [hidden, setHidden] = useState(hideChecklist);
  const [metric, setMetric] = useState<"calls" | "tokens">("calls");
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const doneCount = Object.values(checklist).filter(Boolean).length;
  const hasActivity = checklist.conversation || checklist.persona || checklist.simulate;
  const firstName = email.split("@")[0].split(/[._-]/)[0];
  const inProgress = sims.filter((s) => s.status === "running");
  const maxVal = Math.max(1, ...activity.map((d) => d[metric]));

  const clearChecklist = async () => {
    setHidden(true);
    const { data: { user } } = await supabase!.auth.getUser();
    if (user) await supabase!.from("users").update({ prefs: { hide_onboarding: true } }).eq("id", user.id);
  };

  const tiles: { label: string; value: string; sub: string; href: string }[] = [
    { label: "SIMULATIONS", value: String(stats.sims), sub: `${inProgress.length ? `${inProgress.length} RUNNING · ` : ""}${stats.runs} COMPLETE`, href: "/dashboard" },
    { label: "REPORTS", value: String(stats.reports), sub: "DECISION-GRADE, FOREVER", href: "/reports" },
    { label: "YOUR PERSONAS", value: String(stats.personas), sub: "CUSTOM + REMIXED", href: "/personas" },
    { label: "CONVERSATIONS", value: String(stats.conversations), sub: "ROOMS & 1:1S", href: "/conversations" },
    { label: "MODEL CALLS · 14D", value: fmtK(stats.calls14), sub: `${fmtK(stats.tokens14)} TOKENS`, href: "/monitoring" },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div className="kicker">Home</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>
        {hasActivity ? `Welcome back, ${firstName}` : "Welcome to Microcosm"}
      </h1>
      <p style={{ margin: "12px 0 0", maxWidth: 620, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
        {hasActivity
          ? "Your simulations, reports, rooms, and people — the whole operation at a glance."
          : "A rehearsal room for real estate's hardest decisions — start by talking to the people who live in it."}
      </p>

      {/* stat tiles — the operation at a glance (creation lives in the sidebar) */}
      {hasActivity && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 30 }}>
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className="card cardHoverQuiet" style={{ padding: "16px 18px", display: "block" }}>
              <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t6)" }}>{t.label}</div>
              <div style={{ ...mono, fontSize: 26, color: "var(--t0)", marginTop: 6 }}>{t.value}</div>
              <div style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)", marginTop: 4 }}>{t.sub}</div>
            </Link>
          ))}
        </div>
      )}

      {/* in-progress runs get top billing */}
      {inProgress.length > 0 && (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {inProgress.map((s) => (
            <Link key={s.id} href={`/sim/${s.id}/run`} className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", border: "1px solid var(--acc)", background: "var(--acc-dim)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite", flex: "none" }} />
              <span style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.problem}
              </span>
              <span style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".06em", color: "var(--acc)" }}>
                RUNNING{s.mode ? ` · ${s.mode.toUpperCase()}` : ""} — OPEN THE RUN →
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* 14-day activity — interactive: hover any bar for the day's numbers, toggle the metric */}
      {hasActivity && stats.calls14 > 0 && (
        <div className="card" style={{ marginTop: 20, padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" }}>ACTIVITY · LAST 14 DAYS</div>
            <span style={{ display: "inline-flex", gap: 5 }}>
              {(["calls", "tokens"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  style={{
                    ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "3px 10px", borderRadius: 100, cursor: "pointer",
                    background: metric === m ? "var(--acc-dim)" : "transparent",
                    border: `1px solid ${metric === m ? "var(--acc)" : "var(--ln4)"}`,
                    color: metric === m ? "var(--acc)" : "var(--t6)", transition: "all .15s",
                  }}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </span>
            <span style={{ ...mono, marginLeft: "auto", fontSize: 9, letterSpacing: ".06em", color: hoverDay !== null ? "var(--acc)" : "var(--t7)" }}>
              {hoverDay !== null
                ? `${activity[hoverDay].day.slice(5).replace("-", "/")} · ${activity[hoverDay].calls.toLocaleString()} CALLS · ${fmtK(activity[hoverDay].tokens)} TOKENS`
                : `${stats.calls14.toLocaleString()} CALLS · ${fmtK(stats.tokens14)} TOKENS`}
            </span>
            <Link href="/monitoring" style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--acc)" }}>MONITORING →</Link>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 84, marginTop: 16 }} onMouseLeave={() => setHoverDay(null)}>
            {activity.map((d, i) => {
              const hot = hoverDay === i;
              return (
                <div
                  key={d.day}
                  onMouseEnter={() => setHoverDay(i)}
                  onClick={() => router.push("/monitoring")}
                  style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", cursor: "pointer" }}
                >
                  <div style={{
                    height: `${Math.max(d[metric] > 0 ? 6 : 2, (d[metric] / maxVal) * 100)}%`,
                    borderRadius: 3,
                    background: d[metric] > 0 ? "var(--acc)" : "var(--sf2)",
                    opacity: hot ? 1 : d[metric] > 0 ? 0.35 + 0.55 * (d[metric] / maxVal) : 1,
                    outline: hot && d[metric] > 0 ? "1px solid var(--acc)" : "none",
                    transition: "opacity .12s, height .3s ease",
                    animation: "grow .6s ease both", transformOrigin: "bottom",
                  }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>{activity[0]?.day.slice(5).replace("-", "/")}</span>
            <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>EACH BAR = ONE DAY · CLICK THROUGH FOR THE CALL LOG</span>
            <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>{activity[activity.length - 1]?.day.slice(5).replace("-", "/")}</span>
          </div>
        </div>
      )}

      {/* trend charts: what you've been building and where it landed */}
      {hasActivity && (
        <div className="grid3" style={{ marginTop: 14, alignItems: "start" }}>
          <div className="card" style={{ padding: "20px 24px", minWidth: 0 }}>
            <SectionHead label="SIMULATIONS · 30 DAYS" href="/dashboard" cta="ALL →" />
            <MiniBars data={sims30} unit="CREATED" href="/dashboard" onNavigate={(h) => router.push(h)} />
          </div>
          <div className="card" style={{ padding: "20px 24px", minWidth: 0 }}>
            <SectionHead label="MESSAGES · 30 DAYS" href="/conversations" cta="OPEN →" />
            <MiniBars data={msgs30} unit="MESSAGES" href="/conversations" onNavigate={(h) => router.push(h)} />
          </div>
          <div className="card" style={{ padding: "20px 24px", minWidth: 0 }}>
            <SectionHead label="OUTCOMES · ALL REPORTS" href="/reports" cta="ALL →" />
            {(() => {
              const total = VERDICT_ORDER.reduce((s, v) => s + (verdictMix[v.key] ?? 0), 0);
              if (total === 0) {
                return (
                  <p style={{ margin: "12px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--t6)" }}>
                    No verdicts yet — every synthesized report lands its verdict here.
                  </p>
                );
              }
              return (
                <div>
                  {/* verdict mix — one stacked bar, the honest split of every call made */}
                  <div style={{ display: "flex", gap: 3, height: 10, borderRadius: 100, overflow: "hidden", marginTop: 14 }}>
                    {VERDICT_ORDER.filter((v) => (verdictMix[v.key] ?? 0) > 0).map((v) => (
                      <span
                        key={v.key}
                        title={`${v.label} · ${verdictMix[v.key]}`}
                        style={{ width: `${((verdictMix[v.key] ?? 0) / total) * 100}%`, background: v.color, opacity: v.key === "no-go" ? 0.55 : 1 }}
                      />
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 12 }}>
                    {VERDICT_ORDER.filter((v) => (verdictMix[v.key] ?? 0) > 0).map((v) => (
                      <div key={v.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: v.color, opacity: v.key === "no-go" ? 0.55 : 1, flex: "none" }} />
                        <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t5)", flex: 1 }}>{v.label}</span>
                        <span style={{ ...mono, fontSize: 9.5, color: "var(--t3)" }}>{verdictMix[v.key]}</span>
                        <span style={{ ...mono, fontSize: 8.5, color: "var(--t7)", width: 34, textAlign: "right" }}>{Math.round(((verdictMix[v.key] ?? 0) / total) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                  {modeMix.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--ln2)" }}>
                      <div style={{ ...mono, fontSize: 8, letterSpacing: ".1em", color: "var(--t7)" }}>MODES RUN</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                        {modeMix.slice(0, 5).map((m) => (
                          <span key={m.mode} style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", padding: "3px 9px", borderRadius: 100, border: "1px solid var(--ln4)", color: "var(--t5)" }}>
                            {m.mode.toUpperCase()} · {m.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* getting-started checklist */}
      {!hidden && (
        <div className="card" style={{ marginTop: 26, padding: "26px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--acc)" }}>
              GETTING STARTED · {doneCount}/{STEPS.length}
            </div>
            <button onClick={clearChecklist} style={{ ...mono, fontSize: 9, letterSpacing: ".08em", background: "none", border: "none", color: "var(--t7)", cursor: "pointer" }}>
              CLEAR — RE-ENABLE IN SETTINGS
            </button>
          </div>
          <div style={{ height: 6, borderRadius: 100, background: "var(--sf2)", overflow: "hidden", marginTop: 14 }}>
            <div style={{ height: "100%", width: `${(doneCount / STEPS.length) * 100}%`, borderRadius: 100, background: "var(--acc)", transformOrigin: "left", animation: "grow .6s ease both" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            {STEPS.map((s) => {
              const done = checklist[s.key];
              return (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderBottom: "1px solid var(--ln2)" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", flex: "none", border: `1px solid ${done ? "var(--acc)" : "var(--ln6)"}`, background: done ? "var(--acc)" : "transparent", color: "var(--acc-c)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                    {done ? "✓" : ""}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: done ? "var(--t5)" : "var(--t1)", textDecoration: done ? "line-through" : "none", textDecorationColor: "var(--t7)" }}>
                      {s.title}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--t6)", marginTop: 2 }}>{s.desc}</span>
                  </span>
                  {!done && <Link href={s.href} style={{ ...mono, flex: "none", fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)" }}>{s.cta}</Link>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* recent simulations — a real table (§10 grammar): scan, hover, click through */}
      <div className="card" style={{ marginTop: 26, padding: "24px 26px", overflow: "hidden" }}>
        <SectionHead label="RECENT SIMULATIONS" href="/dashboard" cta={sims.length > 0 ? "SEE ALL →" : undefined} />
        {sims.length === 0 ? (
          <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
            Nothing yet — <Link href="/sim/new" style={{ color: "var(--acc)" }}>state your first hard question</Link> and cast the room.
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  {["THE QUESTION", "STATUS", "MODE", "POSTS", "WHEN", ""].map((h, i) => (
                    <th key={h || "go"} style={{
                      ...mono, textAlign: i >= 3 && i <= 4 ? "right" : "left", fontSize: 8.5, letterSpacing: ".1em",
                      color: "var(--t7)", fontWeight: 500, padding: "8px 10px 8px 0",
                      borderBottom: "1px solid var(--ln3)",
                      width: i === 0 ? "auto" : i === 1 ? 96 : i === 2 ? 96 : i === 3 ? 58 : i === 4 ? 68 : 64,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sims.map((s) => (
                  <tr
                    key={s.id}
                    className="homeRow"
                    onClick={() => router.push(`/sim/${s.id}`)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ padding: "12px 10px 12px 0", borderBottom: "1px solid var(--ln2)", fontSize: 13, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.problem}
                    </td>
                    <td style={{ padding: "12px 10px 12px 0", borderBottom: "1px solid var(--ln2)" }}>
                      <span style={{
                        ...mono, fontSize: 8, letterSpacing: ".06em", padding: "2px 8px", borderRadius: 100, whiteSpace: "nowrap",
                        border: `1px solid ${s.status === "complete" || s.status === "running" ? "var(--acc)" : "var(--ln5)"}`,
                        color: s.status === "complete" || s.status === "running" ? "var(--acc)" : "var(--t6)",
                        background: s.status === "running" ? "var(--acc-dim)" : "transparent",
                      }}>
                        {s.status === "complete" ? "RAN" : s.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...mono, padding: "12px 10px 12px 0", borderBottom: "1px solid var(--ln2)", fontSize: 10, letterSpacing: ".05em", color: "var(--t5)", whiteSpace: "nowrap" }}>
                      {s.mode ? s.mode.toUpperCase() : "—"}
                    </td>
                    <td style={{ ...mono, padding: "12px 10px 12px 0", borderBottom: "1px solid var(--ln2)", fontSize: 10.5, color: "var(--t4)", textAlign: "right" }}>
                      {s.posts > 0 ? s.posts : "—"}
                    </td>
                    <td style={{ ...mono, padding: "12px 10px 12px 0", borderBottom: "1px solid var(--ln2)", fontSize: 9, letterSpacing: ".04em", color: "var(--t7)", textAlign: "right", whiteSpace: "nowrap" }}>
                      {timeAgo(s.created_at).toUpperCase()}
                    </td>
                    <td style={{ padding: "12px 0", borderBottom: "1px solid var(--ln2)", textAlign: "right" }}>
                      <span className="rowGo" style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--acc)", whiteSpace: "nowrap" }}>
                        OPEN →
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* reports · personas · conversations — three lanes, every child clamped */}
      <div className="grid3" style={{ marginTop: 14, alignItems: "start" }}>
        <div className="card" style={{ padding: "24px 26px", minWidth: 0 }}>
          <SectionHead label="LATEST REPORTS" href="/reports" cta={reports.length > 0 ? "ALL →" : undefined} />
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8, minWidth: 0 }}>
            {reports.length === 0 && (
              <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
                None yet — run a simulation, then hit “Synthesize the report” on the run screen.
              </p>
            )}
            {reports.map((r, i) => (
              <Link key={`${r.sim_id}-${i}`} href={`/sim/${r.sim_id}/report`} style={{ display: "block", padding: "12px 0", borderBottom: "1px solid var(--ln2)", minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "3px 10px", borderRadius: 100, border: `1px solid ${toneColor(r.tone)}`, color: toneColor(r.tone), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {r.label}
                  </span>
                </span>
                <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 12, lineHeight: 1.55, color: "var(--t5)", marginTop: 7 }}>
                  {r.headline}
                </span>
                <span style={{ ...mono, display: "block", fontSize: 8, letterSpacing: ".06em", color: "var(--t7)", marginTop: 5 }}>
                  {timeAgo(r.created_at).toUpperCase()}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "24px 26px", minWidth: 0 }}>
          <SectionHead label="YOUR PERSONAS" href="/personas" cta="LIBRARY →" />
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8, minWidth: 0 }}>
            {personas.length === 0 && (
              <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
                None yet — remix a library expert to make them yours.
              </p>
            )}
            {personas.map((p) => (
              <Link key={p.id} href={`/conversations?with=${p.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--ln2)", minWidth: 0 }}>
                <span style={{ ...mono, width: 28, height: 28, borderRadius: "50%", flex: "none", background: "var(--acc-dim)", border: "1px solid var(--acc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, color: "var(--acc)" }}>
                  {p.spec.initials}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.spec.name}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.spec.role}</span>
                </span>
                {(p.spec.lineage?.length ?? 0) > 0 && (
                  <span style={{ ...mono, flex: "none", fontSize: 8, letterSpacing: ".06em", color: "var(--acc)" }}>⑂</span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "24px 26px", minWidth: 0 }}>
          <SectionHead label="RECENT CONVERSATIONS" href="/conversations/history" cta={conversations.length > 0 ? "ALL →" : undefined} />
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8, minWidth: 0 }}>
            {conversations.length === 0 && (
              <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
                Nothing yet — <Link href="/conversations/new" style={{ color: "var(--acc)" }}>build your first room</Link> and ask a hard question.
              </p>
            )}
            {conversations.slice(0, 5).map((c) => (
              <Link key={c.id} href={`/conversations?open=${c.id}`} style={{ display: "block", padding: "11px 0", borderBottom: "1px solid var(--ln2)", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.title}
                </span>
                <span style={{ ...mono, display: "block", fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)", marginTop: 3 }}>
                  {c.participants} IN · {c.messages} MSGS · {timeAgo(c.updated_at).toUpperCase()}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
