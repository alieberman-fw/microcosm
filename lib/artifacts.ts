/**
 * Analyst artifacts — standalone styled HTML documents the analyst writes on
 * request ("re-cut the report focusing on water risk", "one-page memo for my
 * IC"). The model writes BODY HTML against a fixed class vocabulary; we wrap
 * it in a self-contained §10-styled shell (light base, dark via
 * prefers-color-scheme), store it in the documents bucket, and track it in
 * report_artifacts. Rendering is sandboxed (iframe, no scripts) AND the body
 * is sanitized here — scripts/handlers/embeds never survive either gate.
 */

export const MAX_ARTIFACT_HTML = 400_000; // chars — a dense memo is ~50–100K
export const MAX_ARTIFACT_NAME = 80;
export const MAX_TOOL_HOPS = 4; // tool-use round-trips per analyst turn

export interface ArtifactMeta {
  id: string;
  name: string;
  conversation_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** an artifact reference persisted on the message that produced it */
export interface ArtifactRef {
  kind: "artifact";
  id: string;
  name: string;
  action: "created" | "updated" | "deleted";
}

/** defense-in-depth on model-written HTML — the viewer iframe is sandboxed
 *  (no scripts, no same-origin), this strips the vectors before storage */
export function sanitizeArtifactBody(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|form|link|meta|base|style)\b[^>]*>/gi, "")
    .replace(/<\/(iframe|object|embed|form|style)\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "");
}

/** the §10 shell: tokens, typography, and the class vocabulary the model
 *  writes against — light base (documents read light, like shared reports),
 *  dark palette via prefers-color-scheme */
