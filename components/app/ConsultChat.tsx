"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { LibraryPersona } from "@/lib/personas";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What would you look at first on my deal?",
  "What's the mistake people in my seat usually make?",
  "What would change your mind?",
];

export default function ConsultChat({ personas, initialKey }: { personas: LibraryPersona[]; initialKey?: string }) {
  const [activeKey, setActiveKey] = useState(initialKey ?? personas[0]?.key);
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const persona = personas.find((p) => p.key === activeKey) ?? personas[0];
  const thread = threads[persona?.key ?? ""] ?? [];

  useEffect(() => {
    const f = feedRef.current;
    if (f) f.scrollTop = f.scrollHeight;
  }, [thread.length, busy]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy || !persona) return;
    setInput("");
    setErr(null);
    const next = [...thread, { role: "user" as const, content }];
    setThreads({ ...threads, [persona.key]: next });
    setBusy(true);
    try {
      const res = await fetch("/api/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: {
            name: persona.name, initials: persona.initials, role: persona.role,
            kind: persona.kind, discipline: persona.discipline,
            backstory: persona.backstory, stances: persona.stances,
          },
          messages: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setThreads((t) => ({ ...t, [persona.key]: [...next, { role: "assistant", content: data.reply }] }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setThreads((t) => ({ ...t, [persona.key]: thread }));
      setInput(content);
    } finally {
      setBusy(false);
    }
  };

  if (!persona) {
    return <div style={{ padding: 60, textAlign: "center", color: "var(--t5)" }}>No personas available yet.</div>;
  }

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* persona picker */}
      <div style={{ width: 280, flex: "none", borderRight: "1px solid var(--ln2)", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
        <div style={{ padding: "26px 22px 14px" }}>
          <div className="kicker">Office Hours</div>
          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.55, color: "var(--t5)" }}>
            Pull one expert aside. Grounded in their background, on the record.
          </div>
          <div style={{ ...mono, marginTop: 14, fontSize: 8.5, letterSpacing: ".07em", color: "var(--t7)", border: "1px dashed var(--ln5)", borderRadius: 100, padding: "5px 10px", display: "inline-block" }}>
            GROUP SESSIONS · COMING WITH THE ENGINE
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 12px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
          {personas.map((p) => {
            const active = p.key === persona.key;
            return (
              <button
                key={p.key}
                onClick={() => { setActiveKey(p.key); setErr(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 11, textAlign: "left",
                  background: active ? "var(--acc-dim)" : "transparent",
                  border: `1px solid ${active ? "var(--acc)" : "transparent"}`,
                  borderRadius: 12, padding: "10px 12px", cursor: "pointer", transition: "background .15s",
                }}
              >
                <span style={{ ...mono, width: 32, height: 32, borderRadius: "50%", flex: "none", background: p.source === "custom" ? "var(--acc-dim)" : "var(--sf2)", border: `1px solid ${p.source === "custom" ? "var(--acc)" : "var(--ln5)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: p.source === "custom" ? "var(--acc)" : "var(--t3)" }}>
                  {p.initials}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: active ? "var(--t0)" : "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--t6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.role}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* chat */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: "none", padding: "18px 28px", borderBottom: "1px solid var(--ln2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span style={{ ...mono, width: 36, height: 36, borderRadius: "50%", flex: "none", background: "var(--sf2)", border: "1px solid var(--ln5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, color: "var(--t2)" }}>
              {persona.initials}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{persona.name}</div>
              <div style={{ fontSize: 12, color: "var(--t5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {persona.role}{persona.tagline ? ` · ${persona.tagline}` : ""}
              </div>
            </div>
          </div>
          <span style={{ ...mono, flex: "none", fontSize: 9, letterSpacing: ".06em", color: persona.kind === "adversarial" ? "var(--warn)" : "var(--t7)", border: `1px solid ${persona.kind === "adversarial" ? "var(--warn)" : "var(--ln5)"}`, borderRadius: 100, padding: "4px 10px" }}>
            {persona.source === "custom" ? "CUSTOM" : persona.kind === "adversarial" ? "ADVERSARIAL SEED" : "LIBRARY"}
          </span>
        </div>

        <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          {thread.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", maxWidth: 460 }}>
              <div style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: "var(--t6)" }}>THE FLOOR IS YOURS</div>
              <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.65, color: "var(--t5)" }}>
                Ask {persona.name.split(" ")[0]} anything in their lane — they answer from their background and stances, and they will tell you when they&apos;d need a document to answer properly.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="btnGhost" style={{ padding: "10px 18px", fontSize: 13, borderRadius: 12 }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {thread.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", animation: "fadeUp .3s ease both" }}>
              <div
                style={{
                  maxWidth: "76%", borderRadius: 14, padding: "12px 16px",
                  border: `1px solid ${m.role === "user" ? "var(--acc)" : "var(--ln4)"}`,
                  background: m.role === "user" ? "var(--acc-dim)" : "var(--sf)",
                }}
              >
                <div style={{ ...mono, fontSize: 9, letterSpacing: ".07em", color: m.role === "user" ? "var(--acc)" : "var(--t6)", marginBottom: 6 }}>
                  {m.role === "user" ? "YOU" : persona.name.toUpperCase()}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.62, color: "var(--t2)", whiteSpace: "pre-wrap" }}>{m.content}</div>
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ ...mono, fontSize: 11, color: "var(--t7)" }}>
              {persona.name} is thinking<span style={{ animation: "blink 1s step-end infinite" }}>…</span>
            </div>
          )}
          {err && (
            <div className="mono" style={{ fontSize: 11, borderRadius: 10, padding: "10px 14px", border: "1px solid var(--warn)", background: "var(--warn-dim)", color: "var(--warn)" }}>
              {err}
            </div>
          )}
        </div>

        <div style={{ flex: "none", padding: "16px 28px 22px", borderTop: "1px solid var(--ln2)" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={`Ask ${persona.name.split(" ")[0]}…`}
              style={{ flex: 1, boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 12, padding: "13px 16px", fontSize: 14, color: "var(--t1)", outline: "none" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
            />
            <button onClick={() => send()} disabled={busy || !input.trim()} className="btnAcc" style={{ padding: "13px 24px", fontSize: 14, borderRadius: 12, opacity: busy || !input.trim() ? 0.55 : 1 }}>
              Send
            </button>
          </div>
          <div style={{ ...mono, marginTop: 10, fontSize: 9, letterSpacing: ".06em", color: "var(--t7)" }}>
            SYNTHETIC EXPERT · GROUNDED IN PERSONA BACKGROUND · CONVERSATIONS ARE NOT YET SAVED
          </div>
        </div>
      </div>
    </div>
  );
}
