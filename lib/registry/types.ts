import { z } from "zod";

/**
 * The single registry entry shape. Every registry tool — whether it's a LUT,
 * a gl-transitions entry, a composed look recipe, or a Remotion text template —
 * declares itself as one of these. The catalog count is whatever
 * `public/registry/manifest.json` reports (the authority); never hardcode it.
 *
 * Loading is uniform (`lib/registry/catalog.ts`) so the AI, the palette UI,
 * and the render pipeline all see one namespace of keys.
 */

export const RegistryCategory = z.enum([
  "transitions",
  "luts",
  "color",
  "glitch",
  "text",
  "audio",
  "overlays",
  "looks",
  "procedural",
]);

export const Stability = z.enum(["stable", "beta", "experimental"]);

export const Engine = z.enum([
  "ffmpeg",            // filter_complex graph
  "gl-transitions",    // GLSL transition shader
  "lut",               // 3D LUT
  "remotion",          // React scene component (text, overlays)
  "composed",          // look recipe: expands into multiple primitives
  "overlay-asset",     // static WebM/PNG overlay
  "procedural",        // shader-parametrised variant
]);

export const ParamKind = z.enum([
  "number",
  "range",       // number with min/max/step
  "boolean",
  "enum",
  "color",
  "text",
  "percent",
  "duration",
  "easing",
]);

export const ParamSpec = z.object({
  key: z.string(),
  label: z.string(),
  kind: ParamKind,
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
});

export const RegistryEntry = z.object({
  key: z.string(),              // globally-unique — used by AI & user
  label: z.string(),            // human-facing name
  category: RegistryCategory,
  tags: z.array(z.string()).default([]),
  engine: Engine,
  component: z.string().optional(),  // Remotion component path (text/overlays)
  ffmpegFilter: z.string().optional(),
  lutFile: z.string().optional(),
  overlayAsset: z.string().optional(), // /overlays/foo.webm
  recipe: z.array(z.any()).optional(), // looks: array of {effectKey, params}
  params: z.array(ParamSpec).default([]),
  paramsSchema: z.any().optional(),
  requires: z.array(z.string()).default([]), // e.g. ["faces", "beats"]
  preview: z.string().optional(), // blob URL (webm 400×225 3s)
  stability: Stability.default("stable"),
  description: z.string().optional(),
});

export type RegistryEntry = z.infer<typeof RegistryEntry>;
export type RegistryCategory = z.infer<typeof RegistryCategory>;
export type Stability = z.infer<typeof Stability>;

export const CATEGORY_LABELS: Record<RegistryCategory, string> = {
  transitions: "TRANSITIONS",
  luts:        "LUTS",
  color:       "COLOR",
  glitch:      "GLITCH",
  text:        "TEXT",
  audio:       "AUDIO",
  overlays:    "OVERLAYS",
  looks:       "LOOKS",
  procedural:  "PROCEDURAL",
};

/**
 * Roman-numeral tab labels for the EffectsWindow. ONLY categories that are genuine CLIP effects with
 * a real renderer belong here — the EffectsWindow applies every row via `applyEffectFromWindow`
 * (ADD_EFFECT), and HiteRoot paints a clip effect only when `getEffectRenderer(key)` exists.
 *
 * `color`+`luts` (CSS-filter grades) and `glitch` (chromatic/rgb-split/glitch-bars/zoom-punch) all
 * have renderers, so they render in preview AND export. `transitions` and `overlays` were REMOVED:
 * they are NOT clip effects (they're top-level EDL entries authored via ADD_TRANSITION/ADD_OVERLAY in
 * the dedicated Transitions/Overlays decks). Pushed through ADD_EFFECT they have no effect renderer,
 * so the row showed a success toast and then rendered NOTHING — a silent WYSIWYG dead-end that also
 * duplicated those decks. `procedural` (lens flares) is likewise omitted until it has a renderer.
 */
export const EFFECTS_TABS: { roman: string; categories: RegistryCategory[]; label: string }[] = [
  { roman: "Ⅰ", categories: ["color", "luts"],    label: "COLOR" },
  { roman: "Ⅱ", categories: ["glitch"],           label: "GLITCH" },
];
