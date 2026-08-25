import { describe, expect, test } from "vitest";
import { Edl, emptyEdl } from "./edl";

describe("Edl schema — valid inputs round-trip", () => {
  test("emptyEdl(assetId, durationMs) produces a parseable EDL", () => {
    const edl = emptyEdl("asset-1", 10_000);
    expect(() => Edl.parse(edl)).not.toThrow();
  });

  test("empty clips/overlays/etc arrays default to empty", () => {
    const parsed = Edl.parse({ version: 1, durationMs: 1000 });
    expect(parsed.clips).toEqual([]);
    expect(parsed.overlays).toEqual([]);
    expect(parsed.captions).toEqual([]);
    expect(parsed.transitions).toEqual([]);
    expect(parsed.audioBeds).toEqual([]);
    expect(parsed.looksApplied).toEqual([]);
    expect(parsed.chapters).toEqual([]);
    expect(parsed.outputs).toEqual([{ aspect: "16:9" }]);
    expect(parsed.metadata).toEqual({ generatedBy: "seed" });
  });

  test("effect with range preserves fields", () => {
    const parsed = Edl.parse({
      version: 1,
      durationMs: 10_000,
      clips: [{
        id: "c0", assetId: "a",
        trim: { startMs: 0, endMs: 10_000 },
        timelineStartMs: 0,
        effects: [{ id: "f1", effectKey: "x", params: { k: 1 }, startMs: 1000, endMs: 2000 }],
      }],
    });
    expect(parsed.clips[0].effects[0].startMs).toBe(1000);
  });

  test("face-tracked overlay preserves trackFaceId", () => {
    const parsed = Edl.parse({
      version: 1, durationMs: 5000,
      overlays: [{
        id: "ov1", overlayKey: "overlay-skull", startMs: 100, endMs: 500,
        placement: { mode: "face", trackFaceId: "f0" },
        params: {},
      }],
    });
    expect(parsed.overlays[0].placement).toEqual({ mode: "face", trackFaceId: "f0" });
  });
});

describe("Edl schema — invalid inputs rejected", () => {
  test("version !== 1 rejected", () => {
    expect(() => Edl.parse({ version: 2, durationMs: 0 })).toThrow();
  });

  test("negative durationMs rejected", () => {
    expect(() => Edl.parse({ version: 1, durationMs: -1 })).toThrow();
  });

  test("non-integer trim values rejected", () => {
    expect(() =>
      Edl.parse({
        version: 1, durationMs: 1000,
        clips: [{ id: "c0", assetId: "a", trim: { startMs: 0.5, endMs: 100 }, timelineStartMs: 0 }],
      }),
    ).toThrow();
  });

  test("invalid aspect rejected", () => {
    expect(() =>
      Edl.parse({ version: 1, durationMs: 1000, outputs: [{ aspect: "21:9" }] }),
    ).toThrow();
  });

  test("speed <= 0 rejected", () => {
    expect(() =>
      Edl.parse({
        version: 1, durationMs: 1000,
        clips: [{ id: "c0", assetId: "a", trim: { startMs: 0, endMs: 1000 }, timelineStartMs: 0, speed: 0 }],
      }),
    ).toThrow();
  });

  test("volume > 2 rejected", () => {
    expect(() =>
      Edl.parse({
        version: 1, durationMs: 1000,
        clips: [{ id: "c0", assetId: "a", trim: { startMs: 0, endMs: 1000 }, timelineStartMs: 0, volume: 3 }],
      }),
    ).toThrow();
  });

  test("overlay placement.mode must be one of the known modes", () => {
    expect(() =>
      Edl.parse({
        version: 1, durationMs: 1000,
        overlays: [{ id: "o", overlayKey: "x", startMs: 0, endMs: 100, placement: { mode: "weird" }, params: {} }],
      }),
    ).toThrow();
  });

  test("transition needs betweenClipIds tuple of exactly 2", () => {
    expect(() =>
      Edl.parse({
        version: 1, durationMs: 1000,
        transitions: [{ id: "t1", betweenClipIds: ["a"], transitionKey: "fade", durationMs: 200 }],
      }),
    ).toThrow();
  });

  test("caption with endMs <= startMs rejected by positive constraint, endMs must be positive", () => {
    expect(() =>
      Edl.parse({
        version: 1, durationMs: 1000,
        captions: [{ id: "c", startMs: 0, endMs: 0, text: "hi" }],
      }),
    ).toThrow();
  });
});

describe("Edl schema — defaults", () => {
  test("clip defaults: speed=1, volume=1, effects=[], trackIndex=0", () => {
    const parsed = Edl.parse({
      version: 1, durationMs: 10_000,
      clips: [{ id: "c0", assetId: "a", trim: { startMs: 0, endMs: 10_000 }, timelineStartMs: 0 }],
    });
    expect(parsed.clips[0].speed).toBe(1);
    expect(parsed.clips[0].volume).toBe(1);
    expect(parsed.clips[0].effects).toEqual([]);
    expect(parsed.clips[0].trackIndex).toBe(0);
  });

  test("metadata defaults generatedBy=seed", () => {
    const parsed = Edl.parse({ version: 1, durationMs: 0 });
    expect(parsed.metadata.generatedBy).toBe("seed");
  });
});

describe("emptyEdl builder", () => {
  test("produces one clip spanning [0, durationMs]", () => {
    const edl = emptyEdl("asset-x", 7500);
    expect(edl.clips).toHaveLength(1);
    expect(edl.clips[0].assetId).toBe("asset-x");
    expect(edl.clips[0].trim).toEqual({ startMs: 0, endMs: 7500 });
    expect(edl.clips[0].timelineStartMs).toBe(0);
  });

  test("durationMs matches the argument", () => {
    expect(emptyEdl("x", 123).durationMs).toBe(123);
  });
});
