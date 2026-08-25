import { describe, expect, test } from "vitest";
import { reduceBatch, CommandError } from "./reducer";
import { EditHistory } from "./history";
import { emptyEdl2, type Edl } from "./schema";
import type { EditCommand } from "./commands";

const seed = () => emptyEdl2("a", 300_000); // one clip c0, 0..300000 (10s @ 30000tps)
const track0 = (e: Edl) => e.tracks[0].items;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clips = (e: Edl) => track0(e).filter((i: any) => i.schema === "Clip.1") as any[];

describe("reducer — effects", () => {
  test("ADD_EFFECT all → effect on every clip", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_EFFECT", target: "all", effectKey: "saturation-up", params: { amount: 1.2 } },
    ] as EditCommand[]);
    expect(clips(edl)[0].effects).toHaveLength(1);
    expect(clips(edl)[0].effects[0].effectKey).toBe("saturation-up");
    expect(clips(edl)[0].effects[0].id).toMatch(/^fx_/);
  });

  test("REMOVE_EFFECT throws on unknown clip", () => {
    expect(() =>
      reduceBatch(seed(), [{ type: "REMOVE_EFFECT", clipId: "nope", effectId: "x" }] as EditCommand[]),
    ).toThrow(CommandError);
  });
});

describe("reducer — structural timeline", () => {
  test("ADD_CLIP appends a second clip after the first", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
    ] as EditCommand[]);
    expect(clips(edl)).toHaveLength(2);
  });

  test("ADD_CLIP past the end inserts an explicit Gap", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 400_000, inTick: 0, outTick: 100_000 },
    ] as EditCommand[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(track0(edl).map((i: any) => i.schema)).toEqual(["Clip.1", "Gap.1", "Clip.1"]);
  });

  test("SPLIT_CLIP yields two clips with contiguous source ranges", () => {
    const { edl } = reduceBatch(seed(), [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 100_000 }] as EditCommand[]);
    const cs = clips(edl);
    expect(cs).toHaveLength(2);
    expect(cs[0].outTick).toBe(100_000);
    expect(cs[1].inTick).toBe(100_000);
    expect(cs[1].outTick).toBe(300_000);
  });

  test("SPLIT_CLIP out of range throws", () => {
    expect(() => reduceBatch(seed(), [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 0 }] as EditCommand[])).toThrow(CommandError);
  });

  test("REMOVE_CLIP ripple removes; non-ripple leaves a Gap", () => {
    const two = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
    ] as EditCommand[]).edl;
    const rip = reduceBatch(two, [{ type: "REMOVE_CLIP", clipId: "c0", ripple: true }] as EditCommand[]).edl;
    expect(clips(rip)).toHaveLength(1);
    const noRip = reduceBatch(two, [{ type: "REMOVE_CLIP", clipId: "c0", ripple: false }] as EditCommand[]).edl;
    expect(track0(noRip)[0].schema).toBe("Gap.1");
  });

  test("MOVE_CLIP reorders on the same track with a non-boundary tick (drag) without throwing", () => {
    // c0 [0..300000], c1 [300000..450000]. A UI drag feeds a continuous tick that lands inside an
    // item (here 280_001) — the old exact-boundary insert threw insert_mid_item and refused to move.
    const two = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
    ] as EditCommand[]).edl;
    expect(clips(two).map((c) => c.id)).toEqual(["c0", expect.any(String)]);
    const c1Id = clips(two)[1].id;

    const moved = reduceBatch(two, [
      { type: "MOVE_CLIP", clipId: "c0", toTrackId: "track_0", atTick: 280_001 },
    ] as EditCommand[]).edl;
    // c0 snapped to the boundary after c1 → order flips, both clips survive, no gaps introduced.
    expect(clips(moved)).toHaveLength(2);
    expect(clips(moved).map((c) => c.id)).toEqual([c1Id, "c0"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(track0(moved).every((i: any) => i.schema === "Clip.1")).toBe(true);
  });

  test("MOVE_CLIP across tracks lands the clip on the destination track", () => {
    const two = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
    ] as EditCommand[]).edl;
    const moved = reduceBatch(two, [
      { type: "MOVE_CLIP", clipId: "c0", toTrackId: "track_1", atTick: 0 },
    ] as EditCommand[]).edl;
    const t0 = moved.tracks.find((t) => t.id === "track_0")!;
    const t1 = moved.tracks.find((t) => t.id === "track_1")!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(t1.items.some((i: any) => i.schema === "Clip.1" && i.id === "c0")).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(t0.items.some((i: any) => i.schema === "Clip.1" && i.id === "c0")).toBe(false);
  });

  test("TRIM_CLIP out shortens the clip's source out point", () => {
    const { edl } = reduceBatch(seed(), [{ type: "TRIM_CLIP", clipId: "c0", edge: "out", toTick: 120_000 }] as EditCommand[]);
    expect(clips(edl)[0].outTick).toBe(120_000);
  });

  test("SET_CLIP_SPEED changes speed (and timeline duration shrinks)", () => {
    const { edl } = reduceBatch(seed(), [{ type: "SET_CLIP_SPEED", clipId: "c0", speed: 2 }] as EditCommand[]);
    expect(clips(edl)[0].speed).toBe(2);
    expect(edl.durationTicks).toBe(150_000); // 300000 source / 2
  });

  test("SET_CLIP_VOLUME sets clip volume (mute and boost within [0,2])", () => {
    const muted = reduceBatch(seed(), [{ type: "SET_CLIP_VOLUME", clipId: "c0", volume: 0 }] as EditCommand[]).edl;
    expect(clips(muted)[0].volume).toBe(0);
    const boosted = reduceBatch(seed(), [{ type: "SET_CLIP_VOLUME", clipId: "c0", volume: 1.5 }] as EditCommand[]).edl;
    expect(clips(boosted)[0].volume).toBe(1.5);
  });

  test("SET_CLIP_VOLUME on a missing clip throws", () => {
    expect(() =>
      reduceBatch(seed(), [{ type: "SET_CLIP_VOLUME", clipId: "nope", volume: 1 }] as EditCommand[]),
    ).toThrow(CommandError);
  });

  test("PROPOSE_CUTS replaces the main track, stamping the primary assetId", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "PROPOSE_CUTS", clips: [{ assetId: "primary", inTick: 0, outTick: 50_000, speed: 1, volume: 1 }, { assetId: "primary", inTick: 100_000, outTick: 130_000, speed: 1, volume: 1 }] },
    ] as EditCommand[]);
    const cs = clips(edl);
    expect(cs).toHaveLength(2);
    expect(cs[0].assetId).toBe("a");
  });
});

