import { describe, expect, test } from "vitest";
import { DEFAULT_RENDER_FPS, resolveRenderFps } from "./fps";
import { emptyEdl2 } from "@/lib/edl/schema";
import { reduceBatch } from "@/lib/edl/reducer";
import type { EditCommand } from "@/lib/edl/commands";

/**
 * The fps rule is shared by preview and export, so what it must guarantee is AGREEMENT: the same
 * EDL yields the same frame rate on both surfaces, whatever else each of them happens to know
 * about the project. A disagreement means the same timeline compiles to a different frame count in
 * the download than in the thing the user watched.
 */

/** Two clips: `lead` first, then `second`. */
function twoClipEdl(lead: string, second: string) {
  const edl = emptyEdl2(lead, 60_000);
  return reduceBatch(edl, [
    { type: "ADD_CLIP", assetId: second, trackId: "track_0", atTick: 60_000, inTick: 0, outTick: 60_000 },
  ] as EditCommand[]).edl;
}

describe("resolveRenderFps", () => {
  test("anchors to the FIRST clip's asset — the footage that drives the edit", () => {
    expect(resolveRenderFps(twoClipEdl("lead", "second"), { lead: 24, second: 60 })).toBe(24);
  });

  test("falls through the clips in timeline order when the lead asset has no rate", () => {
    // A still or an audio-only clip at the head of the cut. The next clip decides — deterministic
    // from the EDL alone, unlike "whichever asset the query happened to return first".
    expect(resolveRenderFps(twoClipEdl("still", "footage"), { still: null, footage: 25 })).toBe(25);
  });

  test("preview and export agree even though they know about different assets", () => {
    // THE regression. Preview builds its lookup from every asset in the project; the worker builds
    // it from only the assets the EDL references. The old rules disagreed here: preview fell back
    // to `primaryAsset.fps` and export to "the first asset in an unordered result with any fps".
    const edl = twoClipEdl("still", "footage");
    const previewKnowsEverything = { still: null, footage: 25, unrelatedUpload: 60, oldClip: 24 };
    const workerKnowsOnlyTheEdl = { still: null, footage: 25 };
    expect(resolveRenderFps(edl, previewKnowsEverything)).toBe(resolveRenderFps(edl, workerKnowsOnlyTheEdl));
  });

  test("rounds to a whole frame rate", () => {
    expect(resolveRenderFps(twoClipEdl("a", "b"), { a: 29.97 })).toBe(30);
    expect(resolveRenderFps(twoClipEdl("a", "b"), { a: 23.976 })).toBe(24);
  });

  test("an EDL of nothing but stills and audio still renders, at the default", () => {
    expect(resolveRenderFps(twoClipEdl("a", "b"), { a: null, b: undefined })).toBe(DEFAULT_RENDER_FPS);
    expect(resolveRenderFps(twoClipEdl("a", "b"), {})).toBe(DEFAULT_RENDER_FPS);
  });

  test("a nonsense rate is ignored rather than compiling a broken timeline", () => {
    // `asset_probe_sane` keeps these out of the database, but a zero or a NaN reaching the frame
    // grid would divide the whole timeline by zero rather than falling back visibly.
    expect(resolveRenderFps(twoClipEdl("a", "b"), { a: 0, b: 30 })).toBe(30);
    expect(resolveRenderFps(twoClipEdl("a", "b"), { a: Number.NaN, b: 30 })).toBe(30);
    expect(resolveRenderFps(twoClipEdl("a", "b"), { a: -30, b: 30 })).toBe(30);
  });

  test("accepts a Map as readily as a record", () => {
    const edl = twoClipEdl("a", "b");
    expect(resolveRenderFps(edl, new Map([["a", 50]]))).toBe(50);
  });
});
