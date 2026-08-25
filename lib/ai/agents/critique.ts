import type { Edl } from "@/lib/edl/schema";
import type { EditBatch, EditCommand } from "@/lib/edl/commands";
import { reduceBatch, withContentHash } from "@/lib/edl/reducer";
import { flatBatchToEditBatch, readNoOpEmit } from "@/lib/ai/edit-batch-flat";
import { describeCommand } from "@/lib/editor/describeCommand";
import { summarizeEdl } from "@/lib/ai/timeline";
import { allClipPositions, locateClip } from "@/lib/edl/query";
import { TICKS_PER_SECOND } from "@/lib/edl/time";
import { errorMessage } from "@/lib/api/errors";
import type { EffortProfile } from "@/lib/ai/effort";

/**
 * The critique pass — what makes high effort produce a BETTER edit rather than a longer wait.
 *
 * Today the planner emits a batch blind: it never sees what its own commands did. Every expensive
 * failure mode lives in that gap — "you asked for a 60-second cut-down and this timeline is 94
 * seconds", "findFillerWords returned seven spans and the batch removes three", "the transition you
 * added is between two clips that the ripple delete just separated". None of it is visible to a
 * model that emits and stops.
 *
 * So `emitEditBatch` gets an `execute` that ACTUALLY APPLIES the batch, in-process, with no DB and
 * no network: map it (`flatBatchToEditBatch`) → reduce it (`reduceBatch`) → describe the result in
 * the exact format the model read the parent timeline in, plus a set of checks computed by the
 * SERVER, not asserted by the model. A critique that only says "are you sure?" buys nothing; these
 * carry measured facts.
 *
 * Two consequences worth stating:
 *
 *  - The reduce MOVES here from the route. There is one reduce per emit, not two, and the route
 *    persists `run.lastValid` — a batch that has already been proven to apply. It can no longer
 *    persist an unvalidated batch, and it can no longer lose a valid one to a later failed revision.
 *  - A tool WITHOUT `execute` produces no tool-result message, and Gemini cannot legally continue a
 *    turn after a function-call with no function-response. Adding `execute` is what makes the
 *    revise loop possible at all; it is not decoration.
 */

/** The turn is over and the batch stands: a deliberate zero-command answer. Never critiqued. */
export interface DryRunNoOp {
  readonly kind: "no-op";
  readonly summary: string;
  readonly note: string;
}

/** The batch applied. At `repairOnly` levels this ends the turn; above them it starts the review. */
export interface DryRunApplied {
  readonly kind: "applied";
  /** `summarizeEdl(next)` — the SAME formatter the prompt used for the parent timeline. */
  readonly resultingTimeline: string;
  readonly applied: readonly string[];
  readonly deltas: {
    readonly durationTicksBefore: number;
    readonly durationTicksAfter: number;
    readonly clipsBefore: number;
    readonly clipsAfter: number;
  };
  /** Deterministic, server-computed findings. Empty means "nothing measurable looks wrong". */
  readonly checks: readonly string[];
  readonly instruction: string;
}

/** The batch does not apply. The problems are the mapper's/reducer's own field-named messages. */
export interface DryRunRejected {
  readonly kind: "rejected";
  readonly problems: readonly string[];
  readonly instruction: string;
}

export type DryRunResult = DryRunNoOp | DryRunApplied | DryRunRejected;

/**
 * A failure the turn must NOT recover from, however much valid work preceded it. Distinguished from
 * an ordinary stream fault because the route deliberately salvages the latter (a validated batch is
 * worth more than a lost turn) and must never salvage this one.
 */
export class PlannerContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerContractError";
  }
}

/** Leave this much of the wall-clock budget for the final emit + the DB write. */
export const DEADLINE_RESERVE_MS = 12_000;

export interface PlannerRunInput {
  readonly effort: EffortProfile;
  readonly parentEdl: Edl;
  readonly assetDurationsTicks: Record<string, number>;
  readonly prompt: string;
  /** Injected so the deadline is testable and the module has no hidden clock. */
  readonly now?: () => number;
}

