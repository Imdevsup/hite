/**
 * lib/remotion/fx/ColorGrade.tsx — CSS-filter approximations of the LUT + `color`-engine registry
 * effects, so the flagship looks (A24, Kodachrome, VHS, Portra…) actually CHANGE THE PICTURE in
 * preview AND export instead of showing the ungraded clip.
 *
 * Honesty: this is an APPROXIMATION (the WYSIWYG product claim is "preview is a faithful
 * approximation; export is deterministic & reproducible" — DECISIONS §1.8). A true tetrahedral 3D
 * `.cube` sampler (WebGL, P6) will replace these once the LUT files ship; until then this is a strict
 * upgrade over "no grade at all" and is byte-identical between <Player> and renderMedia because it is
 * pure CSS with no randomness (`lib/remotion/**` bans Math.random/Date.now).
 *
 * `gradeFor` is a PURE (effectKey, params) → {filter, tint?, lift?} mapping → unit-testable.
 */
import type React from "react";
import type { EffectRendererProps } from "../registry";
import { withinWindow } from "./window";

export interface Grade {
  /** CSS `filter` string applied to the clip. */
  filter: string;
  /** Optional color wash painted over the clip (cast), with its own blend mode. */
  tint?: { color: string; blend: React.CSSProperties["mixBlendMode"]; opacity: number };
  /** Optional matte "lift" (faded blacks) — a low-opacity light veil in `screen`. */
  lift?: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Per-key grade recipes. Keyed by registry effectKey; `intensity` (0..1, default 1) scales the look. */
function recipe(key: string, intensity: number, params: Record<string, unknown>): Grade {
  const i = clamp01(intensity);
  const mix = (base: number, full: number) => (base + (full - base) * i).toFixed(3);
  switch (key) {
    // ───── LUTs (luts category) ─────
    case "lut-a24-moonlight": // cold teal cinema matte (the A24 signature)
      return {
        filter: `contrast(${mix(1, 1.06)}) saturate(${mix(1, 0.82)}) brightness(${mix(1, 0.98)})`,
        tint: { color: "rgb(20,70,90)", blend: "soft-light", opacity: 0.45 * i },
        lift: 0.06 * i,
      };
    case "lut-a24-dusk":
      return {
        filter: `contrast(${mix(1, 1.05)}) saturate(${mix(1, 0.9)}) brightness(${mix(1, 0.97)})`,
        tint: { color: "rgb(90,60,80)", blend: "soft-light", opacity: 0.4 * i },
        lift: 0.05 * i,
      };
    case "lut-kodachrome-64": // warm, punchy vintage film
      return {
        filter: `contrast(${mix(1, 1.12)}) saturate(${mix(1, 1.18)}) brightness(${mix(1, 1.01)}) sepia(${mix(0, 0.12)})`,
        tint: { color: "rgb(120,80,30)", blend: "soft-light", opacity: 0.28 * i },
      };
    case "lut-fuji-pro-400h": // soft pastel greens
      return {
        filter: `contrast(${mix(1, 0.96)}) saturate(${mix(1, 1.05)}) brightness(${mix(1, 1.03)})`,
        tint: { color: "rgb(60,90,70)", blend: "soft-light", opacity: 0.22 * i },
        lift: 0.05 * i,
      };
    case "lut-portra-160": // warm skin-friendly low-contrast
      return {
        filter: `contrast(${mix(1, 0.98)}) saturate(${mix(1, 1.04)}) brightness(${mix(1, 1.02)}) sepia(${mix(0, 0.08)})`,
        tint: { color: "rgb(110,80,60)", blend: "soft-light", opacity: 0.2 * i },
        lift: 0.04 * i,
      };
    case "lut-cinestill-800t": // tungsten night, cyan shadows
      return {
        filter: `contrast(${mix(1, 1.08)}) saturate(${mix(1, 1.1)}) brightness(${mix(1, 0.96)})`,
        tint: { color: "rgb(20,60,100)", blend: "soft-light", opacity: 0.34 * i },
      };
    case "lut-ektachrome-100": // crisp cool slide film
      return {
        filter: `contrast(${mix(1, 1.1)}) saturate(${mix(1, 1.12)}) brightness(${mix(1, 1.0)})`,
        tint: { color: "rgb(30,70,110)", blend: "soft-light", opacity: 0.2 * i },
      };
    case "lut-vhs-worn": // faded, desaturated, green-magenta drift
      return {
        filter: `contrast(${mix(1, 0.9)}) saturate(${mix(1, 0.78)}) brightness(${mix(1, 1.04)}) hue-rotate(${mix(0, -6)}deg)`,
        tint: { color: "rgb(80,50,90)", blend: "soft-light", opacity: 0.3 * i },
        lift: 0.12 * i,
      };
    case "lut-vhs-fresh":
      return {
        filter: `contrast(${mix(1, 0.95)}) saturate(${mix(1, 1.08)}) brightness(${mix(1, 1.03)})`,
        tint: { color: "rgb(60,40,90)", blend: "soft-light", opacity: 0.22 * i },
        lift: 0.08 * i,
      };
    case "lut-polaroid-sx70": // washed warm instant film
      return {
        filter: `contrast(${mix(1, 0.92)}) saturate(${mix(1, 0.95)}) brightness(${mix(1, 1.05)}) sepia(${mix(0, 0.15)})`,
        tint: { color: "rgb(120,90,50)", blend: "soft-light", opacity: 0.26 * i },
        lift: 0.1 * i,
      };

    // ───── color-engine ops (color category) ─────
    case "contrast-cream": {
      const amount = typeof params.amount === "number" ? (params.amount as number) : 1.15;
      return { filter: `contrast(${(1 + (amount - 1) * i).toFixed(3)}) brightness(${mix(1, 1.02)})` };
    }
    case "curve-lift-blacks": // matte / lifted shadows (the "film" black point)
      return { filter: `contrast(${mix(1, 0.92)})`, lift: 0.14 * i };
    case "saturation-up":
      return { filter: `saturate(${mix(1, 1.2)})` };
    case "saturation-down":
      return { filter: `saturate(${mix(1, 0.7)})` };

    default:
      // Generic LUT fallback: a gentle cinematic contrast/saturation bump so an unmapped LUT key still
      // visibly grades rather than no-oping.
      return key.startsWith("lut-")
        ? { filter: `contrast(${mix(1, 1.06)}) saturate(${mix(1, 1.05)})`, lift: 0.04 * i }
        : { filter: "none" };
  }
}

/** Pure: resolve a Grade for an effectKey + params. Exported for tests. */
export function gradeFor(effectKey: string, params: Record<string, unknown>): Grade {
  const p = params ?? {};
  const intensity = typeof p.intensity === "number" ? (p.intensity as number) : 1;
  return recipe(effectKey, intensity, p);
}

export function ColorGrade({ params, frame, startFrame, endFrame, children, effectKey }: EffectRendererProps & { effectKey: string }) {
  // A grade can be windowed too ("go VHS for the chorus") — honour the window like every other fx.
  if (!withinWindow(frame, startFrame, endFrame)) return <>{children}</>;
  const g = gradeFor(effectKey, params);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div style={{ width: "100%", height: "100%", filter: g.filter }}>{children}</div>
      {g.lift ? (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "rgba(180,185,195,1)", mixBlendMode: "screen", opacity: g.lift }} />
      ) : null}
      {g.tint ? (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: g.tint.color, mixBlendMode: g.tint.blend, opacity: g.tint.opacity }} />
      ) : null}
    </div>
  );
}
