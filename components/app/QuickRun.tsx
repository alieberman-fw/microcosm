"use client";

/**
 * QUICK RUN (6-PR2, docs/next-level-plan.md §6a DECISION) — the one-box
 * alternate view on /sim/new. Empty state = the box + file drop. Once the
 * user starts typing, config surfaces progressively BELOW the box: the
 * animated mode cards first (AUTO = the director decides), and CLICKING a
 * mode reveals that mode's params as selection pills — mode-aware (fixed-
 * shape modes hide ROUNDS). The prompt itself may DESCRIBE the population
 * ("homebuyers aged 35-45 in Beverly Hills…") — the Understanding pass
 * extracts it and casting honors it; omitted, the director decides.
 *
 * There is NO population stage: RUN estimates cost up front, then drives
 * create → files → understand (one-line UNDERSTOOD strip) → cast (theater,
 * seat dots) → crowd (dot-field fill — materialized HERE so the forum feed
 * opens clean) and drops into the live run with ?autostart=1 — LiveRun's
 * auto-materialize sees a non-zero crowd and skips straight to launch.
 * Classic remains the default; the view preference persists per user.
 */

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ModeDiagram, { ModeKey } from "@/components/app/docs/ModeDiagram";
import { MAX_DOC_BYTES } from "@/lib/corpus";
import { SIM_MODES } from "@/lib/casting";
import { RUN_DEFAULTS, RunConfig, estimateRunCost, isFixedShape } from "@/lib/run";

const mono: CSSProperties = { fontFamily: "var(--font-mono), monospace" };

const MODE_BLURB: Record<string, string> = {
  Agora: "open forum — threads & replies",
  Roundtable: "every voice, every round",
  Tribunal: "two sides argue, a judge rules",
  Chamber: "blind takes, then peer review",
  Jury: "independent verdicts, tallied",
  Desk: "research memo, director + workers",
  Expedition: "autonomous deep research",
};

type Stage = { key: string; label: string; state: "pending" | "active" | "done" };