/**
 * Per-turn state shared by the planner's tool loop and the route that persists the result.
 *
 * Two independent counters live here on purpose, because they are observed from two places that
 * cannot see each other's ordering:
 *
 *  - `emitCount` / `lastValid` are written inside `emitEditBatch.execute`, synchronously with the
 *    model loop. The SDK evaluates `stopWhen` after a step's tools have run, so these are the only
 *    values the stop condition can trust.
 *  - `streamEmitsThisStep` is written by the ROUTE as it walks `fullStream`. The route may read the
 *    stream later than the tool executed, so it counts its own view — which is the only view in
 *    which "two emits inside ONE step" (Gemini's parallel function calls) is even a well-defined
 *    question.
 */
export class PlannerRun {
  readonly effort: EffortProfile;
  readonly deadlineAt: number;
  private readonly parentEdl: Edl;
  private readonly assetDurationsTicks: Record<string, number>;
  private readonly prompt: string;
  private readonly now: () => number;

  /** Emits that reached the dry run. Authoritative for the stop condition. */
  emitCount = 0;
  /** The last batch that actually applied, with the timeline it produced. What the route persists. */
  lastValid: { batch: EditBatch; edl: Edl } | null = null;
  /** Field-named problems from the last REJECTED dry run; the error text if nothing ever applied. */
  lastProblems: readonly string[] = [];
  /** A deliberate zero-command answer ends the turn immediately, edit or no edit. */
  noOp: { summary: string } | null = null;

  private lastOk = false;
  private streamEmitsThisStep = 0;
  /** True while the model has been handed a result and still owes us a confirm-or-correct. */
  private awaitingReview = false;
  /**
   * Content hashes of the timelines already shown to the model. Re-emitting an identical batch is
   * the sanctioned way to CONFIRM, so it must terminate; emitting a DIFFERENT one is a correction,
   * and a correction that was never checked is exactly the thing the extra revisions are for.
   */
  private readonly reviewed = new Set<string>();

  constructor(input: PlannerRunInput) {
    this.effort = input.effort;
    this.parentEdl = input.parentEdl;
    this.assetDurationsTicks = input.assetDurationsTicks;
    this.prompt = input.prompt;
    this.now = input.now ?? Date.now;
    this.deadlineAt = this.now() + input.effort.wallClockMs;
  }

  /** Route: a new `start-step` part arrived. */
  beginStreamStep(): void {
    this.streamEmitsThisStep = 0;
  }

  /**
   * Route: an `emitEditBatch` tool-call part arrived. Gemini may legally emit PARALLEL function
   * calls; taking the last one applied half an edit while the summary described all of it, so the
   * turn fails instead. Sequential emits across steps are the revise loop and are fine.
   */
  noteStreamEmit(): void {
    this.streamEmitsThisStep += 1;
    if (this.streamEmitsThisStep > 1) throw new PlannerContractError("planner emitted multiple edit batches");
  }

  get pastDeadline(): boolean {
    return this.now() >= this.deadlineAt - DEADLINE_RESERVE_MS;
  }

  /**
   * Has the turn produced everything it is going to?
   *
   * Emits are budgeted as `revisions + 1` (the first attempt plus its allowed revisions). A valid
   * batch settles immediately at a `repairOnly` level; above them it settles once the model has seen
   * what its batch produced and answered — by confirming (re-emitting the same timeline) or by
   * correcting it into one we then check too. That round IS the quality.
   */
  get settled(): boolean {
    if (this.noOp) return true;
    if (this.emitCount === 0) return false;
    if (this.pastDeadline) return true; // we have a validated batch or nothing; either way, stop
    if (this.emitCount > this.effort.revisions) return true;
    if (!this.lastOk) return false; // a rejected batch always gets its repair round
    return !this.awaitingReview;
  }

  /** Whether another emit is still budgeted after the one just processed. */
  private get budgetLeft(): boolean {
    return this.emitCount <= this.effort.revisions;
  }

