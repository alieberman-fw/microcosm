import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";

const FILES_BETA = "files-api-2025-04-14";

/** Signed URL so the user can open the original document (5-minute link). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: doc } = await supabase.from("documents").select("storage_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 300);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}

/** Remove a document everywhere: chunks (cascade), Storage, Files API, row. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: doc } = await supabase.from("documents")
    .select("id, storage_path, anthropic_file_id").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.storage.from("documents").remove([doc.storage_path]);
  if (doc.anthropic_file_id && process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic();
      await anthropic.beta.files.delete(doc.anthropic_file_id, { betas: [FILES_BETA] });
    } catch {
      // best-effort — orphaned Files API objects are harmless
    }
  }
  return NextResponse.json({ ok: true });
}
