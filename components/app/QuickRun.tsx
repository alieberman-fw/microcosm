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
 * There is NO population stage, but there IS a CHECKPOINT (field fix): RUN
 * drives create → files → understand, then STOPS on the WHAT I UNDERSTOOD
 * review — the mirror, the clarifier questions as tap-able chips, and a
 * CAST & RUN button. Editing the prompt during review demands a RE-DERIVE
 * before continuing. Then cast (the classic casting-theater swarm) → crowd
 * (the CrowdBand dot-field, materialized HERE so the forum opens clean) →
 * straight into the live run with ?autostart=1. Classic remains the
 * default; the view preference persists per user.
 */

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ModeDiagram, { ModeKey } from "@/components/app/docs/ModeDiagram";
import CastingTheater, { CrowdBand } from "@/components/app/CastingTheater";
import Orb from "@/components/app/Orb";
import { MAX_DOC_BYTES } from "@/lib/corpus";
import { SIM_MODES } from "@/lib/casting";
import { BriefContract } from "@/lib/understand";
import { RUN_DEFAULTS, RunConfig, estimateRunCost, isFixedShape } from "@/lib/run";
import { TOOL_RACK } from "@/lib/tools";

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
  // files added AT the review checkpoint — uploaded immediately, chip per file
  const [lateDocs, setLateDocs] = useState<{ name: string; state: "up" | "ok" | "fail" }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<string | null>(null); // null = AUTO, the director decides
  const [rounds, setRounds] = useState(RUN_DEFAULTS.rounds);
  const [tier, setTier] = useState<RunConfig["tier"]>(RUN_DEFAULTS.tier);
  const [density, setDensity] = useState<RunConfig["density"]>(RUN_DEFAULTS.density);
  // agent tools (§7 rack): the allowlist for this run — ALL OFF by default,
  // picked from a popover (same contract as the classic run config's cards)
  const [toolSel, setToolSel] = useState<string[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLSpanElement>(null);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [understood, setUnderstood] = useState<string | null>(null);
  const [castLine, setCastLine] = useState<string | null>(null);
  const [crowd, setCrowd] = useState<{ landed: number; sample: number; experts: number; residents: number } | null>(null);
  // the CHECKPOINT: the contract from the understanding pass — while set and
  // unconfirmed, the pipeline waits on the user (clarifiers, re-derive, go)
  const [contract, setContract] = useState<BriefContract | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const reviewedProblem = useRef(""); // the prompt text the contract was derived from
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const createdId = useRef<string | null>(null); // retry-safe: never mint a second sim

  const typing = problem.trim().length > 20;

  // the tools popover closes on any outside click
  useEffect(() => {
    if (!toolsOpen) return;
    const close = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [toolsOpen]);

  const autosize = () => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autosize, [problem]);

  const addFiles = (list: FileList | File[]) => {
    const valid: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_DOC_BYTES) { setError(`Over the 50MB limit: ${f.name}`); continue; }
      valid.push(f);
    }
    // at the review checkpoint the sim already exists — files upload NOW
    // (field fix: the zone used to vanish here, stranding late diligence)
    if (reviewing && createdId.current) { void uploadNow(valid); return; }
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of valid) {
        if (!merged.some((x) => x.name === f.name && x.size === f.size)) merged.push(f);
      }
      return merged.slice(0, 12);
    });
  };

  // review-checkpoint uploads: straight into the created sim's corpus, chip
  // per file (uploading → in the corpus / failed), same 3-wide worker pool
  const uploadNow = async (list: File[]) => {
    const id = createdId.current;
    if (!id || !list.length) return;
    const fresh = list.filter((f) => !lateDocs.some((d) => d.name === f.name && d.state !== "fail"));
    if (!fresh.length) return;
    setLateDocs((prev) => [...prev.filter((d) => d.state !== "fail" || !fresh.some((f) => f.name === d.name)), ...fresh.map((f) => ({ name: f.name, state: "up" as const }))]);
    const queue = [...fresh];
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const f = queue[next++];
        const form = new FormData();
        form.set("simId", id);
        form.set("file", f);
        let ok = false;
        try { ok = (await fetch("/api/documents", { method: "POST", body: form })).ok; } catch { /* fail chip */ }
        setLateDocs((prev) => prev.map((d) => (d.name === f.name ? { ...d, state: ok ? "ok" : "fail" } : d)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
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

  // PHASE 1: create → files → understand → STOP at the checkpoint
  const run = async () => {
    if (!typing || running) return;
    setRunning(true);
    setError(null);
    setCrowd(null);
    setContract(null);
    setReviewing(false);
    setLateDocs([]);
    setStages([
      { key: "create", label: files.length ? `UPLOADING ${files.length} FILE${files.length > 1 ? "S" : ""}` : "CREATING THE SIMULATION", state: "active" },
      { key: "understand", label: "UNDERSTANDING YOUR BRIEF", state: "pending" },
      { key: "review", label: "REVIEW WHAT I UNDERSTOOD", state: "pending" },
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

      // 3 · the understanding pass → the CHECKPOINT (field fix: the pipeline
      // used to barrel straight into casting; now it stops for the user)
      setStage("understand", "active");
      const ures = await fetch(`/api/simulations/${id}/understand`, { method: "POST" });
      const u = await ures.json();
      setStage("understand", "done");
      if (ures.ok && u.contract) {
        const c = u.contract as BriefContract;
        setUnderstood(
          `${String(c.intent).toUpperCase()} · ${c.sub_asks.length} SUB-ASK${c.sub_asks.length > 1 ? "S" : ""}` +
          ` · ${Array.isArray(c.poll_plan) ? (c.poll_plan.length ? `POLL PLAN: ${c.poll_plan.length} ANGLE${c.poll_plan.length > 1 ? "S" : ""}` : "NO CROWD POLL") : "CLASSIC POLL"}` +
          (c.population_hints?.described ? " · POPULATION FROM YOUR PROMPT" : ""),
        );
        setContract(c);
        reviewedProblem.current = problem.trim();
        setStage("review", "active");
        setReviewing(true);
        setRunning(false);
        return; // ← the checkpoint: castAndLaunch continues on the user's go
      }
      // understanding is probabilistic and optional — a miss never blocks the
      // run; with nothing to review, continue straight through
      setStage("review", "done");
      await castAndLaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quick run failed");
      setRunning(false);
    }
  };

  // one-tap clarifier answers persist to the contract (same PATCH the
  // workspace card uses); a failure keeps the old answer and says so
  const saveContract = async (next: BriefContract) => {
    const id = createdId.current;
    if (!id) return;
    const prev = contract;
    setContract(next);
    try {
      const res = await fetch(`/api/simulations/${id}/understand`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setContract(data.contract as BriefContract);
    } catch (e) {
      setContract(prev);
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  // the prompt was edited during review → the contract no longer matches
  const dirty = reviewing && problem.trim() !== reviewedProblem.current;
  // checkpoint uploads still in flight → CAST & RUN waits for the corpus
  const uploadingDocs = lateDocs.some((d) => d.state === "up");

  // re-derive: persist the edited brief, then run the understanding pass again
  const rederive = async () => {
    const id = createdId.current;
    if (!id || running) return;
    setRunning(true);
    setError(null);
    setStage("understand", "active");
    setStage("review", "pending");
    try {
      const bres = await fetch(`/api/simulations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: problem.trim(), questions: [], template: "Custom", success: [] }),
      });
      if (!bres.ok) throw new Error("Could not save the edited brief");
      const ures = await fetch(`/api/simulations/${id}/understand`, { method: "POST" });
      const u = await ures.json();
      if (!ures.ok || !u.contract) throw new Error((u as { error?: string }).error ?? "Re-derive failed — try again");
      setContract(u.contract as BriefContract);
      reviewedProblem.current = problem.trim();
      setStage("understand", "done");
      setStage("review", "active");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-derive failed");
      setStage("understand", "done");
      setStage("review", "active");
    } finally {
      setRunning(false);
    }
  };

  // PHASE 2 (on the user's go): config → cast → crowd → launch
  const castAndLaunch = async () => {
    const id = createdId.current;
    if (!id) return;
    setRunning(true);
    setReviewing(false);
    setError(null);
    setStage("review", "done");
    try {
      // 4 · run params (mode only when the user picked one — AUTO lets the director decide)
      await fetch(`/api/simulations/${id}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(mode ? { mode } : {}), run: { rounds, tier, density }, tools: toolSel }),
      });

      // 5 · cast — the classic casting-theater swarm plays while seats land
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
              let kevt: { type?: string; sample?: number; generated?: number; experts?: number; residents?: number } = {};
              try { kevt = JSON.parse(line); } catch { continue; }
              if (kevt.type === "start") setCrowd({ landed: 0, sample: Number(kevt.sample) || 0, experts: Number(kevt.experts) || 0, residents: Number(kevt.residents) || 0 });
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
    // the WHOLE composer is a drop target (field fix: drops on the grown
    // textarea used to hit the browser default and go nowhere)
    <div
      style={{ animation: "fadeUp .5s ease both" }}
      onDragOver={(e) => { if (!running) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { if (!running) { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); } }}
    >
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

      {/* files ride with the prompt; at the review checkpoint the zone stays
          (field fix: it used to vanish — "not letting me upload") and files
          added there stream straight into the created sim's corpus */}
      {!running && (
        <div
          onClick={() => pickRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          style={{
            marginTop: 12, border: `1px dashed ${dragOver ? "var(--acc)" : "var(--ln4)"}`,
            background: dragOver ? "var(--acc-dim)" : "transparent",
            borderRadius: 10, padding: files.length || lateDocs.length ? "10px 14px" : "12px 16px", cursor: "pointer", transition: "all .15s",
          }}
        >
          {files.length === 0 && lateDocs.length === 0 ? (
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: dragOver ? "var(--acc)" : "var(--t7)", textAlign: "center" }}>
              {reviewing ? "+ ADD DILIGENCE FILES — THEY JOIN THE CORPUS BEFORE CASTING" : "+ DROP DILIGENCE FILES WITH THE PROMPT (OPTIONAL)"}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {files.map((f) => (
                <span key={`${f.name}-${f.size}`} onClick={(e) => e.stopPropagation()} style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 9.5, padding: "4px 11px", borderRadius: 100, border: "1px solid var(--ln5)", color: "var(--t3)" }}>
                  📄 {f.name.length > 30 ? `${f.name.slice(0, 28)}…` : f.name}
                  <button onClick={(e) => { e.stopPropagation(); setFiles((prev) => prev.filter((x) => !(x.name === f.name && x.size === f.size))); }} aria-label={`Remove ${f.name}`} style={{ background: "none", border: "none", color: "var(--t6)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
                </span>
              ))}
              {lateDocs.map((d) => (
                <span key={`late-${d.name}`} onClick={(e) => e.stopPropagation()} style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 9.5, padding: "4px 11px", borderRadius: 100, border: `1px solid ${d.state === "fail" ? "var(--warn)" : d.state === "ok" ? "var(--acc)" : "var(--ln5)"}`, color: d.state === "fail" ? "var(--warn)" : d.state === "ok" ? "var(--acc)" : "var(--t3)" }}>
                  {d.state === "up" && <Orb state="working" size={20} tone="quiet" aria-label="uploading" />}
                  📄 {d.name.length > 30 ? `${d.name.slice(0, 28)}…` : d.name}
                  {d.state === "ok" ? " · IN THE CORPUS" : d.state === "fail" ? " · FAILED — RE-ADD TO RETRY" : ""}
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

            {/* AGENT TOOLS (§7 rack) — a picker in the Claude grammar: the
                pill states what's on; the popover lists the rack with
                per-tool toggles + ENABLE ALL / ALL OFF. All off by default. */}
            <span ref={toolsRef} style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative" }}>
              <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>TOOLS</span>
              <button
                onClick={() => setToolsOpen((v) => !v)}
                aria-expanded={toolsOpen}
                style={pill(toolSel.length > 0)}
              >
                {toolSel.length === 0 ? "⚒ OFF" : `⚒ ${toolSel.length} ON`} {toolsOpen ? "▴" : "▾"}
              </button>
              {/* the selected tools, visible at a glance */}
              {toolSel.map((k) => {
                const t = TOOL_RACK.find((x) => x.key === k);
                return t ? (
                  <span key={k} style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", padding: "4px 11px", borderRadius: 100, border: "1px solid var(--acc)", background: "var(--acc-dim)", color: "var(--acc)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {t.name.toUpperCase()}
                    <button
                      onClick={() => setToolSel((prev) => prev.filter((x) => x !== k))}
                      aria-label={`Disable ${t.name}`}
                      style={{ background: "none", border: "none", color: "var(--acc)", cursor: "pointer", padding: 0, fontSize: 11, lineHeight: 1 }}
                    >
                      ×
                    </button>
                  </span>
                ) : null;
              })}

              {toolsOpen && (
                <div
                  style={{
                    position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 50, width: 340,
                    background: "var(--sf2)", border: "1px solid var(--ln5)", borderRadius: 14, padding: 10,
                    boxShadow: "0 12px 32px rgba(0,0,0,.35)", animation: "fadeUp .18s ease both",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 10px", borderBottom: "1px solid var(--ln3)" }}>
                    <span style={{ ...mono, fontSize: 9, letterSpacing: ".1em", color: "var(--t6)" }}>AGENT TOOLS — AGENTS DECIDE WHEN TO USE THEM</span>
                  </div>
                  {TOOL_RACK.map((t) => {
                    const available = t.status === "available";
                    const on = toolSel.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        disabled={!available}
                        onClick={() => setToolSel((prev) => (on ? prev.filter((x) => x !== t.key) : [...prev, t.key]))}
                        style={{
                          width: "100%", textAlign: "left", display: "flex", alignItems: "flex-start", gap: 10,
                          background: "none", border: "none", borderRadius: 10, padding: "10px 8px",
                          cursor: available ? "pointer" : "default", opacity: available ? 1 : 0.45,
                        }}
                      >
                        {/* the toggle dot — checked = accent-filled */}
                        <span style={{
                          width: 14, height: 14, borderRadius: 5, flex: "none", marginTop: 1, boxSizing: "border-box",
                          border: `1px solid ${on ? "var(--acc)" : "var(--ln6)"}`,
                          background: on ? "var(--acc)" : "transparent",
                          color: "var(--acc-c)", fontSize: 10, lineHeight: "12px", textAlign: "center",
                        }}>
                          {on ? "✓" : ""}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)", fontFamily: "var(--font-sans), sans-serif" }}>{t.name}</span>
                            {!available && (
                              <span style={{ ...mono, fontSize: 7.5, letterSpacing: ".06em", color: "var(--t7)", border: "1px solid var(--ln5)", borderRadius: 100, padding: "1px 7px" }}>SOON</span>
                            )}
                          </span>
                          <span style={{ ...mono, display: "block", fontSize: 8, letterSpacing: ".06em", color: "var(--t6)", marginTop: 3 }}>
                            {t.tagline} · {t.costNote.toUpperCase()}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  <div style={{ display: "flex", gap: 6, padding: "10px 8px 4px", borderTop: "1px solid var(--ln3)" }}>
                    <button
                      onClick={() => setToolSel(TOOL_RACK.filter((t) => t.status === "available").map((t) => t.key))}
                      style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "5px 12px", borderRadius: 100, border: "1px solid var(--acc)", background: "var(--acc-dim)", color: "var(--acc)", cursor: "pointer" }}
                    >
                      ENABLE ALL
                    </button>
                    <button
                      onClick={() => setToolSel([])}
                      style={{ ...mono, fontSize: 8.5, letterSpacing: ".06em", padding: "5px 12px", borderRadius: 100, border: "1px solid var(--ln5)", background: "transparent", color: "var(--t5)", cursor: "pointer" }}
                    >
                      ALL OFF
                    </button>
                    <span style={{ ...mono, marginLeft: "auto", fontSize: 8, letterSpacing: ".05em", color: "var(--t7)", alignSelf: "center" }}>
                      OFF BY DEFAULT
                    </span>
                  </div>
                </div>
              )}
            </span>
          </div>
        </div>
      )}

      {/* the pipeline — the classic theater plays inside the box */}
      {(running || reviewing) && (
        <div className="card" style={{ marginTop: 22, padding: "22px 26px", animation: "fadeUp .3s ease both" }}>
          {stages.map((s) => (
            <div key={s.key} style={{ padding: "5px 0", opacity: s.state === "pending" ? 0.4 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ ...mono, fontSize: 9, width: 12, color: s.state === "done" ? "var(--acc)" : "var(--t6)", flex: "none" }}>
                  {s.state === "done" ? "✓" : s.state === "active" ? "·" : ""}
                </span>
                {s.state === "active" && (
                  // every stage speaks orb (field request), one meaning each:
                  // working = setup · shaping = brief→contract · breathing =
                  // idling for YOU · weaving = seats braiding into a panel ·
                  // composing = crowd personas being written · connecting =
                  // the run wiring up
                  s.key === "create" ? <Orb state="working" size={20} tone="quiet" aria-label="Creating the simulation" />
                  : s.key === "understand" ? <Orb state="shaping" size={20} aria-label="Reading your brief" />
                  : s.key === "review" ? <Orb state="breathing" size={20} aria-label="Waiting for your review" />
                  : s.key === "cast" ? <Orb state="weaving" size={20} aria-label="Casting the panel" />
                  : s.key === "crowd" ? <Orb state="composing" size={20} aria-label="Writing the crowd" />
                  : s.key === "launch" ? <Orb state="connecting" size={20} aria-label="Launching the run" />
                  : <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)", animation: "pulseDot 1.4s ease infinite", flex: "none" }} />
                )}
                <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".07em", color: s.state === "active" ? "var(--t2)" : "var(--t5)" }}>
                  {s.label}
                  {s.key === "review" && s.state === "active" && <span style={{ color: "var(--t6)" }}> — WAITING ON YOU</span>}
                </span>
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

              {/* THE CHECKPOINT — review what was understood before anything casts */}
              {s.key === "review" && s.state === "active" && contract && (
                <div style={{ margin: "12px 0 8px 22px", padding: "16px 18px", border: "1px solid var(--ln3)", borderRadius: 12, background: "var(--sf2)", animation: "fadeUp .3s ease both" }}>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--t3)", maxWidth: 760 }}>{contract.mirror}</p>
                  {contract.population_hints.described && contract.population_hints.cohorts.length > 0 && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>POPULATION</span>
                      {contract.population_hints.cohorts.map((co, i) => (
                        <span key={i} style={{ ...mono, fontSize: 9, letterSpacing: ".05em", padding: "3px 10px", borderRadius: 100, border: "1px solid var(--acc)", color: "var(--acc)" }}>
                          {co.desc.toUpperCase().slice(0, 48)}{co.geography ? ` · ${co.geography.toUpperCase()}` : ""}
                        </span>
                      ))}
                      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".05em", color: "var(--t7)" }}>→ CASTING HONORS THIS</span>
                    </div>
                  )}
                  {contract.output_contracts.length > 0 && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      <span style={{ ...mono, fontSize: 8.5, letterSpacing: ".08em", color: "var(--t6)" }}>THE REPORT YOU&rsquo;LL GET</span>
                      {contract.output_contracts.map((oc, i) => (
                        <span key={i} style={{ ...mono, fontSize: 9, letterSpacing: ".05em", padding: "3px 10px", borderRadius: 100, border: `1px solid ${i === 0 ? "var(--acc)" : "var(--ln5)"}`, color: i === 0 ? "var(--acc)" : "var(--t5)" }}>
                          {i === 0 ? "OPENS WITH · " : "+ "}{oc.type.replace("_", " ").toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* the clarifiers — the follow-up questions, one tap each */}
                  {contract.flags.map((f) => (
                    <div key={f.question} style={{ marginTop: 14, padding: "12px 14px", borderLeft: "2px solid var(--warn)", background: "var(--warn-dim)", borderRadius: "0 10px 10px 0" }}>
                      <div style={{ fontSize: 13, color: "var(--t2)" }}>{f.question}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
                        {f.options.map((o) => {
                          const on = (f.answer ?? f.default) === o;
                          return (
                            <button
                              key={o}
                              onClick={() => void saveContract({ ...contract, flags: contract.flags.map((x) => (x.question === f.question ? { ...x, answer: o } : x)) })}
                              style={{
                                ...mono, fontSize: 9, letterSpacing: ".05em", padding: "4px 12px", borderRadius: 100, cursor: "pointer",
                                background: on ? "var(--acc-dim)" : "transparent",
                                border: `1px solid ${on ? "var(--acc)" : "var(--ln5)"}`, color: on ? "var(--acc)" : "var(--t5)",
                              }}
                            >
                              {o.toUpperCase()}{!f.answer && o === f.default ? " · DEFAULT" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
                    {dirty ? (
                      <>
                        <button
                          onClick={() => void rederive()}
                          style={{ background: "var(--warn)", color: "var(--acc-c)", fontWeight: 600, fontSize: 13, padding: "10px 22px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif" }}
                        >
                          ↻ Prompt changed — re-derive
                        </button>
                        <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--warn)" }}>THE READING ABOVE IS FROM YOUR EARLIER PROMPT</span>
                      </>
                    ) : uploadingDocs ? (
                      <>
                        <button
                          disabled
                          style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "var(--sf2)", color: "var(--t5)", fontWeight: 600, fontSize: 13, padding: "10px 22px", borderRadius: 100, border: "1px solid var(--ln4)", cursor: "wait", fontFamily: "var(--font-sans), sans-serif" }}
                        >
                          <Orb state="working" size={20} tone="quiet" aria-label="uploading documents" /> Uploading your documents…
                        </button>
                        <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)" }}>CAST &amp; RUN UNLOCKS WHEN THE CORPUS HAS THEM</span>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => void castAndLaunch()}
                          style={{ background: "var(--acc)", color: "var(--acc-c)", fontWeight: 600, fontSize: 13, padding: "10px 22px", borderRadius: 100, border: "none", cursor: "pointer", fontFamily: "var(--font-sans), sans-serif" }}
                        >
                          Looks right — cast &amp; run →
                        </button>
                        <span style={{ ...mono, fontSize: 9, letterSpacing: ".06em", color: "var(--t6)" }}>EDIT THE PROMPT ABOVE TO CHANGE IT, THEN RE-DERIVE</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* the classic casting-theater swarm plays while the panel forms */}
              {s.key === "cast" && s.state === "active" && (
                <div style={{ margin: "10px 0 4px 22px" }}>
                  <CastingTheater compact height={150} />
                </div>
              )}
              {/* the CrowdBand dot-field lights as members land — same visual
                  the classic composer's population stage uses */}
              {s.key === "crowd" && s.state !== "pending" && crowd && crowd.sample > 0 && (
                <div style={{ margin: "8px 0 2px 22px", maxWidth: 560 }}>
                  <CrowdBand
                    experts={crowd.experts || crowd.sample}
                    residents={crowd.residents}
                    litExperts={Math.round(crowd.landed * ((crowd.experts || crowd.sample) / Math.max(crowd.sample, 1)))}
                    litResidents={Math.round(crowd.landed * (crowd.residents / Math.max(crowd.sample, 1)))}
                    active={s.state === "active"}
                  />
                </div>
              )}
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

      {/* RUN — the estimate rides on the button (no surprise bills). During
          review the CHECKPOINT card owns the primary action, so this hides. */}
      {!reviewing && (
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
      )}
    </div>
  );
}
