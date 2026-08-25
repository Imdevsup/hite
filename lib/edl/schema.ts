/**
 * lib/edl/schema.ts — the canonical Edl.2 schema (Layer 1).
 *
 * docs/CANONICAL-IR-SPEC.md §4, docs/DECISIONS.md §1.3 (locked).
 *
 * Differences from the as-built v1 (lib/ai/schema/edl.ts), which stays in place during the
 * migration and is consumed by the not-yet-ported code:
 *   • Integer TICKS (ticksPerSecond=30000) everywhere — no floats, no ms, no stored frames.
 *   • OTIO-style FLAT `tracks: Track[]` whose `items` are an ordered `(Clip | Gap)[]`;
 *     timeline position is DERIVED from order + gap durations (no stored timelineStartMs).
 *   • Per-node `schema` discriminator tags; top-level `schema: "Edl.2"`.
 *   • `chapters` → `markers`; clips carry `mediaRefs{full,proxy?}` + `activeRefKey` (proxy path);
 *     `revision` + `contentHash` for ordering + caching; declarative `volumeEnvelope` (ducking)
 *     and `AnimatedNumber` params.
 *
 * This file is ADDITIVE: nothing imports it yet. The reducer (P2) and IR compiler (P3) build
 * on it; consumers migrate off lib/ai/schema/edl.ts in later phases, after which v1 is deleted.
 */
import { z } from "zod";
import { TICKS_PER_SECOND } from "./time";

/** Integer ticks (see lib/edl/time.ts). */
const Tick = z.number().int();
const TickWindow = z.object({ startTick: Tick, endTick: Tick }); // half-open [start, end)

export const Timebase = z.object({
  ticksPerSecond: z.number().int().positive().default(TICKS_PER_SECOND), // raise to 240000 for sample-accurate audio (§1.3)
});

/** The seven explicit placement modes — verbatim from as-built edl.ts:10-18. */
export const Placement = z.union([
  z.object({ mode: z.literal("center") }),
  z.object({ mode: z.literal("xy"), x: z.number(), y: z.number() }),
  z.object({ mode: z.literal("face"), trackFaceId: z.string() }),
  z.object({ mode: z.literal("topLeft") }),
  z.object({ mode: z.literal("topRight") }),
  z.object({ mode: z.literal("bottomLeft") }),
  z.object({ mode: z.literal("bottomRight") }),
]);

export const MarkerColor = z.enum([
  "RED", "GREEN", "BLUE", "CYAN", "MAGENTA", "YELLOW", "ORANGE", "PINK", "PURPLE", "BLACK", "WHITE",
]); // OTIO marker colors

/**
 * Ducking / fades as data so they survive undo/audit/AI authoring (never procedural).
 *
 * `atTick` is NODE-RELATIVE: 0 is the owning clip's (or audio bed's) own start on the timeline, so an
 * envelope travels with its node through MOVE_CLIP and is rebased by SPLIT_CLIP (reducer.ts
 * `envelopeAfterSplit`). The compiler adds the node's timeline start when it materializes absolute
 * IR frames (compile.ts `volumeCurve`) — the ONE place that crossing happens.
 */
export const VolumeKeyframe = z.object({ atTick: Tick.nonnegative(), gain: z.number().min(0).max(2) });
export const VolumeEnvelope = z.array(VolumeKeyframe); // empty ⇒ use scalar `volume`

/** Animated effect params — reversible, hashable. Inputs are TICKS, not frames/seconds (§4.6). */
export const AnimatedNumber = z.union([
  z.object({ kind: z.literal("static"), value: z.number() }),
  z.object({
    kind: z.literal("interpolate"),
    atTicks: z.array(Tick),
    values: z.array(z.number()),
    easing: z.string().optional(),
    extrapolate: z.enum(["clamp", "extend"]).default("clamp"),
  }),
  z.object({
    kind: z.literal("spring"),
    from: z.number(),
    to: z.number(),
    config: z.record(z.number()).optional(),
    durationTicks: Tick.positive().optional(),
  }),
]);

