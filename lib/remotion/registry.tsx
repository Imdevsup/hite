import type { ComponentType, ReactNode } from "react";

/**
 * Effect renderer registry — maps registry `effectKey`s to Remotion-renderable
 * React components consumed by HiteRoot (lib/remotion/HiteRoot.tsx).
 *
 * WYSIWYG invariant: HiteRoot is the SINGLE composition behind BOTH the live
 * preview (<Player>) and the server export (renderMedia), so this same registry
 * drives both — there is no separate server compositor. (The old per-key FFmpeg
 * compositor, lib/ffmpeg/graph.ts, has been deleted; FFmpeg is now used only for
 * decode/encode/mux, never compositing.)
 *
 * Coverage: hero glitch/zoom/grain/vignette effects render as CSS; LUT + color-engine
 * effects render as CSS-filter color GRADES (ColorGrade) — an honest approximation of
 * the looks until the P6 WebGL 3D-LUT sampler ships. A handful of advanced ops (audio
 * effects, gl-transitions used as clip effects) still have no preview renderer and show
 * the un-graded clip; they return undefined from getEffectRenderer.
 */

export interface EffectRendererProps {
  params: Record<string, unknown>;
  /** Effect-local enable window, in CLIP-RELATIVE frames (0 = clip start), or undefined for whole-clip.
   *  `frame` is also clip-relative (Remotion useCurrentFrame() inside the clip's Sequence). */
  startFrame?: number;
  endFrame?: number;
  frame: number;
  children: ReactNode;
}

type EffectRenderer = ComponentType<EffectRendererProps>;

const REGISTRY = new Map<string, EffectRenderer>();

export function registerEffectRenderer(key: string, comp: EffectRenderer): void {
  REGISTRY.set(key, comp);
}

export function getEffectRenderer(key: string): EffectRenderer | undefined {
  return REGISTRY.get(key);
}

/**
 * Every effectKey that actually paints, sorted. THE source of truth for "can the pipeline render
 * this?" — `lib/remotion/renderable.ts` snapshots it for the AI/registry layers, and
 * scripts/lint-registry.ts fails the build when a clip-effect entry has no renderer. Derived from
 * the map itself so the answer can never drift from what HiteRoot will do.
 */
export function listEffectRendererKeys(): string[] {
  return [...REGISTRY.keys()].sort();
}

// Register a few commonly needed client-side renderers on import so the
// preview has parity with the server render for hero effects.
import { ChromaticAberration } from "./fx/ChromaticAberration";
import { RgbSplit } from "./fx/RgbSplit";
import { GlitchBars } from "./fx/GlitchBars";
import { ZoomPunch } from "./fx/ZoomPunch";
import { Vignette } from "./fx/Vignette";
import { FilmGrain } from "./fx/FilmGrain";
import { ColorGrade } from "./fx/ColorGrade";

registerEffectRenderer("chromatic-aberration-drift", ChromaticAberration);
registerEffectRenderer("chromatic-flash", ChromaticAberration);
registerEffectRenderer("rgb-split-hard", RgbSplit);
registerEffectRenderer("glitch-bars", GlitchBars);
registerEffectRenderer("zoom-punch", ZoomPunch);
registerEffectRenderer("vignette-soft", Vignette);
registerEffectRenderer("vignette-harsh", Vignette);
registerEffectRenderer("grain-fine-medium", FilmGrain);

/**
 * LUT + `color`-engine effects → CSS-filter color grade (lib/remotion/fx/ColorGrade.tsx). These are
 * the keys the look recipes reference (look-a24 → lut-a24-moonlight + curve-lift-blacks, etc.) plus
 * the standalone film LUTs in the registry. Each binds its own effectKey so ColorGrade can pick the
 * right recipe (the registry renderer API is keyless). Unmapped lut-* keys fall through to
 * ColorGrade's generic LUT grade. Approximation now; WebGL 3D-LUT sampler is the P6 follow-up.
 */
const COLOR_GRADE_KEYS = [
  "lut-a24-moonlight",
  "lut-a24-dusk",
  "lut-kodachrome-64",
  "lut-fuji-pro-400h",
  "lut-portra-160",
  "lut-cinestill-800t",
  "lut-ektachrome-100",
  "lut-vhs-worn",
  "lut-vhs-fresh",
  "lut-polaroid-sx70",
  "contrast-cream",
  "curve-lift-blacks",
  "saturation-up",
  "saturation-down",
];
for (const key of COLOR_GRADE_KEYS) {
  registerEffectRenderer(key, (props) => <ColorGrade {...props} effectKey={key} />);
}