  /**
   * Apply the model's emitted batch for real, and answer with what it produced.
   *
   * Pure with respect to the outside world: no DB, no network, no mutation of anything the caller
   * owns. The only side effects are onto `this`.
   */
  dryRun(input: unknown): DryRunResult {
    this.emitCount += 1;

    // A zero-command emit is the prompt's sanctioned "can't / needn't do that" answer. Never
    // critique a deliberate no-op into becoming an edit.
    const noOp = readNoOpEmit(input);
    if (noOp) {
      this.noOp = noOp;
      this.lastOk = true;
      return { kind: "no-op", summary: noOp.summary, note: "Recorded as a no-op turn. Nothing was applied." };
    }

    let batch: EditBatch;
    try {
      batch = flatBatchToEditBatch(input);
    } catch (e) {
      return this.reject(e);
    }

    let next: Edl;
    try {
      next = reduceBatch(this.parentEdl, batch.commands as EditCommand[], {
        assetDurationsTicks: this.assetDurationsTicks,
      }).edl;
    } catch (e) {
      return this.reject(e);
    }

    this.lastOk = true;
    this.lastProblems = [];
    this.lastValid = { batch, edl: next };

    // Review this result unless the level does not critique valid batches, the budget is gone, or
    // the model just re-emitted a timeline it has already been shown (its way of confirming).
    const hash = next.contentHash ?? "";
    this.awaitingReview = !this.effort.repairOnly && this.budgetLeft && !this.reviewed.has(hash);
    if (this.awaitingReview) this.reviewed.add(hash);

    const clipsBefore = allClipPositions(this.parentEdl).length;
    const clipsAfter = allClipPositions(next).length;
    return {
      kind: "applied",
      resultingTimeline: summarizeEdl(next),
      applied: batch.commands.map(describeCommand),
      deltas: {
        durationTicksBefore: this.parentEdl.durationTicks,
        durationTicksAfter: next.durationTicks,
        clipsBefore,
        clipsAfter,
      },
      checks: computeChecks(this.prompt, this.parentEdl, next, batch),
      // Never promise a round that will not happen: the loop stops the moment `awaitingReview` is
      // false, so the model would be told to call again by a turn that is already over.
      instruction: this.awaitingReview
        ? "This is what your batch ACTUALLY produced, computed by applying it to the real timeline. " +
          "Compare it against the user's request. If it is right, call emitEditBatch again with the " +
          "IDENTICAL batch to confirm. If it is not, call emitEditBatch with a corrected batch — a full " +
          "replacement, not a delta, since it is applied to the original timeline."
        : "Applied. This is the final state of the timeline — do not call emitEditBatch again.",
    };
  }

  private reject(e: unknown): DryRunRejected {
    this.lastOk = false;
    this.awaitingReview = false; // a rejection is answered by repairing, not by reviewing
    // `errorMessage` renders a ZodError as field-named lines. Its raw `.message` is the issues JSON,
    // which would put a wall of JSON in front of BOTH the model (as the repair instruction) and the
    // user (as the chat error) — the same reason the routes have always used this helper.
    const problems = [errorMessage(e)];
    this.lastProblems = problems;
    return {
      kind: "rejected",
      problems,
      instruction: this.budgetLeft
        ? "Your batch was REJECTED and nothing was applied. Fix exactly the problems named above and call emitEditBatch again with a corrected batch."
        : "Your batch was rejected and no attempts remain. Nothing was applied.",
    };
  }
}

/**
 * What the activity log shows for ONE emit/review round. The resulting timeline stays server-side —
 * the client receives the final EDL anyway, and echoing a full timeline per round would multiply the
 * stream for nothing. One owner, because /api/plan and /api/refine render the same activity log.
 */
export function reviewSummary(
  output: unknown,
): { kind: string; checks?: readonly string[]; problems?: readonly string[] } {
  const result = output as DryRunResult | undefined;
  if (result?.kind === "applied") return { kind: "applied", checks: result.checks };
  if (result?.kind === "rejected") return { kind: "rejected", problems: result.problems };
  return { kind: result?.kind ?? "unknown" };
}

/**
 * The most actionable thing we know about a turn that produced no applicable batch: the reducer's
 * own field-named problems if it ever got that far, otherwise whatever broke the stream.
 */