/** Authoring shape for a speed ramp; the compiler bakes it into a per-frame PlaybackCurve (§5.6). */
export const SpeedRamp = z.array(z.object({ atTick: Tick.nonnegative(), speed: z.number().positive() }));

export const MediaRef = z.object({
  schema: z.literal("MediaRef.1"),
  url: z.string(), // resolved https — NEVER blob:/data:
  availableInTick: Tick.nonnegative(),
  availableOutTick: Tick.positive(),
});

export const EffectInstance = z.object({
  schema: z.literal("Effect.1"),
  id: z.string(),
  effectKey: z.string(), // open; validated against the live registry manifest at the boundary (§3.3.1)
  params: z.record(z.unknown()).default({}),
  // ABSOLUTE TIMELINE ticks (the same space as an overlay/caption window), NOT clip-local: the AI
  // mapper emits timeline positions, SPLIT_CLIP carries the window over unshifted because a split
  // moves nothing on the timeline, and the compiler converts it 1:1 to absolute IR frames
  // (render/ir.ts EffectNode.window) which HiteRoot then rebases per clip. Absent ⇒ whole clip.
  window: TickWindow.optional(),
  enabled: z.boolean().default(true),
});

export const Clip = z.object({
  schema: z.literal("Clip.1"),
  id: z.string(),
  assetId: z.string(),
  mediaRefs: z.object({ full: MediaRef, proxy: MediaRef.optional() }),
  activeRefKey: z.enum(["full", "proxy"]).default("full"), // §8 flips this for preview
  inTick: Tick.nonnegative(), // local trimmed span (OTIO source_range)
  outTick: Tick.positive(),
  speed: z.number().positive().default(1),
  speedRamp: SpeedRamp.optional(),
  volume: z.number().min(0).max(2).default(1),
  volumeEnvelope: VolumeEnvelope.default([]),
  effects: z.array(EffectInstance).default([]),
  // NO timelineStartTick. Position is DERIVED from item order + Gaps (§4.7).
});

export const Gap = z.object({
  schema: z.literal("Gap.1"),
  id: z.string(),
  durationTicks: Tick.positive(),
});

export const Transition = z.object({
  schema: z.literal("Transition.1"),
  id: z.string(),
  betweenClipIds: z.tuple([z.string(), z.string()]),
  transitionKey: z.string(),
  durationTicks: Tick.positive(),
  params: z.record(z.unknown()).default({}),
});

export const Track = z.object({
  schema: z.literal("Track.1"),
  id: z.string(),
  kind: z.enum(["video", "audio"]),
  role: z.enum(["main", "overlay", "caption", "music", "voice"]).default("main"),
  items: z.array(z.union([Clip, Gap])).default([]), // strictly sequential, non-overlapping (§4.7); FLAT (§4.1)
});

export const Marker = z.object({
  schema: z.literal("Marker.1"),
  id: z.string(),
  atTick: Tick.nonnegative(),
  title: z.string(),
  color: MarkerColor.default("BLUE"),
  kind: z.enum(["chapter", "comment", "ai"]).default("comment"),
});

export const OverlayInstance = z.object({
  schema: z.literal("Overlay.1"),
  id: z.string(),
  overlayKey: z.string(),
  window: TickWindow,
  placement: Placement,
  params: z.record(z.unknown()).default({}),
});

export const CaptionSegment = z.object({
  schema: z.literal("Caption.1"),
  id: z.string(),
  window: TickWindow,
  text: z.string(),
  style: z.string().default("default"),
  words: z.array(z.object({ text: z.string(), startTick: Tick, endTick: Tick })).default([]),
});

export const AudioBed = z.object({
  schema: z.literal("AudioBed.1"),
  id: z.string(),
  assetId: z.string(),
  window: TickWindow,
  volume: z.number().min(0).max(2).default(0.4),
  volumeEnvelope: VolumeEnvelope.default([]),
  loop: z.boolean().default(false),
});

export const OutputVariant = z.object({
  aspect: z.enum(["16:9", "9:16", "1:1"]),
  maxTicks: Tick.positive().optional(), // hard output cap enforced by the IR compiler; 0 would mean "render nothing"
});

