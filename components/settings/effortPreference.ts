import type { Effort } from "./types";

/**
 * WHICH RUNG THIS BROWSER ASKS FOR.
 *
 * `app/api/settings/route.ts` says why there is nothing to read here from the server: "There is no
 * stored 'current effort level' to report, because effort is per-request and chosen by the client".
 * So the choice lives in the browser and rides on the request body, where `z.enum(EFFORT_LEVELS)`
 * in `app/api/plan/route.ts` validates it and `effortProfileFor` clamps it. The client clamp below
 * exists so the CONTROL never offers a rung the server would silently take away — not as a
 * security boundary, which is server-side and stays there.
 *
 * `localStorage`, not `sessionStorage`: a rung is a preference, not a credential. The reasoning
 * that puts the KEY in session storage — a shared machine must not serve the next person's
 * credential — does not apply to "how hard should the planner try", and losing it every tab is
 * friction with nothing bought.
 */

const STORAGE_KEY = "hite.effort";

type Listener = () => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The raw stored string. Unvalidated on purpose — `resolveEffortSelection` is the only judge. */
export function readEffortPreference(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeEffortPreference(level: Effort): void {
  try {
    storage()?.setItem(STORAGE_KEY, level);
  } catch {
    /* Storage is off in this browser. The rung still applies for this page — it simply will not
       survive a reload, which is a smaller failure than refusing to change it at all. */
  }
  for (const listener of listeners) listener();
}

export function subscribeEffortPreference(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

/**
 * Rank is the rung's INDEX in `effort.levels`.
 *
 * `EFFORT_LEVELS` is declared in ascending order and `RANK` in `lib/ai/effort.ts` is built to match
 * it, so the array the route hands us already carries the ordering — deriving rank from position
 * means this file has no second copy of the ladder's shape to drift from.
 * `effortPreference.test.ts` proves the agreement by running this clamp against the real
 * `clampEffort` for every requested/ceiling pair.
 */
export function rankOf(level: string, levels: readonly Effort[]): number {
  return (levels as readonly string[]).indexOf(level);
}

export function isReachable(level: Effort, ceiling: Effort, levels: readonly Effort[]): boolean {
  return rankOf(level, levels) <= rankOf(ceiling, levels);
}

/** `min(requested, ceiling)` by rank — the client mirror of `clampEffort`. */
export function clampToCeiling(requested: Effort, ceiling: Effort, levels: readonly Effort[]): Effort {
  return isReachable(requested, ceiling, levels) ? requested : ceiling;
}
