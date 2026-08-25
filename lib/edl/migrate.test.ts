import { describe, expect, test } from "vitest";
import { upgradeEdlV1toV2 } from "./migrate";
import { isClip } from "./query";
import type { Clip, Gap, Track } from "./schema";

/**
 * Tests for the registered v1 → Edl.2 upgrade (run on every project load). v1 is float-ms;
 * Edl.2 is integer ticks @ 30000tps, so `ms → round(ms * 30)`.
 */

const TPS = 30_000;
const ticks = (ms: number) => Math.round((ms * TPS) / 1000); // mirror of msToTicks

/** A minimal-but-complete v1 EDL; pass partials to override individual sections. */
function v1(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    durationMs: 10_000,
    clips: [
      {
        id: "c0",
        assetId: "asset-a",
        trim: { startMs: 0, endMs: 5_000 },
        trackIndex: 0,
        timelineStartMs: 0,
        speed: 1,
        volume: 1,
        effects: [],
      },
    ],
    metadata: { generatedBy: "user" },
    ...over,
  };
}

function tracks(e: ReturnType<typeof upgradeEdlV1toV2>) {
  return e.tracks as Track[];
}
function items(t: Track) {
  return t.items as Array<Clip | Gap>;
}

describe("upgradeEdlV1toV2 — basics", () => {
  test("produces a valid Edl.2 with the right schema tag + timebase", () => {
    const e = upgradeEdlV1toV2(v1());
    expect(e.schema).toBe("Edl.2");
    expect(e.timebase.ticksPerSecond).toBe(TPS);
    expect(e.revision).toBe(0);
  });

  test("durationMs is converted to ticks", () => {
    const e = upgradeEdlV1toV2(v1({ durationMs: 10_000 }));
    expect(e.durationTicks).toBe(ticks(10_000)); // 300000
  });

  test("a single clip's trim becomes inTick/outTick in ticks", () => {
    const e = upgradeEdlV1toV2(v1());
    const c = items(tracks(e)[0])[0] as Clip;
    expect(c.schema).toBe("Clip.1");
    expect(c.inTick).toBe(0);
    expect(c.outTick).toBe(ticks(5_000)); // 150000
    expect(c.id).toBe("c0");
    expect(c.assetId).toBe("asset-a");
  });

  test("metadata is carried through", () => {
    const e = upgradeEdlV1toV2(v1({ metadata: { generatedBy: "ai", model: "x" } }));
    expect(e.metadata.generatedBy).toBe("ai");
    expect(e.metadata.model).toBe("x");
  });
});

describe("upgradeEdlV1toV2 — track grouping + gaps", () => {
  test("clips are grouped by trackIndex into sorted Track[]", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          { id: "b", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 2, timelineStartMs: 0, speed: 1, volume: 1, effects: [] },
          { id: "a", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1, effects: [] },
        ],
      }),
    );
    // Two tracks, ascending by source trackIndex (0 before 2).
    expect(tracks(e)).toHaveLength(2);
    expect(tracks(e)[0].id).toBe("track_0");
    expect(tracks(e)[1].id).toBe("track_2");
  });

  test("a hole left by timelineStartMs becomes an explicit Gap", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          { id: "c0", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1, effects: [] },
          // starts at 3000ms but the first clip ends at 1000ms → 2000ms hole
          { id: "c1", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 0, timelineStartMs: 3_000, speed: 1, volume: 1, effects: [] },
        ],
      }),
    );
    const it = items(tracks(e)[0]);
    expect(it.map((i) => i.schema)).toEqual(["Clip.1", "Gap.1", "Clip.1"]);
    const gap = it[1] as Gap;
    expect(gap.durationTicks).toBe(ticks(2_000)); // 60000
  });

  test("contiguous clips produce NO gap", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          { id: "c0", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1, effects: [] },
          { id: "c1", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 0, timelineStartMs: 1_000, speed: 1, volume: 1, effects: [] },
        ],
      }),
    );
    const it = items(tracks(e)[0]);
    expect(it.map((i) => i.schema)).toEqual(["Clip.1", "Clip.1"]);
  });

  test("clips out of timeline order are sorted by timelineStartMs", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          { id: "late", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 0, timelineStartMs: 5_000, speed: 1, volume: 1, effects: [] },
          { id: "early", assetId: "a", trim: { startMs: 0, endMs: 1_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1, effects: [] },
        ],
      }),
    );
    const clipIds = items(tracks(e)[0]).filter(isClip).map((c) => c.id);
    expect(clipIds).toEqual(["early", "late"]);
  });
});

