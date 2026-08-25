import { z } from "zod";
import { EditBatch } from "../edl/commands";
import { tick } from "../edl/time";

/**
 * Gemini-native flat edit-command schema + mapper.
 *
 * Gemini's function-calling accepts only a restricted JSON-schema subset: no
 * tuples (z.tuple), no open records (z.record / additionalProperties), no
 * mixed-type unions (anyOf of string|object). Our canonical AiEditCommand
 * (lib/edl/commands.ts) uses all three, so Gemini rejects it with a 400.
 *
 * This is the docs' sanctioned "flat-schema escape hatch": the model emits ONE
 * flat object per command (a `type` enum + flat, optional, primitive fields),
 * and we map it back to the canonical union here. The reducer, audit log, and
 * EditBatch validation are untouched — `flatBatchToEditBatch()` returns a
 * fully-validated EditBatch (and throws if the model omitted required fields).
 */

const COMMAND_TYPES = [
  "ADD_CLIP", "REMOVE_CLIP", "MOVE_CLIP", "SPLIT_CLIP", "TRIM_CLIP", "SET_CLIP_SPEED",
  "PROPOSE_CUTS", "ADD_EFFECT", "ADD_TRANSITION", "ADD_OVERLAY", "COMPOSE_LOOK",
  "ADD_CAPTION", "ADD_AUDIO_BED", "ADD_MARKER", "SET_OUTPUT_VARIANT",
] as const;

export const FlatEditCommand = z.object({
  type: z.enum(COMMAND_TYPES).describe("The command kind; determines which other fields are required."),

  // ids / assets
  assetId: z.string().optional().describe("Asset id (ADD_CLIP, ADD_AUDIO_BED)."),
  trackId: z.string().optional().describe("Target track id (ADD_CLIP)."),
  toTrackId: z.string().optional().describe("Destination track id (MOVE_CLIP)."),
  clipId: z.string().optional().describe("Target clip id (REMOVE/MOVE/SPLIT/TRIM/SET_CLIP_SPEED; ADD_EFFECT when targetMode='clip')."),
  betweenClipIds: z.array(z.string()).optional().describe("ADD_TRANSITION: exactly two adjacent clip ids [idA, idB]."),
  targetClipIds: z.array(z.string()).optional().describe("COMPOSE_LOOK: clips to apply the look to (omit for whole timeline)."),

  // ticks / numbers (integer ticks at 30000/sec)
  atTick: z.number().optional().describe("Timeline position in ticks (ADD_CLIP/MOVE_CLIP/SPLIT_CLIP/ADD_MARKER)."),
  inTick: z.number().optional().describe("Source in-point in ticks (ADD_CLIP)."),
  outTick: z.number().optional().describe("Source out-point in ticks (ADD_CLIP)."),
  toTick: z.number().optional().describe("Absolute tick to move an edge to (TRIM_CLIP)."),
  durationTicks: z.number().optional().describe("Duration in ticks (ADD_TRANSITION)."),
  maxTicks: z.number().optional().describe("Optional max output length in ticks (SET_OUTPUT_VARIANT)."),
  windowStartTick: z.number().optional().describe("Window start tick (ADD_EFFECT range / ADD_OVERLAY / ADD_CAPTION / ADD_AUDIO_BED)."),
  windowEndTick: z.number().optional().describe("Window end tick (must be > windowStartTick)."),
  speed: z.number().optional().describe("Playback speed (SET_CLIP_SPEED): 2 = 2x, 0.5 = slow-mo."),
  volume: z.number().optional().describe("Volume 0..2 (ADD_AUDIO_BED)."),

  // enums / flags
  edge: z.enum(["in", "out"]).optional().describe("Which edge to trim (TRIM_CLIP)."),
  ripple: z.boolean().optional().describe("REMOVE_CLIP: close the gap (default true)."),
  loop: z.boolean().optional().describe("ADD_AUDIO_BED: loop the bed."),
  aspect: z.enum(["16:9", "9:16", "1:1"]).optional().describe("SET_OUTPUT_VARIANT aspect ratio."),
  markerColor: z.enum(["RED","GREEN","BLUE","CYAN","MAGENTA","YELLOW","ORANGE","PINK","PURPLE","BLACK","WHITE"]).optional().describe("ADD_MARKER color."),
  markerKind: z.enum(["chapter", "comment", "ai"]).optional().describe("ADD_MARKER kind."),
  targetMode: z.enum(["all", "clip", "range"]).optional().describe("ADD_EFFECT scope: all clips, one clip (set clipId), or a tick range (set windowStartTick/windowEndTick). Default all."),
  placementMode: z.enum(["center", "xy", "face", "topLeft", "topRight", "bottomLeft", "bottomRight"]).optional().describe("ADD_OVERLAY placement; for 'xy' set placeX/placeY, for 'face' set placeFaceId."),

  // registry keys / text
  effectKey: z.string().optional().describe("Exact registry key (ADD_EFFECT)."),
  transitionKey: z.string().optional().describe("Exact registry key (ADD_TRANSITION)."),
  overlayKey: z.string().optional().describe("Exact registry key (ADD_OVERLAY)."),
  lookKey: z.string().optional().describe("Exact registry key (COMPOSE_LOOK)."),
  captionText: z.string().optional().describe("Caption text (ADD_CAPTION)."),
  captionStyle: z.string().optional().describe("Caption style key (ADD_CAPTION)."),
  title: z.string().optional().describe("Marker title (ADD_MARKER)."),
  rationale: z.string().optional().describe("Why these cuts (PROPOSE_CUTS)."),
  paramsJson: z.string().optional().describe("Effect/transition/overlay params as a JSON object string, e.g. '{\"amount\":0.4}'. Omit if none."),

  // placement coords
  placeX: z.number().optional().describe("ADD_OVERLAY x (placementMode='xy')."),
  placeY: z.number().optional().describe("ADD_OVERLAY y (placementMode='xy')."),
  placeFaceId: z.string().optional().describe("ADD_OVERLAY face track id (placementMode='face')."),

  // proposed cuts (PROPOSE_CUTS)
  proposedClips: z.array(z.object({
    assetId: z.string().optional(),
    inTick: z.number(),
    outTick: z.number(),
    speed: z.number().optional(),
    volume: z.number().optional(),
  })).optional().describe("PROPOSE_CUTS: the full proposed sequence of clips."),
});
export type FlatEditCommand = z.infer<typeof FlatEditCommand>;

