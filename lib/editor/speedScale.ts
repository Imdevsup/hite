/**
 * lib/editor/speedScale.ts — pure log-scale mapping between a clip's playback speed and a 0..1
 * slider position, used by the Inspector's SPEED control.
 *
 * Why log, not linear: the reducer clamps SET_CLIP_SPEED to the NLE-safe envelope 0.1×–100×
 * (lib/edl/reducer.ts). A linear slider over that range buries the everyday 1× region at ~1% of
 * the track and — worse, when the old slider's max was 4× — could not even REPRESENT a velocity /
 * speed-ramp the AI sets above 4× (the thumb pinned to max, and the first drag silently reset the
 * ramp). A log map places 1× at the natural midpoint, makes the whole backend-supported range
 * reachable, and means any stored speed maps to a valid thumb position (so touching the slider
 * never clobbers an out-of-range AI value).
 *
 * Mapping: pos = (ln(speed) − ln(MIN)) / (ln(MAX) − ln(MIN)), clamped to [0,1]. Endpoints are the
 * reducer's exact clamp bounds, so slider-min ⇒ 0.1× and slider-max ⇒ 100× — no UI/engine drift.
 */

/** Must match the reducer's SET_CLIP_SPEED clamp (lib/edl/reducer.ts). */
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 100;

/** Quick presets spanning the range, incl. slow-mo + a velocity-edit speed. */
export const SPEED_PRESETS = [0.25, 0.5, 1, 2, 4] as const;

const LN_MIN = Math.log(SPEED_MIN);
const LN_SPAN = Math.log(SPEED_MAX) - LN_MIN;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Clip speed (any value; clamped to the envelope first) → slider position in [0,1]. */
export function speedToSlider(speed: number): number {
  const s = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed > 0 ? speed : SPEED_MIN));
  return clamp01((Math.log(s) - LN_MIN) / LN_SPAN);
}

/** Slider position in [0,1] → clip speed in [SPEED_MIN, SPEED_MAX], rounded to a clean 2dp step. */
export function sliderToSpeed(pos: number): number {
  const speed = Math.exp(LN_MIN + clamp01(pos) * LN_SPAN);
  return Math.round(speed * 100) / 100;
}
