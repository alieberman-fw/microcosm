import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import { PersonaSpec } from "@/lib/personas";
import { CASTING_MODEL } from "@/lib/casting";
import { parseLooseObject } from "@/lib/llm-json";
import { PACK_CAPS, parsePackKind } from "@/lib/packs";
import { MAX_PACK_PROMPT, packDraftSystem } from "@/lib/packs-cast";

export const maxDuration = 60;

/**
 * Draft ONE new pack member from a one-liner (§3.2C: "a land-use attorney
 * who's fought three data-center CUPs") — always GENERATES (the user asked
 * for someone new; matching is what the search box is for), saves to the
 * org's custom library, and appends to the pack. Returns the member row.
 */
export async function POST(request: Request, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body: { prompt?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const prompt = (body.prompt ?? "").trim().slice(0, MAX_PACK_PROMPT);
  if (!prompt) return NextResponse.json({ error: "Describe the person" }, { status: 400 });

  const { data: pack } = await supabase.from("persona_sets")
    .select("id, kind, persona_ids").eq("id", packId).maybeSingle();
  if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  const kind = parsePackKind(pack.kind) ?? "panel";
  const ids = (pack.persona_ids ?? []) as string[];
  if (ids.length >= PACK_CAPS[kind]) {
    return NextResponse.json({ error: `This pack is full (${PACK_CAPS[kind]})` }, { status: 400 });
  }

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const anthropic = new Anthropic();
  const t0 = Date.now();
  let spec: PersonaSpec;
  try {
    const res = await anthropic.messages.create({
      model: CASTING_MODEL,
      max_tokens: 1400,
      system: packDraftSystem(),
      messages: [{ role: "user", content: `THE PERSON, AS DESCRIBED:\n${prompt}` }],
    });
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface: "packs.draft", model: CASTING_MODEL,
      input_tokens: res.usage?.input_tokens ?? null, output_tokens: res.usage?.output_tokens ?? null,
      latency_ms: Date.now() - t0, status: "ok", detail: { prompt: prompt.slice(0, 160), pack_id: packId },
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const raw = parseLooseObject(text) as (PersonaSpec & { name?: string }) | null;
    if (!raw?.name) throw new Error("The draft came back unusable — try rephrasing");
    spec = {
      name: String(raw.name).trim(),
      initials: raw.initials || String(raw.name).split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2),
      role: raw.role ?? "Panelist",
      tagline: raw.tagline,
      discipline: raw.discipline,
      kind: raw.kind ?? (kind === "crowd" ? "consumer" : "expert"),
      backstory: raw.backstory ?? "",
      stances: Array.isArray(raw.stances) ? raw.stances.slice(0, 4) : [],
      skills: Array.isArray(raw.skills) ? raw.skills.slice(0, 6) : [],
      traits: raw.traits,
      demographics: raw.demographics,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Draft failed";
    await supabase.from("agent_interactions").insert({
      org_id: orgId, user_id: user.id, surface: "packs.draft", model: CASTING_MODEL,
      latency_ms: Date.now() - t0, status: "error", error: msg.slice(0, 300), detail: { prompt: prompt.slice(0, 160), pack_id: packId },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const { data: inserted, error: insErr } = await supabase.from("personas")
    .insert({ org_id: orgId, kind: spec.kind, spec, source: "auto", author_org: orgId })
    .select("id, kind, spec").single();
  if (insErr || !inserted) return NextResponse.json({ error: insErr?.message ?? "Could not save the persona" }, { status: 500 });

  const { error: patchErr } = await supabase.from("persona_sets")
    .update({ persona_ids: [...ids, inserted.id], updated_at: new Date().toISOString() })
    .eq("id", packId);
  if (patchErr) return NextResponse.json({ error: patchErr.message }, { status: 500 });

  return NextResponse.json({ member: { id: inserted.id, kind: inserted.kind, spec: inserted.spec, source: "custom" } }, { status: 201 });
}
