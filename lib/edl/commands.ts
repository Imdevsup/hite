/**
 * lib/edl/commands.ts — Layer 0, the canonical EditCommand union (docs/CANONICAL-IR-SPEC.md §3,
 * docs/DECISIONS.md §2).
 *
 * One vocabulary emitted by BOTH the AI (a batch per turn) and the manual UI (one per gesture).
 * A command is INTENT, not a diff. Two schemas, deliberately:
 *   • `AiEditCommand` — a `z.union` (NOT `z.discriminatedUnion`, whose `oneOf` output no
 *     structured-output provider we've shipped on accepts); this is the canonical shape the
 *     model's emission is mapped ONTO. Gemini's own function-calling rejects unions/tuples/
 *     records outright, so the model actually emits the flat schema in
 *     lib/ai/edit-batch-flat.ts, which `flatBatchToEditBatch()` maps back to this union.
 *   • `EditCommand` — the full internal union (AI + UI-only), still narrowable on `cmd.type`
 *     for the reducer's exhaustive `never` check.
 *
 * Time is integer ticks (lib/edl/time.ts). Casing is SCREAMING_SNAKE.
 */
import { z } from "zod";
import { Placement, MarkerColor, ProposedClip } from "./schema";

const Id = z.string().min(1);
/**
 * Every tick in a COMMAND is either an absolute timeline/source position or a duration — there is
 * no relative-offset command in the vocabulary — so a negative value is always a caller bug (a sign
 * error or relative/absolute confusion from the model). Bounding it here makes the flat mapper fail
 * loud with a field-named error instead of the reducer silently appending a "before zero" clip at
 * the END of the track. (The Edl.2 node schema keeps its own per-field bounds; this is the input edge.)
 */
const Tick = z.number().int().nonnegative();
/**
 * Half-open `[startTick, endTick)`. The ordering refine is load-bearing: an equal/inverted window
 * (an easy off-by-zero for the model) is accepted by every per-field check yet renders NOTHING —
 * the batch "succeeds" and the user sees no change. Reject it where the field can be named.
 */
const TickWindow = z
  .object({ startTick: Tick, endTick: Tick })
  .refine((w) => w.endTick > w.startTick, { message: "endTick must be greater than startTick", path: ["endTick"] });

/** One target selector for effects (canonical name `ApplyTarget`). */
export const ApplyTarget = z.union([
  z.literal("all"),
  z.object({ clipId: Id }),
  z.object({ range: TickWindow }),
]);
export type ApplyTarget = z.infer<typeof ApplyTarget>;

