import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { PersonaSpec } from "@/lib/personas";
import { normalizeQuestions, normalizeSuccess } from "@/lib/corpus";
import {
  CastPlan, CastSeat, FrozenSpec, MAX_SEATS, SIM_MODES,
  CASTING_MODEL, CROWD_MODEL, castingAddSystem, castingGenerateSystem, castingPlanSystem, overlapScore, seatKey,
} from "@/lib/casting";
import { parseLooseArray, parseLooseObject } from "@/lib/llm-json";

export const maxDuration = 180; // plan + generation calls for a full panel

/**
 * The Casting Director (CLAUDE.md §3.2A, demo Stage 02), streamed as ND-JSON:
 *   {type:"plan", ...}          the composition, scale, mode, and seat list
 *   {type:"seat", ...}          one per seat as it resolves (match or generated)
 *   {type:"done"} | {type:"error"}
 * Matching order: the org's own personas → the global library (FTS) →
 * generate the true gaps and save them to the org's custom library so the
 * catalog self-heals. Every seat freezes its spec into sim_agents.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: { guidance?: string; mode?: string; seats?: number; composition?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const guidance = (body.guidance ?? "").trim().slice(0, 500);
  const addMode = body.mode === "add";
  const targetSeats = typeof body.seats === "number" ? Math.min(Math.max(Math.round(body.seats), 4), MAX_SEATS) : undefined;
  const compOverride = (["experts", "consumers", "mixed"] as const).find((c) => c === body.composition);
  if (addMode && !guidance) return NextResponse.json({ error: "Describe who to add" }, { status: 400 });

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const { data: sim } = await supabase.from("simulations").select("id, brief, config").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const brief = sim.brief as { problem?: string; questions?: unknown; success?: unknown; template?: string };
  if (!brief?.problem) return NextResponse.json({ error: "Write the brief first" }, { status: 400 });

  // corpus inventory + a taste of each doc so casting sees what evidence exists
  const { data: docs } = await supabase.from("documents")
    .select("id, name, token_estimate, page_count").eq("sim_id", id).eq("parse_status", "parsed");
  const docLines: string[] = [];
  for (const d of docs ?? []) {
    const { data: chunks } = await supabase.from("doc_chunks")
      .select("content").eq("document_id", d.id).order("seq").limit(2);
    const opening = (chunks ?? []).map((c) => c.content).join(" ").replace(/\s+/g, " ").slice(0, 700);
    const excerpt = opening ? ` — opens: "${opening}…"` : "";
    docLines.push(`- ${d.name} (${d.page_count ? `${d.page_count}p, ` : ""}~${d.token_estimate ?? "?"} tokens)${excerpt}`);
  }

  // anchor re-casts to the previous plan so composition/mode/scale stay
  // stable run-to-run unless the brief or the user's guidance warrants change
  const prevPlan = ((sim.config as { casting?: { composition?: string; mode?: string; scale?: { experts?: number; residents?: number } } } | null)?.casting) ?? null;
  const prevLine = !addMode && prevPlan?.composition
    ? `PREVIOUS CASTING PLAN (stay consistent with it — composition "${prevPlan.composition}", mode ${prevPlan.mode}, scale ${JSON.stringify(prevPlan.scale)} — unless the brief or the user's guidance clearly warrants a change; if you change it, say why in the rationale):
`
    : "";

  const questions = normalizeQuestions(brief.questions);
  const success = normalizeSuccess(brief.success);
  const briefText =
    `PROBLEM: ${brief.problem}\n` +
    (questions.length ? `QUESTIONS TO RESOLVE:\n${questions.map((q) => `- ${q.label}${q.detail ? ` — ${q.detail}` : ""}`).join("\n")}\n` : "") +
    (success.length ? `SUCCESS CRITERIA:\n${success.map((s) => `- ${s}`).join("\n")}\n` : "") +
    (brief.template && brief.template !== "Custom" ? `DECISION SHAPE (internal classification): ${brief.template}\n` : "") +
    (docLines.length ? `DILIGENCE CORPUS:\n${docLines.join("\n")}\n` : "DILIGENCE CORPUS: none uploaded yet\n") +
    prevLine +
    (guidance ? `USER GUIDANCE FOR THIS CAST (apply it): ${guidance}\n` : "");

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();

  const logCall = async (surface: string, model: string, usage: { input_tokens: number; output_tokens: number } | null, t0: number, error?: string, detail?: Record<string, unknown>) => {
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface, model, sim_id: id,
      input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
      latency_ms: Date.now() - t0, status: error ? "error" : "ok", error: error ?? null,
      detail: detail ?? null,
    });
  };

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        // ---- 1 · the plan (salvage truncation; one silent retry) ----
        // add-more mode extends the current panel instead of replacing it
        const { data: existingAgents } = addMode
          ? await supabase.from("sim_agents").select("agent_key, spec_frozen").eq("sim_id", id)
          : { data: [] as { agent_key: string; spec_frozen: FrozenSpec }[] };
        // only LEAD seats count toward the cap and the roster context — crowd rows don't
        const existingRoles = (existingAgents ?? [])
          .filter((a) => (a.spec_frozen as FrozenSpec).seat?.tier !== "crowd")
          .map((a) => {
            const f = a.spec_frozen as FrozenSpec;
            return `${f.seat?.role ?? f.role} (${f.name})`;
          });
        const maxNew = Math.max(1, MAX_SEATS - existingRoles.length);
        if (addMode && existingRoles.length >= MAX_SEATS) throw new Error(`Lead seats are capped at ${MAX_SEATS}`);

        // The plan must NEVER surface a truncation error to the user: a big
        // budget makes truncation rare, and when a partial plan still lands
        // short of the target, a CONTINUATION call asks for only the missing
        // seats (same JSON shape) and the lists merge. Hard failure only when
        // no seats can be produced at all.
        let raw: Record<string, unknown> & { seats?: unknown; scale?: { experts?: unknown; residents?: unknown }; composition?: unknown; mode?: unknown } = {};
        for (let attempt = 0; attempt < 2; attempt++) {
          const t0 = Date.now();
          const planRes = await anthropic.messages.create({
            model: CASTING_MODEL,
            max_tokens: 9000, // 20 seats + reasoning + summaries with adaptive-thinking headroom
            system: addMode ? castingAddSystem(existingRoles, maxNew) : castingPlanSystem(targetSeats, compOverride),
            messages: [{ role: "user", content: briefText }],
          });
          await logCall("casting.plan", CASTING_MODEL, planRes.usage, t0, undefined, {
            problem: (brief.problem ?? "").slice(0, 160), mode: addMode ? "add" : "recast",
            guidance: guidance || null, target_seats: targetSeats ?? null, composition: compOverride ?? null,
          });
          const planText = planRes.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
          const parsed = parseLooseObject(planText);
          if (parsed && Array.isArray(parsed.seats) && parsed.seats.length > 0) { raw = parsed as typeof raw; break; }
          if (attempt === 1) throw new Error(`Casting pass returned no usable plan (stop: ${planRes.stop_reason})`);
        }

        // continuation top-up: fill any remaining seat definitions (max 2 passes)
        for (let topup = 0; topup < 2; topup++) {
          const have = Array.isArray(raw.seats) ? (raw.seats as { role?: string; kind?: string }[]) : [];
          const want = addMode ? undefined : targetSeats;
          if (want === undefined || have.length >= want) break;
          const missing = want - have.length;
          const tt = Date.now();
          try {
            const contRes = await anthropic.messages.create({
              model: CASTING_MODEL,
              max_tokens: Math.min(9000, 600 * missing + 800),
              system:
                `You are completing a Casting Director seat list for a real-estate simulation panel. ` +
                `Seats already defined: ${have.map((s) => `${s.role} (${s.kind})`).join("; ")}. ` +
                `Produce ONLY a JSON array of EXACTLY ${missing} ADDITIONAL seats (no duplicates of the above, keep at most one adversarial across the whole panel${have.some((s) => s.kind === "adversarial") ? " — one already exists, so add NONE" : ""}): ` +
                `[{"role": "...", "kind": "expert|consumer|resident|stakeholder|adversarial", "discipline": "SHORT UPPERCASE", "why": "one clause, <=12 words", "query": "2-4 lowercase keywords"}]`,
              messages: [{ role: "user", content: briefText }],
            });
            await logCall("casting.plan", CASTING_MODEL, contRes.usage, tt, undefined, { mode: "seat-topup", missing });
            const contText = contRes.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
            const more = parseLooseArray(contText);
            if (Array.isArray(more) && more.length) raw.seats = [...have, ...more].slice(0, want);
            else break;
          } catch (e) {
            await logCall("casting.plan", CASTING_MODEL, null, tt, e instanceof Error ? e.message : "seat topup failed", { mode: "seat-topup", missing });
            break; // proceed with what we have — a slightly short panel beats an error
          }
        }

        const keyOffset = existingRoles.length;
        const seats: CastSeat[] = (Array.isArray(raw.seats) ? raw.seats : []).slice(0, addMode ? maxNew : MAX_SEATS)
          .map((s: { role?: string; kind?: string; discipline?: string; why?: string; query?: string }, i: number): CastSeat => ({
            key: seatKey(String(s.role ?? "seat"), keyOffset + i + 1),
            role: String(s.role ?? "Panelist").slice(0, 80),
            kind: ["expert", "consumer", "resident", "stakeholder", "adversarial"].includes(String(s.kind)) ? (s.kind as CastSeat["kind"]) : "expert",
            discipline: String(s.discipline ?? "PANEL").toUpperCase().slice(0, 20),
            why: String(s.why ?? "").slice(0, 200),
            query: String(s.query ?? s.role ?? "").slice(0, 80),
          }));
        if (seats.length === 0) throw new Error("Casting pass produced no seats");

        const clip = (s: unknown, n: number) => {
          const str = String(s ?? "");
          if (str.length <= n) return str;
          const cut = str.slice(0, n);
          return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 40))}…`;
        };
        const plan: CastPlan = {
          composition: compOverride ?? (["experts", "consumers", "mixed"] as const).find((c) => c === raw.composition) ?? "mixed",
          rationale: clip(raw.rationale, 1200),
          rationaleSummary: clip((raw as { rationale_summary?: unknown }).rationale_summary ?? raw.rationale, 260),
          scale: {
            experts: Math.min(Math.max(Number(raw.scale?.experts) || seats.length, 4), 500),
            residents: Math.min(Math.max(Number(raw.scale?.residents) || 0, 0), 1000),
          },
          mode: SIM_MODES.find((m) => m === raw.mode) ?? "Agora",
          modeRationale: clip(raw.mode_rationale, 900),
          modeSummary: clip((raw as { mode_summary?: unknown }).mode_summary ?? raw.mode_rationale, 260),
          seats,
        };
        emit({ type: "plan", ...plan, add: addMode });

        // frozen spec = persona + seat metadata (+ adversarial mandate) — built
        // up-front so live seat events render exactly what gets persisted
        const freeze = (seat: CastSeat, spec: PersonaSpec, provenance: "yours" | "library" | "generated"): FrozenSpec => {
          const frozen: FrozenSpec = {
            ...spec,
            seat: { role: seat.role, why: seat.why, discipline: seat.discipline, adversarial: seat.kind === "adversarial", provenance },
          };
          if (seat.kind === "adversarial") {
            frozen.stances = [
              ...(spec.stances ?? []),
              "ADVERSARIAL MANDATE: your job on this panel is to attack the thesis — find the failure modes, stress the assumptions, and refuse easy consensus.",
            ];
          }
          return frozen;
        };

        // ---- 2 · match: org custom personas first, then the global library ----
        const { data: customRows } = await supabase.from("personas")
          .select("id, kind, spec").eq("org_id", orgId).limit(200);
        const usedPersonaIds = new Set<string>();
        if (addMode) {
          const { data: seated } = await supabase.from("sim_agents").select("persona_id").eq("sim_id", id);
          for (const r of seated ?? []) if (r.persona_id) usedPersonaIds.add(r.persona_id as string);
        }
        const resolved: { seat: CastSeat; personaId: string; spec: FrozenSpec; provenance: "yours" | "library" }[] = [];
        const gaps: CastSeat[] = [];

        for (const seat of seats) {
          const seatText = `${seat.role} ${seat.query}`;
          // 2a — the org's own people
          let best: { id: string; spec: PersonaSpec } | null = null;
          let bestScore = 0;
          for (const row of customRows ?? []) {
            if (usedPersonaIds.has(row.id)) continue;
            const score = overlapScore(seatText, row.spec as PersonaSpec);
            if (score > bestScore) { best = { id: row.id, spec: row.spec as PersonaSpec }; bestScore = score; }
          }
          if (best && bestScore >= 2) {
            usedPersonaIds.add(best.id);
            const frozenYours = freeze(seat, best.spec, "yours");
            resolved.push({ seat, personaId: best.id, spec: frozenYours, provenance: "yours" });
            emit({ type: "seat", key: seat.key, provenance: "yours", spec: frozenYours });
            continue;
          }
          // 2b — the global library (FTS; residents/consumers match their own kinds)
          const kinds = seat.kind === "consumer" || seat.kind === "resident" ? ["consumer", "resident"] : null;
          let hit: { id: string; spec: PersonaSpec } | null = null;
          // FIT GATE: the loose OR-query fallback once seated a Wine Cellar
          // Builder as "Pool Design & Build Specialist" on a shared word.
          // Strong lexical overlap passes free; anything weaker must survive a
          // Haiku yes/no before it takes the seat — rejects become generated.
          let fitChecks = 0;
          const fits = async (spec: PersonaSpec): Promise<boolean> => {
            if (overlapScore(`${seat.role} ${seat.query}`, spec) >= 2) return true;
            if (fitChecks >= 3) return false; // bound model calls per seat
            fitChecks += 1;
            const tf = Date.now();
            try {
              const res = await anthropic.messages.create({
                model: CROWD_MODEL, max_tokens: 8,
                system: `Casting fit check for an expert panel. Reply ONLY "yes" or "no": could this person credibly hold this seat and speak with first-hand authority on it? A neighboring trade or generic overlap is "no".`,
                messages: [{ role: "user", content: `SEAT: ${seat.role}${seat.why ? ` — ${seat.why}` : ""}\nPERSON: ${spec.role}${spec.tagline ? ` — ${spec.tagline}` : ""}` }],
              });
              await logCall("casting.fit", CROWD_MODEL, res.usage, tf, undefined, { seat: seat.role, candidate: spec.role });
              const verdict = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").toLowerCase();
              return verdict.includes("yes");
            } catch (e) {
              await logCall("casting.fit", CROWD_MODEL, null, tf, e instanceof Error ? e.message : "fit check failed");
              return true; // fail open — a plausible FTS match beats a dead cast
            }
          };
          // websearch syntax ANDs terms — retry progressively looser, ending OR-joined
          const orQuery = [...new Set(`${seat.query} ${seat.role}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3))].join(" or ");
          outer: for (const q of [seat.query, seat.role.toLowerCase(), orQuery]) {
            if (!q) continue;
            const { data: rows } = await supabase.rpc("search_personas", {
              q, kinds, cats: null, age_min: null, age_max: null, tenure_f: null,
              sort: "relevance", off_set: 0, lim: 5,
            });
            for (const r of (rows as { id: string; spec: PersonaSpec }[] | null) ?? []) {
              if (usedPersonaIds.has(r.id)) continue;
              if (await fits(r.spec)) { hit = r; break outer; }
            }
          }
          if (hit) {
            usedPersonaIds.add(hit.id);
            const frozenLib = freeze(seat, hit.spec, "library");
            resolved.push({ seat, personaId: hit.id, spec: frozenLib, provenance: "library" });
            emit({ type: "seat", key: seat.key, provenance: "library", spec: frozenLib });
          } else {
            gaps.push(seat);
          }
        }

        // ---- 3 · generate the true gaps, save them back to the org library ----
        // gaps generate in CONCURRENT chunks of 4 — one giant serial call was
        // the slow tail on big panels (10 gaps ≈ one 7K-token generation)
        const generated: { seat: CastSeat; personaId: string; spec: FrozenSpec }[] = [];
        if (gaps.length) {
          const avoid = [...(customRows ?? []).map((r) => (r.spec as PersonaSpec).name), ...resolved.map((r) => r.spec.name)]
            .filter(Boolean).slice(0, 60);
          const CHUNK = 4;
          const chunks: CastSeat[][] = [];
          for (let i = 0; i < gaps.length; i += CHUNK) chunks.push(gaps.slice(i, i + CHUNK));
          const chunkSpecs = await Promise.all(chunks.map(async (chunk) => {
            const t1 = Date.now();
            try {
              const genRes = await anthropic.messages.create({
                model: CASTING_MODEL,
                max_tokens: 700 * chunk.length + 500,
                system: castingGenerateSystem(),
                messages: [{
                  role: "user",
                  content:
                    `BRIEF CONTEXT:\n${briefText}\nAVOID THESE NAMES: ${avoid.join(", ") || "none"}\n\nSEATS TO CREATE:\n` +
                    chunk.map((s) => `- seat_key ${s.key}: ${s.role} (kind ${s.kind}, discipline ${s.discipline}) — ${s.why}`).join("\n"),
                }],
              });
              await logCall("casting.generate", CASTING_MODEL, genRes.usage, t1, undefined, { seats: chunk.length });
              const genText = genRes.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
              return (parseLooseArray(genText) ?? []) as (PersonaSpec & { seat_key?: string })[];
            } catch (e) {
              await logCall("casting.generate", CASTING_MODEL, null, t1, e instanceof Error ? e.message : "generate failed", { seats: chunk.length });
              return [] as (PersonaSpec & { seat_key?: string })[];
            }
          }));
          // concurrent chunks can't see each other's names — de-collide here
          const usedNames = new Set(avoid.map((n) => n.toLowerCase()));
          for (let ci = 0; ci < chunks.length; ci++) {
          const specsChunk = chunkSpecs[ci];
          for (const seat of chunks[ci]) {
            const genSpec = specsChunk.find((s) => s.seat_key === seat.key) ?? specsChunk[chunks[ci].indexOf(seat)];
            if (!genSpec?.name) { emit({ type: "seat", key: seat.key, provenance: "failed" }); continue; }
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
              kind: seat.kind === "adversarial" ? "adversarial" : (genSpec.kind ?? seat.kind),
              backstory: genSpec.backstory ?? "",
              stances: Array.isArray(genSpec.stances) ? genSpec.stances.slice(0, 4) : [],
              skills: Array.isArray(genSpec.skills) ? genSpec.skills.slice(0, 6) : [],
              traits: genSpec.traits,
              demographics: genSpec.demographics,
            };
            const { data: inserted, error: insErr } = await supabase.from("personas")
              .insert({ org_id: orgId, kind: spec.kind, spec, source: "auto", author_org: orgId })
              .select("id").single();
            if (insErr || !inserted) { emit({ type: "seat", key: seat.key, provenance: "failed" }); continue; }
            const frozenGen = freeze(seat, spec, "generated");
            generated.push({ seat, personaId: inserted.id, spec: frozenGen });
            emit({ type: "seat", key: seat.key, provenance: "generated", spec: frozenGen });
          }
          }
        }

        // ---- 4 · freeze the cast ----
        if (!addMode) {
          // re-cast replaces the population — the old transcript referenced
          // agents that no longer exist, so run artifacts reset with it
          // (brief, corpus, and the user's run parameters are kept)
          await supabase.from("sim_agents").delete().eq("sim_id", id);
          await supabase.from("posts").delete().eq("sim_id", id);
          await supabase.from("events").delete().eq("sim_id", id);
        }
        const all = [
          ...resolved.map((r) => ({ ...r, provenance: r.provenance as "yours" | "library" | "generated" })),
          ...generated.map((g) => ({ ...g, provenance: "generated" as const })),
        ];
        const rows = all.map(({ seat, personaId, spec }) => (
          { sim_id: id, persona_id: personaId, agent_key: seat.key, spec_frozen: spec }
        ));
        if (rows.length === 0) throw new Error("No seats could be cast");
        const { error: agentErr } = await supabase.from("sim_agents").insert(rows);
        if (agentErr) throw new Error(agentErr.message);

        const prevCasting = ((sim.config as { casting?: Record<string, unknown> } | null)?.casting) ?? null;
        const prevConfig = (sim.config as Record<string, unknown>) ?? {};
        if (!addMode) { delete prevConfig.run_state; delete prevConfig.run_result; }
        await supabase.from("simulations").update({
          ...(addMode ? {} : { status: "draft" }),
          config: {
            ...prevConfig,
            casting: addMode && prevCasting
              ? { ...prevCasting, last_addition: guidance, cast_at: new Date().toISOString() }
              : {
                  composition: plan.composition, rationale: plan.rationale, rationaleSummary: plan.rationaleSummary, scale: plan.scale,
                  // mode is CHOSEN in run config; the director's pick seeds it and
                  // recommended_mode survives user changes so the card stays tagged
                  mode: plan.mode, recommended_mode: plan.mode, modeRationale: plan.modeRationale, modeSummary: plan.modeSummary,
                  guidance: guidance || null, cast_at: new Date().toISOString(),
                },
          },
        }).eq("id", id);

        emit({ type: "done", seats: rows.length, generated: generated.length, add: addMode });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "Casting failed" });
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
