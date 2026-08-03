/**
 * Synthesis ticker (PR-B, field-report item 4): the report director can think
 * silently for minutes, and "~N WORDS DRAFTED" told the user nothing about
 * WHERE the draft was. The draft streams as schema-shaped JSON, so the
 * accumulated buffer itself is the progress bar — which top-level key is
 * being written, and how many findings sections exist so far.
 *
 * Pure function over the raw stream buffer; the route calls it on every
 * throttled tick. Returns null until the first known key appears (the route
 * keeps its generic "compiling" note until then).
 */

/** schema keys in the order the sketch asks for them, with user-facing labels */
const STAGES: [key: string, label: string][] = [
  ["verdict", "VERDICT"],
  ["lead", "LEAD VISUAL"],
  ["bottom_line", "BOTTOM LINE"],
  ["executive_summary", "SUMMARY"],
  ["dimension_scores", "SCORES"],
  ["sections", "FINDINGS"],
  ["criteria", "CRITERIA RECEIPT"],
  ["risks", "RISK REGISTER"],
  ["dissents", "DISSENTS"],
  ["tripwires", "TRIPWIRES"],
  ["media", "KEY MATERIALS"],
];

export function synthTicker(buf: string, opts: { expectedSections?: number; elapsedMs?: number } = {}): string | null {
  const seen: { key: string; label: string; at: number }[] = [];
  for (const [key, label] of STAGES) {
    const at = buf.search(new RegExp(`"${key}"\\s*:`));
    if (at >= 0) seen.push({ key, label, at });
  }
  if (!seen.length) return null;
  seen.sort((a, b) => a.at - b.at);
  const current = seen[seen.length - 1];
  const lastDone = seen.length > 1 ? seen[seen.length - 2] : null;

  let activity = `WRITING ${current.label}`;
  if (current.key === "sections") {
    // each finding section opens with its "question" — count = the one being written
    const n = Math.max((buf.match(/"question"\s*:/g) ?? []).length, 1);
    const exp = opts.expectedSections && opts.expectedSections > 0 ? opts.expectedSections : null;
    activity = `WRITING FINDINGS ${exp ? `${Math.min(n, exp)}/${exp}` : n}`;
  }

  const parts: string[] = [];
  if (lastDone) parts.push(`✓ ${lastDone.label}`);
  parts.push(activity);
  parts.push(`~${Math.round(buf.length / 6).toLocaleString()} WORDS`);
  if (opts.elapsedMs && opts.elapsedMs >= 1000) {
    const s = Math.floor(opts.elapsedMs / 1000);
    parts.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  }
  return parts.join(" · ");
}
