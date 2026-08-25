import type { ProviderCapabilities, ThinkingIntent } from "@/lib/ai/providers/types";

/**
 * The effort ladder — the ONE owner of "how hard does the planner try".
 *
 * Every level is a *planning shape*, not a label. The ordering of the levers below is deliberate,
 * and it is not the obvious one:
 *
 *   1. VERIFICATION against ground truth (`revisions` / `repairOnly`). The batch is dry-run reduced
 *      and the resulting timeline is handed back to the model to compare against the request. This
 *      is the biggest quality lever and it costs one extra round-trip, not a bigger model.
 *   2. GROUNDING (`groundSteps`) — `emitEditBatch` is withheld for the first N steps, so the model
 *      physically cannot skip investigation and guess. A structural guarantee, not a polite ask.
 *   3. THINKING (`thinking`) — better internal planning per step.
 *   4. STEP CAP — permission to do 1-3, not a quality lever on its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED WHEN HITE BECAME MULTI-PROVIDER, AND WHY IT MATTERS
 *
 * The ladder used to own a MODEL per level, and `max` was hardcoded to `gemini-2.5-pro` — which
 * 404s for new accounts and is unreachable on free-tier keys, so the top rung was dead on arrival
 * for exactly the users most likely to try it. A ladder cannot own a model id: the user picks the
 * provider and the model, and the rung picks the SHAPE. `EffortProfile.model` is therefore gone, and
 * `HITE_PLANNER_MODEL` / `HITE_MAX_EFFORT_MODEL` with it.
 *
 * `thinkingBudget: number | null` likewise became `thinking: ThinkingIntent` — a normalized lever
 * that each provider translates into its own vocabulary (`lib/ai/providers/options.ts`). Gemini's
 * per-family budget ranges did not disappear; they moved to `lib/ai/gemini.ts` where they are still
 * exactly right, and a Gemini run comes out numerically identical to what it was.
 *
 * A note on the low end, because it inverts the usual assumption: several models think DYNAMICALLY
 * when no lever is sent, so "send nothing" is not "thinking off". `draft` therefore says `off`
 * explicitly, which makes it a genuinely cheaper path rather than a rename of the default one.
 *
 * Tool BREADTH is deliberately NOT a lever. `lib/ai/tools/router.ts` caps exposure at ~16 because
 * selection accuracy collapses past it; showing high effort more tools makes it worse, not better.
 */

