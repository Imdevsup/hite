import { describe, expect, test } from "vitest";
import {
  isClip,
  clipTimelineDur,
  itemDur,
  trackDuration,
  allClipPositions,
  locateClip,
  clipAtTick,
  lanes,
  type VideoLane,
  type SpanLane,
} from "./query";
import { reduceBatch } from "./reducer";
import { emptyEdl2, Edl, Clip, Gap } from "./schema";
import { TICKS_PER_SECOND } from "./time";
import type { EditCommand } from "./commands";

const seed = () => emptyEdl2("a", 300_000); // one clip c0, span 0..300000 (10s @ 30000tps)

/** A bare Clip fixture (defaults applied via schema.parse) with the given source window + speed. */
function clip(id: string, inTick: number, outTick: number, speed = 1): Clip {
  return Clip.parse({
    schema: "Clip.1",
    id,
    assetId: "a",
    mediaRefs: { full: { schema: "MediaRef.1", url: "", availableInTick: 0, availableOutTick: 1_000_000 } },
    inTick,
    outTick,
    speed,
  });
}

function gap(id: string, durationTicks: number): Gap {
  return Gap.parse({ schema: "Gap.1", id, durationTicks });
}

/** Build a two-video-track EDL directly (schema-validated) so each track's independent cursor is testable. */
function twoTrackEdl(): Edl {
  return Edl.parse({
    schema: "Edl.2",
    timebase: { ticksPerSecond: TICKS_PER_SECOND },
    durationTicks: 300_000,
    tracks: [
      { schema: "Track.1", id: "track_0", kind: "video", role: "main", items: [clip("a0", 0, 100_000), clip("a1", 0, 50_000)] },
      { schema: "Track.1", id: "track_1", kind: "video", role: "overlay", items: [gap("g0", 30_000), clip("b0", 0, 40_000)] },
    ],
  });
}

describe("clipTimelineDur — speed-adjusted timeline span", () => {
  test("speed 1 → timeline duration equals source span", () => {
    expect(clipTimelineDur(clip("c", 0, 90_000, 1))).toBe(90_000);
  });

  test("2x speed halves the timeline duration", () => {
    expect(clipTimelineDur(clip("c", 0, 90_000, 2))).toBe(45_000);
  });

  test("0.5x speed doubles the timeline duration", () => {
    expect(clipTimelineDur(clip("c", 0, 90_000, 0.5))).toBe(180_000);
  });

  test("rounds to whole ticks", () => {
    // 100000 / 3 = 33333.33 → rounded
    expect(clipTimelineDur(clip("c", 0, 100_000, 3))).toBe(33_333);
  });

  test("floors at 1 tick — a clip never collapses to zero width even at extreme speed", () => {
    expect(clipTimelineDur(clip("c", 0, 1, 1000))).toBe(1);
  });
});

describe("itemDur / trackDuration", () => {
  test("itemDur returns the clip's timeline duration for a clip", () => {
    expect(itemDur(clip("c", 0, 60_000, 2))).toBe(30_000);
  });

  test("itemDur returns the raw durationTicks for a gap (speed-independent)", () => {
    expect(itemDur(gap("g", 25_000))).toBe(25_000);
  });

  test("trackDuration is the sum of clip + gap durations in order", () => {
    const t = twoTrackEdl().tracks[1]; // gap 30000 + clip 40000
    expect(trackDuration(t)).toBe(70_000);
  });

  test("isClip discriminates Clip from Gap", () => {
    expect(isClip(clip("c", 0, 10))).toBe(true);
    expect(isClip(gap("g", 10))).toBe(false);
  });
});

describe("allClipPositions — derived absolute spans", () => {
  test("single seed clip starts at 0 and ends at its duration", () => {
    const pos = allClipPositions(seed());
    expect(pos).toHaveLength(1);
    expect(pos[0].startTick).toBe(0);
    expect(pos[0].endTick).toBe(300_000);
    expect(pos[0].trackIndex).toBe(0);
    expect(pos[0].itemIndex).toBe(0);
  });

  test("consecutive clips are laid end-to-end (position = running sum)", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 120_000 },
    ] as EditCommand[]);
    const pos = allClipPositions(edl);
    expect(pos).toHaveLength(2);
    expect(pos[0].startTick).toBe(0);
    expect(pos[0].endTick).toBe(300_000);
    expect(pos[1].startTick).toBe(300_000); // begins exactly where the first ends
    expect(pos[1].endTick).toBe(420_000);
  });

  test("a gap advances the cursor but is NOT emitted as a position", () => {
    // ADD_CLIP past the end inserts an explicit Gap between the two clips.
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 400_000, inTick: 0, outTick: 100_000 },
    ] as EditCommand[]);
    const pos = allClipPositions(edl);
    expect(pos).toHaveLength(2); // two clips, the gap is skipped
    expect(pos[0].endTick).toBe(300_000);
    expect(pos[1].startTick).toBe(400_000); // pushed forward by the 100000-tick gap
    expect(pos[1].itemIndex).toBe(2); // clip, gap, clip → the second clip is index 2
  });

  test("a sped-up clip shifts everything after it earlier", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 100_000 },
      { type: "SET_CLIP_SPEED", clipId: "c0", speed: 2 }, // first clip 300000 → 150000 on the timeline
    ] as EditCommand[]);
    const pos = allClipPositions(edl);
    expect(pos[0].endTick).toBe(150_000);
    expect(pos[1].startTick).toBe(150_000);
  });

  test("each track has an independent cursor starting at 0", () => {
    const pos = allClipPositions(twoTrackEdl());
    const t0 = pos.filter((p) => p.trackIndex === 0);
    const t1 = pos.filter((p) => p.trackIndex === 1);
    // track 0: a0 [0,100000), a1 [100000,150000)
    expect(t0.map((p) => [p.startTick, p.endTick])).toEqual([[0, 100_000], [100_000, 150_000]]);
    // track 1: gap 30000, then b0 [30000,70000) — starts at 0 again, independent of track 0
    expect(t1.map((p) => [p.startTick, p.endTick])).toEqual([[30_000, 70_000]]);
    expect(t1[0].clip.id).toBe("b0");
  });
});

