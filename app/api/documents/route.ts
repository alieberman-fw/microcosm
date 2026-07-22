import { NextResponse } from "next/server";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  chunkText, docKind, estimatePdfTokens, estimateTokens,
  CORPUS_QA_MODEL_LARGE, MAX_DOC_BYTES, MAX_DOCS_PER_SIM,
} from "@/lib/corpus";

export const maxDuration = 120; // parsing + Files API upload for big PDFs

const FILES_BETA = "files-api-2025-04-14";

/**
 * Corpus upload (CLAUDE.md §2 Stage 2), one file per request:
 * 1. store the original in Supabase Storage (org-scoped folder),
 * 2. extract text locally (unpdf for PDFs) → doc_chunks rows (FTS substrate
 *    for the verifier pass and future large-corpus retrieval),
 * 3. upload to the Anthropic Files API so ask/agent calls reference the doc
 *    by file_id — whole document in context, native citations, no re-upload,
 * 4. count tokens against the API for an honest cost readout.
 * The doc is usable if either (2) or (3) succeeded; 'error' means neither did.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const simId = String(form.get("simId") ?? "");
  const file = form.get("file");
  if (!simId || !(file instanceof File)) {
    return NextResponse.json({ error: "simId and file are required" }, { status: 400 });
  }
  const kind = docKind(file.type);
  if (!kind) {
    return NextResponse.json({ error: `Unsupported type: ${file.type || "unknown"}. Use PDF, text/CSV/HTML/GeoJSON, or images.` }, { status: 400 });
  }
  if (file.size > MAX_DOC_BYTES) {
    return NextResponse.json({ error: `File exceeds ${Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB` }, { status: 400 });
  }

  const { data: userRow } = await supabase.from("users").select("org_id").eq("id", user.id).single();
  if (!userRow) return NextResponse.json({ error: "No org" }, { status: 400 });
  const orgId = userRow.org_id as string;

  const { data: sim } = await supabase.from("simulations").select("id, project_id").eq("id", simId).maybeSingle();
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

  const { count } = await supabase.from("documents").select("id", { count: "exact", head: true }).eq("sim_id", simId);
  if ((count ?? 0) >= MAX_DOCS_PER_SIM) {
    return NextResponse.json({ error: `Corpus is capped at ${MAX_DOCS_PER_SIM} documents for now` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
  const storagePath = `${orgId}/corpus/${simId}/${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await supabase.storage.from("documents")
    .upload(storagePath, buffer, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: doc, error: rowErr } = await supabase.from("documents").insert({
    project_id: sim.project_id, sim_id: simId, name: file.name.slice(0, 200),
    storage_path: storagePath, parse_status: "parsing",
    size_bytes: file.size, mime: file.type, created_by: user.id,
  }).select("id, name, size_bytes, mime, parse_status, created_at").single();
  if (rowErr) {
    await supabase.storage.from("documents").remove([storagePath]);
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }

  // ---- parse locally (chunk substrate + fallback grounding) ----
  let text = "";
  let pageCount: number | null = null;
  let parseError: string | null = null;
  try {
    if (kind === "text") {
      text = buffer.toString("utf8");
    } else if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const extracted = await extractText(pdf, { mergePages: true });
      pageCount = extracted.totalPages;
      text = typeof extracted.text === "string" ? extracted.text : String(extracted.text ?? "");
    }
  } catch (e) {
    parseError = e instanceof Error ? e.message : "text extraction failed";
  }

  // ---- Anthropic Files API (the direct-context grounding path) ----
  let fileId: string | null = null;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic();
      const uploaded = await anthropic.beta.files.upload({
        file: await toFile(buffer, safeName, { type: file.type }),
        betas: [FILES_BETA],
      });
      fileId = uploaded.id;
    } catch (e) {
      parseError = parseError ?? (e instanceof Error ? e.message : "Files API upload failed");
    }
  }

  // ---- token estimate: exact via count_tokens when possible ----
  let tokenEstimate =
    kind === "pdf" ? estimatePdfTokens(pageCount ?? 1, text.length)
    : kind === "image" ? 1600
    : estimateTokens(text);
  // count_tokens rejects file_id sources, so count the raw bytes instead
  // (base64 inflates 4/3 — stay under the 32MB request cap)
  if (process.env.ANTHROPIC_API_KEY && buffer.length <= 20 * 1024 * 1024) {
    try {
      const anthropic = new Anthropic();
      const block =
        kind === "image"
          ? { type: "image" as const, source: { type: "base64" as const, media_type: file.type as "image/png", data: buffer.toString("base64") } }
          : kind === "pdf"
          ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: buffer.toString("base64") } }
          : { type: "text" as const, text: text || " " };
      const counted = await anthropic.messages.countTokens({
        model: CORPUS_QA_MODEL_LARGE,
        messages: [{ role: "user", content: [block] }],
      });
      tokenEstimate = counted.input_tokens;
    } catch {
      // heuristic estimate stands
    }
  }

  // ---- chunk rows (batched insert) ----
  const chunks = chunkText(text);
  if (chunks.length) {
    const rows = chunks.map((content, seq) => ({ document_id: doc.id, content, seq }));
    for (let i = 0; i < rows.length; i += 100) {
      await supabase.from("doc_chunks").insert(rows.slice(i, i + 100));
    }
  }

  const usable = Boolean(fileId) || chunks.length > 0;
  const status = usable ? "parsed" : "error";
  const { data: updated } = await supabase.from("documents").update({
    parse_status: status,
    anthropic_file_id: fileId,
    token_estimate: tokenEstimate,
    page_count: pageCount,
    parse_error: usable ? null : parseError ?? "no readable content",
  }).eq("id", doc.id)
    .select("id, name, size_bytes, mime, parse_status, parse_error, token_estimate, page_count, created_at")
    .single();

  return NextResponse.json({ document: updated });
}