describe("reducer — transitions (§4.7.4 legality)", () => {
  const twoClip = () => reduceBatch(seed(), [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 150_000 }] as EditCommand[]).edl;
  test("adjacent clips, legal duration → added", () => {
    const e = twoClip();
    const ids = clips(e).map((c) => c.id) as [string, string];
    const { edl } = reduceBatch(e, [{ type: "ADD_TRANSITION", betweenClipIds: ids, transitionKey: "fade", durationTicks: 30_000, params: {} }] as EditCommand[]);
    expect(edl.transitions).toHaveLength(1);
  });
  test("too-long duration throws", () => {
    const e = twoClip();
    const ids = clips(e).map((c) => c.id) as [string, string];
    expect(() =>
      reduceBatch(e, [{ type: "ADD_TRANSITION", betweenClipIds: ids, transitionKey: "fade", durationTicks: 999_999, params: {} }] as EditCommand[]),
    ).toThrow(CommandError);
  });
  test("non-adjacent / missing clip throws", () => {
    const e = twoClip();
    expect(() =>
      reduceBatch(e, [{ type: "ADD_TRANSITION", betweenClipIds: ["c0", "ghost"], transitionKey: "fade", durationTicks: 1000, params: {} }] as EditCommand[]),
    ).toThrow(CommandError);
  });
});

