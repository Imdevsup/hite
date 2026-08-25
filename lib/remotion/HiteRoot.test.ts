import { describe, expect, test } from "vitest";
import { volumeProp, activeWordIndex } from "./HiteRoot";
import { edlToRenderIR } from "@/lib/render/compile";
import { makeMediaResolver } from "@/lib/render/resolver";
import { reduceBatch } from "@/lib/edl/reducer";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import type { EditCommand } from "@/lib/edl/commands";
import { validateManifest } from "@/lib/registry/catalog";
import manifestData from "@/public/registry/manifest.json";
import type { AudioNode, CaptionNode, ClipNode, RenderEnv } from "@/lib/render/ir";

/**
 * The pure frame-space helpers HiteRoot is built on. The IR speaks ABSOLUTE timeline frames
 * everywhere; anything rendered inside a <Sequence> reads a RELATIVE frame, so every crossing has to
 * be explicit. (clipRelativeWindow — the effect-window crossing — is covered in fx/timing.test.ts.)
 */

describe("volumeProp — volume curves are rebased onto their Sequence", () => {
  test("a static gain is just the number", () => {
    expect(volumeProp({ kind: "static", gain: 0.4 }, 300)).toBe(0.4);
  });

  test("keyframes authored on the timeline fire at the right moment inside the clip", () => {
    // A duck authored at absolute frames 330→360 on a clip that starts at frame 300. Remotion hands
    // the callback CLIP-RELATIVE frames, so the curve must move to 30→60. Without the rebase the
    // ramp would sit 300 frames (10s) too late and the clip would just play at full volume.
    const v = volumeProp({ kind: "keyframed", atFrames: [330, 360], gains: [1, 0.2] }, 300);
    expect(typeof v).toBe("function");
    const at = v as (f: number) => number;
    expect(at(30)).toBeCloseTo(1, 5); // clip-relative 30 == absolute 330
    expect(at(45)).toBeCloseTo(0.6, 5); // halfway down
    expect(at(60)).toBeCloseTo(0.2, 5);
  });

  test("it clamps outside the keyframes instead of extrapolating past legal gains", () => {
    const at = volumeProp({ kind: "keyframed", atFrames: [330, 360], gains: [1, 0.2] }, 300) as (f: number) => number;
    expect(at(0)).toBeCloseTo(1, 5);
    expect(at(10_000)).toBeCloseTo(0.2, 5);
  });

  test("a single keyframe is a constant gain, not a crash", () => {
    // Remotion's interpolate throws on a one-value input range — that would take the whole render
    // down rather than dip the volume.
    expect(volumeProp({ kind: "keyframed", atFrames: [120], gains: [0.35] }, 0)).toBe(0.35);
  });
});

/**
 * The crossing the unit tests above CANNOT catch: they hand `volumeProp` a hand-written IR node, so
 * they prove the rebase and nothing about who produces `atFrames`. These drive the real path —
 * Edl.2 → reduceBatch → edlToRenderIR (real manifest, real resolver) → volumeProp — because the EDL
 * stores keyframes NODE-RELATIVE and the IR stores them ABSOLUTE, and the compiler used to skip that
 * conversion. Both halves then subtracted the node's start and every envelope off timeline-zero went
 * flat: a fade-in played at full volume, a split's right half played silent.
 */
