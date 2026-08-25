/**
 * lib/edl/time.ts — the single definition of HITE's time unit.
 *
 * Canonical decision (docs/DECISIONS.md §1, docs/CANONICAL-IR-SPEC.md §1–2): time is an
 * integer count of *ticks* in a fixed project-global timebase, `ticksPerSecond = 30000`.
 * 30000 is frame-exact for 24/25/30/50/60 fps AND millisecond-exact, so ticks→frames is
 * exact integer division at every supported fps, and the v1(float-ms)→Edl.2(ticks)
 * migration is lossless. No float ever enters the EDL, the Render IR, or a hash.
 *
 * `ticksToFrame` is the ONLY ticks→frame conversion in the codebase. It replaces the
 * ad-hoc roundings that caused "export is one frame off from preview" — including the
 * legacy `lib/ffmpeg/graph.ts` (ms→sec) compositor, now deleted (export renders via the
 * Remotion IR path). The remaining `HiteTimeline.tsx` ms→frame rounding is retired as
 * that layer finishes moving onto the IR (P3–P6).
 */

export const TICKS_PER_SECOND = 30_000 as const;

/**
 * Integer ticks. Never a float, never milliseconds, never a frame index.
 * Kept a plain `number` (not a branded type) so it is assignable to/from the Zod
 * schema's `z.number().int()` without nominal-typing friction across the codebase.
 */
export type Tick = number;

export interface Timebase {
  ticksPerSecond: number;
}

/** Half-open window `[startTick, endTick)`. */
export interface TickWindow {
  startTick: Tick;
  endTick: Tick;
}

/**
 * Integer-coerce a number to a Tick. Uses `Math.round` (not truncation / `| 0`) so it is
 * correct for values beyond 2^31 — a 10-hour timeline is ~1.08e9 ticks, which `| 0` would
 * corrupt via int32 wraparound.
 */
export const tick = (n: number): Tick => Math.round(n);

/**
 * THE ONLY ticks→frame conversion in the codebase.
 * Exact integer division for fps ∈ {24,25,30,50,60} at tps=30000. Round-half-even guards
 * the degenerate non-divisor-fps case so frame boundaries are deterministic across
 * platforms — a hard requirement for the render segment cache.
 */
export function ticksToFrame(t: Tick, fps: number, tps: number = TICKS_PER_SECOND): number {
  const exact = (t * fps) / tps;
  const r = Math.round(exact);
  // round-half-even: nudge an odd .5 result down to the even neighbour
  return Math.abs(exact - Math.trunc(exact) - 0.5) < 1e-9 && r % 2 !== 0 ? r - 1 : r;
}

/** Frame index → ticks. Exact on frame boundaries; used by the v1→v2 migration and tests. */
export function framesToTicks(frame: number, fps: number, tps: number = TICKS_PER_SECOND): Tick {
  return Math.round((frame * tps) / fps);
}

/** Milliseconds → ticks. Used by the v1(ms)→Edl.2 migration and at UI input edges. */
export function msToTicks(ms: number, tps: number = TICKS_PER_SECOND): Tick {
  return Math.round((ms * tps) / 1000);
}

/** Ticks → milliseconds. For display / interop only — never persist the result. */
export function tickToMs(t: Tick, tps: number = TICKS_PER_SECOND): number {
  return Math.round((t * 1000) / tps);
}

/** Seconds → ticks. */
export function secToTicks(sec: number, tps: number = TICKS_PER_SECOND): Tick {
  return Math.round(sec * tps);
}