describe("reducer — overlays/looks/captions/markers/output", () => {
  test("ADD_OVERLAY then REMOVE_OVERLAY", () => {
    const added = reduceBatch(seed(), [{ type: "ADD_OVERLAY", overlayKey: "overlay-skull", window: { startTick: 0, endTick: 1000 }, placement: { mode: "center" }, params: {} }] as EditCommand[]).edl;
    expect(added.overlays).toHaveLength(1);
    const removed = reduceBatch(added, [{ type: "REMOVE_OVERLAY", overlayId: added.overlays[0].id }] as EditCommand[]).edl;
    expect(removed.overlays).toHaveLength(0);
  });
  test("COMPOSE_LOOK records a thin LookInstance; CLEAR_LOOKS empties", () => {
    const looked = reduceBatch(seed(), [{ type: "COMPOSE_LOOK", lookKey: "look-a24" }] as EditCommand[]).edl;
    expect(looked.looksApplied).toHaveLength(1);
    expect(looked.looksApplied[0].lookKey).toBe("look-a24");
    const cleared = reduceBatch(looked, [{ type: "CLEAR_LOOKS" }] as EditCommand[]).edl;
    expect(cleared.looksApplied).toHaveLength(0);
  });
  test("ADD_AUDIO_BED then REMOVE_AUDIO_BED", () => {
    const added = reduceBatch(seed(), [{ type: "ADD_AUDIO_BED", assetId: "song", window: { startTick: 0, endTick: 300_000 }, volume: 0.4, loop: false }] as EditCommand[]).edl;
    expect(added.audioBeds).toHaveLength(1);
    expect(added.audioBeds[0].assetId).toBe("song");
    const removed = reduceBatch(added, [{ type: "REMOVE_AUDIO_BED", audioBedId: added.audioBeds[0].id }] as EditCommand[]).edl;
    expect(removed.audioBeds).toHaveLength(0);
  });
  test("REMOVE_AUDIO_BED with an unknown id is a no-op (idempotent), not a throw", () => {
    const added = reduceBatch(seed(), [{ type: "ADD_AUDIO_BED", assetId: "song", window: { startTick: 0, endTick: 300_000 }, volume: 0.4, loop: false }] as EditCommand[]).edl;
    const same = reduceBatch(added, [{ type: "REMOVE_AUDIO_BED", audioBedId: "nope" }] as EditCommand[]).edl;
    expect(same.audioBeds).toHaveLength(1);
  });
  test("ADD_CAPTION + ADD_MARKER + SET_OUTPUT_VARIANT", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_CAPTION", window: { startTick: 0, endTick: 1000 }, text: "hi", style: "default" },
      { type: "ADD_MARKER", atTick: 1000, title: "Drop", color: "RED", kind: "chapter" },
      { type: "SET_OUTPUT_VARIANT", aspect: "9:16" },
    ] as EditCommand[]);
    expect(edl.captions).toHaveLength(1);
    expect(edl.markers[0].color).toBe("RED");
    expect(edl.outputs).toEqual([{ aspect: "9:16", maxTicks: undefined }]);
  });
  test("SET_CAPTION_STYLE restyles an existing caption (the TextWindow restyle path)", () => {
    const added = reduceBatch(seed(), [{ type: "ADD_CAPTION", window: { startTick: 0, endTick: 1000 }, text: "hi", style: "default" }] as EditCommand[]).edl;
    expect(added.captions[0].style).toBe("default");
    const restyled = reduceBatch(added, [{ type: "SET_CAPTION_STYLE", captionId: added.captions[0].id, style: "text-lower-third-basic" }] as EditCommand[]).edl;
    expect(restyled.captions[0].style).toBe("text-lower-third-basic");
    expect(restyled.captions[0].id).toBe(added.captions[0].id); // identity + window preserved, only style changed
    expect(restyled.captions[0].window).toEqual(added.captions[0].window);
  });
  test("SET_CAPTION_STYLE on an unknown caption id throws (transaction guard)", () => {
    expect(() => reduceBatch(seed(), [{ type: "SET_CAPTION_STYLE", captionId: "missing", style: "karaoke" }] as EditCommand[])).toThrow();
  });
});

