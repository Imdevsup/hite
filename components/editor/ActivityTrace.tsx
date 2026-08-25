"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * ACTIVITY TRACE — the planner's real tool loop, shown while it runs.
 *
 * A planning turn takes 10–60 seconds. For all of it the chat showed three bouncing dots, so the
 * single most common thought a first-time user has ("is this thing doing anything?") had no answer.
 * Meanwhile `/api/plan` and `/api/refine` were already streaming `tool-call` and `tool-result` SSE
 * events — the route's own comment calls them "analysis/registry activity (for the UI activity log)"
 * — and `ChatWindow` parsed them and threw them away. Nothing new is computed here; a stream the
 * server was already sending is finally rendered.
 *
 * HONESTY. Every line is the name of a tool the model actually called, and every count comes from
 * counting the tool's own returned array. Nothing is embellished, nothing is predicted, and no step
 * appears before the model asks for it. A turn that calls no analysis tools shows no steps — the
 * elapsed clock alone — because that is what happened.
 *
 * MOTION. DESIGN-DIRECTION §5.6 (SIGNAL): the running step uses the ADDITIVE `.shimmer` (base text
 * is `--t-2`, 9.72:1, legible with zero animation; the highlight is a separate plus-lighter layer
 * that disappears under reduced motion and forced colors), and the live pip uses `.signal-flicker`.
 * Both classes are token-defined in `app/globals.css`.
 */

export interface ActivityStep {
  /** Stable key for React. Assigned on the `tool-call` that opened the step. */
  readonly id: string;
  /** The tool's real name, exactly as the planner called it. */
  readonly name: string;
  readonly state: "running" | "done";
  /** A count read off the tool's own result, or null when the result carries no countable list. */
  readonly note: string | null;
}

/** The two SSE shapes this trace consumes. Anything else the stream sends is not activity. */
export type ActivityEvent =
  | { readonly type: "tool-call"; readonly name: string }
  | { readonly type: "tool-result"; readonly name: string; readonly result: unknown };

/**
 * Fold one stream event into the step list.
 *
 * Pure, and exported, because the ordering rule is the part that can silently rot: a planner may
 * call the SAME tool twice in one turn (two assets, two queries), so a result closes the OLDEST
 * still-running step with that name. Matching on name alone would tick the wrong row; matching on
 * the newest would leave the first one spinning forever.
 */
export function applyActivityEvent(steps: readonly ActivityStep[], event: ActivityEvent): ActivityStep[] {
  if (event.type === "tool-call") {
    return [...steps, { id: `${event.name}:${steps.length}`, name: event.name, state: "running", note: null }];
  }
  const index = steps.findIndex((s) => s.name === event.name && s.state === "running");
  if (index === -1) {
    // A result with no matching call — possible if the stream drops a part. Record it as finished
    // rather than discarding it; the user saw the work happen either way.
    return [...steps, { id: `${event.name}:${steps.length}`, name: event.name, state: "done", note: summarizeToolResult(event.result) }];
  }
  const next = [...steps];
  next[index] = { ...next[index], state: "done", note: summarizeToolResult(event.result) };
  return next;
}

/**
 * `findSilences` → "Find silences". The tool's real name, made readable — never re-worded, so a
 * renamed tool shows its new name and nobody has to remember to update a label map.
 */
export function humanizeToolName(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return name;
  return spaced[0].toUpperCase() + spaced.slice(1);
}

/**
 * What the tool actually returned, as a count — or nothing.
 *
 * Only ever reports the length of a list the tool really returned (`{ silences: [...] }` → "14
 * silences"). No inference, no restating of prose fields, and no summary at all when there is no
 * list to count: a made-up "done ✓ looks good" is exactly the kind of confident filler this product
 * is trying not to ship.
 */