export function failureMessage(problems: readonly string[], streamFault: string | null): string {
  if (problems.length > 0) return problems.join("; ");
  return streamFault ?? "planner did not emit an edit batch";
}

// ── deterministic checks ────────────────────────────────────────────────────

/**
 * Findings the SERVER measured, never the model's own opinion of its work.
 *
 * Each line has to be worth its tokens, so this is deliberately short: the things that are (a)
 * computable exactly, (b) the actual observed failure modes, and (c) impossible for the model to
 * know without applying the batch. Anything we cannot measure is simply absent — a fabricated
 * finding would steer the revision worse than no finding at all.
 */
export function computeChecks(prompt: string, before: Edl, after: Edl, batch: EditBatch): string[] {
  const checks: string[] = [];

  // A seeded parent has no hash yet, so normalise through the reducer's own hasher rather than
  // skipping the check — "your batch changed nothing" is exactly what a seeded timeline needs told.
  const beforeHash = before.contentHash ?? withContentHash(before).contentHash;
  const afterHash = after.contentHash ?? withContentHash(after).contentHash;
  if (beforeHash === afterHash) {
    checks.push("This batch did not change the timeline at all — the result is identical to the parent.");
  }

  const clipsBefore = allClipPositions(before).length;
  const clipsAfter = allClipPositions(after).length;
  if (clipsBefore > 0 && clipsAfter === 0) {
    checks.push("The timeline now has NO clips left — this produces an empty video.");
  }

  const targetTicks = parseTargetTicks(prompt);
  if (targetTicks !== null) {
    const producedTicks = after.durationTicks;
    const pct = targetTicks > 0 ? Math.round(((producedTicks - targetTicks) / targetTicks) * 100) : 0;
    const verdict = pct > 10 ? `${pct}% OVER` : pct < -10 ? `${Math.abs(pct)}% under` : "on target";
    checks.push(
      `Length target read from the request: ~${fmtSeconds(targetTicks)} (${targetTicks}t). ` +
        `This batch produces ${fmtSeconds(producedTicks)} (${producedTicks}t) — ${verdict}. ` +
        "If that is not the target the user meant, ignore this line.",
    );
  }

  // The reducer PRUNES a transition whose pair stopped being adjacent, and CLAMPS one that outgrew
  // its neighbours — quietly, in `recompute`, after the command "succeeded". So the batch reports
  // success while the transition the user asked for is simply not there. Compare what was requested
  // against what survived; nothing else in the pipeline tells the model this happened.
  for (const cmd of batch.commands) {
    if (cmd.type !== "ADD_TRANSITION") continue;
    const [idA, idB] = cmd.betweenClipIds;
    const kept = after.transitions.find((t) => t.betweenClipIds[0] === idA && t.betweenClipIds[1] === idB);
    if (!kept) {
      const missing = !locateClip(after, idA) ? idA : !locateClip(after, idB) ? idB : null;
      checks.push(
        `ADD_TRANSITION between ${idA} and ${idB} was DROPPED from the result — ` +
          (missing
            ? `clip ${missing} no longer exists after the other commands in this batch.`
            : "those two clips are no longer adjacent after the other commands in this batch."),
      );
    } else if (kept.durationTicks !== cmd.durationTicks) {
      checks.push(
        `ADD_TRANSITION between ${idA} and ${idB} was shortened from ${cmd.durationTicks}t to ` +
          `${kept.durationTicks}t — a neighbouring clip is shorter than the transition you asked for.`,
      );
    }
  }

  if (batch.commands.some((c) => c.type === "ADD_EFFECT" || c.type === "COMPOSE_LOOK")) {
    const graded = allClipPositions(after).filter((p) => p.clip.effects.length > 0).length;
    if (graded < clipsAfter) {
      checks.push(
        `Effect coverage: ${graded} of ${clipsAfter} clips carry an effect. ` +
          "If the user asked for the whole video, the other clips were missed.",
      );
    }
  }

  return checks;
}