describe("volume envelopes end-to-end: EDL ticks → IR frames → Remotion callback", () => {
  const env: RenderEnv = { aspect: "16:9", quality: "full", tier: "pro", fps: 30, engineFingerprint: "volume-e2e" };
  const catalog = validateManifest(manifestData);
  const resolver = makeMediaResolver({ assetUrls: { a: "https://blob/a.mp4" }, catalog });
  // reduceBatch freezes its output (Immer); envelopes are authored on a clone since no command
  // writes one yet (SPLIT_CLIP is the only handler that touches them).
  const withEnvelope = (edl: Edl, mutate: (draft: Edl) => void): Edl => {
    const copy = structuredClone(edl);
    mutate(copy);
    return copy;
  };
  const clipsOf = (edl: Edl) =>
    edlToRenderIR(edl, env, resolver).scene.layers[0].items.filter((n): n is ClipNode => n.kind === "clip");

  test("a fade-in on a clip that starts at 0:10 fades in AT 0:10, not from silence", () => {
    let edl = emptyEdl2("a", 300_000); // 10s
    edl = reduceBatch(edl, [
      { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 300_000 },
    ] as EditCommand[]).edl;
    const authored = withEnvelope(edl, (d) => {
      // 2s fade-in, clip-relative: [0 → 60000 ticks] = [0 → 2s] into the SECOND clip.
      (d.tracks[0].items[1] as { volumeEnvelope: { atTick: number; gain: number }[] }).volumeEnvelope = [
        { atTick: 0, gain: 0 },
        { atTick: 60_000, gain: 1 },
      ];
    });
    const second = clipsOf(authored)[1];
    expect(second.startFrame).toBe(300);
    expect(second.volume).toEqual({ kind: "keyframed", atFrames: [300, 360], gains: [0, 1] }); // ABSOLUTE
    const at = volumeProp(second.volume, second.startFrame) as (f: number) => number;
    expect(at(0)).toBeCloseTo(0, 5); // clip-relative 0 — the fade starts here
    expect(at(30)).toBeCloseTo(0.5, 5);
    expect(at(60)).toBeCloseTo(1, 5);
  });

  test("SPLIT_CLIP's rebased envelope survives the compile — the right half is not silent", () => {
    const seeded = withEnvelope(emptyEdl2("a", 600_000), (d) => {
      (d.tracks[0].items[0] as { volumeEnvelope: { atTick: number; gain: number }[] }).volumeEnvelope = [
        { atTick: 0, gain: 1 },
        { atTick: 200_000, gain: 0 },
      ];
    });
    const split = reduceBatch(seeded, [{ type: "SPLIT_CLIP", clipId: "c0", atTick: 100_000 }] as EditCommand[]).edl;
    const right = clipsOf(split)[1];
    expect(right.startFrame).toBe(100);
    // envelopeAfterSplit re-anchors the curve at the cut: gain 0.5 there, reaching 0 100k ticks later.
    const at = volumeProp(right.volume, right.startFrame) as (f: number) => number;
    expect(at(0)).toBeCloseTo(0.5, 5);
    expect(at(50)).toBeCloseTo(0.25, 5);
    expect(at(100)).toBeCloseTo(0, 5);
  });

  test("an audio bed's envelope is relative to the bed's own window", () => {
    let edl = emptyEdl2("a", 900_000);
    edl = reduceBatch(edl, [
      { type: "ADD_AUDIO_BED", assetId: "a", window: { startTick: 300_000, endTick: 900_000 }, volume: 0.8, loop: false },
    ] as EditCommand[]).edl;
    const authored = withEnvelope(edl, (d) => {
      d.audioBeds[0].volumeEnvelope = [
        { atTick: 0, gain: 0 },
        { atTick: 60_000, gain: 0.8 },
      ];
    });
    const ir = edlToRenderIR(authored, env, resolver);
    const bed = ir.scene.layers.find((l) => l.trackKind === "audio")!.items[0] as AudioNode;
    expect(bed.startFrame).toBe(300);
    expect(bed.volume).toEqual({ kind: "keyframed", atFrames: [300, 360], gains: [0, 0.8] });
    const at = volumeProp(bed.volume, bed.startFrame) as (f: number) => number;
    expect(at(0)).toBeCloseTo(0, 5);
    expect(at(30)).toBeCloseTo(0.4, 5);
    expect(at(60)).toBeCloseTo(0.8, 5);
  });
});

describe("activeWordIndex — the read-along caption highlight", () => {
  const words: CaptionNode["words"] = [
    { text: "cut", startFrame: 100, endFrame: 110 },
    { text: "to", startFrame: 110, endFrame: 118 },
    { text: "the", startFrame: 118, endFrame: 124 },
    { text: "beat", startFrame: 130, endFrame: 150 }, // note the gap before it
  ];

  test("picks the word being spoken, half-open on its own window", () => {
    expect(activeWordIndex(words, 100)).toBe(0);
    expect(activeWordIndex(words, 109)).toBe(0);
    expect(activeWordIndex(words, 110)).toBe(1); // boundary belongs to the next word
    expect(activeWordIndex(words, 123)).toBe(2);
    expect(activeWordIndex(words, 149)).toBe(3);
  });

  test("no word before the first, after the last, or in a pause between them", () => {
    expect(activeWordIndex(words, 99)).toBe(-1);
    expect(activeWordIndex(words, 127)).toBe(-1); // the gap
    expect(activeWordIndex(words, 150)).toBe(-1);
  });

  test("a caption with no word timings has no active word (renders as plain text)", () => {
    expect(activeWordIndex([], 100)).toBe(-1);
  });
});