export const FlatEditBatch = z.object({
  commands: z
    .array(FlatEditCommand)
    .describe(
      "All edit commands for this turn (up to 40). Emit none ONLY when the request needs no edit — " +
      "then explain why in `summary`.",
    ),
  summary: z.string().describe("One-line description of the change, shown to the user."),
});
export type FlatEditBatch = z.infer<typeof FlatEditBatch>;

// ── flat → canonical helpers ────────────────────────────────────────────────
/**
 * Snap a model-emitted tick onto the integer grid canonical `Tick` (z.number().int()) demands.
 * LLM arithmetic ("half a second before the drop", a midpoint `(a+b)/2`) routinely lands on a .5,
 * and ONE fractional field used to fail the WHOLE batch after the tool-loop had run and the daily
 * prompt credit was already spent. Rounding is lossless at 30000 ticks/s (1 tick ≈ 33 µs).
 * `tick()` (lib/edl/time.ts) is the codebase's one integer-coercion — int32-safe, unlike `| 0`.
 */
function roundTick(n: number | undefined): number | undefined {
  return n == null ? undefined : tick(n);
}
function win(f: FlatEditCommand): { startTick: number; endTick: number } | undefined {
  const startTick = roundTick(f.windowStartTick);
  const endTick = roundTick(f.windowEndTick);
  return startTick != null && endTick != null ? { startTick, endTick } : undefined;
}
/**
 * Params the user asked for are INTENT ("very subtle grain, like 10%"), so unusable JSON is a loud
 * failure, not a shrug: the old `{}` fallback applied the effect at registry defaults and the turn
 * reported success, i.e. the model silently ignored the nuance the user actually asked for.
 */
