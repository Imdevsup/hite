/**
 * lib/render/ir.ts — Layer 2, the engine-agnostic Render IR (docs/CANONICAL-IR-SPEC.md §5).
 *
 * The IR is a fully-resolved, normalized, hashable scene graph DERIVED from the EDL: absolute
 * positions, transition offsets precomputed, looks expanded, faces resolved, FRAMES materialized
 * (the only place frames appear), every node content-hashed. It is not persisted truth (it is
 * recomputable) and leaks no Remotion/FFmpeg types — both engines consume it.
 */
import type { Tick } from "@/lib/edl/time";
import type { Placement } from "@/lib/edl/schema";

export type Hash = string; // sha256 hex of the node's canonical form (§7)

/**
 * Something the EDL asked for that the compiler could NOT honour, recorded so the surfaces above can
 * SAY so. The alternative — the old behaviour — was to substitute 0 (strength 0, a 1-frame overlay,
 * scale 0) and render a silent lie that looked like success. Deterministic (derived from the same
 * inputs), excluded from every hash: diagnostics describe the compile, not the picture.
 */
export interface RenderDiagnostic {
  code: "look-step-unresolved";
  /** The registry key whose expansion was affected (e.g. "look-skull-face-drop"). */
  key: string;
  /** Human-readable reason, e.g. `overlay-skull dropped: {{dropMs_minus_1600}} needs analysis data`. */
  detail: string;
}

export interface RenderIR {
  schema: "RenderIR.1";
  timebase: { ticksPerSecond: number };
  fps: number;
  resolution: { width: number; height: number };
  durationTicks: number;
  durationInFrames: number; // = ticksToFrame(durationTicks) — materialized ONCE
  meta: {
    edlContentHash: string; // provenance back to Layer 1
    engineFingerprint: string; // Remotion + Chromium versions
    quality: "proxy" | "full";
  };
  scene: StackNode;
  rootHash: Hash;
  /** Steps the compiler refused to fake. Empty on a clean compile. Never affects rootHash. */
  diagnostics: RenderDiagnostic[];
}

export interface NodeBase {
  id: string;
  hash: Hash;
}

export interface StackNode extends NodeBase {
  kind: "stack";
  layers: TrackNode[]; // index 0 = bottom (painter order for video; audio is additive)
}
export interface TrackNode extends NodeBase {
  kind: "track";
  trackKind: "video" | "audio" | "overlay" | "caption";
  role: string;
  items: (ClipNode | GapNode | TransitionNode | OverlayNode | CaptionNode | AudioNode)[];
}
/**
 * What kind of media a clip's source actually is. A still on the timeline must NOT be handed to
 * <OffthreadVideo> — it breaks the preview frame and crashes `renderMedia` on export — so the kind
 * travels with the source and the renderer branches on it.
 */
export type MediaKind = "video" | "image" | "audio";

export interface ClipNode extends NodeBase {
  kind: "clip";
  source: { assetId: string; url: string; refKey: "full" | "proxy"; mediaKind: MediaKind };
  startTick: number;
  endTick: number;
  startFrame: number;
  endFrame: number;
  inTick: number;
  outTick: number;
  inFrame: number;
  outFrame: number;
  playback: PlaybackCurve;
  volume: VolumeCurve;
  effects: EffectNode[];
}
export interface GapNode extends NodeBase {
  kind: "gap";
  startTick: number;
  endTick: number;
  startFrame: number;
  endFrame: number;
}
export interface TransitionNode extends NodeBase {
  kind: "transition";
  transitionKey: string;
  fromHash: Hash;
  toHash: Hash;
  durationTicks: number;
  durationInFrames: number;
  offsetTick: number;
  offsetFrame: number;
  presentation: { name: string; props: Record<string, unknown> };
  timing: { name: "spring" | "linear"; params: Record<string, unknown> };
}
export interface EffectNode extends NodeBase {
  kind: "effect";
  effectKey: string;
  engine: "remotion" | "lut" | "gl-transitions";
  params: Record<string, unknown>;
  /**
   * Half-open enable window in ABSOLUTE TIMELINE frames (NOT clip-relative, NOT ticks) — the same
   * space as ClipNode.startFrame/endFrame. Absent ⇒ the effect is on for the whole clip. HiteRoot
   * rebases it onto the clip's <Sequence> (clipRelativeWindow) before handing it to a renderer,
   * which sees CLIP-RELATIVE frames. (lib/edl EffectInstance.window is absolute ticks — the same
   * space, one conversion — unlike VolumeCurve below, whose EDL keyframes are node-relative.)
   */
  window?: { startFrame: number; endFrame: number };
}
export interface OverlayNode extends NodeBase {
  kind: "overlay";
  overlayKey: string;
  window: { startFrame: number; endFrame: number };
  placement: ResolvedPlacement;
  params: Record<string, unknown>;
}
export interface CaptionNode extends NodeBase {
  kind: "caption";
  window: { startFrame: number; endFrame: number };
  text: string;
  style: string;
  fontHash: string;
  words: { text: string; startFrame: number; endFrame: number }[];
}
export interface AudioNode extends NodeBase {
  kind: "audio";
  source: { assetId: string; url: string; inFrame: number; outFrame: number };
  startFrame: number;
  endFrame: number;
  volume: VolumeCurve;
  loop: boolean;
}