export function summarizeToolResult(result: unknown): string | null {
  if (Array.isArray(result)) return `${result.length} ${result.length === 1 ? "result" : "results"}`;
  if (result === null || typeof result !== "object") return null;
  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (Array.isArray(value)) return `${value.length} ${humanizeToolName(key).toLowerCase()}`;
  }
  return null;
}

/** `7` → "0:07". Whole seconds only — a millisecond readout would imply a precision nobody needs. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

interface Props {
  readonly steps: readonly ActivityStep[];
  /** `Date.now()` when the turn started. Drives the elapsed clock. */
  readonly startedAt: number;
  /**
   * `Date.now()` when the turn ended, or null while it is still streaming.
   *
   * A recorded instant rather than a "still running?" boolean, so the final duration is the turn's
   * MEASURED length. Deriving it from the last clock tick instead would print a number up to a
   * second short of the truth — small, but this is a component whose entire job is to report what
   * really happened.
   */
  readonly finishedAt: number | null;
}

export function ActivityTrace({ steps, startedAt, finishedAt }: Props) {
  const active = finishedAt === null;
  const elapsed = useElapsedSeconds(startedAt, finishedAt);

  /**
   * What assistive tech is told, and it is NOT the clock.
   *
   * The whole card used to be the live region, with the elapsed seconds inside it — so a screen
   * reader read "WORKING FOR 0:07", "WORKING FOR 0:08", "WORKING FOR 0:09" once a second for the
   * entire 10–60 second turn, burying the only thing worth hearing. The clock is `aria-hidden`
   * below; this string changes only when a STEP changes, plus once when the turn settles.
   */
  const currentStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const announcement = active
    ? currentStep
      ? `${humanizeToolName(currentStep.name)}${currentStep.state === "done" && currentStep.note ? `, ${currentStep.note}` : ""}`
      : "HITE is working."
    : `HITE finished in ${formatElapsed(elapsed)}.`;

  return (
    <div
      className="w-full max-w-[88%] rounded-[var(--radius-md)] border border-[var(--color-line-2)] bg-[var(--s-1)] px-2.5 py-2"
      role="group"
      aria-label={active ? "HITE is working" : "What HITE did"}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {/* The ticking clock — visual only, for the reason above. */}
      <div aria-hidden className="flex items-center gap-2">
        {active && (
          <span
            aria-hidden
            className="signal-flicker w-[5px] h-[5px] rounded-full bg-[var(--color-accent)] shrink-0"
          />
        )}
        <span className="label-mono-sm text-[var(--t-3)] tnum">
          {active ? `WORKING FOR ${formatElapsed(elapsed)}` : `TOOK ${formatElapsed(elapsed)}`}
        </span>
      </div>

      {steps.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2 text-[12px] leading-snug">
              <span aria-hidden className="mt-[3px] shrink-0 w-3 flex items-center justify-center">
                {step.state === "done" ? (
                  <Check size={11} strokeWidth={2.6} className="text-[var(--color-accent)]" />
                ) : (
                  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-accent)]" />
                )}
              </span>
              {step.state === "running" ? (
                // `.shimmer` reads its highlight text from data-label, so the visible glyphs come
                // from the base layer and stay legible with the animation off.
                <span className="shimmer" data-label={humanizeToolName(step.name)}>
                  {humanizeToolName(step.name)}
                </span>
              ) : (
                <span className="text-[var(--t-3)]">
                  {humanizeToolName(step.name)}
                  {step.note && <span className="text-[var(--t-4)]"> · {step.note}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Seconds between `startedAt` and either now (live) or `finishedAt` (settled).
 *
 * The clock is read in the interval CALLBACK, never in the render body and never in the effect
 * body: rendering must stay pure, and a synchronous setState inside an effect cascades. Once the
 * turn has a recorded end, the interval stops and the duration is arithmetic on two real instants.
 */
function useElapsedSeconds(startedAt: number, finishedAt: number | null): number {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    if (finishedAt !== null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [finishedAt]);
  return ((finishedAt ?? now) - startedAt) / 1000;
}