export const LookInstance = z.object({
  schema: z.literal("Look.1"),
  id: z.string(),
  lookKey: z.string(),
  targetClipIds: z.array(z.string()).optional(),
  params: z.record(z.unknown()).default({}),
});

export const Edl = z.object({
  schema: z.literal("Edl.2"),
  timebase: Timebase,
  durationTicks: Tick.nonnegative(),
  revision: z.number().int().nonnegative().default(0), // bumped per applied batch; orders the command log
  // Content address of the EDL: `stableHash` (cyrb53, base36 — NOT sha256; ids.ts explains why a
  // non-crypto hash is enough here) over the canonical EDL minus `contentHash` AND `revision`.
  // Revision is edit-COUNT, not content: including it meant two byte-identical timelines reached by
  // different edit paths never shared a hash, which defeats the whole point (§7). Reducer-computed.
  contentHash: z.string().optional(),
  tracks: z.array(Track).default([]),
  transitions: z.array(Transition).default([]),
  overlays: z.array(OverlayInstance).default([]),
  captions: z.array(CaptionSegment).default([]),
  audioBeds: z.array(AudioBed).default([]),
  markers: z.array(Marker).default([]),
  outputs: z.array(OutputVariant).default([{ aspect: "16:9" }]),
  looksApplied: z.array(LookInstance).default([]),
  metadata: z
    .object({
      generatedBy: z.enum(["ai", "user", "seed"]).default("seed"), // matches CommandEnvelope.source
      model: z.string().optional(),
      promptVersion: z.string().optional(),
    })
    .default({ generatedBy: "seed" }),
});

/**
 * What PROPOSE_CUTS carries — the planner doesn't know real asset ids/positions yet.
 * The ordering refine is load-bearing: PROPOSE_CUTS REPLACES the whole main track, so one inverted
 * pair (the model swapping in/out) used to turn the timeline into an invisible 1-tick flash. Reject
 * it here so the failing clip's field is named, and again in the reducer for raw (unparsed) input.
 */
export const ProposedClip = z
  .object({
    id: z.string().optional(),
    assetId: z.string().default("primary"),
    inTick: Tick.nonnegative(),
    outTick: Tick.positive(),
    speed: z.number().positive().default(1),
    volume: z.number().min(0).max(2).default(1),
  })
  .refine((c) => c.outTick > c.inTick, { message: "outTick must be greater than inTick", path: ["outTick"] });

export type Edl = z.infer<typeof Edl>;
export type Clip = z.infer<typeof Clip>;
export type Gap = z.infer<typeof Gap>;
export type Track = z.infer<typeof Track>;
export type EffectInstance = z.infer<typeof EffectInstance>;
export type OverlayInstance = z.infer<typeof OverlayInstance>;
export type Transition = z.infer<typeof Transition>;
export type CaptionSegment = z.infer<typeof CaptionSegment>;
export type AudioBed = z.infer<typeof AudioBed>;
export type Marker = z.infer<typeof Marker>;
export type LookInstance = z.infer<typeof LookInstance>;
export type OutputVariant = z.infer<typeof OutputVariant>;
export type Placement = z.infer<typeof Placement>;
export type ProposedClip = z.infer<typeof ProposedClip>;
export type Timebase = z.infer<typeof Timebase>;

/** Seed EDL: one video track, one full-span clip. Ticks. Used before any prompt runs. */
export function emptyEdl2(assetId: string, durationTicks: number, url = ""): Edl {
  return Edl.parse({
    schema: "Edl.2",
    timebase: { ticksPerSecond: TICKS_PER_SECOND },
    durationTicks,
    tracks: [
      {
        schema: "Track.1",
        id: "track_0",
        kind: "video",
        role: "main",
        items: [
          {
            schema: "Clip.1",
            id: "c0",
            assetId,
            mediaRefs: { full: { schema: "MediaRef.1", url, availableInTick: 0, availableOutTick: Math.max(1, durationTicks) } },
            activeRefKey: "full",
            inTick: 0,
            outTick: Math.max(1, durationTicks),
            speed: 1,
            volume: 1,
            volumeEnvelope: [],
            effects: [],
          },
        ],
      },
    ],
    metadata: { generatedBy: "seed" },
  });
}
