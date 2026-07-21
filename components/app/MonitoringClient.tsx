"use client";

/**
 * Monitoring: stat tiles, activity/spend charts, an app-area label per call,
 * a filter rail (area · model · status · search), and expandable rows that
 * pull the surrounding conversation context (what was asked, what the agent
 * replied) plus a deep link into the thread.
 */

import { CSSProperties, Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

/**
 * Estimated $/Mtok used ONLY for the on-screen spend estimate. Keep in sync
 * with the Anthropic pricing page; never used for billing (CLAUDE.md §6.4).
 */
const RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-opus-4-8": { in: 5, out: 25 },
};

export interface InteractionRow {
  id: number;
  surface: string;
  agent_name: string | null;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  status: string;
  error: string | null;
  created_at: string;
  conversation_id: string | null;
}

export interface ConvMeta { title: string; participants: number }

/** which part of the app a call came from, derived from its surface */
function areaOf(surface: string): string {
  if (surface.startsWith("conversation")) return "Conversations";
  if (surface.startsWith("library")) return "Agent Library";
  if (surface.startsWith("sim") || surface.startsWith("engine") || surface.startsWith("casting")) return "Simulations";
  return "Other";
}

function costOf(r: InteractionRow): number {
  const rate = RATES[r.model];
  if (!rate) return 0;
  return ((r.input_tokens ?? 0) / 1e6) * rate.in + ((r.output_tokens ?? 0) / 1e6) * rate.out;
}

function Tile({ k, v, sub, accent }: { k: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: "22px 24px", ...(accent ? { border: "1px solid var(--acc)", background: "var(--acc-dim)" } : {}) }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: accent ? "var(--acc)" : "var(--t6)" }}>{k}</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 600, letterSpacing: "-.02em" }}>{v}</div>
      {sub && <div style={{ ...mono, marginTop: 4, fontSize: 9.5, color: "var(--t7)" }}>{sub}</div>}
    </div>
  );
}

function PillGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t7)" }}>{label}</span>
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            onClick={() => onChange(on ? "ALL" : o)}
            style={{
              ...mono, fontSize: 9, letterSpacing: ".05em", padding: "6px 11px", borderRadius: 100, cursor: "pointer",
              border: `1px solid ${on ? "var(--acc)" : "var(--ln5)"}`,
              background: on ? "var(--acc-dim)" : "var(--sf2)",
              color: on ? "var(--acc)" : "var(--t5)", textTransform: "uppercase",
            }}
          >
            {o}
          </button>
        );
      })}
    </span>
  );
}

function BreakdownBar({ label, value, max, sub }: { label: string; value: number; max: number; sub: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, gap: 10 }}>
        <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".05em", color: "var(--t5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ ...mono, flex: "none", fontSize: 9.5, color: "var(--t6)" }}>{sub}</span>
      </div>
      <div style={{ height: 7, borderRadius: 100, background: "var(--sf2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${max ? Math.max(3, (value / max) * 100) : 0}%`, borderRadius: 100, background: "var(--acc)", transformOrigin: "left", animation: "grow .6s ease both" }} />
      </div>
    </div>
  );
}

interface Ctx { loading: boolean; asked?: string; replied?: string }

