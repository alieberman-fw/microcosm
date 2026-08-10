/**
 * Loading-orb ink (Settings → Appearance): ACCENT tints the thinking-orbs
 * painters with the theme's own tokens; MONO keeps the library's shipped
 * grayscale ink. Per-device, like the theme itself. The remap preserves
 * every depth cue the painters encode in their gray channel — ink strength
 * (bright-on-dark / dark-on-light) becomes alpha on the token color.
 */

export type OrbInk = "accent" | "mono";
export const ORB_INK_KEY = "mc-orb-ink";
export const ORB_INK_EVENT = "mc-orb-ink-changed";
export const DEFAULT_ORB_INK: OrbInk = "accent";

export function readOrbInk(): OrbInk {
  if (typeof localStorage === "undefined") return DEFAULT_ORB_INK;
  return localStorage.getItem(ORB_INK_KEY) === "mono" ? "mono" : DEFAULT_ORB_INK;
}

export function writeOrbInk(ink: OrbInk) {
  localStorage.setItem(ORB_INK_KEY, ink);
  window.dispatchEvent(new Event(ORB_INK_EVENT));
}

/** dark-ink themes (light ink on dark ground) */
export function themeIsDark(theme: string | undefined): boolean {
  return theme !== "light" && theme !== "fog";
}

export interface Rgb { r: number; g: number; b: number }

export function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : fallback;
}

const GRAY = /^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/;

/** remap the painters' grayscale rgba ink onto a token color; non-gray
 *  styles pass through untouched */
export function remapInk(value: string, dark: boolean, color: Rgb): string {
  const m = GRAY.exec(value);
  if (!m || m[1] !== m[2] || m[2] !== m[3]) return value;
  const g = Number(m[1]) / 255;
  const a = Number(m[4]);
  const strength = dark ? g : 1 - g;
  return `rgba(${color.r},${color.g},${color.b},${(a * strength).toFixed(3)})`;
}

/** proxy a 2D context so fillStyle/strokeStyle assignments run the remap */
export function tintedContext(ctx: CanvasRenderingContext2D, dark: boolean, color: Rgb): CanvasRenderingContext2D {
  return new Proxy(ctx, {
    get(target, key) {
      const v = target[key as keyof CanvasRenderingContext2D];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set(target, key, value) {
      if ((key === "fillStyle" || key === "strokeStyle") && typeof value === "string") {
        target[key] = remapInk(value, dark, color);
        return true;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (target as any)[key] = value;
      return true;
    },
  });
}
