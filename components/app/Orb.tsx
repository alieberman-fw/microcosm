"use client";

/**
 * The app's loading orb (thinking-orbs, Adam's find) — one meaning per
 * state, everywhere: composing = writing · solving = reasoning ·
 * searching = retrieval · connecting = assembling · shaping = translation
 * · weaving = parallel synthesis · working = mechanical.
 *
 * Ink follows Settings → Appearance: ACCENT (default) tints the package's
 * painters with the theme's tokens (--acc, or --t5 for tone="quiet");
 * MONO renders the library's shipped grayscale. Theme dark/light is pinned
 * from our four themes (dark+gray = light ink). Reduced motion freezes a
 * mid-cycle frame, exactly like the package does.
 */

import { CSSProperties, useEffect, useRef, useState } from "react";
import { MODE_DRAWS, resolvePreset, type OrbState } from "thinking-orbs";
import {
  DEFAULT_ORB_INK, ORB_INK_EVENT, OrbInk, Rgb, hexToRgb, readOrbInk, themeIsDark, tintedContext,
} from "@/lib/orb-ink";

export type { OrbState };

const FALLBACK_ACC: Rgb = { r: 55, g: 217, b: 138 };
const FALLBACK_QUIET: Rgb = { r: 154, g: 160, b: 166 };

function tokenRgb(name: string, fallback: Rgb): Rgb {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return hexToRgb(v, fallback);
}

export default function Orb({ state, size = 20, tone = "acc", ink: inkOverride, style, "aria-label": ariaLabel }: {
  state: OrbState;
  /** the package's two hand-tuned presets */
  size?: 20 | 64;
  /** acc = model cognition (accent token) · quiet = mechanical (--t5) ·
   *  contrast = ON an accent-filled ground (--acc-c ink, always tinted —
   *  the ground dictates, so the user's mono/accent setting is moot here) */
  tone?: "acc" | "quiet" | "contrast";
  /** pin the ink (the Settings preview uses this); default follows the user's setting */
  ink?: OrbInk;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ink, setInk] = useState<OrbInk>(inkOverride ?? DEFAULT_ORB_INK);

  useEffect(() => {
    if (inkOverride) { setInk(inkOverride); return; }
    const read = () => setInk(readOrbInk());
    read();
    window.addEventListener(ORB_INK_EVENT, read);
    return () => window.removeEventListener(ORB_INK_EVENT, read);
  }, [inkOverride]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const raw = canvas.getContext("2d");
    if (!raw) return;

    const { mode, speed, opts } = resolvePreset(state, size);
    const draw = MODE_DRAWS[mode];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // contrast tone lives on an accent-filled ground: ink is the accent's
    // own contrast token, and the ground's brightness flips the painter's
    // dark flag (dark theme = bright green strip = light-mode painting)
    const resolve = () => {
      const themeDark = themeIsDark(document.documentElement.dataset.theme);
      if (tone === "contrast") {
        return { dark: !themeDark, color: tokenRgb("--acc-c", { r: 255, g: 255, b: 255 }) };
      }
      return { dark: themeDark, color: tone === "quiet" ? tokenRgb("--t5", FALLBACK_QUIET) : tokenRgb("--acc", FALLBACK_ACC) };
    };
    let { dark, color } = resolve();
    const ctx = () => (ink === "mono" && tone !== "contrast" ? raw : tintedContext(raw, dark, color));

    const paint = (t: number) => {
      raw.setTransform(dpr, 0, 0, dpr, 0, 0);
      raw.clearRect(0, 0, size, size);
      draw(ctx(), size, t, dark, opts);
    };

    if (reduced) { paint(0.6); return; }

    let rafId = 0;
    const frame = () => {
      paint(Math.max(0, performance.now() / 1000) * speed);
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    // theme flips re-read the tokens live (same event surface as the shell)
    const retheme = () => {
      ({ dark, color } = resolve());
    };
    window.addEventListener("mc-theme-changed", retheme);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mc-theme-changed", retheme);
    };
  }, [state, size, tone, ink]);

  return (
    <canvas
      ref={canvasRef}
      role="status"
      aria-label={ariaLabel ?? `${state}…`}
      style={{ width: size, height: size, flex: "none", opacity: ink === "mono" && tone === "quiet" ? 0.55 : 1, ...style }}
    />
  );
}
