import { z } from "zod";

/**
 * Edit Decision List — the canonical representation of a cut. Single source
 * of truth for the planner, refiner, preview, render pipeline, and DB.
 * Every field is typed. Every AI output is validated against this schema
 * at the server boundary before anything else runs.
 */

export const Placement = z.union([
  z.object({ mode: z.literal("center") }),
  z.object({ mode: z.literal("xy"), x: z.number(), y: z.number() }),
  z.object({ mode: z.literal("face"), trackFaceId: z.string() }),
  z.object({ mode: z.literal("topLeft") }),
  z.object({ mode: z.literal("topRight") }),
  z.object({ mode: z.literal("bottomLeft") }),
  z.object({ mode: z.literal("bottomRight") }),
]);

export const EffectInstance = z.object({
  id: z.string(),
  effectKey: z.string(), // any key in the registry manifest (public/registry/manifest.json is the authority)
  params: z.record(z.unknown()),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
});

export const Clip = z.object({
  id: z.string(),
  assetId: z.string(),
  trim: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() }),
  trackIndex: z.number().int().nonnegative().default(0),
  timelineStartMs: z.number().int().nonnegative(),
  speed: z.number().positive().default(1),
  volume: z.number().min(0).max(2).default(1),
  effects: z.array(EffectInstance).default([]),
});

export const Transition = z.object({
  id: z.string(),
  betweenClipIds: z.tuple([z.string(), z.string()]),
  transitionKey: z.string(), // gl-transitions key from registry
  durationMs: z.number().int().positive(),
  params: z.record(z.unknown()).default({}),
});

export const OverlayInstance = z.object({
  id: z.string(),
  overlayKey: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  placement: Placement,
  params: z.record(z.unknown()).default({}),
});

export const CaptionSegment = z.object({
  id: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string(),
  style: z.string().default("default"),
});

export const AudioBed = z.object({
  id: z.string(),
  assetId: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  volume: z.number().min(0).max(2).default(0.4),
  loop: z.boolean().default(false),
});

export const ChapterMarker = z.object({
  id: z.string(),
  startMs: z.number().int().nonnegative(),
  title: z.string(),
});

export const OutputVariant = z.object({
  aspect: z.enum(["16:9", "9:16", "1:1"]),
  maxMs: z.number().int().positive().optional(),
});

export const LookInstance = z.object({
  id: z.string(),
  lookKey: z.string(),
  targetClipIds: z.array(z.string()).optional(),
  params: z.record(z.unknown()).default({}),
});

export const Edl = z.object({
  version: z.literal(1),
  durationMs: z.number().int().nonnegative(),
  clips: z.array(Clip).default([]),
  transitions: z.array(Transition).default([]),
  overlays: z.array(OverlayInstance).default([]),
  captions: z.array(CaptionSegment).default([]),
  audioBeds: z.array(AudioBed).default([]),
  chapters: z.array(ChapterMarker).default([]),
  outputs: z.array(OutputVariant).default([{ aspect: "16:9" }]),
  looksApplied: z.array(LookInstance).default([]),
  metadata: z.object({
    generatedBy: z.enum(["ai", "user", "seed"]).default("seed"),
    model: z.string().optional(),
    promptVersion: z.string().optional(),
  }).default({ generatedBy: "seed" }),
});

export type Edl = z.infer<typeof Edl>;
export type Clip = z.infer<typeof Clip>;
export type EffectInstance = z.infer<typeof EffectInstance>;
export type OverlayInstance = z.infer<typeof OverlayInstance>;
export type Transition = z.infer<typeof Transition>;
export type CaptionSegment = z.infer<typeof CaptionSegment>;
export type LookInstance = z.infer<typeof LookInstance>;

/** Build an empty EDL from an asset's duration — used as seed when a
 * project first opens before any prompt has been run. */
export function emptyEdl(assetId: string, durationMs: number): Edl {
  return Edl.parse({
    version: 1,
    durationMs,
    clips: [
      {
        id: "c0",
        assetId,
        trim: { startMs: 0, endMs: durationMs },
        trackIndex: 0,
        timelineStartMs: 0,
        speed: 1,
        volume: 1,
        effects: [],
      },
    ],
    metadata: { generatedBy: "seed" },
  });
}
