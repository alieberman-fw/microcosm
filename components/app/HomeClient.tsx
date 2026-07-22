"use client";

/**
 * Home: for new users, a getting-started checklist (computed from real
 * activity; clearable, re-enabled from Settings); once there's activity, a
 * recent-activity dashboard — conversations, custom personas, simulations &
 * reports — plus quick actions.
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

const STEPS: { key: keyof ChecklistState; title: string; desc: string; href: string; cta: string; soon?: boolean }[] = [
  { key: "conversation", title: "Start your first conversation", desc: "Open a direct line to any of 1,800+ built-world personas.", href: "/conversations/new", cta: "BUILD THE ROOM →" },
  { key: "search", title: "Search the library in plain language", desc: "Try “looking to build a data center” or “under 40 homeowner”.", href: "/personas", cta: "OPEN LIBRARY →" },
  { key: "group", title: "Assemble a group chat", desc: "Put a lender, an engineer, and a skeptic in one room — direct with @mentions.", href: "/conversations/new", cta: "PICK A PANEL →" },
  { key: "persona", title: "Create or remix a persona", desc: "Remix any library expert into your own, or write one from scratch.", href: "/personas", cta: "REMIX SOMEONE →" },
  { key: "attachment", title: "Attach a plan or PDF", desc: "Drop a site plan into a chat — experts analyze the actual file.", href: "/conversations", cta: "OPEN A CHAT →" },
  { key: "simulate", title: "Open your first simulation brief", desc: "State the problem, attach the diligence docs, and get cited answers from the corpus.", href: "/sim/new", cta: "OPEN THE BRIEF COMPOSER →" },
];

function QuickAction({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href} className="card cardHoverQuiet" style={{ padding: "20px 22px", display: "block" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div style={{ ...mono, marginTop: 6, fontSize: 9.5, letterSpacing: ".06em", color: "var(--t6)" }}>{sub}</div>
    </Link>
  );
}

export default function HomeClient({
  email, checklist, hideChecklist, conversations, personas,
}: {
  email: string;
  checklist: ChecklistState;
  hideChecklist: boolean;
  conversations: HomeConversation[];
  personas: HomePersona[];
}) {
  const supabase = createClient();
  const [hidden, setHidden] = useState(hideChecklist);
  const doneCount = Object.values(checklist).filter(Boolean).length;
  const hasActivity = checklist.conversation || checklist.persona;
  const firstName = email.split("@")[0].split(/[._-]/)[0];

  const clearChecklist = async () => {
    setHidden(true);
    const { data: { user } } = await supabase!.auth.getUser();
    if (user) await supabase!.from("users").update({ prefs: { hide_onboarding: true } }).eq("id", user.id);
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div className="kicker">Home</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>
        {hasActivity ? `Welcome back, ${firstName}` : "Welcome to Microcosm"}
      </h1>
      <p style={{ margin: "12px 0 0", maxWidth: 620, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
        {hasActivity
          ? "Your rooms, your people, and everything they've been telling you."
          : "A rehearsal room for real estate's hardest decisions — start by talking to the people who live in it."}
      </p>

      {/* quick actions */}
      <div className="grid4" style={{ marginTop: 30 }}>
        <QuickAction href="/conversations/new" title="New conversation" sub="1:1 OR A ROOM OF 20" />
        <QuickAction href="/personas" title="Browse the library" sub="1,800+ PERSONAS" />
        <QuickAction href="/sim/new" title="Start a simulation" sub="BRIEF → CORPUS → CITED ANSWERS" />
        <QuickAction href="/sim/demo" title="Watch the demo run" sub="SITE 47-A REPLAY" />
      </div>

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
                  {s.soon ? (
                    <span style={{ display: "flex", gap: 8, alignItems: "center", flex: "none" }}>
                      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t7)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "3px 8px" }}>SOON</span>
                      <Link href={s.href} style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)" }}>{s.cta}</Link>
                    </span>
                  ) : (
                    !done && <Link href={s.href} style={{ ...mono, flex: "none", fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)" }}>{s.cta}</Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* recent activity */}
      <div className="splitCol" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginTop: 26, alignItems: "start" }}>
        <div className="card" style={{ padding: "24px 26px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" }}>RECENT CONVERSATIONS</div>
            {conversations.length > 0 && (
              <Link href="/conversations/history" style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--acc)" }}>SEE ALL →</Link>
            )}
          </div>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "24px 26px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" }}>YOUR PERSONAS</div>
              <Link href="/personas" style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--acc)" }}>LIBRARY →</Link>
            </div>
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

          <div className="card" style={{ padding: "24px 26px" }}>
            <div style={{ ...mono, fontSize: 10, letterSpacing: ".12em", color: "var(--t6)" }}>SIMULATIONS & REPORTS</div>
            <p style={{ margin: "14px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--t6)" }}>
              The full loop — brief, casting, live deliberation, decision-grade report — is next on the build.
              Until then, <Link href="/sim/demo" style={{ color: "var(--acc)" }}>watch the Site 47-A replay</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
