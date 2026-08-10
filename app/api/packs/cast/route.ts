import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { PersonaSpec } from "@/lib/personas";
import {
  CASTING_MODEL, CROWD_MODEL, CastSeat, castingGenerateSystem, overlapScore, roleOverlap,
} from "@/lib/casting";
import { parseLooseArray, parseLooseObject } from "@/lib/llm-json";
import { MAX_PACKS_PER_ORG, PackKind, parsePackKind } from "@/lib/packs";
import { MAX_PACK_PROMPT, normalizePackPlan, packPlanSystem } from "@/lib/packs-cast";

export const maxDuration = 180; // plan + generation for a full roster

/**
 * The Pack Director — natural-language pack casting, streamed as ND-JSON:
 *   {type:"plan", name, kind, count, description, clamped, requested}
 *   {type:"member", provenance: "yours"|"library"|"generated"|"failed",
 *    member:{id,kind,spec}}                    — one per member as it resolves
 *   {type:"done", packId, matched, generated} | {type:"error"}
 * Same resolution order as the Casting Director: the org's own personas →
 * the global library (FTS + fit gate) → generate the true gaps and save
 * them to the org's custom library. The pack row is created at the END so
 * a failed cast never leaves an empty husk.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body: { prompt?: string; kind?: string; name?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const prompt = (body.prompt ?? "").trim().slice(0, MAX_PACK_PROMPT);
  if (!prompt) return NextResponse.json({ error: "Describe the pack" }, { status: 400 });
  const kindOverride = parsePackKind(body.kind) ?? undefined;
  const nameOverride = (body.name ?? "").trim() || undefined;

  const { count } = await supabase.from("persona_sets").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_PACKS_PER_ORG) {
    return NextResponse.json({ error: `Packs are capped at ${MAX_PACKS_PER_ORG} for now` }, { status: 400 });
  }
  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();

  const logCall = async (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => {
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface, model,
      input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
      latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null,
      detail: detail ?? { prompt: prompt.slice(0, 160) },
    });
  };

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        // ---- 1 · the plan ----
        let plan = null;
        for (let attempt = 0; attempt < 2 && !plan; attempt++) {
          const t0 = Date.now();
          const res = await anthropic.messages.create({
            model: CASTING_MODEL,
            max_tokens: 9000,
            system: packPlanSystem(kindOverride),
            messages: [{ role: "user", content: `THE PACK, AS DESCRIBED BY THE USER:\n${prompt}` }],
          });
          await logCall("packs.cast", CASTING_MODEL, res.usage, t0, undefined, { prompt: prompt.slice(0, 160), attempt });
          const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
          plan = normalizePackPlan(parseLooseObject(text), { kindOverride, nameOverride });
          if (!plan && attempt === 1) throw new Error(`The pack plan came back unusable (stop: ${res.stop_reason})`);
        }
        if (!plan) throw new Error("The pack plan came back unusable");
        emit({ type: "plan", name: plan.name, kind: plan.kind, count: plan.members.length, description: plan.description, clamped: plan.clamped, requested: plan.requested });

        // ---- 2 · match: org personas → global library (FTS + fit gate) ----
        const { data: customRows } = await supabase.from("personas")
          .select("id, kind, spec").eq("org_id", orgId).limit(200);
        const used = new Set<string>();
        const resolvedIds: string[] = [];
        let matched = 0;
        const gaps: CastSeat[] = [];

        for (const seat of plan.members) {
          const seatText = `${seat.role} ${seat.query}`;
          let fitChecks = 0;
          const fits = async (spec: PersonaSpec): Promise<boolean> => {
            if (roleOverlap(seat.role, spec.role) >= 2) return true;
            if (fitChecks >= 3) return false; // bound model calls per member
            fitChecks += 1;
            const tf = Date.now();
            try {
              const res = await anthropic.messages.create({
                model: CROWD_MODEL, max_tokens: 8,
                system: `Casting fit check. Reply ONLY "yes" or "no": could this person credibly hold this seat and speak with first-hand authority on it? A neighboring trade or generic overlap is "no".`,
                messages: [{ role: "user", content: `SEAT: ${seat.role}${seat.why ? ` — ${seat.why}` : ""}\nPERSON: ${spec.role}${spec.tagline ? ` — ${spec.tagline}` : ""}` }],
              });
              await logCall("packs.fit", CROWD_MODEL, res.usage, tf, undefined, { seat: seat.role, candidate: spec.role });
              return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").toLowerCase().includes("yes");
            } catch {
              return true; // fail open — a plausible FTS match beats a dead cast
            }
          };

          // 2a — the org's own people
          let best: { id: string; kind: string; spec: PersonaSpec } | null = null;
          let bestScore = 0;
          for (const row of customRows ?? []) {
            if (used.has(row.id as string)) continue;
            const score = overlapScore(seatText, row.spec as PersonaSpec);
            if (score > bestScore) {
              best = { id: row.id as string, kind: row.kind as string, spec: row.spec as PersonaSpec };
              bestScore = score;
            }
          }
          if (best && bestScore >= 2 && (await fits(best.spec))) {
            used.add(best.id);
            resolvedIds.push(best.id);
            matched++;
            emit({ type: "member", provenance: "yours", member: { id: best.id, kind: best.kind, spec: best.spec } });
            continue;
          }

          // 2b — the global library, progressively looser
          const kinds = seat.kind === "consumer" || seat.kind === "resident" ? ["consumer", "resident"] : null;
          const orQuery = [...new Set(`${seat.query} ${seat.role}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))].join(" or ");
          let hit: { id: string; kind: string; spec: PersonaSpec } | null = null;
          outer: for (const q of [seat.query, seat.role.toLowerCase(), orQuery]) {
            if (!q) continue;
            const { data: rows } = await supabase.rpc("search_personas", {
              q, kinds, cats: null, age_min: null, age_max: null, tenure_f: null,
              sort: "relevance", off_set: 0, lim: 5,
            });
            for (const r of (rows as { id: string; kind: string; spec: PersonaSpec }[] | null) ?? []) {
              if (used.has(r.id)) continue;
              if (await fits(r.spec)) { hit = r; break outer; }
            }
          }
          if (hit) {
            used.add(hit.id);
            resolvedIds.push(hit.id);
            matched++;
            emit({ type: "member", provenance: "library", member: { id: hit.id, kind: hit.kind, spec: hit.spec } });
          } else {
            gaps.push(seat);
          }
        }

        // ---- 3 · generate the gaps (concurrent chunks), save to the org library ----
        let generated = 0;
        if (gaps.length) {
          const avoid = (customRows ?? []).map((r) => (r.spec as PersonaSpec).name).filter(Boolean).slice(0, 60);
          const CHUNK = 4;
          const chunks: CastSeat[][] = [];
          for (let i = 0; i < gaps.length; i += CHUNK) chunks.push(gaps.slice(i, i + CHUNK));
          const chunkSpecs = await Promise.all(chunks.map(async (chunk) => {
            const t1 = Date.now();
            try {
              const res = await anthropic.messages.create({
                model: CASTING_MODEL,
                max_tokens: 700 * chunk.length + 500,
                system: castingGenerateSystem(),
                messages: [{
                  role: "user",
                  content:
                    `PACK CONTEXT (what the user asked for):\n${prompt}\nAVOID THESE NAMES: ${avoid.join(", ") || "none"}\n\nSEATS TO CREATE:\n` +
                    chunk.map((s) => `- seat_key ${s.key}: ${s.role} (kind ${s.kind}, discipline ${s.discipline}) — ${s.why}`).join("\n"),
                }],
              });
              await logCall("packs.generate", CASTING_MODEL, res.usage, t1, undefined, { seats: chunk.length });
              const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
              return (parseLooseArray(text) ?? []) as (PersonaSpec & { seat_key?: string })[];
            } catch (e) {
              await logCall("packs.generate", CASTING_MODEL, null, t1, e instanceof Error ? e.message : "generate failed", { seats: chunk.length });
              return [] as (PersonaSpec & { seat_key?: string })[];
            }
          }));
          const usedNames = new Set(avoid.map((n) => n.toLowerCase()));
          for (let ci = 0; ci < chunks.length; ci++) {
            for (const seat of chunks[ci]) {
              const genSpec = chunkSpecs[ci].find((s) => s.seat_key === seat.key) ?? chunkSpecs[ci][chunks[ci].indexOf(seat)];
              if (!genSpec?.name) { emit({ type: "member", provenance: "failed", role: seat.role }); continue; }
              if (usedNames.has(String(genSpec.name).trim().toLowerCase())) {
                const parts = String(genSpec.name).trim().split(/\s+/);
                genSpec.name = [parts[0], `${String.fromCharCode(66 + ci)}.`, ...parts.slice(1)].join(" ");
              }
              usedNames.add(String(genSpec.name).trim().toLowerCase());
              const spec: PersonaSpec = {
                name: String(genSpec.name).trim(),
                initials: genSpec.initials || String(genSpec.name).split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2),
                role: genSpec.role || seat.role,
                tagline: genSpec.tagline,
                discipline: seat.discipline,
                kind: genSpec.kind ?? seat.kind,
                backstory: genSpec.backstory ?? "",
                stances: Array.isArray(genSpec.stances) ? genSpec.stances.slice(0, 4) : [],
                skills: Array.isArray(genSpec.skills) ? genSpec.skills.slice(0, 6) : [],
                traits: genSpec.traits,
                demographics: genSpec.demographics,
              };
              const { data: inserted, error: insErr } = await supabase.from("personas")
                .insert({ org_id: orgId, kind: spec.kind, spec, source: "auto", author_org: orgId })
                .select("id").single();
              if (insErr || !inserted) { emit({ type: "member", provenance: "failed", role: seat.role }); continue; }
              resolvedIds.push(inserted.id as string);
              generated++;
              emit({ type: "member", provenance: "generated", member: { id: inserted.id, kind: spec.kind, spec } });
            }
          }
        }

        if (resolvedIds.length === 0) throw new Error("No members could be cast");

        // ---- 4 · the pack row, created last so failures leave nothing behind ----
        const { data: pack, error: packErr } = await supabase.from("persona_sets")
          .insert({
            org_id: orgId, created_by: user.id, name: plan.name, kind: plan.kind,
            description: plan.description || null, persona_ids: resolvedIds,
          })
          .select("id").single();
        if (packErr || !pack) throw new Error(packErr?.message ?? "Could not save the pack");

        emit({ type: "done", packId: pack.id, matched, generated, count: resolvedIds.length });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "Pack casting failed" });
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