describe("reducer — invariants", () => {
  test("determinism: same input batch ⇒ deep-equal EDL + equal contentHash", () => {
    const batch = [{ type: "ADD_EFFECT", target: "all", effectKey: "saturation-up", params: { amount: 1.2 } }] as EditCommand[];
    const a = reduceBatch(seed(), batch).edl;
    const b = reduceBatch(seed(), batch).edl;
    expect(a).toEqual(b);
    expect(a.contentHash).toBe(b.contentHash);
    expect(typeof a.contentHash).toBe("string");
  });

  test("batch is a transaction: a failing command leaves the input untouched", () => {
    const base = seed();
    const before = JSON.stringify(base);
    expect(() =>
      reduceBatch(base, [
        { type: "ADD_EFFECT", target: "all", effectKey: "x", params: {} },
        { type: "REMOVE_EFFECT", clipId: "nope", effectId: "x" }, // throws
      ] as EditCommand[]),
    ).toThrow(CommandError);
    expect(JSON.stringify(base)).toBe(before); // input never mutated
  });

  test("revision bumps by exactly one per batch", () => {
    const e1 = reduceBatch(seed(), [{ type: "CLEAR_LOOKS" }] as EditCommand[]).edl;
    expect(e1.revision).toBe(1);
    const e2 = reduceBatch(e1, [{ type: "CLEAR_LOOKS" }] as EditCommand[]).edl;
    expect(e2.revision).toBe(2);
  });
});

describe("history — undo/redo/replay", () => {
  test("undo restores prior state; redo re-applies", () => {
    const h = new EditHistory(seed());
    h.apply([{ type: "ADD_EFFECT", target: "all", effectKey: "saturation-up", params: {} }] as EditCommand[]);
    expect(clips(h.current)[0].effects).toHaveLength(1);
    expect(h.canUndo()).toBe(true);
    h.undo();
    expect(clips(h.current)[0].effects).toHaveLength(0);
    h.redo();
    expect(clips(h.current)[0].effects).toHaveLength(1);
  });

  test("replay from seed + command log reconstructs the same EDL", () => {
    const batches = [
      [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 100_000 }],
      [{ type: "ADD_EFFECT", target: "all", effectKey: "grain-fine-medium", params: {} }],
    ] as EditCommand[][];
    const live = batches.reduce((e, b) => reduceBatch(e, b).edl, seed());
    const replayed = EditHistory.replay(seed(), batches);
    expect(replayed).toEqual(live);
  });
});

