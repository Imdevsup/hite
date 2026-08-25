/**
 * lib/remotion/fx/window.ts — the ONE effect-window gate every fx renderer applies.
 *
 * The IR gives an effect an optional enable window; HiteRoot rebases it onto the clip and hands each
 * renderer CLIP-RELATIVE `frame` / `startFrame` / `endFrame` (see registry.tsx EffectRendererProps).
 * Until this existed only ZoomPunch honoured those bounds — so `chromatic-flash`, a momentary flash
 * BY NAME, painted the entire clip, and a correctly-windowed 50 ms flash was a whole-clip effect in
 * preview AND export alike.
 *
 * Single owner on purpose: six copies of `frame >= start && frame < end` is six chances to get the
 * half-open boundary (or the undefined case) wrong.
 */

/**
 * Is `frame` inside the half-open window `[startFrame, endFrame)`? An undefined bound is open on
 * that side, so an effect with no window at all is always on (the whole-clip case).
 */
export function withinWindow(frame: number, startFrame?: number, endFrame?: number): boolean {
  if (startFrame != null && frame < startFrame) return false;
  if (endFrame != null && frame >= endFrame) return false;
  return true;
}
