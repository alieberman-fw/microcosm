import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { PersonaSpec } from "@/lib/personas";
import { CROWD_BATCH, CROWD_MODEL, CROWD_SAMPLE_CAP, FrozenSpec, crowdGenerateSystem } from "@/lib/casting";
import { parseLooseArray, parseLooseObject } from "@/lib/llm-json";

export const maxDuration = 300; // up to 12 Haiku batches, 3 concurrent

/**
 * Materialize the crowd (CLAUDE.md §3 Stage 3 / §4.1): turn the cast's
 * scale numbers into real, browsable crowd members. Crowds beyond
 * CROWD_SAMPLE_CAP get a proportional representative sample now and reach
 * full scale at run time. Streamed as ND-JSON:
 *   {type:"start", target, sample, experts, residents}
 *   {type:"members", members:[...], generated}   one per resolved batch
 *   {type:"done", generated} | {type:"error"}
 * Members land in sim_agents with seat.tier "crowd" (persona_id null — the
 * crowd never pollutes the org's persona library).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const { data: sim } = await supabase.from("simulations").select("id, brief, config").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const casting = ((sim.config as { casting?: { scale?: { experts?: number; residents?: number } } } | null)?.casting) ?? null;
  const scale = casting?.scale;
  if (!scale) return NextResponse.json({ error: "Cast the leads first" }, { status: 400 });

  const { data: agents } = await supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id);
  const leads = (agents ?? []).filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd");
  if (leads.length === 0) return NextResponse.json({ error: "Cast the leads first" }, { status: 400 });

  const brief = sim.brief as { problem?: string };
  const leadSpecs = leads.map((a) => a.spec_frozen as FrozenSpec);
  // expert crowd takes its cue from the EXPERT leads only — consumer leads in
  // the context made Haiku clone renters into the expert bench
  const expertLeadSpecs = leadSpecs.filter((f) => f.kind !== "consumer" && f.kind !== "resident");
  const expertLeadRoles = expertLeadSpecs.map((f) => f.seat?.role ?? f.role).slice(0, 20);
  const disciplines = [...new Set(expertLeadSpecs.map((f) => f.seat?.discipline).filter(Boolean))] as string[];

  // the leads count toward the population — the crowd is the rest
  const residentLeadCount = leadSpecs.filter((f) => f.kind === "consumer" || f.kind === "resident").length;
  const expertLeadCount = leads.length - residentLeadCount;
  const expertsTarget = Math.max((scale.experts ?? expertLeadCount) - expertLeadCount, 0);
  const residentsTarget = Math.max((scale.residents ?? 0) - residentLeadCount, 0);
  const target = expertsTarget + residentsTarget;
  if (target === 0) return NextResponse.json({ error: "Crowd counts are zero — raise them in the CROWD row" }, { status: 400 });
  const sample = Math.min(target, CROWD_SAMPLE_CAP);
  let expertsSample = Math.round(sample * (expertsTarget / target));
  if (expertsTarget > 0) expertsSample = Math.max(expertsSample, 1);
  if (residentsTarget > 0) expertsSample = Math.min(expertsSample, sample - 1);
  const residentsSample = sample - expertsSample;

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        // regenerate semantics: clear any previous crowd
        await supabase.from("sim_agents").delete().eq("sim_id", id).like("agent_key", "crowd-%");

        emit({ type: "start", target, sample, experts: expertsSample, residents: residentsSample });

        const briefLine = `PROBLEM: ${(brief?.problem ?? "").slice(0, 500)}`;
        const seenNames = new Set(leadSpecs.map((f) => f.name).filter(Boolean));
        let generated = 0;
        let keySeq = 0;

        // batch plan across both groups
        const batches: { group: "experts" | "residents"; count: number; index: number }[] = [];
        for (let done = 0, i = 0; done < expertsSample; i++) {
          const n = Math.min(CROWD_BATCH, expertsSample - done);
          batches.push({ group: "experts", count: n, index: i });
          done += n;
        }
        for (let done = 0, i = 0; done < residentsSample; i++) {
          const n = Math.min(CROWD_BATCH, residentsSample - done);
          batches.push({ group: "residents", count: n, index: i });
          done += n;
        }

        // the model occasionally wraps the array in an object or prose —
        // salvage the first array we can find before declaring zero
        const extractSpecs = (text: string): PersonaSpec[] => {
          let arr = parseLooseArray(text) as PersonaSpec[] | null;
          if (!arr?.length) {
            const obj = parseLooseObject(text);
            const wrapped = obj && Object.values(obj).find((v) => Array.isArray(v) && v.length);
            if (wrapped) arr = wrapped as PersonaSpec[];
          }
          return (arr ?? []).filter((s) => s?.name);
        };

        const runBatch = async (batch: { group: "experts" | "residents"; count: number; index: number }) => {
          let specs: PersonaSpec[] = [];
          for (let attempt = 0; attempt < 2 && specs.length === 0; attempt++) {
            const t0 = Date.now();
            const avoid = [...seenNames].slice(-80).join(", ") || "none";
            let usage: { input_tokens: number; output_tokens: number } | null = null;
            let errMsg: string | undefined;
            try {
              const res = await anthropic.messages.create({
                model: CROWD_MODEL,
                max_tokens: 260 * batch.count + 500,
                system: crowdGenerateSystem(batch.group, expertLeadRoles, disciplines),
                messages: [{
                  role: "user",
                  content:
                    `${briefLine}\nAVOID THESE NAMES: ${avoid}\n` +
                    `Create EXACTLY ${batch.count} ${batch.group === "experts" ? "expert" : "resident/consumer"} crowd members ` +
                    `(variation slice ${batch.index + 1} — make this slice feel different from the others: different firms, ages, angles).`,
                }],
              });
              usage = res.usage;
              const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
              specs = extractSpecs(text);
            } catch (e) {
              errMsg = e instanceof Error ? e.message : "generation failed";
            }
            await supabase.from("agent_interactions").insert({
              org_id: orgId, user_id: user.id, surface: "crowd.generate", model: CROWD_MODEL, sim_id: id,
              input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
              latency_ms: Date.now() - t0, status: errMsg ? "error" : "ok", error: errMsg ?? null,
              detail: { group: batch.group, requested: batch.count, produced: specs.length, attempt },
            });
          }
          return specs;
        };

        // 3-way concurrency; dedupe names as batches resolve, insert per batch
        const CONCURRENCY = 3;
        let cursor = 0;
        const worker = async () => {
          for (;;) {
            const i = cursor++;
            if (i >= batches.length) return;
            const batch = batches[i];
            const specs = await runBatch(batch);
            const rows: { sim_id: string; persona_id: null; agent_key: string; spec_frozen: FrozenSpec }[] = [];
            const members: { key: string; spec: FrozenSpec }[] = [];
            for (const raw of specs.slice(0, batch.count)) {
              const name = String(raw.name).trim();
              if (!name || seenNames.has(name)) continue; // duplicate across concurrent batches — drop
              seenNames.add(name);
              const kind = batch.group === "experts"
                ? "expert"
                : (raw.kind === "consumer" ? "consumer" : "resident");
              const spec: FrozenSpec = {
                name,
                initials: raw.initials || name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2),
                role: raw.role || (batch.group === "experts" ? "Panel expert" : "Resident"),
                tagline: raw.tagline,
                discipline: raw.discipline,
                kind,
                backstory: raw.backstory ?? "",
                stances: Array.isArray(raw.stances) ? raw.stances.slice(0, 2) : [],
                demographics: raw.demographics,
                seat: {
                  role: raw.role ?? "", why: "", discipline: String(raw.discipline ?? "").toUpperCase().slice(0, 20),
                  adversarial: false, provenance: "generated", tier: "crowd",
                },
              };
              const key = `crowd-${batch.group === "experts" ? "e" : "r"}-${++keySeq}`;
              rows.push({ sim_id: id, persona_id: null, agent_key: key, spec_frozen: spec });
              members.push({ key, spec });
            }
            if (rows.length) {
              const { error: insErr } = await supabase.from("sim_agents").insert(rows);
              if (insErr) throw new Error(insErr.message);
              generated += rows.length;
              emit({ type: "members", members, generated });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

        if (generated === 0) throw new Error("Crowd generation produced no members — try again");

        await supabase.from("simulations").update({
          config: {
            ...((sim.config as Record<string, unknown>) ?? {}),
            casting: {
              ...(casting as Record<string, unknown>),
              crowd: { generated, sampled_of: target, at: new Date().toISOString() },
            },
          },
        }).eq("id", id);

        emit({ type: "done", generated, sample, target });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "Crowd generation failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Clear the materialized crowd (the counts + band stay; regenerate any time). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.from("sim_agents").delete().eq("sim_id", id).like("agent_key", "crowd-%");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: sim } = await supabase.from("simulations").select("config").eq("id", id).maybeSingle();
  const config = (sim?.config as Record<string, unknown>) ?? {};
  const casting = (config.casting as Record<string, unknown>) ?? null;
  if (casting?.crowd) {
    delete casting.crowd;
    await supabase.from("simulations").update({ config: { ...config, casting } }).eq("id", id);
  }
  return NextResponse.json({ ok: true });
}
