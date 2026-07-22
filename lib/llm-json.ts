/**
 * Loose JSON extraction for model output. A truncated or lightly malformed
 * response degrades to the salvageable prefix instead of throwing: a response
 * cut mid-array/mid-object is repaired by closing every container that was
 * still open at the last structurally safe point (right after a completed
 * value), so every complete element before the cut survives.
 *
 * Callers should still cap generously and retry once; this is the net.
 */

/** Repair a truncated JSON string by cutting at the last safe boundary and
 * closing all still-open containers. Returns a parseable string or null. */
function repair(src: string): string | null {
  const stack: string[] = []; // '{' or '['
  let inStr = false;
  let esc = false;
  // best cut: index just past a completed value, plus the closers needed there
  let bestCut = -1;
  let bestClosers = "";

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      // safe boundary: a value just completed; closing the current stack works
      bestCut = i + 1;
      bestClosers = stack.map((c) => (c === "{" ? "}" : "]")).reverse().join("");
    }
  }

  if (bestCut === -1) return null;
  const candidate = src.slice(0, bestCut) + bestClosers;
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/** first {...} object in the text; salvages truncation via repair() */
export function parseLooseObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  const slice = raw.slice(start);
  try {
    return JSON.parse(slice.slice(0, slice.lastIndexOf("}") + 1)) as Record<string, unknown>;
  } catch {
    const fixed = repair(slice);
    if (!fixed) return null;
    const v = JSON.parse(fixed);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  }
}

/** first [...] array in the text; salvages truncation via repair() */
export function parseLooseArray(raw: string): unknown[] | null {
  const start = raw.indexOf("[");
  if (start === -1) return null;
  const slice = raw.slice(start);
  try {
    const v = JSON.parse(slice.slice(0, slice.lastIndexOf("]") + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    const fixed = repair(slice);
    if (!fixed) return null;
    const v = JSON.parse(fixed);
    return Array.isArray(v) ? v : null;
  }
}