export type PlaybackCurve =
  | { kind: "static"; rate: number }
  | { kind: "keyframed"; table: number[] };
/**
 * `atFrames` are ABSOLUTE TIMELINE frames — the same space as EffectNode.window and ClipNode.
 * startFrame (the IR materializes one frame space, §5). The EDL's own keyframes are NODE-RELATIVE
 * ticks, so compile.ts `volumeCurve` adds the node's timeline start on the way in. Remotion's
 * `volume` callback receives SEQUENCE-RELATIVE frames, so the renderer takes it back off; a curve
 * consumed without that rebase reads the wrong keyframes for every clip that isn't at 0.
 */
export type VolumeCurve =
  | { kind: "static"; gain: number }
  | { kind: "keyframed"; atFrames: number[]; gains: number[] };
export type ResolvedPlacement =
  | { mode: "static"; x: number; y: number; w: number; h: number }
  | { mode: "face"; track: FaceTrack };
export interface FaceTrack {
  trackId: string;
  keyframes: { tick: Tick; bbox: [number, number, number, number]; conf: number }[];
}

// ───────────────────────── compiler inputs (§6.1) ─────────────────────────
export interface RenderEnv {
  aspect: "16:9" | "9:16" | "1:1";
  quality: "proxy" | "full";
  tier: "free" | "pro";
  fps: number;
  engineFingerprint: string;
}

/**
 * A time value inside a look recipe. A literal is ALREADY ms→ticks converted at the resolver
 * boundary (lib/edl/time.ts `msToTicks`); a `{{…}}` template is carried through UNEVALUATED because
 * the vars that resolve it (`recipeVars` + the look's own params) are only known in the compiler.
 */
export type RecipeTime =
  | { kind: "ticks"; ticks: number }
  | { kind: "template"; expr: string };

/**
 * Where a look's effect step applies. Absent on a step ⇒ `all` (every target clip, whole clip).
 * `unreadable` is NOT the same as absent: the recipe named a target the resolver could not parse, so
 * the compiler drops the step instead of widening it to the whole timeline.
 */
export type RecipeTarget =
  | { kind: "all" }
  | { kind: "range"; start: RecipeTime; end: RecipeTime }
  | { kind: "unreadable"; raw: string };

export interface RegistryRecipeStep {
  kind: "effect" | "overlay";
  effectKey?: string;
  overlayKey?: string;
  params: Record<string, unknown>;
  /** effect steps: whole timeline vs a tick range that becomes the EffectNode's enable window. */
  target?: RecipeTarget;
  /** overlay steps: the on-screen window, absolute timeline. Absent ⇒ the step cannot be placed. */
  window?: { start: RecipeTime; end: RecipeTime };
  /** overlay steps: the recipe's placement verbatim (its `trackFaceId` may be a `{{…}}` template). */
  placement?: Placement;
}
export interface RegistryRecipe {
  steps: RegistryRecipeStep[];
}
export interface RegistryEntryLite {
  engine: "remotion" | "lut" | "gl-transitions" | "ffmpeg" | "composed" | "overlay-asset" | "procedural";
  lutFile?: string;
}
/** Pure inputs resolved at the boundary BEFORE the (synchronous) compiler runs. */
export interface MediaResolver {
  urlForAsset(assetId: string, refKey: "full" | "proxy"): string;
  /** Video / image / audio. Omitted ⇒ the compiler assumes "video" (the pre-stills behaviour). */
  assetKind?(assetId: string): MediaKind;
  faceTrack(assetId: string, trackFaceId: string): FaceTrack;
  lookRecipe(lookKey: string): RegistryRecipe;
  registryEntry(key: string): RegistryEntryLite;
  /**
   * Analysis-derived numeric vars (e.g. `dropMs`) for look template interpolation, in the units the
   * recipe writes them (ms for `*Ms` names). A var the resolver cannot supply must be ABSENT — the
   * compiler then drops the step that needs it and records a diagnostic, instead of substituting 0.
   */
  recipeVars?(lookKey: string): Record<string, number>;
}
