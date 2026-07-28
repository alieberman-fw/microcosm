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

function QuickAction({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href} className="card cardHoverQuiet" style={{ padding: "20px 22px", display: "block" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div style={{ ...mono, marginTop: 6, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)" }}>{sub}</div>
    </Link>
  );
}

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
}) {
  const supabase = createClient();
  const [hidden, setHidden] = useState(hideChecklist);
  const doneCount = Object.values(checklist).filter(Boolean).length;
  const hasActivity = checklist.conversation || checklist.persona || checklist.simulate;
  const firstName = email.split("@")[0].split(/[._-]/)[0];
  const inProgress = sims.filter((s) => s.status === "running");
  const maxCalls = Math.max(1, ...activity.map((d) => d.calls));

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

      {/* quick actions */}
      <div className="grid4" style={{ marginTop: 30 }}>
        <QuickAction href="/sim/new" title="Start a simulation" sub="BRIEF → CAST → RUN → REPORT" />
        <QuickAction href="/conversations/new" title="New conversation" sub="1:1 OR A ROOM OF 20" />
        <QuickAction href="/personas" title="Browse the library" sub="1,800+ PERSONAS" />
        <QuickAction href="/reports" title="Read your reports" sub="VERDICTS & DISSENTS" />
      </div>

      {/* stat tiles — the operation at a glance */}
      {hasActivity && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 26 }}>
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

      {/* 14-day activity strip */}
      {hasActivity && stats.calls14 > 0 && (
        <div className="card" style={{ marginTop: 20, padding: "20px 24px" }}>
          <SectionHead label="ACTIVITY · LAST 14 DAYS" href="/monitoring" cta="FULL DETAIL IN MONITORING →" />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 74, marginTop: 16 }}>
            {activity.map((d) => (
              <div
                key={d.day}
                title={`${d.day} · ${d.calls.toLocaleString()} calls · ${fmtK(d.tokens)} tokens`}
                style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", cursor: "default" }}
              >
                <div style={{
                  height: `${Math.max(d.calls > 0 ? 6 : 2, (d.calls / maxCalls) * 100)}%`,
                  borderRadius: 3,
                  background: d.calls > 0 ? "var(--acc)" : "var(--sf2)",
                  opacity: d.calls > 0 ? 0.4 + 0.6 * (d.calls / maxCalls) : 1,
                  animation: "grow .6s ease both", transformOrigin: "bottom",
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>{activity[0]?.day.slice(5).replace("-", "/")}</span>
            <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>
              {stats.calls14.toLocaleString()} MODEL CALLS · {fmtK(stats.tokens14)} TOKENS
            </span>
            <span style={{ ...mono, fontSize: 8, letterSpacing: ".06em", color: "var(--t7)" }}>{activity[activity.length - 1]?.day.slice(5).replace("-", "/")}</span>
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

      {/* recent work */}
      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginTop: 26, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "24px 26px" }}>
            <SectionHead label="RECENT SIMULATIONS" href="/dashboard" cta={sims.length > 0 ? "SEE ALL →" : undefined} />
            <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
              {sims.length === 0 && (
                <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
                  Nothing yet — <Link href="/sim/new" style={{ color: "var(--acc)" }}>state your first hard question</Link> and cast the room.
                </p>
              )}
              {sims.map((s) => (
                <Link key={s.id} href={`/sim/${s.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--ln2)" }}>
                  <span style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.problem}
                  </span>
                  <span style={{ ...mono, flex: "none", fontSize: 8.5, letterSpacing: ".05em", padding: "2px 9px", borderRadius: 100, border: `1px solid ${s.status === "complete" ? "var(--acc)" : s.status === "running" ? "var(--acc)" : "var(--ln5)"}`, color: s.status === "complete" || s.status === "running" ? "var(--acc)" : "var(--t6)" }}>
                    {s.status === "complete" ? `RAN · ${s.mode?.toUpperCase() ?? ""} · ${s.posts}P` : s.status.toUpperCase()}
                  </span>
                  <span style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".05em", color: "var(--t7)", width: 58, textAlign: "right" }}>
                    {timeAgo(s.created_at).toUpperCase()}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: "24px 26px" }}>
            <SectionHead label="RECENT CONVERSATIONS" href="/conversations/history" cta={conversations.length > 0 ? "SEE ALL →" : undefined} />
            <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
              {conversations.length === 0 && (
                <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
                  Nothing yet — <Link href="/conversations/new" style={{ color: "var(--acc)" }}>build your first room</Link> and ask a hard question.
                </p>
              )}
              {conversations.map((c) => (
                <Link key={c.id} href={`/conversations?open=${c.id}`} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--ln2)" }}>
                  <span style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.title}
                  </span>
                  <span style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".05em", color: "var(--t7)" }}>
                    {c.participants} IN · {c.messages} MSGS · {timeAgo(c.updated_at).toUpperCase()}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "24px 26px" }}>
            <SectionHead label="LATEST REPORTS" href="/reports" cta={reports.length > 0 ? "ALL REPORTS →" : undefined} />
            <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
              {reports.length === 0 && (
                <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
                  None yet — run a simulation, then hit “Synthesize the report” on the run screen.
                </p>
              )}
              {reports.map((r, i) => (
                <Link key={`${r.sim_id}-${i}`} href={`/sim/${r.sim_id}/report`} style={{ display: "block", padding: "12px 0", borderBottom: "1px solid var(--ln2)" }}>
                  <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "3px 10px", borderRadius: 100, border: `1px solid ${toneColor(r.tone)}`, color: toneColor(r.tone) }}>
                    {r.label}
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

          <div className="card" style={{ padding: "24px 26px" }}>
            <SectionHead label="YOUR PERSONAS" href="/personas" cta="LIBRARY →" />
            <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
              {personas.length === 0 && (
                <p style={{ margin: "14px 0 4px", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
                  None yet — remix a library expert to make them yours.
                </p>
              )}
              {personas.map((p) => (
                <Link key={p.id} href={`/conversations?with=${p.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--ln2)" }}>
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
        </div>
      </div>
    </div>
  );
}
