/**
 * Corpus config + helpers (CLAUDE.md §2 Stage 2).
 *
 * Architecture (decided pre-build): v1 grounds answers by passing WHOLE
 * documents to Claude — Anthropic Files API ids referenced as native
 * document/image blocks with citations enabled and a cache_control
 * breakpoint on the corpus prefix. No embeddings required. doc_chunks (FTS)
 * is populated at parse time as the substrate for the verifier pass and for
 * corpora that outgrow the direct-context budget; pgvector activates later
 * with an embeddings key.
 */

/** grounded corpus Q&A on the lightweight tier by default */
export const CORPUS_QA_MODEL = process.env.CORPUS_QA_MODEL ?? "claude-haiku-4-5";
/** big corpora need a 1M-context model (Haiku caps at 200K) */
export const CORPUS_QA_MODEL_LARGE = process.env.CORPUS_QA_MODEL_LARGE ?? "claude-sonnet-5";
/** suggestion passes (question chips, template hints) stay on the router tier */
export const BRIEF_SUGGEST_MODEL = process.env.BRIEF_SUGGEST_MODEL ?? "claude-haiku-4-5";

/** above this the corpus no longer fits the lightweight tier's window */
export const DIRECT_CONTEXT_BUDGET = 150_000; // tokens

export const MAX_DOC_BYTES = 50 * 1024 * 1024;   // per file (Files API cap is 500MB)
export const MAX_DOCS_PER_SIM = 25;

/** mime → how we treat it. `text` parses locally; `pdf` extracts via unpdf;
 * `image` is vision-only (no chunks). */
export const ACCEPTED_TYPES: Record<string, "pdf" | "text" | "image"> = {
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "text/html": "text",
  "application/json": "text",
  "application/geo+json": "text",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
};

export function docKind(mime: string): "pdf" | "text" | "image" | null {
  return ACCEPTED_TYPES[mime] ?? null;
}

/** rough chars→tokens; the upload route replaces this with the API's exact
 * count_tokens figure whenever that call succeeds */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/** PDFs bill text + a per-page image; ~1,500–3K tokens/page is the honest range */
export function estimatePdfTokens(pages: number, textLen: number): number {
  return Math.max(pages * 1800, Math.ceil(textLen / 3.6));
}

/** paragraph-aware chunking: ~4,200 chars (~1,200 tokens) with 300-char overlap */
export function chunkText(text: string, target = 4200, overlap = 300): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= target) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + target, clean.length);
    if (end < clean.length) {
      // prefer breaking on a paragraph, then a sentence, then a space
      const window = clean.slice(start, end);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf(".\n"));
      const space = window.lastIndexOf(" ");
      const cut = para > target * 0.4 ? para : sentence > target * 0.4 ? sentence + 1 : space > target * 0.4 ? space : window.length;
      end = start + cut;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

/**
 * Decision shapes — inferred from the brief by the suggest pass (user can
 * override), never a required form field. The shape picks the report's lead
 * visual (verdict chip vs price band vs approval odds); report *sections*
 * always come from the questions-to-resolve + success criteria.
 */
export const DECISION_SHAPES = [
  "Site go/no-go",
  "Land & parcel valuation",
  "Product & floor-plan mix",
  "Pricing & absorption",
  "Lease-up & amenity test",
  "Entitlement rehearsal",
  "Policy impact",
  "Investment memo",
  "Custom",
] as const;

/** A question-to-resolve: the chip label plus an optional one-line framing.
 * Each question becomes a required section of the final report. */
export interface BriefQuestion {
  label: string;
  detail?: string;
}

/** Accepts legacy string[] chips and loose LLM output alike. */
export function normalizeQuestions(raw: unknown): BriefQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefQuestion[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ label: item.trim().toUpperCase().slice(0, 40) });
    } else if (item && typeof item === "object" && typeof (item as { label?: unknown }).label === "string") {
      const o = item as { label: string; detail?: unknown };
      const label = o.label.trim().toUpperCase().slice(0, 40);
      if (!label) continue;
      const detail = typeof o.detail === "string" ? o.detail.trim().slice(0, 140) : "";
      out.push(detail ? { label, detail } : { label });
    }
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Embeddings (dormant until chunk retrieval activates — verifier pass and
 * corpora past DIRECT_CONTEXT_BUDGET): served by the Vercel AI Gateway's
 * OpenAI-compatible endpoint, billed through the existing Vercel account.
 * Auth: AI_GATEWAY_API_KEY (create in the Vercel dashboard → AI Gateway;
 * deployed functions can also use VERCEL_OIDC_TOKEN). The default model's
 * 1536 dims match doc_chunks.embedding / personas.embedding exactly.
 */
export const EMBEDDINGS_URL = "https://ai-gateway.vercel.sh/v1/embeddings";
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