// ── AI-facing commands: z.union (NOT z.discriminatedUnion — §3.6) ──────────────
export const AiEditCommand = z.union([
  z.object({ type: z.literal("ADD_CLIP"), assetId: Id, trackId: Id, atTick: Tick, inTick: Tick, outTick: Tick })
    // An inverted/empty source range is never a legal insert: the reducer used to clamp it to a
    // 1-tick (1/30000s) invisible sliver. Named-field rejection so the model can fix the pair.
    .refine((c) => c.outTick > c.inTick, { message: "outTick must be greater than inTick", path: ["outTick"] })
    .describe("Insert a trimmed clip on a track at atTick."),
  z.object({ type: z.literal("REMOVE_CLIP"), clipId: Id, ripple: z.boolean().default(true) }),
  z.object({ type: z.literal("MOVE_CLIP"), clipId: Id, toTrackId: Id, atTick: Tick })
    .describe("Move a clip to toTrackId at atTick. May cross tracks."),
  z.object({ type: z.literal("SPLIT_CLIP"), clipId: Id, atTick: Tick }),
  z.object({ type: z.literal("TRIM_CLIP"), clipId: Id, edge: z.enum(["in", "out"]), toTick: Tick }),
  z.object({ type: z.literal("SET_CLIP_SPEED"), clipId: Id, speed: z.number().positive() }),
  z.object({ type: z.literal("PROPOSE_CUTS"), clips: z.array(ProposedClip).min(1), rationale: z.string().optional() }),
  z.object({
    type: z.literal("ADD_EFFECT"),
    target: ApplyTarget.default("all"),
    effectKey: z.string().describe("exact registry key, e.g. 'saturation-up'"),
    params: z.record(z.unknown()).default({}),
    // ABSOLUTE TIMELINE ticks (same space as an overlay/caption window, never clip-local): this is
    // the enable GATE — WHEN the effect paints — while `target` picks WHICH clips carry it.
    window: TickWindow.optional(),
  }),
  z.object({
    type: z.literal("ADD_TRANSITION"),
    betweenClipIds: z.tuple([Id, Id]),
    transitionKey: z.string(),
    durationTicks: Tick.positive(), // Transition.1 requires > 0; catch it here with a field name, not at the Edl.parse tripwire
    params: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal("ADD_OVERLAY"),
    overlayKey: z.string(),
    window: TickWindow,
    placement: Placement,
    params: z.record(z.unknown()).default({}),
  }),
  z.object({ type: z.literal("COMPOSE_LOOK"), lookKey: z.string(), targetClipIds: z.array(Id).optional() }),
  z.object({ type: z.literal("ADD_CAPTION"), window: TickWindow, text: z.string(), style: z.string().default("default") }),
  z.object({
    type: z.literal("ADD_AUDIO_BED"),
    assetId: Id,
    window: TickWindow,
    volume: z.number().min(0).max(2).default(0.4),
    loop: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("ADD_MARKER"),
    atTick: Tick,
    title: z.string(),
    color: MarkerColor.default("BLUE"),
    kind: z.enum(["chapter", "comment", "ai"]).default("comment"),
  }),
  // maxTicks is a HARD output cap consumed by the IR compiler — 0 would mean "render nothing".
  z.object({ type: z.literal("SET_OUTPUT_VARIANT"), aspect: z.enum(["16:9", "9:16", "1:1"]), maxTicks: Tick.positive().optional() }),
]);

// ── UI-only commands (never emitted by the model) ──────────────────────────────
export const UiOnlyCommand = z.union([
  z.object({ type: z.literal("SET_CLIP_VOLUME"), clipId: Id, volume: z.number().min(0).max(2) }),
  z.object({ type: z.literal("REMOVE_EFFECT"), clipId: Id, effectId: Id }),
  z.object({ type: z.literal("REMOVE_TRANSITION"), transitionId: Id }),
  z.object({ type: z.literal("REMOVE_OVERLAY"), overlayId: Id }),
  z.object({ type: z.literal("REMOVE_CAPTION"), captionId: Id }),
  z.object({ type: z.literal("REMOVE_AUDIO_BED"), audioBedId: Id }),
  z.object({ type: z.literal("CLEAR_LOOKS") }),
  z.object({ type: z.literal("SET_CAPTION_STYLE"), captionId: Id, style: z.string() }),
  z.object({ type: z.literal("ADJUST_WORD_TIMING"), captionId: Id, startTick: Tick, endTick: Tick }),
]);

/** The full internal union — used for the reducer's exhaustive switch. */
export const EditCommand = z.union([...AiEditCommand.options, ...UiOnlyCommand.options]);
export type EditCommand = z.infer<typeof EditCommand>;
export type EditCommandType = EditCommand["type"];

/** The AI returns exactly this per turn (§3.5). Cap 40 = one turn's worth of edits, not a provider limit. */
export const EditBatch = z
  .object({
    commands: z.array(AiEditCommand).min(1).max(40),
    summary: z.string(), // REQUIRED — the chat UI consumes it
  })
  .describe("EditCommandBatch — all edits for this turn, applied atomically.");
export type EditBatch = z.infer<typeof EditBatch>;

/** The persisted audit-log row (§3.4). One shape reconciling all Wave-1 envelopes. */
export interface CommandEnvelope {
  id: string; // ULID — minted ONCE at the boundary (the only randomness in the system)
  schemaV: 1;
  batchId: string; // one AI turn / one UI gesture; one undo step
  seq: number; // monotonic per session; UNIQUE(sessionId, seq) = optimistic concurrency
  command: EditCommand;
  source: "ai" | "user" | "seed"; // matches edl.metadata.generatedBy
  actor: string; // user id or model id ("openai/gpt-5")
  parentEditId: string;
  rationale?: string;
  createdAt: string; // ISO; metadata only — the reducer never reads it
}