function parseParams(json?: string): Record<string, unknown> {
  if (!json) return {};
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new Error(`paramsJson is not valid JSON: ${json.slice(0, 80)}`);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`paramsJson must be a JSON object, got: ${json.slice(0, 80)}`);
  }
  return v as Record<string, unknown>;
}
function placement(f: FlatEditCommand): Record<string, unknown> {
  // Same fail-loud policy as effectTarget(): canonical `Placement` accepts any number / any string,
  // so a defaulted (0,0) or trackFaceId:"" is never caught downstream — the overlay just renders in
  // the wrong place (or wherever the face resolver's miss-path lands) and the turn reports success.
  switch (f.placementMode) {
    case "xy":
      if (f.placeX == null || f.placeY == null) throw new Error("placementMode='xy' requires placeX and placeY");
      return { mode: "xy", x: f.placeX, y: f.placeY };
    case "face":
      if (!f.placeFaceId) throw new Error("placementMode='face' requires placeFaceId");
      return { mode: "face", trackFaceId: f.placeFaceId };
    case "topLeft":
    case "topRight":
    case "bottomLeft":
    case "bottomRight": return { mode: f.placementMode };
    default: return { mode: "center" };
  }
}
function effectTarget(f: FlatEditCommand): unknown {
  // Fail loud rather than silently widening scope: a "clip"/"range" request with
  // no clipId/window must NOT fall through to "all" (that would grade the whole
  // timeline — destructive and hard to undo).
  if (f.targetMode === "clip") {
    if (!f.clipId) throw new Error("targetMode='clip' requires clipId");
    return { clipId: f.clipId };
  }
  if (f.targetMode === "range") {
    const w = win(f);
    if (!w) throw new Error("targetMode='range' requires windowStartTick and windowEndTick");
    // A swapped pair ("from 0:09 to 0:03") satisfies the reducer's overlap test, so it would apply
    // the effect to whole clips instead of failing like every other degenerate window does.
    if (w.startTick >= w.endTick) {
      throw new Error(`targetMode='range' requires windowStartTick < windowEndTick (got ${w.startTick}..${w.endTick})`);
    }
    return { range: w };
  }
  return "all";
}

/** Map one flat command to the canonical AiEditCommand shape (validated downstream). */
function toCanonical(f: FlatEditCommand): Record<string, unknown> {
  switch (f.type) {
    case "ADD_CLIP":
      return { type: f.type, assetId: f.assetId, trackId: f.trackId, atTick: roundTick(f.atTick), inTick: roundTick(f.inTick), outTick: roundTick(f.outTick) };
    case "REMOVE_CLIP":
      return { type: f.type, clipId: f.clipId, ...(f.ripple != null ? { ripple: f.ripple } : {}) };
    case "MOVE_CLIP":
      return { type: f.type, clipId: f.clipId, toTrackId: f.toTrackId, atTick: roundTick(f.atTick) };
    case "SPLIT_CLIP":
      return { type: f.type, clipId: f.clipId, atTick: roundTick(f.atTick) };
    case "TRIM_CLIP":
      return { type: f.type, clipId: f.clipId, edge: f.edge, toTick: roundTick(f.toTick) };
    case "SET_CLIP_SPEED":
      return { type: f.type, clipId: f.clipId, speed: f.speed };
    case "PROPOSE_CUTS":
      return {
        type: f.type,
        clips: (f.proposedClips ?? []).map((c) => ({ ...c, inTick: tick(c.inTick), outTick: tick(c.outTick) })),
        ...(f.rationale ? { rationale: f.rationale } : {}),
      };
    case "ADD_EFFECT": {
      const target = effectTarget(f);
      // The window is the effect's ENABLE GATE — the only thing that makes a time-scoped effect
      // time-scoped (compile.ts turns it into IR frames, HiteRoot rebases it per clip). For
      // targetMode='range' the SAME window is used twice, deliberately: `target.range` picks WHICH
      // clips get the effect, `window` picks WHEN it paints. Dropping it here (the old
      // "double-applies it" rationale) was wrong — the reducer's range test only selects clips, it
      // gates no time — so "glitch from 0:03 to 0:09" graded whole clips, i.e. the entire video on
      // the one-clip seed timeline, in preview and export alike.
      const window = win(f);
      return { type: f.type, effectKey: f.effectKey, params: parseParams(f.paramsJson), target, ...(window ? { window } : {}) };
    }
    case "ADD_TRANSITION":
      return { type: f.type, betweenClipIds: f.betweenClipIds, transitionKey: f.transitionKey, durationTicks: roundTick(f.durationTicks), params: parseParams(f.paramsJson) };
    case "ADD_OVERLAY":
      return { type: f.type, overlayKey: f.overlayKey, window: win(f), placement: placement(f), params: parseParams(f.paramsJson) };
    case "COMPOSE_LOOK":
      return { type: f.type, lookKey: f.lookKey, ...(f.targetClipIds ? { targetClipIds: f.targetClipIds } : {}) };
    case "ADD_CAPTION":
      return { type: f.type, window: win(f), text: f.captionText, ...(f.captionStyle ? { style: f.captionStyle } : {}) };
    case "ADD_AUDIO_BED":
      return { type: f.type, assetId: f.assetId, window: win(f), ...(f.volume != null ? { volume: f.volume } : {}), ...(f.loop != null ? { loop: f.loop } : {}) };
    case "ADD_MARKER":
      return { type: f.type, atTick: roundTick(f.atTick), title: f.title, ...(f.markerColor ? { color: f.markerColor } : {}), ...(f.markerKind ? { kind: f.markerKind } : {}) };
    case "SET_OUTPUT_VARIANT":
      return { type: f.type, aspect: f.aspect, ...(f.maxTicks != null ? { maxTicks: tick(f.maxTicks) } : {}) };
  }
  throw new Error(`unknown command type: ${(f as { type: string }).type}`);
}

