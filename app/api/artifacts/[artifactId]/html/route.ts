import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Serve an artifact's HTML for the panel viewer and open-in-tab. Supabase
 * Storage deliberately serves text/html objects as text/plain (XSS
 * protection on its domain), so signed URLs show source — this route
 * downloads server-side (RLS proves access first) and returns real HTML
 * under `Content-Security-Policy: sandbox`: the document renders with its
 * styles but runs no scripts and has an opaque origin, in the panel's
 * sandboxed iframe AND in a full tab.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: artifact } = await supabase.from("report_artifacts")
    .select("id, name, storage_path").eq("id", artifactId).maybeSingle();
  if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

  const { data: blob, error } = await supabase.storage.from("documents").download(artifact.storage_path);
  if (error || !blob) return NextResponse.json({ error: error?.message ?? "Could not read the document" }, { status: 500 });

  return new Response(await blob.text(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
