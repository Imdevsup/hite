import { allClipPositions } from "@/lib/edl/query";
import type { Edl } from "@/lib/edl/schema";

/**
 * THE fps rule for compiling an EDL to the Render IR — one owner for preview and export.
 *
 * Why this file exists (`fps-fallback-divergence`): preview and export each carried their own
 * fallback chain. Preview walked `lead clip's asset → primaryAsset → 30`; export walked
 * `lead clip's asset → the first asset in an unordered `.in()` result that happened to have an fps
 * → 30`. They agree only while the lead clip's asset has a readable fps, and disagree exactly when
 * it does not — and a different fps means a different frame count for the same timeline, i.e. the
 * export runs at a different length than the thing the user watched.
 *
 * The rule below is derived ENTIRELY from the EDL's own clip order, so it does not depend on which
 * assets the caller happens to have loaded: preview (every asset in the project) and the worker
 * (only the assets the EDL references) compute the same number from the same EDL.
 *
 * Pure and client-safe — no node built-ins, no database — so both surfaces can import it.
 */

/**
 * Used when no clip's asset reports a frame rate: an EDL of nothing but stills and audio still has
 * to be rendered at some rate, and 30 is what every other default in this codebase assumes
 * (lib/remotion/Root.tsx's placeholder, the seed EDL's timing examples).
 */
export const DEFAULT_RENDER_FPS = 30;

export type AssetFpsLookup = Map<string, number | null | undefined> | Record<string, number | null | undefined>;

export function resolveRenderFps(edl: Edl, assetFps: AssetFpsLookup): number {
  const lookup = assetFps instanceof Map ? assetFps : new Map(Object.entries(assetFps));
  // Timeline order, first track first — the lead clip is the footage that drives the edit, and the
  // clips after it are the deterministic tiebreak when it has no rate of its own (a still or an
  // audio-only clip at the head of the cut).
  for (const position of allClipPositions(edl)) {
    const fps = lookup.get(position.clip.assetId);
    if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) return Math.round(fps);
  }
  return DEFAULT_RENDER_FPS;
}