export default function QuickRun({ onClassic }: { onClassic: () => void }) {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<string | null>(null); // null = AUTO, the director decides
  const [rounds, setRounds] = useState(RUN_DEFAULTS.rounds);
  const [tier, setTier] = useState<RunConfig["tier"]>(RUN_DEFAULTS.tier);
  const [density, setDensity] = useState<RunConfig["density"]>(RUN_DEFAULTS.density);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [understood, setUnderstood] = useState<string | null>(null);
  const [castLine, setCastLine] = useState<string | null>(null);
  const [seatCount, setSeatCount] = useState(0); // lead dots light as seats land
  const [crowd, setCrowd] = useState<{ landed: number; sample: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const createdId = useRef<string | null>(null); // retry-safe: never mint a second sim

  const typing = problem.trim().length > 20;

  const autosize = () => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autosize, [problem]);

  const addFiles = (list: FileList | File[]) => {
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of Array.from(list)) {
        if (f.size > MAX_DOC_BYTES) { setError(`Over the 50MB limit: ${f.name}`); continue; }
        if (!merged.some((x) => x.name === f.name && x.size === f.size)) merged.push(f);
      }
      return merged.slice(0, 12);
    });
  };

  // the no-surprise-bills rule: the estimate rides ON the run button.
  // Leads/crowd aren't cast yet — estimate at the director's typical shape
  // (10 leads, 50 crowd), labeled as such.
  const est = useMemo(
    () => estimateRunCost({ leads: 10, crowd: 50, cfg: { ...RUN_DEFAULTS, rounds, tier, density }, mode: mode ?? "Agora" }),
    [rounds, tier, density, mode],
  );

  const setStage = (key: string, state: Stage["state"]) =>
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, state } : s)));

  const run = async () => {
    if (!typing || running) return;
    setRunning(true);
    setError(null);
    setSeatCount(0);
    setCrowd(null);
    setStages([
      { key: "create", label: files.length ? `UPLOADING ${files.length} FILE${files.length > 1 ? "S" : ""}` : "CREATING THE SIMULATION", state: "active" },
      { key: "understand", label: "UNDERSTANDING YOUR BRIEF", state: "pending" },
      { key: "cast", label: "CASTING THE PANEL", state: "pending" },
      { key: "crowd", label: "MATERIALIZING THE CROWD", state: "pending" },
      { key: "launch", label: "INTO THE LIVE RUN", state: "pending" },
    ]);
    try {
      // 1 · create once (a retry after a failure reuses the sim)
      if (!createdId.current) {
        const res = await fetch("/api/simulations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ problem: problem.trim(), questions: [], template: "Custom", success: [] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not create the simulation");
        createdId.current = data.id as string;
      }
      const id = createdId.current;

      // 2 · files ride with the prompt — same corpus pipeline
      if (files.length) {
        const queue = [...files];
        let next = 0;
        const failed: File[] = [];
        const worker = async () => {
          while (next < queue.length) {
            const f = queue[next++];
            const form = new FormData();
            form.set("simId", id);
            form.set("file", f);
            try {
              const r = await fetch("/api/documents", { method: "POST", body: form });
              if (!r.ok) throw new Error();
            } catch { failed.push(f); }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
        if (failed.length) {
          setFiles(failed);
          throw new Error(`${failed.length} file${failed.length > 1 ? "s" : ""} failed to upload — RUN again to retry`);
        }
        setFiles([]);
      }
      setStage("create", "done");

      // 3 · the understanding pass → the one-line UNDERSTOOD strip
      setStage("understand", "active");
      const ures = await fetch(`/api/simulations/${id}/understand`, { method: "POST" });
      const u = await ures.json();
      if (ures.ok && u.contract) {
        const c = u.contract as { intent: string; sub_asks: unknown[]; poll_plan?: unknown[]; population_hints?: { described?: boolean } };
        setUnderstood(
          `${String(c.intent).toUpperCase()} · ${c.sub_asks.length} SUB-ASK${c.sub_asks.length > 1 ? "S" : ""}` +
          ` · ${Array.isArray(c.poll_plan) ? (c.poll_plan.length ? `POLL PLAN: ${c.poll_plan.length} ANGLE${c.poll_plan.length > 1 ? "S" : ""}` : "NO CROWD POLL") : "CLASSIC POLL"}` +
          (c.population_hints?.described ? " · POPULATION FROM YOUR PROMPT" : ""),
        );
      }
      // understanding is probabilistic and optional — a miss never blocks the run
      setStage("understand", "done");

      // 4 · run params (mode only when the user picked one — AUTO lets the director decide)
      await fetch(`/api/simulations/${id}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(mode ? { mode } : {}), run: { rounds, tier, density } }),
      });

      // 5 · cast — the theater: seats land as status lines while the panel forms
      setStage("cast", "active");
      const cres = await fetch(`/api/simulations/${id}/cast`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!cres.ok || !cres.body) {
        const d = await cres.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Casting failed — RUN again to retry");
      }
      const reader = cres.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let seats = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type?: string; seat?: { role?: string }; spec?: { name?: string }; error?: string } = {};
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === "plan") setCastLine("THE DIRECTOR HAS A PLAN — SEATING THE PANEL…");
          if (evt.type === "seat") {
            seats += 1;
            setSeatCount(seats);
            const role = (evt as { seat?: { role?: string } }).seat?.role ?? (evt as { spec?: { role?: string } }).spec?.role ?? "seat";
            setCastLine(`SEATED ${seats} · ${String(role).toUpperCase().slice(0, 44)}`);
          }
          if (evt.type === "error") throw new Error(evt.error ?? "Casting failed");
        }
      }
      if (seats < 2) throw new Error("Casting produced too few seats — RUN again to retry");
      setStage("cast", "done");

      // 6 · the crowd materializes HERE, as a pipeline stage (field fix) —
      // LiveRun's auto-materialize sees a non-zero crowd and skips. A crowd
      // failure never blocks the run: LiveRun retries whatever's missing.
      setStage("crowd", "active");
      try {
        const kres = await fetch(`/api/simulations/${id}/crowd`, { method: "POST" });
        if (kres.ok && kres.body) {
          const kreader = kres.body.getReader();
          const kdec = new TextDecoder();
          let kbuf = "";
          for (;;) {
            const { done, value } = await kreader.read();
            if (done) break;
            kbuf += kdec.decode(value, { stream: true });
            const lines = kbuf.split("\n");
            kbuf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              let kevt: { type?: string; sample?: number; generated?: number } = {};
              try { kevt = JSON.parse(line); } catch { continue; }
              if (kevt.type === "start") setCrowd({ landed: 0, sample: Number(kevt.sample) || 0 });
              if (kevt.type === "members") setCrowd((c) => c ? { ...c, landed: Number(kevt.generated) || c.landed } : c);
              if (kevt.type === "done") setCrowd((c) => c ? { ...c, landed: Number(kevt.generated) || c.landed } : c);
            }
          }
        }
      } catch { /* non-fatal — the run screen picks up whatever's missing */ }
      setStage("crowd", "done");

      // 7 · straight into the live run
      setStage("launch", "active");
      router.push(`/sim/${id}/run?autostart=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quick run failed");
      setRunning(false);
    }
  };

  const pill = (on: boolean): CSSProperties => ({
    ...mono, fontSize: 9.5, letterSpacing: ".06em", padding: "6px 14px", borderRadius: 100, cursor: "pointer",
    background: on ? "var(--acc-dim)" : "transparent",
    border: `1px solid ${on ? "var(--acc)" : "var(--ln5)"}`, color: on ? "var(--acc)" : "var(--t5)",
  });

  return (
    <div style={{ animation: "fadeUp .5s ease both" }}>
      <div style={{ ...mono, fontSize: 12, letterSpacing: ".14em", color: "var(--acc)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 2.2s infinite" }} />
        Quick run · one box, straight to the simulation
        <button
          onClick={onClassic}
          style={{ ...mono, marginLeft: "auto", fontSize: 9.5, letterSpacing: ".08em", padding: "5px 13px", borderRadius: 100, background: "transparent", border: "1px solid var(--ln6)", color: "var(--t5)", cursor: "pointer" }}
        >
          ≡ CLASSIC COMPOSER
        </button>
      </div>

      <textarea
        ref={boxRef}
        value={problem}
        onChange={(e) => setProblem(e.target.value)}
        placeholder="Ask the hardest question you have — and describe WHO to simulate if you want (“how would homebuyers aged 35-45 react to a 2% rate increase in Beverly Hills?”). Config appears as you type."
        rows={3}
        maxLength={6000}
        disabled={running}
        style={{
          width: "100%", boxSizing: "border-box", marginTop: 20,
          background: "transparent", border: "none", outline: "none", resize: "none",
          fontFamily: "var(--font-sans), sans-serif", fontWeight: 600,
          fontSize: problem.length > 280 ? "clamp(18px, 2vw, 24px)" : "clamp(22px, 2.8vw, 34px)",
          lineHeight: problem.length > 280 ? 1.4 : 1.22, letterSpacing: "-.03em",
          color: "var(--t0)", caretColor: "var(--acc)", overflow: "hidden", opacity: running ? 0.6 : 1,
        }}
      />

      {/* files ride with the prompt */}
      {!running && (
        <div
          onClick={() => pickRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          style={{
            marginTop: 12, border: `1px dashed ${dragOver ? "var(--acc)" : "var(--ln4)"}`,
            background: dragOver ? "var(--acc-dim)" : "transparent",
            borderRadius: 10, padding: files.length ? "10px 14px" : "12px 16px", cursor: "pointer", transition: "all .15s",
          }}
        >
          {files.length === 0 ? (
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: dragOver ? "var(--acc)" : "var(--t7)", textAlign: "center" }}>
              + DROP DILIGENCE FILES WITH THE PROMPT (OPTIONAL)
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {files.map((f) => (
                <span key={`${f.name}-${f.size}`} onClick={(e) => e.stopPropagation()} style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 9.5, padding: "4px 11px", borderRadius: 100, border: "1px solid var(--ln5)", color: "var(--t3)" }}>
                  📄 {f.name.length > 30 ? `${f.name.slice(0, 28)}…` : f.name}
                  <button onClick={(e) => { e.stopPropagation(); setFiles((prev) => prev.filter((x) => !(x.name === f.name && x.size === f.size))); }} aria-label={`Remove ${f.name}`} style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
                </span>
              ))}
              <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--t6)" }}>+ ADD MORE</span>
            </div>
          )}
          <input ref={pickRef} type="file" multiple accept=".pdf,.txt,.md,.csv,.html,.json,.geojson,image/*,application/pdf,text/plain,text/markdown,text/csv,text/html" onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
        </div>
      )}

      {/* progressive reveal: modes first, then the picked mode's params */}
      {typing && !running && (
        <div style={{ marginTop: 24, animation: "fadeUp .35s ease both" }}>
          <div style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--t6)" }}>
            HOW SHOULD THEY DELIBERATE? <span style={{ color: "var(--t7)" }}>— AUTO LETS THE CASTING DIRECTOR PICK</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 10, marginTop: 12 }}>
            <button
              onClick={() => setMode(null)}
              style={{
                border: `1px solid ${mode === null ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 12,
                background: mode === null ? "var(--acc-dim)" : "var(--sf)", cursor: "pointer",
                padding: "12px 10px", textAlign: "center",
              }}
            >
              <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: "var(--acc)" }}>✦</div>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: mode === null ? "var(--acc)" : "var(--t3)" }}>AUTO</div>
              <div style={{ fontSize: 10.5, color: "var(--t6)", marginTop: 3 }}>the director decides</div>
            </button>
            {SIM_MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  border: `1px solid ${mode === m ? "var(--acc)" : "var(--ln3)"}`, borderRadius: 12,
                  background: mode === m ? "var(--acc-dim)" : "var(--sf)", cursor: "pointer",
                  padding: "12px 10px", textAlign: "center",
                }}
              >
                <ModeDiagram mode={m.toLowerCase() as ModeKey} height={64} />
                <div style={{ ...mono, fontSize: 10, letterSpacing: ".08em", color: mode === m ? "var(--acc)" : "var(--t3)", marginTop: 2 }}>{m.toUpperCase()}</div>
                <div style={{ fontSize: 10.5, color: "var(--t6)", marginTop: 3 }}>{MODE_BLURB[m]}</div>
              </button>
            ))}
          </div>

          {/* the picked mode's params, as pills — mode-aware */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 18, animation: "fadeUp .3s ease both" }}>
            {!(mode && isFixedShape(mode)) && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 220 }}>
                <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>ROUNDS</span>
                {/* field fix: a 2–20 slider, not four pills — §10 slider grammar */}
                <input
                  type="range"
                  min={2}
                  max={20}
                  step={1}
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                  style={{ width: 130, accentColor: "var(--acc)", height: 4, cursor: "pointer" }}
                  aria-label="Discussion rounds (2–20)"
                />
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)", background: "var(--acc-dim)", border: "1px solid var(--acc)", borderRadius: 100, padding: "3px 10px" }}>
                  {rounds}
                </span>
              </span>
            )}
            {mode && isFixedShape(mode) && (
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".07em", color: "var(--t6)" }}>
                {mode.toUpperCase()} RUNS A FIXED CHOREOGRAPHY — NO ROUNDS TO SET
              </span>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>TIER</span>
              {(["economy", "standard", "frontier"] as const).map((t) => (
                <button key={t} onClick={() => setTier(t)} style={pill(tier === t)}>{t.toUpperCase()}</button>
              ))}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>DENSITY</span>
              {(["focused", "lively", "bustling"] as const).map((d) => (
                <button key={d} onClick={() => setDensity(d)} style={pill(density === d)}>{d.toUpperCase()}</button>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* the pipeline — casting theater as the loading state */}
      {running && (
        <div className="card" style={{ marginTop: 22, padding: "22px 26px", animation: "fadeUp .3s ease both" }}>
          {stages.map((s) => (
            <div key={s.key} style={{ padding: "5px 0", opacity: s.state === "pending" ? 0.4 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ ...mono, fontSize: 9, width: 12, color: s.state === "done" ? "var(--acc)" : "var(--t6)", flex: "none" }}>
                  {s.state === "done" ? "✓" : s.state === "active" ? "·" : ""}
                </span>
                {s.state === "active" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite", flex: "none" }} />}
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: s.state === "active" ? "var(--t2)" : "var(--t5)" }}>{s.label}</span>
                {s.key === "cast" && s.state === "active" && castLine && (
                  <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--acc)", animation: "fadeUp .25s ease both" }} key={castLine}>— {castLine}</span>
                )}
                {s.key === "crowd" && s.state !== "pending" && crowd && crowd.sample > 0 && (
                  <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--acc)" }}>— {crowd.landed}/{crowd.sample} MEMBERS</span>
                )}
                {s.key === "crowd" && s.state === "done" && crowd?.sample === 0 && (
                  <span style={{ ...mono, fontSize: 9, letterSpacing: ".05em", color: "var(--t6)" }}>— NO CROWD FOR THIS RUN</span>
                )}
              </div>
              {/* the panel forms as dots — leads land one by one while casting */}
              {s.key === "cast" && s.state !== "pending" && seatCount > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "7px 0 2px 22px" }}>
                  {Array.from({ length: Math.min(seatCount, 16) }, (_, i) => (
                    <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--acc)", animation: "fadeUp .3s ease both", boxShadow: "0 0 6px var(--acc-dim)" }} />
                  ))}
                </div>
              )}
              {/* the crowd fills a dot field — one dot per slice of the sample */}
              {s.key === "crowd" && s.state !== "pending" && crowd && crowd.sample > 0 && (() => {
                const nDots = Math.min(crowd.sample, 60);
                const lit = Math.round((crowd.landed / crowd.sample) * nDots);
                return (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "7px 0 2px 22px", maxWidth: 420 }}>
                    {Array.from({ length: nDots }, (_, i) => (
                      <span
                        key={i}
                        style={{
                          width: 5, height: 5, borderRadius: "50%",
                          background: i < lit ? "var(--acc)" : "var(--ln4)",
                          transition: "background .3s ease",
                          ...(i < lit ? { animation: "fadeUp .3s ease both" } : {}),
                        }}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>
          ))}
          {understood && (
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".06em", color: "var(--acc)", marginTop: 12, borderTop: "1px solid var(--ln2)", paddingTop: 12 }}>
              ✻ UNDERSTOOD · {understood}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ ...mono, fontSize: 10.5, color: "var(--warn)", marginTop: 14 }}>{error.toUpperCase().slice(0, 120)}</div>}

      {/* RUN — the estimate rides on the button (no surprise bills) */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 24, flexWrap: "wrap" }}>
        <button
          onClick={() => void run()}
          disabled={!typing || running}
          style={{
            background: typing && !running ? "var(--acc)" : "var(--sf2)",
            color: typing && !running ? "var(--acc-c)" : "var(--t6)",
            fontWeight: 600, fontSize: 14.5, padding: "13px 30px", borderRadius: 100, border: "none",
            cursor: typing && !running ? "pointer" : "default", fontFamily: "var(--font-sans), sans-serif",
          }}
        >
          {running ? "Running…" : "Run the simulation →"}
        </button>
        {typing && !running && (
          <span style={{ ...mono, fontSize: 10, letterSpacing: ".05em", color: "var(--t6)" }}>
            EST ${est.low.toFixed(2)}–{est.high.toFixed(2)} · ~{est.posts} POSTS · AT THE DIRECTOR'S TYPICAL PANEL (10 LEADS + 50 CROWD)
          </span>
        )}
        {!typing && !running && (
          <span style={{ ...mono, fontSize: 10, letterSpacing: ".05em", color: "var(--t7)" }}>
            START TYPING — THE MODES AND CONFIG APPEAR AS YOU GO
          </span>
        )}
      </div>
    </div>
  );
}
