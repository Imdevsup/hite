/**
 * lib/landing/format.ts — how the landing page turns ticks into the strings a visitor reads.
 *
 * Every duration the page prints ("0:48", "0:39", a frame count) is DERIVED from a generated
 * artifact, never typed into JSX (DESIGN-DIRECTION §7.3). That rule only holds if there is exactly
 * one formatter, so the build script and any runtime consumer produce identical strings — a second
 * ad-hoc `Math.floor(t / 30000)` somewhere in a component is how "0:48" and "0:47" end up on the
 * same page.
 *
 * Ticks are the canonical unit (lib/edl/time.ts, 30000/sec). Frames come from `ticksToFrame`, the
 * codebase's ONE ticks→frame conversion — never re-derived here.
 */
import { TICKS_PER_SECOND, ticksToFrame, type Tick } from "@/lib/edl/time";

/**
 * The frame rate the landing page is measured in.
 *
 * DESIGN-DIRECTION §2.1 fixes the page grid at 30fps ("1 frame at 30fps = 1000 ticks; 1 frame = 4
 * CSS px"), and 30 is also the composition default the renderer ships (`lib/remotion/Root.tsx`).
 * It is a PRESENTATION constant for the page's ruler — the EDL itself is fps-agnostic.
 */
export const LANDING_FPS = 30 as const;

/** Ticks → whole frames at the page's ruler rate, via the codebase's one conversion. */
export function ticksToLandingFrames(ticks: Tick): number {
  return ticksToFrame(ticks, LANDING_FPS);
}

/**
 * Ticks → `M:SS`, the duration readout the Mechanism section rolls (§2.2 "0:48 → 0:39").
 *
 * Seconds are FLOORED, matching how every player reports a running length: a 40.4s timeline reads
 * "0:40", not "0:41". Rounding instead would make a variant that removed less footage appear to
 * have removed more. Hours are not special-cased — nothing on this page is an hour long, and a
 * >59:59 value renders as an honest large minute count rather than silently wrapping.
 */
export function ticksToTimecode(ticks: Tick): string {
  const totalSeconds = Math.floor(ticks / TICKS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Ticks → seconds as a number, for layout math (a lane's width in the page's frame unit). */
export function ticksToSeconds(ticks: Tick): number {
  return ticks / TICKS_PER_SECOND;
}