describe("reducer — audit regressions (2026-06-15)", () => {
  test("C1: SPLIT_CLIP rejects a sub-tick source mapping at extreme slow-mo", () => {
    // At the clamped slow-mo floor (0.1×) a split only 4 ticks into the clip maps to
    // round(4 * 0.1) = 0 source ticks → splitSource === inTick → degenerate left clip; must throw.
    // (SET_CLIP_SPEED now clamps to 0.1..100, so the old 0.001 vehicle is engine-prevented — see
    // the dedicated clamp test below; this keeps the degenerate-source guard under test.)
    expect(() =>
      reduceBatch(seed(), [
        { type: "SET_CLIP_SPEED", clipId: "c0", speed: 0.1 },
        { type: "SPLIT_CLIP", clipId: "c0", atTick: 4 },
      ] as EditCommand[]),
    ).toThrow(CommandError);
  });

  test("C1b: SET_CLIP_SPEED clamps pathological values to the 0.1..100 envelope", () => {
    // Schema only enforces .positive(); without a reducer clamp a stray 0.0001 or 99999 would
    // collapse/explode the clip's derived timeline duration (dur = source / speed).
    const tooSlow = reduceBatch(seed(), [{ type: "SET_CLIP_SPEED", clipId: "c0", speed: 0.0001 }] as EditCommand[]).edl;
    expect(clips(tooSlow)[0].speed).toBe(0.1);
    const tooFast = reduceBatch(seed(), [{ type: "SET_CLIP_SPEED", clipId: "c0", speed: 99_999 }] as EditCommand[]).edl;
    expect(clips(tooFast)[0].speed).toBe(100);
    // A normal speed passes through untouched.
    const normal = reduceBatch(seed(), [{ type: "SET_CLIP_SPEED", clipId: "c0", speed: 2 }] as EditCommand[]).edl;
    expect(clips(normal)[0].speed).toBe(2);
  });

  test("H1: a transition is pruned once a split breaks the pair's adjacency", () => {
    const two = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
    ] as EditCommand[]).edl;
    const [left, right] = clips(two).map((c) => c.id) as [string, string];
    const withTr = reduceBatch(two, [
      { type: "ADD_TRANSITION", betweenClipIds: [left, right], transitionKey: "cross-dissolve", durationTicks: 9_000, params: {} },
    ] as EditCommand[]).edl;
    expect(withTr.transitions).toHaveLength(1);
    // Splitting the left clip inserts a third clip between the pair → no longer adjacent → pruned.
    const split = reduceBatch(withTr, [{ type: "SPLIT_CLIP", clipId: left, atTick: 75_000 }] as EditCommand[]).edl;
    expect(split.transitions).toHaveLength(0);
  });

  test("C2: a degenerate caption window (start >= end) is rejected", () => {
    expect(() =>
      reduceBatch(seed(), [
        { type: "ADD_CAPTION", window: { startTick: 100_000, endTick: 100_000 }, text: "x", style: "default" },
      ] as EditCommand[]),
    ).toThrow(CommandError);
  });
});

/**
 * CRUCIBLE audit regressions. Every case below is the auditor's literal probe input: each one used
 * to SUCCEED and persist a silently-wrong timeline (or silently do nothing) — the worst failure
 * class for "type a change → the video changes". They must now fail loud, or actually work.
 */