describe("upgradeEdlV1toV2 — positive-span guarantees", () => {
  test("a zero-length trim is widened so outTick > inTick", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          { id: "c0", assetId: "a", trim: { startMs: 2_000, endMs: 2_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1, effects: [] },
        ],
      }),
    );
    const c = items(tracks(e)[0])[0] as Clip;
    expect(c.outTick).toBeGreaterThan(c.inTick);
    expect(c.outTick).toBe(c.inTick + 1);
  });

  test("effect window with equal start/end is widened to a positive span", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          {
            id: "c0", assetId: "a", trim: { startMs: 0, endMs: 5_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1,
            effects: [{ id: "fx1", effectKey: "rgb-split", params: { amount: 2 }, startMs: 1_000, endMs: 1_000 }],
          },
        ],
      }),
    );
    const c = items(tracks(e)[0])[0] as Clip;
    expect(c.effects).toHaveLength(1);
    expect(c.effects[0].window!.endTick).toBeGreaterThan(c.effects[0].window!.startTick);
  });

  test("effect without start/end maps to a whole-clip effect (no window)", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          {
            id: "c0", assetId: "a", trim: { startMs: 0, endMs: 5_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1,
            effects: [{ id: "fx1", effectKey: "grain", params: {} }],
          },
        ],
      }),
    );
    const c = items(tracks(e)[0])[0] as Clip;
    expect(c.effects[0].window).toBeUndefined();
    expect(c.effects[0].effectKey).toBe("grain");
    expect(c.effects[0].enabled).toBe(true);
  });
});

describe("upgradeEdlV1toV2 — top-level collections", () => {
  test("chapters become markers (kind=chapter, color BLUE)", () => {
    const e = upgradeEdlV1toV2(v1({ chapters: [{ id: "ch1", startMs: 2_000, title: "Drop" }] }));
    expect(e.markers).toHaveLength(1);
    expect(e.markers[0]).toMatchObject({ id: "ch1", atTick: ticks(2_000), title: "Drop", kind: "chapter", color: "BLUE" });
  });

  test("transitions map with a positive duration floor", () => {
    const e = upgradeEdlV1toV2(
      v1({ transitions: [{ id: "t1", betweenClipIds: ["c0", "c1"], transitionKey: "fade", durationMs: 500, params: {} }] }),
    );
    expect(e.transitions[0]).toMatchObject({ id: "t1", transitionKey: "fade", durationTicks: ticks(500) });
    expect(e.transitions[0].betweenClipIds).toEqual(["c0", "c1"]);
  });

  test("overlays/captions/audioBeds windows convert and stay positive", () => {
    const e = upgradeEdlV1toV2(
      v1({
        overlays: [{ id: "o1", overlayKey: "skull", startMs: 1_000, endMs: 2_000, placement: { mode: "center" }, params: {} }],
        captions: [{ id: "cap1", startMs: 0, endMs: 1_000, text: "go", style: "default" }],
        audioBeds: [{ id: "ab1", assetId: "song", startMs: 0, endMs: 8_000, volume: 0.4, loop: true }],
      }),
    );
    expect(e.overlays[0].window).toEqual({ startTick: ticks(1_000), endTick: ticks(2_000) });
    expect(e.overlays[0].placement).toEqual({ mode: "center" });
    expect(e.captions[0].window).toEqual({ startTick: 0, endTick: ticks(1_000) });
    expect(e.audioBeds[0]).toMatchObject({ assetId: "song", loop: true });
    expect(e.audioBeds[0].window).toEqual({ startTick: 0, endTick: ticks(8_000) });
  });

  test("looks + outputs map (maxMs→maxTicks when present)", () => {
    const e = upgradeEdlV1toV2(
      v1({
        looksApplied: [{ id: "l1", lookKey: "phonk-noir", targetClipIds: ["c0"], params: {} }],
        outputs: [{ aspect: "9:16", maxMs: 60_000 }, { aspect: "1:1" }],
      }),
    );
    expect(e.looksApplied[0]).toMatchObject({ id: "l1", lookKey: "phonk-noir", targetClipIds: ["c0"] });
    expect(e.outputs[0]).toEqual({ aspect: "9:16", maxTicks: ticks(60_000) });
    expect(e.outputs[1]).toEqual({ aspect: "1:1", maxTicks: undefined });
  });
});

describe("upgradeEdlV1toV2 — speed + volume passthrough", () => {
  test("clip speed and volume are preserved", () => {
    const e = upgradeEdlV1toV2(
      v1({
        clips: [
          { id: "c0", assetId: "a", trim: { startMs: 0, endMs: 4_000 }, trackIndex: 0, timelineStartMs: 0, speed: 2, volume: 0.5, effects: [] },
        ],
      }),
    );
    const c = items(tracks(e)[0])[0] as Clip;
    expect(c.speed).toBe(2);
    expect(c.volume).toBe(0.5);
  });
});