/**
 * A ZERO-command emit is the contract, not a failure: both system prompts tell the model to answer
 * an impossible or empty request by calling `emitEditBatch` with an explanatory `summary` and no
 * commands. Routes call this BEFORE `flatBatchToEditBatch` and stream the explanation as a no-op
 * turn (nothing reduced, nothing persisted). Returns null for anything else — including a malformed
 * emit, so the mapper below still produces the real, field-named error.
 */
export function readNoOpEmit(raw: unknown): { summary: string } | null {
  const flat = FlatEditBatch.safeParse(raw);
  if (!flat.success || flat.data.commands.length > 0) return null;
  return { summary: flat.data.summary };
}

/**
 * Validate a model-emitted flat batch and map it to a canonical, fully-validated
 * EditBatch. Throws if the model omitted fields required by a command.
 */
export function flatBatchToEditBatch(raw: unknown): z.infer<typeof EditBatch> {
  const flat = FlatEditBatch.parse(raw);
  // Callers that reach here have committed to APPLYING an edit; a batch with nothing in it is a
  // contradiction. The no-op turn is handled earlier, by `readNoOpEmit`.
  if (flat.commands.length === 0) throw new Error("planner emitted an empty edit batch");
  if (flat.commands.length > 40) throw new Error("planner emitted too many commands (>40)");
  const commands = flat.commands.map((f, i) => {
    try {
      return toCanonical(f);
    } catch (e) {
      // Same `command #N (TYPE): …` shape as the Zod path below, so the chat shows one error format
      // whether the field was missing (Zod) or unusable (this mapper).
      throw new Error(`command #${i + 1} (${f.type}): ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const parsed = EditBatch.safeParse({ commands, summary: flat.summary });
  if (!parsed.success) {
    // Turn an opaque ZodError into an actionable message naming the command + field,
    // so a single malformed command doesn't fail the batch with a cryptic path.
    const issue = parsed.error.issues[0];
    const idx = typeof issue.path[1] === "number" ? (issue.path[1] as number) : undefined;
    const type = idx != null ? (flat.commands[idx]?.type ?? "?") : "?";
    const field = issue.path.slice(idx != null ? 2 : 0).join(".") || "(command)";
    throw new Error(
      idx != null
        ? `command #${idx + 1} (${type}): ${field} — ${issue.message}`
        : `invalid edit batch: ${issue.path.join(".")} — ${issue.message}`,
    );
  }
  return parsed.data;
}