describe("reducer — audit regressions (2026-08, EDL core)", () => {
  // ── inverted-range-silent-sliver / add-clip-inverted-silently-one-tick ──
  test("PROPOSE_CUTS with an inverted pair throws instead of replacing the timeline with a 1-tick flash", () => {
    const base = seed();
    const before = JSON.stringify(base);
    expect(() =>
      reduceBatch(base, [
        { type: "PROPOSE_CUTS", clips: [{ assetId: "primary", inTick: 200_000, outTick: 100_000, speed: 1, volume: 1 }] },
      ] as EditCommand[]),
    ).toThrow(CommandError);
    expect(JSON.stringify(base)).toBe(before); // transaction: the timeline survives intact
  });

  test("ADD_CLIP with outTick <= inTick throws (no invisible sliver)", () => {
    for (const [inTick, outTick] of [[120_000, 60_000], [30_000, 0], [60_000, 60_000]]) {
      expect(() =>
        reduceBatch(seed(), [
          { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick, outTick },
        ] as EditCommand[]),
      ).toThrow(CommandError);
    }
  });

  // ── negative-ticks-accepted ──
  test("ADD_CLIP with a negative atTick throws instead of silently appending at the END of the track", () => {
    expect(() =>
      reduceBatch(seed(), [
        { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: -90_000, inTick: 0, outTick: 60_000 },
      ] as EditCommand[]),
    ).toThrow(CommandError);
  });

  // ── split-drops-right-child-effects ──
  test("SPLIT_CLIP keeps the right child's effects, with re-minted ids", () => {
    const graded = reduceBatch(seed(), [
      { type: "ADD_EFFECT", target: "all", effectKey: "saturation-up", params: { amount: 1.2 } },
    ] as EditCommand[]).edl;
    const { edl } = reduceBatch(graded, [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 150_000 }] as EditCommand[]);
    const [left, right] = clips(edl);
    expect(left.effects).toHaveLength(1);
    expect(right.effects).toHaveLength(1); // was 0 — the second half rendered ungraded
    expect(right.effects[0].effectKey).toBe("saturation-up");
    expect(right.effects[0].params).toEqual({ amount: 1.2 });
    expect(right.effects[0].id).not.toBe(left.effects[0].id); // independently addressable
  });

  test("SPLIT_CLIP rebases the right child's volume envelope onto its own start", () => {
    const base = seed();
    // Fade 1.0 → 0.0 across the clip's first 200000 timeline ticks (clip-relative, as the renderer reads it).
    clips(base)[0].volumeEnvelope = [{ atTick: 0, gain: 1 }, { atTick: 200_000, gain: 0 }];
    const { edl } = reduceBatch(base, [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 100_000 }] as EditCommand[]);
    const [left, right] = clips(edl);
    expect(left.volumeEnvelope).toEqual([{ atTick: 0, gain: 1 }, { atTick: 200_000, gain: 0 }]);
    // Shifted back by the 100000-tick split offset; the pre-split keyframe is replaced by the
    // curve's actual value at the cut (0.5) so the audio doesn't jump at a purely structural edit.
    expect(right.volumeEnvelope).toEqual([{ atTick: 0, gain: 0.5 }, { atTick: 100_000, gain: 0 }]);
  });

  // ── duplicate-clip-ids ──
  test("two identical ADD_CLIPs in ONE batch mint distinct clip ids", () => {
    const { edl } = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
    ] as EditCommand[]);
    const ids = clips(edl).map((c) => c.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // was 2 distinct ids for 3 clips

    // …and REMOVE_CLIP of one id now removes exactly one clip, not "the first of two".
    const removed = reduceBatch(edl, [{ type: "REMOVE_CLIP", clipId: ids[1], ripple: true }] as EditCommand[]).edl;
    expect(clips(removed).map((c) => c.id)).toEqual([ids[0], ids[2]]);
  });

  test("the same ADD_CLIP applied in two SEPARATE batches still mints distinct ids", () => {
    const add = [{ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 }] as EditCommand[];
    const once = reduceBatch(seed(), add).edl;
    const twice = reduceBatch(once, add).edl;
    expect(new Set(clips(twice).map((c) => c.id)).size).toBe(3);
  });

  test("minted clip ids stay deterministic (same seed + same batch ⇒ same ids)", () => {
    const add = [{ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 }] as EditCommand[];
    expect(clips(reduceBatch(seed(), add).edl).map((c) => c.id)).toEqual(clips(reduceBatch(seed(), add).edl).map((c) => c.id));
  });

  test("clip ids that collide anyway (model-supplied PROPOSE_CUTS ids) are rejected", () => {
    expect(() =>
      reduceBatch(seed(), [
        {
          type: "PROPOSE_CUTS",
          clips: [
            { id: "same", assetId: "primary", inTick: 0, outTick: 50_000, speed: 1, volume: 1 },
            { id: "same", assetId: "primary", inTick: 60_000, outTick: 90_000, speed: 1, volume: 1 },
          ],
        },
      ] as EditCommand[]),
    ).toThrow(CommandError);
  });

  // ── trim-extend-silent-noop ──
  test("a clip minted WITH the asset's real duration can be trim-extended past its cut", () => {
    const added = reduceBatch(
      seed(),
      [{ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 60_000, outTick: 120_000 }] as EditCommand[],
      { assetDurationsTicks: { a: 900_000 } },
    ).edl;
    const minted = clips(added)[1];
    expect(minted.mediaRefs.full.availableOutTick).toBe(900_000); // was 120000 — its own out point
    // "extend that clip by 2 seconds": the clip starts at timeline 300000, so out edge → 420000.
    const extended = reduceBatch(added, [
      { type: "TRIM_CLIP", clipId: minted.id, edge: "out", toTick: 420_000 },
    ] as EditCommand[]).edl;
    expect(clips(extended)[1].outTick).toBe(180_000); // 60000 source ticks (2s) longer
  });

  test("without a real duration the same extend is a clamp — and now says so instead of silently doing nothing", () => {
    const added = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 60_000, outTick: 120_000 },
    ] as EditCommand[]).edl;
    const minted = clips(added)[1];
    expect(minted.mediaRefs.full.availableOutTick).toBe(120_000);
    expect(() =>
      reduceBatch(added, [{ type: "TRIM_CLIP", clipId: minted.id, edge: "out", toTick: 420_000 }] as EditCommand[]),
    ).toThrow(CommandError);
  });

  test("a clip whose out point is past the caller's real media length is rejected at mint", () => {
    expect(() =>
      reduceBatch(
        seed(),
        [{ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 500_000 }] as EditCommand[],
        { assetDurationsTicks: { a: 300_000 } },
      ),
    ).toThrow(CommandError);
  });

  // ── doc-and-contract-drift (TRIM_CLIP collapse) ──
  test("TRIM_CLIP that would leave < 1 tick throws instead of leaving an invisible sliver", () => {
    expect(() =>
      reduceBatch(seed(), [{ type: "TRIM_CLIP", clipId: "c0", edge: "out", toTick: 0 }] as EditCommand[]),
    ).toThrow(CommandError);
    expect(() =>
      reduceBatch(seed(), [{ type: "TRIM_CLIP", clipId: "c0", edge: "in", toTick: 300_000 }] as EditCommand[]),
    ).toThrow(CommandError);
  });

  test("TRIM_CLIP in still trims normally, and only complains when the clamp changes nothing", () => {
    const trimmed = reduceBatch(seed(), [{ type: "TRIM_CLIP", clipId: "c0", edge: "in", toTick: 60_000 }] as EditCommand[]).edl;
    expect(clips(trimmed)[0].inTick).toBe(60_000);
    // c0 already starts at source 0: dragging the in edge further left is a no-op, so say so.
    expect(() =>
      reduceBatch(seed(), [{ type: "TRIM_CLIP", clipId: "c0", edge: "in", toTick: -30_000 }] as EditCommand[]),
    ).toThrow(CommandError);
  });

  // ── effect-window-degenerate-accepted ──
  test("an equal or inverted per-effect window is rejected (the effect would render in zero frames)", () => {
    for (const window of [{ startTick: 100, endTick: 100 }, { startTick: 500, endTick: 100 }]) {
      expect(() =>
        reduceBatch(seed(), [
          { type: "ADD_EFFECT", target: "all", effectKey: "flash-white", params: {}, window },
        ] as EditCommand[]),
      ).toThrow(CommandError);
    }
  });

  // ── transition-legality-erodes ──
  test("a transition whose neighbours shrank under it is clamped back to a legal duration", () => {
    const two = reduceBatch(seed(), [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 150_000 }] as EditCommand[]).edl;
    const ids = clips(two).map((c) => c.id) as [string, string];
    const withTr = reduceBatch(two, [
      { type: "ADD_TRANSITION", betweenClipIds: ids, transitionKey: "fade", durationTicks: 60_000, params: {} },
    ] as EditCommand[]).edl;
    expect(withTr.transitions[0].durationTicks).toBe(60_000);
    // Speed the right clip up 100× → its timeline duration collapses to 1500 ticks, far under the
    // 60000-tick transition that used to survive verbatim.
    const sped = reduceBatch(withTr, [{ type: "SET_CLIP_SPEED", clipId: ids[1], speed: 100 }] as EditCommand[]).edl;
    expect(sped.transitions).toHaveLength(1);
    expect(sped.transitions[0].durationTicks).toBe(1_500);
  });

  // ── contenthash-not-content-addressed ──
  test("contentHash is content-addressed: two no-op batches at different revisions hash equal", () => {
    const once = reduceBatch(seed(), [{ type: "CLEAR_LOOKS" }] as EditCommand[]).edl;
    const twice = reduceBatch(once, [{ type: "CLEAR_LOOKS" }] as EditCommand[]).edl;
    expect(twice.revision).toBe(once.revision + 1);
    expect(twice.contentHash).toBe(once.contentHash); // was different — revision was in the hash
    // …and a real content change still moves the hash.
    const changed = reduceBatch(twice, [{ type: "SET_CLIP_VOLUME", clipId: "c0", volume: 0.5 }] as EditCommand[]).edl;
    expect(changed.contentHash).not.toBe(twice.contentHash);
  });

  // ── raw-dispatch-bypasses-zod-defaults ──
  test("a raw (never Zod-parsed) ADD_EFFECT without target/params applies to all clips, no TypeError", () => {
    const { edl } = reduceBatch(seed(), [{ type: "ADD_EFFECT", effectKey: "saturation-up" }] as unknown as EditCommand[]);
    expect(clips(edl)[0].effects).toHaveLength(1);
    expect(clips(edl)[0].effects[0].params).toEqual({});
  });

  test("a raw REMOVE_CLIP without `ripple` ripples (the schema default), not leaving a Gap", () => {
    const two = reduceBatch(seed(), [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 150_000 },
    ] as EditCommand[]).edl;
    const { edl } = reduceBatch(two, [{ type: "REMOVE_CLIP", clipId: "c0" }] as unknown as EditCommand[]);
    expect(clips(edl)).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(track0(edl).every((i: any) => i.schema === "Clip.1")).toBe(true);
  });
});