function fmtSeconds(ticks: number): string {
  const seconds = ticks / TICKS_PER_SECOND;
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}s`
    : `${Math.round(seconds * 10) / 10}s`;
}

// ── target-length parsing ───────────────────────────────────────────────────

const UNIT_TICKS: Record<string, number> = {
  h: 3600 * TICKS_PER_SECOND,
  hr: 3600 * TICKS_PER_SECOND,
  hrs: 3600 * TICKS_PER_SECOND,
  hour: 3600 * TICKS_PER_SECOND,
  hours: 3600 * TICKS_PER_SECOND,
  m: 60 * TICKS_PER_SECOND,
  min: 60 * TICKS_PER_SECOND,
  mins: 60 * TICKS_PER_SECOND,
  minute: 60 * TICKS_PER_SECOND,
  minutes: 60 * TICKS_PER_SECOND,
  s: TICKS_PER_SECOND,
  sec: TICKS_PER_SECOND,
  secs: TICKS_PER_SECOND,
  second: TICKS_PER_SECOND,
  seconds: TICKS_PER_SECOND,
};

// `[\s-]*` between the number and the unit, because "a 30-second version" is the phrasing people
// actually use and `\s*` silently misses every hyphenated one.
const DURATION = String.raw`(\d+(?:\.\d+)?)[\s-]*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)`;
/** "before/after/into…" turns a duration into a POSITION, not a length. Never read those as targets. */
const NOT_A_LENGTH = String.raw`(?!\s*(?:before|after|in|into|from|earlier|later|of|mark))`;
const PRODUCT_NOUN =
  "cut|cutdown|cut-down|version|edit|trailer|teaser|reel|short|clip|video|recap|montage|highlight|summary|promo|spot|ad|tiktok|story|intro";

/**
 * The one length target we are willing to assert, or `null`.
 *
 * A duration in a prompt is usually a POSITION ("cut the first 5 seconds", "zoom at 0:14"), not a
 * target length, and a check that reports "target 5s, produced 94s — 1780% over" would actively
 * steer the revision wrong. So a number only becomes a target when the phrasing says so: an upper
 * bound ("under a minute"), a reduction ("cut it down to 90 seconds"), a product ("a 60-second
 * cut"), or an explicit "or less". Everything else yields nothing, and the check is skipped.
 *
 * Exported for tests — both directions matter, and the false-positive direction matters more.
 */
export function parseTargetTicks(prompt: string): number | null {
  const patterns: RegExp[] = [
    // an upper bound
    new RegExp(
      String.raw`\b(?:under|below|within|at most|no more than|no longer than|not longer than|less than|shorter than|max(?:imum)?(?: of)?|cap(?:ped)?(?: it)?(?: at| to))\s+${DURATION}\b`,
      "i",
    ),
    // "…or less"
    new RegExp(String.raw`\b${DURATION}\s*or\s+(?:less|under|shorter|fewer)\b`, "i"),
    // a reduction to a length
    new RegExp(
      String.raw`\b(?:down to|cut(?: it| this| that)? to|trim(?: it| this| that)? to|make it|keep it (?:to|at|under)|into an?|to an?)\s+${DURATION}\b${NOT_A_LENGTH}`,
      "i",
    ),
    // "a 60-second cut", "90 second version"
    new RegExp(String.raw`\b${DURATION}[-\s]*(?:${PRODUCT_NOUN})\b`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(prompt);
    if (m) {
      const ticks = UNIT_TICKS[m[2].toLowerCase()];
      if (ticks) return Math.round(Number(m[1]) * ticks);
    }
  }

  // Clock form ("under 1:30", "cut it down to 2:00") — bounded/reduction cues only.
  const clock =
    /\b(?:under|below|within|at most|no more than|no longer than|less than|down to|cut(?: it| this| that)? to|trim(?: it| this| that)? to|make it|keep it (?:to|at|under))\s+(\d{1,3}):([0-5]\d)\b/i.exec(
      prompt,
    );
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * TICKS_PER_SECOND;

  // "under a minute" / "under half a minute"
  if (/\b(?:under|below|within|less than|at most|no more than|no longer than)\s+(?:a|one)\s+minute\b/i.test(prompt)) {
    return 60 * TICKS_PER_SECOND;
  }
  return null;
}
