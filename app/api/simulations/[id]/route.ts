import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeQuestions, BriefQuestion } from "@/lib/corpus";

/** Update a simulation's brief (inline edits on /sim/[id]). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { problem?: string; questions?: BriefQuestion[]; template?: string; success?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const problem = (body.problem ?? "").trim();
  if (!problem || problem.length > 2000) {
    return NextResponse.json({ error: "Problem statement must be 1–2000 characters" }, { status: 400 });
  }
  const brief = {
    problem,
    questions: normalizeQuestions(body.questions),
    template: (body.template ?? "Custom").slice(0, 60),
    success: (body.success ?? "").trim().slice(0, 2000),
  };

  const { data, error } = await supabase
    .from("simulations").update({ brief }).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Delete a draft simulation (its documents, chunks, and storage objects). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: docs } = await supabase.from("documents").select("id, storage_path").eq("sim_id", id);
  if (docs?.length) {
    await supabase.storage.from("documents").remove(docs.map((d) => d.storage_path));
    await supabase.from("documents").delete().eq("sim_id", id); // chunks cascade
  }
  const { data, error } = await supabase.from("simulations").delete().eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
