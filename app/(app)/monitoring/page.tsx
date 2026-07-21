import { CSSProperties } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

export const metadata = { title: "Monitoring — Microcosm" };
export const dynamic = "force-dynamic";

/**
 * Estimated $/Mtok used ONLY for the on-screen spend estimate. Keep in sync
 * with the Anthropic pricing page; never used for billing (CLAUDE.md §6.4).
 */
const RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-opus-4-8": { in: 5, out: 25 },
};

interface Row {
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
}

function estCost(rows: Row[]): number {
  return rows.reduce((acc, r) => {
    const rate = RATES[r.model];
    if (!rate) return acc;
    return acc + ((r.input_tokens ?? 0) / 1e6) * rate.in + ((r.output_tokens ?? 0) / 1e6) * rate.out;
  }, 0);
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

export default async function Monitoring() {
  const supabase = await createServerSupabase();
  const { data } = await supabase!
    .from("agent_interactions")
    .select("id, surface, agent_name, model, input_tokens, output_tokens, latency_ms, status, error, created_at")
    .order("id", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];

  const calls = rows.length;
  const tokIn = rows.reduce((a, r) => a + (r.input_tokens ?? 0), 0);
  const tokOut = rows.reduce((a, r) => a + (r.output_tokens ?? 0), 0);
  const errors = rows.filter((r) => r.status !== "ok").length;
  const avgLatency = calls ? Math.round(rows.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / calls) : 0;
  const cost = estCost(rows);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 80px" }}>
      <div className="kicker">Monitoring</div>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3vw,36px)", fontWeight: 600, letterSpacing: "-.03em" }}>
        Every agent interaction, on the record
      </h1>
      <p style={{ margin: "12px 0 0", maxWidth: 620, fontSize: 14, lineHeight: 1.6, color: "var(--t5)" }}>
        Each model call across Conversations (and, soon, simulations) is logged with tokens, latency, and status — the same discipline the reports get.
      </p>

      <div className="grid4" style={{ marginTop: 32 }}>
        <Tile k="MODEL CALLS · LAST 200" v={String(calls)} sub={errors ? `${errors} ERRORS` : "NO ERRORS"} />
        <Tile k="TOKENS IN" v={tokIn.toLocaleString()} />
        <Tile k="TOKENS OUT" v={tokOut.toLocaleString()} />
        <Tile k="EST. SPEND" v={`$${cost.toFixed(2)}`} sub={`AVG LATENCY ${avgLatency}MS · ESTIMATE ONLY`} accent />
      </div>

      <div className="card" style={{ marginTop: 24, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["TIME", "SURFACE", "AGENT", "MODEL", "IN", "OUT", "MS", "STATUS"].map((h) => (
                  <th key={h} style={{ ...mono, fontSize: 9.5, letterSpacing: ".08em", color: "var(--t6)", textAlign: "left", padding: "12px 16px", borderBottom: "1px solid var(--ln4)", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "34px 16px", textAlign: "center", color: "var(--t6)", fontSize: 13 }}>
                    No interactions yet — start a conversation and they&apos;ll appear here.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...mono, padding: "10px 16px", borderBottom: "1px solid var(--ln2)", color: "var(--t6)", fontSize: 10.5, whiteSpace: "nowrap" }}>
                    {new Date(r.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    <span style={{ color: "var(--t7)" }}> · {new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </td>
                  <td style={{ ...mono, padding: "10px 16px", borderBottom: "1px solid var(--ln2)", color: "var(--t5)", fontSize: 10.5 }}>{r.surface}</td>
                  <td style={{ padding: "10px 16px", borderBottom: "1px solid var(--ln2)", color: "var(--t2)", fontWeight: 600, whiteSpace: "nowrap" }}>{r.agent_name ?? "—"}</td>
                  <td style={{ ...mono, padding: "10px 16px", borderBottom: "1px solid var(--ln2)", color: "var(--t5)", fontSize: 10.5, whiteSpace: "nowrap" }}>{r.model}</td>
                  <td style={{ ...mono, padding: "10px 16px", borderBottom: "1px solid var(--ln2)", color: "var(--t4)", fontSize: 11 }}>{r.input_tokens?.toLocaleString() ?? "—"}</td>
                  <td style={{ ...mono, padding: "10px 16px", borderBottom: "1px solid var(--ln2)", color: "var(--t4)", fontSize: 11 }}>{r.output_tokens?.toLocaleString() ?? "—"}</td>
                  <td style={{ ...mono, padding: "10px 16px", borderBottom: "1px solid var(--ln2)", color: "var(--t4)", fontSize: 11 }}>{r.latency_ms ?? "—"}</td>
                  <td style={{ padding: "10px 16px", borderBottom: "1px solid var(--ln2)" }} title={r.error ?? undefined}>
                    <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", padding: "3px 9px", borderRadius: 100, border: `1px solid ${r.status === "ok" ? "var(--acc)" : "var(--warn)"}`, color: r.status === "ok" ? "var(--acc)" : "var(--warn)", background: r.status === "ok" ? "var(--acc-dim)" : "var(--warn-dim)" }}>
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