export default function MonitoringClient({ rows, conversations }: { rows: InteractionRow[]; conversations: Record<string, ConvMeta> }) {
  const supabase = createClient();
  const [area, setArea] = useState("ALL");
  const [model, setModel] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [ctx, setCtx] = useState<Record<number, Ctx>>({});

  const models = useMemo(() => [...new Set(rows.map((r) => r.model))], [rows]);
  const areas = useMemo(() => [...new Set(rows.map((r) => areaOf(r.surface)))], [rows]);

  const ql = q.trim().toLowerCase();
  const filtered = rows
    .filter((r) => area === "ALL" || areaOf(r.surface) === area)
    .filter((r) => model === "ALL" || r.model === model)
    .filter((r) => status === "ALL" || (status === "OK" ? r.status === "ok" : r.status !== "ok"))
    .filter((r) => !ql || [r.agent_name ?? "", r.surface, r.model, conversations[r.conversation_id ?? ""]?.title ?? ""].join(" ").toLowerCase().includes(ql));

  const calls = filtered.length;
  const tokIn = filtered.reduce((a, r) => a + (r.input_tokens ?? 0), 0);
  const tokOut = filtered.reduce((a, r) => a + (r.output_tokens ?? 0), 0);
  const errors = filtered.filter((r) => r.status !== "ok").length;
  const avgLatency = calls ? Math.round(filtered.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / calls) : 0;
  const cost = filtered.reduce((a, r) => a + costOf(r), 0);

  // charts (computed over the filtered set so the rail drives everything)
  const daily = useMemo(() => {
    const days: { key: string; label: string; calls: number; cost: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ key: d.toDateString(), label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), calls: 0, cost: 0 });
    }
    const ix = new Map(days.map((d, i) => [d.key, i]));
    filtered.forEach((r) => {
      const k = new Date(r.created_at).toDateString();
      const i = ix.get(k);
      if (i !== undefined) { days[i].calls++; days[i].cost += costOf(r); }
    });
    return days;
  }, [filtered]);
  const maxDaily = Math.max(1, ...daily.map((d) => d.calls));

  const byModel = useMemo(() => {
    const m = new Map<string, { calls: number; cost: number }>();
    filtered.forEach((r) => {
      const e = m.get(r.model) ?? { calls: 0, cost: 0 };
      e.calls++; e.cost += costOf(r);
      m.set(r.model, e);
    });
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [filtered]);

  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => m.set(areaOf(r.surface), (m.get(areaOf(r.surface)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const toggle = async (r: InteractionRow) => {
    const next = expanded === r.id ? null : r.id;
    setExpanded(next);
    if (next === null || !r.conversation_id || ctx[r.id]) return;
    setCtx((c) => ({ ...c, [r.id]: { loading: true } }));
    // the reply is inserted just before the interaction is logged, so both
    // the ask and the reply sit at-or-before the interaction timestamp
    const { data: before } = await supabase!
      .from("conversation_messages")
      .select("role, agent_name, content")
      .eq("conversation_id", r.conversation_id)
      .lte("created_at", r.created_at)
      .order("id", { ascending: false })
      .limit(6);
    const asked = (before ?? []).find((m) => m.role === "user")?.content as string | undefined;
    const replied = r.agent_name
      ? ((before ?? []).find((m) => m.role === "agent" && m.agent_name === r.agent_name)?.content as string | undefined)
      : undefined;
    setCtx((c) => ({ ...c, [r.id]: { loading: false, asked, replied } }));
  };

  const td: CSSProperties = { padding: "10px 16px", borderBottom: "1px solid var(--ln2)" };

  return (
    <div style={{ maxWidth: 1160, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div className="kicker">Monitoring</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>
        Every agent interaction, on the record
      </h1>
      <p style={{ margin: "12px 0 0", maxWidth: 620, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
        Each model call across the app is logged with tokens, latency, and status. Click any row for its full context — the conversation it belongs to and what was asked and answered.
      </p>

      {/* filter rail */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginTop: 28 }}>
        <PillGroup label="AREA" options={areas} value={area} onChange={setArea} />
        <PillGroup label="MODEL" options={models} value={model} onChange={setModel} />
        <PillGroup label="STATUS" options={["OK", "ERRORS"]} value={status} onChange={setStatus} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agent, surface, or conversation…"
          style={{ flex: 1, minWidth: 220, boxSizing: "border-box", background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "9px 18px", fontSize: 13, color: "var(--t1)", outline: "none" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--acc)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ln5)")}
        />
      </div>

      <div className="grid4" style={{ marginTop: 24 }}>
        <Tile k={`MODEL CALLS · LAST ${rows.length}`} v={String(calls)} sub={errors ? `${errors} ERRORS` : "NO ERRORS"} />
        <Tile k="TOKENS IN" v={tokIn.toLocaleString()} />
        <Tile k="TOKENS OUT" v={tokOut.toLocaleString()} />
        <Tile k="EST. SPEND" v={`$${cost.toFixed(2)}`} sub={`AVG LATENCY ${avgLatency}MS · ESTIMATE ONLY`} accent />
      </div>

      {/* charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 14, marginTop: 14 }} className="grid3charts">
        <div className="card" style={{ padding: "20px 22px" }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>ACTIVITY · LAST 14 DAYS</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 90, marginTop: 18 }}>
            {daily.map((d) => (
              <div key={d.key} title={`${d.label}: ${d.calls} calls · $${d.cost.toFixed(2)}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", cursor: "default" }}>
                <div style={{ height: `${Math.max(d.calls ? 6 : 2, (d.calls / maxDaily) * 100)}%`, borderRadius: 3, background: d.calls ? "var(--acc)" : "var(--ln3)", opacity: d.calls ? 0.9 : 1, animation: "grow .5s ease both" }} />
              </div>
            ))}
          </div>
          <div style={{ ...mono, display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 8.5, letterSpacing: ".06em", color: "var(--t7)" }}>
            <span>{daily[0]?.label.toUpperCase()}</span>
            <span>{daily[13]?.label.toUpperCase()}</span>
          </div>
        </div>
        <div className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>SPEND BY MODEL</div>
          {byModel.length === 0 && <span style={{ ...mono, fontSize: 10, color: "var(--t7)" }}>NO DATA</span>}
          {byModel.map(([m, v]) => (
            <BreakdownBar key={m} label={m} value={v.cost} max={byModel[0][1].cost || 1} sub={`$${v.cost.toFixed(2)} · ${v.calls}`} />
          ))}
        </div>
        <div className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: "var(--t6)" }}>CALLS BY AREA</div>
          {byArea.length === 0 && <span style={{ ...mono, fontSize: 10, color: "var(--t7)" }}>NO DATA</span>}
          {byArea.map(([a, n]) => (
            <BreakdownBar key={a} label={a.toUpperCase()} value={n} max={byArea[0][1]} sub={String(n)} />
          ))}
        </div>
      </div>

      {/* table */}
      <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["TIME", "AREA", "AGENT", "MODEL", "IN", "OUT", "MS", "STATUS", ""].map((h, i) => (
                  <th key={i} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "12px 16px", borderBottom: "1px solid var(--ln4)", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: "34px 16px", textAlign: "center", color: "var(--t6)", fontSize: 13 }}>
                    Nothing matches — clear a filter or start a conversation.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const open = expanded === r.id;
                const conv = r.conversation_id ? conversations[r.conversation_id] : undefined;
                const c = ctx[r.id];
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => toggle(r)} style={{ cursor: "pointer", background: open ? "var(--sf2)" : "transparent" }}>
                      <td style={{ ...mono, ...td, color: "var(--t6)", fontSize: 10.5, whiteSpace: "nowrap" }}>
                        {new Date(r.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        <span style={{ color: "var(--t7)" }}> · {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                      </td>
                      <td style={{ ...td }}>
                        <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "3px 9px", borderRadius: 100, border: "1px solid var(--ln5)", color: "var(--t5)", whiteSpace: "nowrap" }}>
                          {areaOf(r.surface).toUpperCase()}
                        </span>
                      </td>
                      <td style={{ ...td, color: "var(--t2)", fontWeight: 600, whiteSpace: "nowrap" }}>{r.agent_name ?? "—"}</td>
                      <td style={{ ...mono, ...td, color: "var(--t5)", fontSize: 10.5, whiteSpace: "nowrap" }}>{r.model}</td>
                      <td style={{ ...mono, ...td, color: "var(--t4)", fontSize: 11 }}>{r.input_tokens?.toLocaleString() ?? "—"}</td>
                      <td style={{ ...mono, ...td, color: "var(--t4)", fontSize: 11 }}>{r.output_tokens?.toLocaleString() ?? "—"}</td>
                      <td style={{ ...mono, ...td, color: "var(--t4)", fontSize: 11 }}>{r.latency_ms ?? "—"}</td>
                      <td style={{ ...td }}>
                        <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", padding: "3px 9px", borderRadius: 100, border: `1px solid ${r.status === "ok" ? "var(--acc)" : "var(--warn)"}`, color: r.status === "ok" ? "var(--acc)" : "var(--warn)", background: r.status === "ok" ? "var(--acc-dim)" : "var(--warn-dim)" }}>
                          {r.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ ...mono, ...td, color: "var(--t6)", fontSize: 11 }}>{open ? "▴" : "▾"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={9} style={{ padding: "16px 20px 20px", borderBottom: "1px solid var(--ln2)", background: "var(--sf2)" }}>
                          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
                            <div style={{ flex: "none", minWidth: 220 }}>
                              <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t7)" }}>CALL</div>
                              <div style={{ ...mono, fontSize: 11, color: "var(--t4)", marginTop: 6, lineHeight: 1.9 }}>
                                SURFACE · {r.surface}<br />
                                SPEND EST · ${costOf(r).toFixed(4)}<br />
                                {conv && <>ROOM · {conv.title} ({conv.participants} in)<br /></>}
                                {r.error && <span style={{ color: "var(--warn)" }}>ERROR · {r.error.slice(0, 120)}</span>}
                              </div>
                              {r.conversation_id && conv && (
                                <Link href={`/conversations?open=${r.conversation_id}`} style={{ ...mono, display: "inline-block", marginTop: 10, fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)" }}>
                                  OPEN THREAD →
                                </Link>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 10 }}>
                              {c?.loading && <span style={{ ...mono, fontSize: 10, color: "var(--t6)" }}>LOADING CONTEXT…</span>}
                              {!c?.loading && c?.asked && (
                                <div>
                                  <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--t7)" }}>ASKED</div>
                                  <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t3)", marginTop: 4, borderLeft: "2px solid var(--ln5)", paddingLeft: 12 }}>
                                    {c.asked.slice(0, 280)}{c.asked.length > 280 ? "…" : ""}
                                  </div>
                                </div>
                              )}
                              {!c?.loading && c?.replied && (
                                <div>
                                  <div style={{ ...mono, fontSize: 8.5, letterSpacing: ".1em", color: "var(--acc)" }}>{r.agent_name?.toUpperCase()} REPLIED</div>
                                  <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--t3)", marginTop: 4, borderLeft: "2px solid var(--acc)", paddingLeft: 12 }}>
                                    {c.replied.slice(0, 280)}{c.replied.length > 280 ? "…" : ""}
                                  </div>
                                </div>
                              )}
                              {!c?.loading && !c?.asked && !c?.replied && r.conversation_id && (
                                <span style={{ ...mono, fontSize: 10, color: "var(--t7)" }}>NO MESSAGE CONTEXT (ROUTER/SEARCH CALL)</span>
                              )}
                              {!r.conversation_id && (
                                <span style={{ ...mono, fontSize: 10, color: "var(--t7)" }}>NOT TIED TO A CONVERSATION</span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
