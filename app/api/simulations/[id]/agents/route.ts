import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { PersonaSpec } from "@/lib/personas";
import { FrozenSpec, MAX_SEATS, seatKey } from "@/lib/casting";

/**
 * Hand-pick seats (CLAUDE.md §3.2C): add specific personas to the cast —
 * no model calls, no tokens. Works standalone (fully manual panel) or after
 * an auto-cast (refine by adding). RLS scopes both the sim and the personas.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { personaIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const personaIds = [...new Set((body.personaIds ?? []).filter((p) => typeof p === "string"))].slice(0, MAX_SEATS);
  if (personaIds.length === 0) return NextResponse.json({ error: "Pick at least one persona" }, { status: 400 });

  const { data: sim } = await supabase.from("simulations").select("id").eq("id", id).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

  const { data: existing } = await supabase.from("sim_agents")
    .select("agent_key, persona_id").eq("sim_id", id);
  const existingIds = new Set((existing ?? []).map((e) => e.persona_id));
  const existingKeys = new Set((existing ?? []).map((e) => e.agent_key as string));
  // only LEAD seats count toward the cap — crowd members (crowd-* keys) don't
  const leadCount = (existing ?? []).filter((e) => !(e.agent_key as string).startsWith("crowd-")).length;
  if (leadCount + personaIds.length > MAX_SEATS) {
    return NextResponse.json({ error: `Lead seats are capped at ${MAX_SEATS} — the crowd is unlimited up to your totals` }, { status: 400 });
  }

  const { data: personas, error: pErr } = await supabase
    .from("personas").select("id, org_id, kind, spec").in("id", personaIds);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const seats: { key: string; provenance: "yours" | "library"; spec: FrozenSpec }[] = [];
  const rows = [];
  let i = existingKeys.size;
  for (const p of personas ?? []) {
    if (existingIds.has(p.id)) continue;
    const spec = p.spec as PersonaSpec;
    const provenance: "yours" | "library" = p.org_id ? "yours" : "library";
    let key = seatKey(spec.role || spec.name, ++i);
    while (existingKeys.has(key)) key = seatKey(spec.role || spec.name, ++i);
    existingKeys.add(key);
    const frozen: FrozenSpec = {
      ...spec,
      seat: {
        role: spec.role || "Panelist",
        why: "Hand-picked by the user",
        discipline: (spec.discipline ?? spec.category ?? "PANEL").toUpperCase().slice(0, 20),
        adversarial: spec.kind === "adversarial",
        provenance,
      },
    };
    rows.push({ sim_id: id, persona_id: p.id, agent_key: key, spec_frozen: frozen });
    seats.push({ key, provenance, spec: frozen });
  }
  if (rows.length === 0) return NextResponse.json({ error: "Those personas are already on the panel" }, { status: 400 });

  const { error: insErr } = await supabase.from("sim_agents").insert(rows);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ seats });
}
