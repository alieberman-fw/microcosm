import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { PersonaSpec } from "@/lib/personas";
import { BriefContract } from "@/lib/understand";
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
        // regenerate semantics: clear the previous GENERATED crowd only —
        // hand-picked members (crowd-N keys from the agents route / packs)
        // survive a regenerate; remove them individually from the roster
        await supabase.from("sim_agents").delete().eq("sim_id", id)
          .or("agent_key.like.crowd-e-%,agent_key.like.crowd-r-%");

        emit({ type: "start", target, sample, experts: expertsSample, residents: residentsSample });

        // Wave 2b (audit U-H6/H7/H8): the crowd IS the sentiment population —
        // it gets the brief's world, not a 500-char excerpt: the contract's
        // cohorts (geography, income, tenure), constraints, and the poll
        // questions it will actually be asked.
        const contract = (brief as { contract?: BriefContract } | null)?.contract;
        const cohorts = contract?.population_hints?.cohorts ?? [];
        const cohortLines = cohorts.length
          ? `COHORTS TO REPRESENT (ground members in these, proportionally):\n${cohorts.map((c, i) => `- [${i + 1}] ${c.desc}${c.geography ? ` · geography: ${c.geography}` : ""}`).join("\n")}\n`
          : "";
        const constraintLines = (contract?.constraints ?? []).length
          ? `CONSTRAINTS THAT SHAPE THIS MARKET: ${contract!.constraints!.join(" · ")}\n`
          : "";
        const pollLines = (Array.isArray(contract?.poll_plan) ? contract!.poll_plan! : [])
          .map((a) => a.question).filter(Boolean).slice(0, 3);
        const pollLine = pollLines.length
          ? `THESE PEOPLE WILL BE POLLED ON: ${pollLines.join(" · ")} — give them lives and stances that make their answers MEAN something.\n`
          : "";
        const briefLine =
          `PROBLEM: ${(brief?.problem ?? "").slice(0, 2000)}\n` +
          cohortLines + constraintLines + pollLine;
        // U-H26: a regenerate must not mint a duplicate of a preserved
        // hand-picked member — seed the avoid-set from EVERY surviving row
        const seenNames = new Set([
          ...leadSpecs.map((f) => f.name),
          ...(agents ?? []).map((a) => (a.spec_frozen as FrozenSpec)?.name),
        ].filter(Boolean));
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

        // persist a batch's specs (dedupe by name, cap at `limit`); returns how many landed
        const generatedBy = { experts: 0, residents: 0 };
        const persist = async (specs: PersonaSpec[], group: "experts" | "residents", limit: number) => {
          const rows: { sim_id: string; persona_id: null; agent_key: string; spec_frozen: FrozenSpec }[] = [];
          const members: { key: string; spec: FrozenSpec }[] = [];
          for (const raw of specs) {
            if (rows.length >= limit) break;
            const name = String(raw.name).trim();
            if (!name || seenNames.has(name)) continue; // duplicate across concurrent batches — drop
            seenNames.add(name);
            const kind = group === "experts"
              ? "expert"
              : (raw.kind === "consumer" ? "consumer" : "resident");
            const spec: FrozenSpec = {
              name,
              initials: raw.initials || name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2),
              role: raw.role || (group === "experts" ? "Panel expert" : "Resident"),
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
            const key = `crowd-${group === "experts" ? "e" : "r"}-${++keySeq}`;
            rows.push({ sim_id: id, persona_id: null, agent_key: key, spec_frozen: spec });
            members.push({ key, spec });
          }
          if (rows.length) {
            const { error: insErr } = await supabase.from("sim_agents").insert(rows);
            if (insErr) throw new Error(insErr.message);
            generated += rows.length;
            generatedBy[group] += rows.length;
            emit({ type: "members", members, generated });
          }
          return rows.length;
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
            await persist(specs, batch.group, batch.count);
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

        // top up the dedupe shortfall UNTIL THE COUNT IS EXACT (field report:
        // 191 of 192 survived multiple regenerations — the old single pass
        // could itself produce a duplicate and strand the count forever).
        // Each retry asks for a couple of SPARES so one collision can't
        // re-strand it; persist() caps at the deficit so we never overshoot.
        for (const group of ["experts", "residents"] as const) {
          const want = group === "experts" ? expertsSample : residentsSample;
          for (let attempt = 0; attempt < 4; attempt++) {
            const short = want - generatedBy[group];
            if (short <= 0) break;
            const ask = Math.min(short + 2, CROWD_BATCH);
            const specs = await runBatch({ group, count: ask, index: 900 + attempt * 10 + (group === "experts" ? 1 : 2) });
            const landed = await persist(specs, group, short);
            if (landed === 0 && specs.length === 0) break; // API dead — fail honest below, don't spin
          }
        }

        if (generated === 0) throw new Error("Crowd generation produced no members — try again");

        // FRESH read-merge-write: this stream runs for minutes, and spreading
        // the config snapshot from request start clobbered everything written
        // meanwhile — the field incident wiped a user's mode choice AND a live
        // run's run_state heartbeat (stall → reclaim → the mode "flip")
        const { data: freshSim } = await supabase.from("simulations").select("config").eq("id", id).maybeSingle();
        const freshConfig = (freshSim?.config as Record<string, unknown>) ?? {};
        const freshCasting = (freshConfig.casting as Record<string, unknown>) ?? {};
        await supabase.from("simulations").update({
          config: {
            ...freshConfig,
            casting: {
              ...freshCasting,
              crowd: { generated, sample, sampled_of: target, at: new Date().toISOString() },
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

  // CLEAR THE CROWD clears the generated crowd; hand-picked members stay
  const { error } = await supabase.from("sim_agents").delete().eq("sim_id", id)
    .or("agent_key.like.crowd-e-%,agent_key.like.crowd-r-%");
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
