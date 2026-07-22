import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeQuestions, normalizeSuccess, BriefQuestion } from "@/lib/corpus";

/**
 * Create a simulation from the brief composer (CLAUDE.md §2 Stage 1).
 * v1 keeps one implicit project per org; the projects surface arrives with
 * multi-user orgs.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { problem?: string; questions?: BriefQuestion[]; template?: string; success?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const problem = (body.problem ?? "").trim();
  if (!problem || problem.length > 2000) {
    return NextResponse.json({ error: "Problem statement must be 1–2000 characters" }, { status: 400 });
  }
  const questions = normalizeQuestions(body.questions);
  const template = (body.template ?? "Custom").slice(0, 60);
  const success = normalizeSuccess(body.success);

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });

  // one implicit project per org for now
  let { data: project } = await supabase.from("projects").select("id").limit(1).maybeSingle();
  if (!project) {
    const { data: created, error } = await supabase
      .from("projects").insert({ org_id: userRow.org_id, name: "Default project" }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    project = created;
  }

  const { data: sim, error: simErr } = await supabase
    .from("simulations")
    .insert({
      project_id: project.id,
      status: "draft",
      brief: { problem, questions, template, success },
      created_by: user.id,
    })
    .select("id")
    .single();
  if (simErr) return NextResponse.json({ error: simErr.message }, { status: 500 });

  return NextResponse.json({ id: sim.id });
}