export function wrapArtifactHtml(opts: { title: string; simName: string; bodyHtml: string; generatedAt: string }): string {
  const body = sanitizeArtifactBody(opts.bodyHtml);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --acc:#0d9d63; --acc-dim:rgba(13,157,99,.10); --acc-c:#ffffff;
  --warn:#b07d24; --warn-dim:rgba(176,125,36,.12);
  --bg:#f6f6f4; --sf:#ffffff; --sf2:#f0f0ee;
  --t0:#0a0b0c; --t1:#17181a; --t2:#2a2c2f; --t3:#3d4044; --t4:#54585d;
  --t5:#6d7378; --t6:#8b9096;
  --ln2:rgba(10,11,12,.08); --ln3:rgba(10,11,12,.12); --ln4:rgba(10,11,12,.16); --ln5:rgba(10,11,12,.22);
}
@media (prefers-color-scheme: dark){
  :root{
    --acc:#37d98a; --acc-dim:rgba(55,217,138,.13); --acc-c:#0a0b0c;
    --warn:#d9a03f; --warn-dim:rgba(217,160,63,.13);
    --bg:#0a0b0c; --sf:#0d0e10; --sf2:#101215;
    --t0:#ffffff; --t1:#ececec; --t2:#c7cbcf; --t3:#b9bdc1; --t4:#adb2b7;
    --t5:#9aa0a6; --t6:#8b9096;
    --ln2:rgba(255,255,255,.09); --ln3:rgba(255,255,255,.12); --ln4:rgba(255,255,255,.16); --ln5:rgba(255,255,255,.22);
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t2);font-family:'Space Grotesk',-apple-system,sans-serif;font-size:14.5px;line-height:1.65;-webkit-font-smoothing:antialiased}
.page{max-width:860px;margin:0 auto;padding:56px 40px 72px}
.kicker{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--t6)}
.kicker b{color:var(--acc);font-weight:500}
h1{font-size:clamp(26px,4vw,38px);font-weight:600;letter-spacing:-.025em;color:var(--t0);line-height:1.15;margin:14px 0 8px}
h2{font-size:19px;font-weight:600;letter-spacing:-.015em;color:var(--t0);margin:40px 0 10px;padding-top:22px;border-top:1px solid var(--ln2)}
h3{font-size:15px;font-weight:600;color:var(--t1);margin:24px 0 6px}
p{margin:0 0 12px}
strong{font-weight:600;color:var(--t0)}
a{color:var(--acc)}
hr{border:none;border-top:1px solid var(--ln2);margin:28px 0}
ul,ol{margin:0 0 14px;padding-left:22px}
li{margin:0 0 6px}
.muted{color:var(--t5)}
.num{font-family:'JetBrains Mono',monospace}
.chip{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.06em;padding:3px 11px;border-radius:100px;border:1px solid var(--ln4);color:var(--t4);vertical-align:middle}
.cite{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.04em;padding:0 7px;margin:0 2px;border-radius:100px;border:1px solid var(--acc);background:var(--acc-dim);color:var(--acc);vertical-align:baseline}
.cite::before{content:"["} .cite::after{content:"]"}
.verdict{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.1em;font-weight:500;padding:7px 18px;border-radius:100px;border:1px solid var(--acc);background:var(--acc-dim);color:var(--acc);margin:6px 0 10px}
.verdict.warn{border-color:var(--warn);background:var(--warn-dim);color:var(--warn)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 22px}
.stat{border:1px solid var(--ln3);border-radius:14px;background:var(--sf);padding:14px 16px}
.stat .label{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--t6);margin-bottom:6px}
.stat .value{font-family:'JetBrains Mono',monospace;font-size:24px;color:var(--t0);line-height:1.1}
.stat .sub{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.06em;color:var(--t5);margin-top:6px}
table{border-collapse:collapse;width:100%;margin:14px 0 20px;font-size:13.5px}
th{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--t6);text-align:left;padding:8px 16px 8px 0;border-bottom:1px solid var(--ln4);white-space:nowrap}
td{padding:9px 16px 9px 0;border-bottom:1px solid var(--ln2);vertical-align:top}
td:first-child{font-weight:600;color:var(--t1)}
blockquote{margin:16px 0;padding:12px 18px;border-left:2px solid var(--acc);background:var(--sf2);border-radius:0 12px 12px 0;color:var(--t3)}
blockquote .who{display:block;font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--t6);margin-top:8px}
.bar{height:7px;border-radius:100px;background:var(--sf2);border:1px solid var(--ln2);overflow:hidden;margin:6px 0 14px}
.bar span{display:block;height:100%;border-radius:100px;background:var(--acc)}
.bar.warn span{background:var(--warn)}
.footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--ln2);font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--t6);line-height:1.9}
@media print{.page{padding:24px}}
</style>
</head>
<body>
<div class="page">
<div class="kicker"><b>MICROCOSM</b> · ANALYST ARTIFACT · ${esc(opts.simName.toUpperCase())} · ${esc(opts.generatedAt)}</div>
${body}
<div class="footer">SYNTHETIC &amp; DIRECTIONAL — generated by the Microcosm analyst from the simulation record. Not a survey, appraisal, or professional advice.</div>
</div>
</body>
</html>`;
}

/** the analyst's document tools (Anthropic Messages `tools` entries) */
export const ARTIFACT_TOOLS: Record<string, unknown>[] = [
  {
    name: "create_artifact",
    description:
      "Write a new standalone document (memo, brief, focused re-cut of the report, comparison sheet) as styled HTML. " +
      "Use ONLY when the user asks for a document — plain questions get chat answers.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short document name shown in the artifact list, e.g. 'Water-risk memo' (max 80 chars)" },
        title: { type: "string", description: "The document's headline (rendered as its h1 is NOT automatic — include your own <h1> in body_html; this is the <title> tag)" },
        body_html: { type: "string", description: "The document body HTML — content only, no <html>/<head>/<style>/<script>. See the class vocabulary in your instructions." },
      },
      required: ["name", "title", "body_html"],
    },
  },
  {
    name: "update_artifact",
    description: "Revise an existing artifact (full body_html replacement) and/or rename it. Artifact ids ride in your context.",
    input_schema: {
      type: "object",
      properties: {
        artifact_id: { type: "string", description: "The artifact's id from the EXISTING ARTIFACTS list" },
        name: { type: "string", description: "New name (optional)" },
        title: { type: "string", description: "New <title> (optional; defaults to the name)" },
        body_html: { type: "string", description: "Replacement body HTML (optional — omit for a pure rename)" },
      },
      required: ["artifact_id"],
    },
  },
  {
    name: "delete_artifact",
    description: "Delete an artifact the user asked to remove.",
    input_schema: {
      type: "object",
      properties: { artifact_id: { type: "string", description: "The artifact's id from the EXISTING ARTIFACTS list" } },
      required: ["artifact_id"],
    },
  },
];

/** appended to the analyst system prompt whenever artifact tools are on */
export const ARTIFACT_SYSTEM =
  `DOCUMENT ARTIFACTS — you can produce standalone styled documents with your tools:\n` +
  `- When the user asks for a document (a memo, one-pager, re-cut of the report focused on X, comparison sheet, briefing for an audience), call create_artifact. Questions get chat answers, not artifacts.\n` +
  `- body_html is CONTENT ONLY: h1–h3, p, strong/em, ul/ol/li, table, blockquote, hr, div/span. No <html>, <head>, <style>, <script>, or inline event handlers — they are stripped.\n` +
  `- The shell styles everything; these classes are available: <div class="kicker"> mono section label · <span class="verdict"> GO-style chip (add class "warn" for caution) · <div class="stats"> grid of <div class="stat"> tiles (children: <div class="label">, <div class="value">, <div class="sub">) · <span class="chip"> mono pill · <span class="cite">18</span> post citation (renders as [18]) · <span class="muted"> · <span class="num"> mono numbers · <div class="bar"><span style="width:62%"></span></div> score bar (add class "warn") · <blockquote> with <span class="who"> attribution for quotes/dissents.\n` +
  `- Start with your own <h1>; use <h2> for sections. Keep citing: transcript posts as <span class="cite">N</span>, documents by filename.\n` +
  `- Preserve dissent and label extrapolation in documents exactly as you would in chat.\n` +
  `- After the tool succeeds, tell the user in 1–2 sentences what the document covers — its card appears in the chat automatically; NEVER paste the document content into the chat.\n` +
  `- update_artifact revises (full body replacement) or renames; delete_artifact removes. The current artifact list (ids + names) rides in your context.`;