export const EFFORT_LEVELS = ["draft", "standard", "high", "max"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/**
 * The one default, because there is one payer.
 *
 * BYOK is the only path: the user pays their provider directly, so there is no deployer budget to
 * protect by starting them low. `max` stays opt-in because of wall-clock, not cost.
 */
export const DEFAULT_EFFORT: Effort = "high";

export interface EffortProfile {
  readonly level: Effort;
  /** The reasoning lever, normalized. `lib/ai/providers/options.ts` translates it per provider. */
  readonly thinking: ThinkingIntent;
  /** SDK-level `stepCountIs` cap: analysis hops + emits + revisions. */
  readonly steps: number;
  /** Extra emits allowed AFTER the first one. 0 = one-shot. */
  readonly revisions: number;
  /** true → only re-prompt when the dry-run FAILED (repair). false → critique even a valid batch. */
  readonly repairOnly: boolean;
  /** Steps at the start of the turn where `emitEditBatch` is withheld, forcing investigation. */
  readonly groundSteps: number;
  /** The tool-budget line appended to the user message. */
  readonly toolGuidance: string;
  /**
   * Wall-clock budget for the whole turn. Enforced twice: as the SDK's own `timeout.totalMs`, and
   * as a deadline `prepareStep` checks so the turn ends with a batch instead of being killed
   * mid-thought. Always < the route's `maxDuration`, with room for the DB write.
   */
  readonly wallClockMs: number;
}

/**
 * The ladder itself. `groundSteps` counts STEPS, not tool calls — models emit parallel function
 * calls, so two grounding steps is typically 2-8 analysis calls, which reaches the "4-6 typical"
 * target without burning the step budget. Kept deliberately small: the planner forces a tool call
 * during grounding (see the note there), so each grounding step the request did not need costs a
 * redundant analysis hop.
 */
const LADDER: Record<Effort, Omit<EffortProfile, "level">> = {
  draft: {
    thinking: "off",
    steps: 5,
    revisions: 0,
    repairOnly: false,
    groundSteps: 0,
    toolGuidance:
      "Call AT MOST 1-2 analysis/advisor tools (only what this request needs), then IMMEDIATELY call emitEditBatch with the commands. Do not keep exploring tools — emitting the batch is how you finish.",
    // Never tighter than the 60s the routes already enforced, so the fast path cannot regress.
    wallClockMs: 45_000,
  },
  standard: {
    thinking: "low",
    steps: 10,
    revisions: 1,
    repairOnly: true,
    groundSteps: 0,
    toolGuidance:
      "Call AT MOST 2-3 analysis/advisor tools (only what this request needs), then IMMEDIATELY call emitEditBatch with the commands. Do not keep exploring tools — emitting the batch is how you finish.",
    wallClockMs: 55_000,
  },
  high: {
    thinking: "high",
    steps: 18,
    revisions: 2,
    repairOnly: false,
    groundSteps: 2,
    toolGuidance:
      "INVESTIGATE FIRST: call every analysis/advisor tool this request actually needs (4-6 is typical) before you plan anything — measure, do not guess. Then call emitEditBatch. Your batch will be applied to the real timeline and the result handed back to you for review, so plan for that check.",
    wallClockMs: 110_000,
  },
  max: {
    thinking: "dynamic",
    steps: 28,
    revisions: 3,
    repairOnly: false,
    groundSteps: 3,
    toolGuidance:
      "INVESTIGATE FIRST: call every analysis/advisor tool this request actually needs before you plan anything, and re-check anything you inferred rather than measured. Then call emitEditBatch. Your batch will be applied to the real timeline and the result handed back to you for review, so plan for that check.",
    wallClockMs: 280_000,
  },
};

export const EFFORT: Record<Effort, EffortProfile> = Object.freeze(
  Object.fromEntries(EFFORT_LEVELS.map((level) => [level, Object.freeze({ level, ...LADDER[level] })])) as Record<
    Effort,
    EffortProfile
  >,
);

const RANK: Record<Effort, number> = { draft: 0, standard: 1, high: 2, max: 3 };

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * The level for this request, NEVER trusted raw.
 *
 * Absent or unrecognised falls back to the default. Routes validate the body against
 * `z.enum(EFFORT_LEVELS)` first, so a client that posts garbage gets a 400 with the field named
 * rather than a silent downgrade; this fallback covers the *absent* case and any non-route caller,
 * where quietly running the default is the only sane behaviour.
 */
export function resolveEffort(value: unknown): Effort {
  return isEffort(value) ? value : DEFAULT_EFFORT;
}

/** `min(requested, ceiling)` by rank. */
export function clampEffort(requested: Effort, ceiling: Effort): Effort {
  return RANK[requested] <= RANK[ceiling] ? requested : ceiling;
}

/**
 * The highest rung whose grounding phase needs nothing enforced upstream — derived from the ladder,
 * not written down twice. Today that is `standard`; if a future rung gains `groundSteps > 0` this
 * moves with it automatically.
 */
const UNGROUNDED_CEILING: Effort = (() => {
  let ceiling: Effort = EFFORT_LEVELS[0];
  for (const level of EFFORT_LEVELS) {
    if (LADDER[level].groundSteps > 0) break;
    ceiling = level;
  }
  return ceiling;
})();

/**
 * THE HIGHEST RUNG THIS PROVIDER+MODEL CAN HONESTLY RUN — derived from capabilities, never
 * configured and never keyed to a vendor id.
 *
 * Rungs with `groundSteps > 0` depend on `toolChoice: "required"` being ENFORCED upstream:
 * `prepareStep` withholds the emit tool and requires a call, and the SDK's loop only continues after
 * a step that made one. On a provider that ACCEPTS `tool_choice` and silently ignores it (Ollama —
 * its published `ChatRequest` has no such field), a grounding step answered with prose ends the turn
 * with NO BATCH. "Investigate first" becomes "lose the edit". So the ceiling is a fact about the
 * provider, and a rung it cannot serve is refused rather than offered and quietly broken.
 */
export function rungCeiling(capabilities: ProviderCapabilities): Effort {
  if (!capabilities.toolCalling) {
    throw new Error("[effort] a provider without tool calling cannot run the planner at all");
  }
  return capabilities.toolChoice ? "max" : UNGROUNDED_CEILING;
}

/**
 * Human-readable reason a provider's ceiling is where it is, for the settings UI to render verbatim.
 * `null` when nothing is being withheld.
 */
export function rungCeilingReason(capabilities: ProviderCapabilities): string | null {
  if (capabilities.toolChoice) return null;
  return (
    `This provider accepts a forced tool call but does not enforce one, so the grounded rungs above ` +
    `${UNGROUNDED_CEILING} would end a turn with no edit at all rather than with a worse edit.`
  );
}

/**
 * The DEPLOYER'S brake, distinct from the provider's own ceiling.
 *
 * A self-hoster may want to cap function-seconds regardless of what the user's provider can do —
 * `max` holds a serverless invocation for minutes. Unset means no brake. An unrecognised value is
 * ignored with a warning rather than silently clamping to something nobody chose.
 */
export function deployerEffortCeiling(): Effort | null {
  const raw = process.env.HITE_BYOK_EFFORT_CEILING?.trim();
  if (raw === undefined || raw === "") return null;
  if (isEffort(raw)) return raw;
  console.warn(`[effort] HITE_BYOK_EFFORT_CEILING='${raw}' is not one of ${EFFORT_LEVELS.join("|")} — ignoring it`);
  return null;
}

/** The rung actually reachable right now: `min(provider ceiling, deployer ceiling)`. */
export function effectiveCeiling(capabilities: ProviderCapabilities): Effort {
  const deployer = deployerEffortCeiling();
  const provider = rungCeiling(capabilities);
  return deployer === null ? provider : clampEffort(provider, deployer);
}

/** The one call a route makes: validate → default → clamp → resolved profile. */
export function effortProfileFor(requested: unknown, capabilities: ProviderCapabilities): EffortProfile {
  return EFFORT[clampEffort(resolveEffort(requested), effectiveCeiling(capabilities))];
}