/**
 * THE REGRESSION: splitting a graded clip left the right half ungraded.
 *
 * The handler already carried `effects` onto the right child — there is a comment above that code
 * describing the earlier bug where it did not. But a LOOK is not an effect: it is stored once in
 * `looksApplied` and names the clips it covers by id. The new right-hand clip was in no look's
 * target list, so a purely structural cut ("split here") silently removed the grade from everything
 * after the cut, in preview and in export, with nothing reported.
 */
describe("SPLIT_CLIP and looks", () => {
  test("a look targeting the parent covers both halves after a split", () => {
    const seed = emptyEdl2("00000000-0000-0000-0000-0000000000aa", 900_000, "https://blob/x");
    const track = seed.tracks.find((t) => t.kind === "video")!;
    const parentId = track.items[0]!.id;

    const graded = reduceBatch(seed, [
      { type: "COMPOSE_LOOK", lookKey: "look-a24", targetClipIds: [parentId] },
    ] as EditCommand[]).edl;
    expect(graded.looksApplied[0]!.targetClipIds).toEqual([parentId]);

    const split = reduceBatch(graded, [
      { type: "SPLIT_CLIP", clipId: parentId, atTick: 300_000 },
    ] as EditCommand[]).edl;

    const items = split.tracks.find((t) => t.kind === "video")!.items;
    expect(items).toHaveLength(2);
    const targets = split.looksApplied[0]!.targetClipIds!;
    for (const clip of items) expect(targets).toContain(clip.id);
  });

  test("a whole-timeline look (no targets) is left alone", () => {
    const seed = emptyEdl2("00000000-0000-0000-0000-0000000000ab", 900_000, "https://blob/x");
    const parentId = seed.tracks.find((t) => t.kind === "video")!.items[0]!.id;
    const graded = reduceBatch(seed, [{ type: "COMPOSE_LOOK", lookKey: "look-a24" }] as EditCommand[]).edl;
    const split = reduceBatch(graded, [
      { type: "SPLIT_CLIP", clipId: parentId, atTick: 300_000 },
    ] as EditCommand[]).edl;
    expect(split.looksApplied[0]!.targetClipIds).toBeUndefined();
  });
});
