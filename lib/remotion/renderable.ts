/**
 * lib/remotion/renderable.ts — what the render layer can ACTUALLY paint, in one place.
 *
 * The registry manifest advertises more keys than HiteRoot can draw: 3 audio-engine effects
 * (compressor-vocal, eq-bright, reverb-plate) and 2 procedural ones (proc-lens-flare-*) have no
 * renderer, and `look-vhs-dream`'s recipe even references `audio-saturation-soft`, a key with no
 * manifest entry at all. `ClipFx` skips an effect with no renderer (`if (!R) continue`), the reducer
 * accepts any key, and the advisors surface every key to the model — so the AI could emit one,
 * report success, and leave the video pixel-identical. Same story for transitions that name a
 * pixel-blend v1 does not do.
 *
 * This module is what every layer above (AI tools, registry advisors, the effects palette) should
 * filter with, so "the model can suggest it" and "the renderer can draw it" cannot drift apart.
 * Both answers are DERIVED — the effect keys from the live renderer map, the transition stems from
 * the treatment classifier — never hand-copied.
 */
import { listEffectRendererKeys, getEffectRenderer } from "./registry";
import { isRenderableTransitionKey, RENDERABLE_TRANSITION_STEMS, transitionStem } from "./fx/transition";

/**
 * Every effectKey with a registered renderer. Snapshotted at import: `registry.tsx` registers all of
 * them at module scope, and ES module evaluation guarantees that has finished before this line runs.
 * Use `isRenderableEffectKey` if a renderer might be registered later.
 */
export const RENDERABLE_EFFECT_KEYS: ReadonlySet<string> = new Set(listEffectRendererKeys());

/** Will HiteRoot paint this effectKey? (Live lookup — the authoritative answer.) */
export function isRenderableEffectKey(key: string): boolean {
  return getEffectRenderer(key) !== undefined;
}

/** Split a key list into what the renderer supports and what it would silently ignore. */
export function partitionRenderableEffectKeys(keys: readonly string[]): { renderable: string[]; unrenderable: string[] } {
  const renderable: string[] = [];
  const unrenderable: string[] = [];
  for (const key of keys) (isRenderableEffectKey(key) ? renderable : unrenderable).push(key);
  return { renderable, unrenderable };
}

export { isRenderableTransitionKey, RENDERABLE_TRANSITION_STEMS, transitionStem };
