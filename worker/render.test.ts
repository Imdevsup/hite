import { describe, expect, test } from "vitest";
import { referencedAssetIds } from "./render";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { reduceBatch } from "@/lib/edl/reducer";
import { allClipPositions } from "@/lib/edl/query";
import type { EditCommand } from "@/lib/edl/commands";

/**
 * Which assets the export has to resolve a url for.
 *
 * This is the `audiobed-asset-url-empty-in-export` regression, and it is a preview ≠ export
 * divergence of the most visible kind. The export resolver was built from `allClipPositions` alone
 * — which walks TRACKS, and `edl.audioBeds` is not a track — so "add music" compiled the bed with
 * `source.url = ""` and the downloaded file was silent, while the preview (whose resolver was
 * built from every asset in the project) played it fine.
 */

function edlWithMusic(): Edl {
  const edl = emptyEdl2("clip-a", 120_000);
  return reduceBatch(edl, [
    { type: "ADD_AUDIO_BED", assetId: "music-track", window: { startTick: 0, endTick: 120_000 }, volume: 0.4 },
  ] as EditCommand[]).edl;
}

describe("referencedAssetIds", () => {
  test("includes AUDIO BED assets, not only clips", () => {
    const edl = edlWithMusic();
    // The bed really is invisible to the clip walk — that is the whole bug.
    expect(allClipPositions(edl).map((p) => p.clip.assetId)).not.toContain("music-track");
    expect(referencedAssetIds(edl)).toContain("music-track");
    expect(referencedAssetIds(edl)).toContain("clip-a");
  });

  test("covers every clip across every track", () => {
    let edl = emptyEdl2("a", 60_000);
    edl = reduceBatch(edl, [
      { type: "ADD_CLIP", assetId: "b", trackId: "track_0", atTick: 60_000, inTick: 0, outTick: 60_000 },
    ] as EditCommand[]).edl;
    expect(referencedAssetIds(edl).sort()).toEqual(["a", "b"]);
  });

  test("de-duplicates an asset used by several clips and by a bed", () => {
    let edl = emptyEdl2("a", 60_000);
    edl = reduceBatch(edl, [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 60_000, inTick: 0, outTick: 60_000 },
      { type: "ADD_AUDIO_BED", assetId: "a", window: { startTick: 0, endTick: 60_000 }, volume: 0.4 },
    ] as EditCommand[]).edl;
    // One signed url per asset, not one per reference — signing is a network round trip each.
    expect(referencedAssetIds(edl)).toEqual(["a"]);
  });

  test("an empty timeline needs no urls at all", () => {
    const edl = { ...emptyEdl2("a", 60_000), tracks: [], audioBeds: [] };
    expect(referencedAssetIds(edl)).toEqual([]);
  });
});
