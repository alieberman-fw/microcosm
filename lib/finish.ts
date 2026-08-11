/**
 * Finish — the premium-mode skin toggle (Settings → Appearance).
 * "normal" is the shipped app, byte-identical. "premium" stamps
 * <html data-finish="premium">, which activates the scoped rules at the
 * bottom of globals.css: card depth (edge light + sheen + ambient shadow),
 * machined stat numbers, tinted chips, gradient primary buttons, row hover
 * washes, kicker dot-runs, the verdict seal, and micro-details (focus ring,
 * accent caret, pill scrollbars). Tokens are defined per theme, so the skin
 * works across all four themes. Persists per device ("mc-finish", same key
 * the boot script in app/layout.tsx reads); orbs are untouched by design.
 */

export type Finish = "normal" | "premium";

export const FINISH_KEY = "mc-finish";
export const DEFAULT_FINISH: Finish = "normal";

export function readFinish(): Finish {
  if (typeof window === "undefined") return DEFAULT_FINISH;
  try {
    const f = localStorage.getItem(FINISH_KEY);
    return f === "premium" ? "premium" : DEFAULT_FINISH;
  } catch {
    return DEFAULT_FINISH;
  }
}

/** persist + stamp <html data-finish> + broadcast so mounted UIs stay honest */
export function writeFinish(f: Finish) {
  try { localStorage.setItem(FINISH_KEY, f); } catch { /* private mode */ }
  applyFinish(f);
  window.dispatchEvent(new Event("mc-finish-changed"));
}

/** stamp only — used by boot/heal paths that must not re-broadcast */
export function applyFinish(f: Finish) {
  if (f === "premium") document.documentElement.dataset.finish = "premium";
  else delete document.documentElement.dataset.finish;
}