describe("locateClip", () => {
  test("finds a clip by id and returns its derived position", () => {
    const found = locateClip(twoTrackEdl(), "a1");
    expect(found?.startTick).toBe(100_000);
    expect(found?.endTick).toBe(150_000);
    expect(found?.trackIndex).toBe(0);
  });

  test("returns null for an unknown id", () => {
    expect(locateClip(seed(), "does-not-exist")).toBeNull();
  });
});

describe("clipAtTick — half-open [startTick, endTick)", () => {
  const edl = (() => reduceBatch(seed(), [
    { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 100_000 },
  ] as EditCommand[]).edl)();
  // c0 occupies [0, 300000); the appended clip occupies [300000, 400000).

  test("a tick inside the first clip resolves to it", () => {
    expect(clipAtTick(edl, 0)?.startTick).toBe(0);
    expect(clipAtTick(edl, 299_999)?.startTick).toBe(0);
  });

  test("the boundary tick belongs to the NEXT clip (start inclusive, end exclusive)", () => {
    expect(clipAtTick(edl, 300_000)?.startTick).toBe(300_000);
  });

  test("a tick past the last clip resolves to null", () => {
    expect(clipAtTick(edl, 400_000)).toBeNull();
    expect(clipAtTick(edl, 999_999)).toBeNull();
  });
});

describe("lanes — the Timeline's mirror of the render layer stack", () => {
  test("a single-track seed yields exactly one video lane, no span lanes", () => {
    const ls = lanes(seed());
    expect(ls).toHaveLength(1);
    expect(ls[0].kind).toBe("video");
    const v = ls[0] as VideoLane;
    expect(v.clips).toHaveLength(1);
    expect(v.seams).toEqual([]);
    expect(v.role).toBe("main");
  });

  test("two video tracks become two separate lanes (NOT merged onto one row)", () => {
    const ls = lanes(twoTrackEdl());
    const videoLanes = ls.filter((l) => l.kind === "video") as VideoLane[];
    expect(videoLanes).toHaveLength(2);
    expect(videoLanes[0].clips.map((c) => c.clip.id)).toEqual(["a0", "a1"]);
    expect(videoLanes[1].clips.map((c) => c.clip.id)).toEqual(["b0"]);
    // each lane keeps its own derived cursor (track 1's clip starts at 30000, not after track 0)
    expect(videoLanes[1].clips[0].startTick).toBe(30_000);
  });

  test("captions and audio beds each surface as their own lane, in render-stack order", () => {
    const base = seed();
    const edl = Edl.parse({
      ...base,
      overlays: [{ schema: "Overlay.1", id: "ov1", overlayKey: "skull", window: { startTick: 0, endTick: 60_000 }, placement: { mode: "center" }, params: {} }],
      captions: [{ schema: "Caption.1", id: "cap1", window: { startTick: 10_000, endTick: 40_000 }, text: "drop", style: "default", words: [] }],
      audioBeds: [{ schema: "AudioBed.1", id: "bed1", assetId: "a", window: { startTick: 0, endTick: 300_000 }, volume: 0.4, volumeEnvelope: [], loop: true }],
    });
    const ls = lanes(edl);
    // video, then overlay, then caption, then audio (mirrors HiteRoot layer order)
    expect(ls.map((l) => l.kind)).toEqual(["video", "overlay", "caption", "audio"]);
    const cap = ls.find((l) => l.kind === "caption") as SpanLane;
    expect(cap.items[0]).toMatchObject({ id: "cap1", startTick: 10_000, endTick: 40_000, label: "drop" });
    const aud = ls.find((l) => l.kind === "audio") as SpanLane;
    expect(aud.items[0]).toMatchObject({ id: "bed1", startTick: 0, endTick: 300_000 });
  });

  test("a transition is placed as a seam on the video lane that holds its clips", () => {
    // c0 [0,300000) + appended clip [300000,420000); transition spans them on track_0.
    const built = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 120_000 },
    ] as EditCommand[]).edl;
    const clips = allClipPositions(built);
    const withTrans = reduceBatch(built, [
      { type: "ADD_TRANSITION", betweenClipIds: [clips[0].clip.id, clips[1].clip.id], transitionKey: "fade", durationTicks: 30_000, params: {} },
    ] as EditCommand[]).edl;
    const v = lanes(withTrans).find((l) => l.kind === "video") as VideoLane;
    expect(v.seams).toHaveLength(1);
    expect(v.seams[0]).toMatchObject({ transitionKey: "fade", atTick: 300_000 }); // first clip's end edge
  });

  test("empty EDL with no tracks yields no lanes", () => {
    const edl = Edl.parse({ schema: "Edl.2", timebase: { ticksPerSecond: TICKS_PER_SECOND }, durationTicks: 0, tracks: [] });
    expect(lanes(edl)).toEqual([]);
  });
});
