import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { MAX_ARTIFACT_NAME } from "@/lib/artifacts";

/**
 * One analyst artifact (RLS scopes sim → project → org):
 * PATCH — rename (the panel's inline edit; the analyst renames via its tool).
 * DELETE — remove the row and the storage object.
 * (Reading happens through ./html — Storage won't serve text/html directly.)
 */

async function ownedArtifact(supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabase>>>, id: string) {
  const { data } = await supabase.from("report_artifacts")
    .select("id, sim_id, conversation_id, name, storage_path, created_at, updated_at")
    .eq("id", id).maybeSingle();
  return data;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { name?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = (body.name ?? "").trim().slice(0, MAX_ARTIFACT_NAME);
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const { data, error } = await supabase.from("report_artifacts")
    .update({ name, updated_at: new Date().toISOString() }).eq("id", artifactId)
    .select("id, name, updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ artifact: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const artifact = await ownedArtifact(supabase, artifactId);
  if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

  await supabase.storage.from("documents").remove([artifact.storage_path]);
  const { error } = await supabase.from("report_artifacts").delete().eq("id", artifactId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
