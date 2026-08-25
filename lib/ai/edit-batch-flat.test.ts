import { describe, it, expect } from "vitest";
import { flatBatchToEditBatch, readNoOpEmit, type FlatEditCommand } from "./edit-batch-flat";
import { AiEditCommand, EditBatch } from "@/lib/edl/commands";
import { reduceBatch } from "@/lib/edl/reducer";
import { emptyEdl2, Edl } from "@/lib/edl/schema";
import { msToTicks } from "@/lib/edl/time";
import { edlToRenderIR } from "@/lib/render/compile";
import type { ClipNode, MediaResolver, RenderEnv } from "@/lib/render/ir";

/**
 * Exhaustive proof that the Gemini-native flat schema maps to EVERY canonical
 * AiEditCommand variant and that the result is a valid, reducible EditBatch.
 * This is the contract the live agent depends on.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";

/** Map a single flat command through the real pipeline; returns the canonical command. */
function mapOne(flat: FlatEditCommand) {
  const batch = flatBatchToEditBatch({ commands: [flat], summary: "test" });
  expect(batch.commands).toHaveLength(1);
  // Every produced command must satisfy the canonical AI schema.
  expect(() => AiEditCommand.parse(batch.commands[0])).not.toThrow();
  return batch.commands[0] as Record<string, unknown>;
}

describe("flat → canonical mapping: all 15 command types", () => {
  it("ADD_CLIP", () => {
    const c = mapOne({ type: "ADD_CLIP", assetId: ASSET, trackId: "track_0", atTick: 0, inTick: 0, outTick: 30000 });
    expect(c).toMatchObject({ type: "ADD_CLIP", assetId: ASSET, trackId: "track_0", atTick: 0, inTick: 0, outTick: 30000 });
  });

  it("REMOVE_CLIP (ripple defaults true)", () => {
    expect(mapOne({ type: "REMOVE_CLIP", clipId: "c0" })).toMatchObject({ type: "REMOVE_CLIP", clipId: "c0", ripple: true });
    expect(mapOne({ type: "REMOVE_CLIP", clipId: "c0", ripple: false })).toMatchObject({ ripple: false });
  });

  it("MOVE_CLIP", () => {
    expect(mapOne({ type: "MOVE_CLIP", clipId: "c0", toTrackId: "track_0", atTick: 9000 }))
      .toMatchObject({ type: "MOVE_CLIP", clipId: "c0", toTrackId: "track_0", atTick: 9000 });
  });

  it("SPLIT_CLIP", () => {
    expect(mapOne({ type: "SPLIT_CLIP", clipId: "c0", atTick: 15000 })).toMatchObject({ type: "SPLIT_CLIP", clipId: "c0", atTick: 15000 });
  });

  it("TRIM_CLIP", () => {
    expect(mapOne({ type: "TRIM_CLIP", clipId: "c0", edge: "out", toTick: 12000 }))
      .toMatchObject({ type: "TRIM_CLIP", clipId: "c0", edge: "out", toTick: 12000 });
  });

  it("SET_CLIP_SPEED", () => {
    expect(mapOne({ type: "SET_CLIP_SPEED", clipId: "c0", speed: 0.5 })).toMatchObject({ type: "SET_CLIP_SPEED", clipId: "c0", speed: 0.5 });
  });

  it("PROPOSE_CUTS", () => {
    const c = mapOne({ type: "PROPOSE_CUTS", proposedClips: [{ inTick: 0, outTick: 6000 }, { inTick: 9000, outTick: 15000 }], rationale: "tighten" });
    expect(c.type).toBe("PROPOSE_CUTS");
    expect((c.clips as unknown[]).length).toBe(2);
    expect(c.rationale).toBe("tighten");
  });

  it("ADD_EFFECT — target all + paramsJson", () => {
    const c = mapOne({ type: "ADD_EFFECT", effectKey: "saturation-up", targetMode: "all", paramsJson: '{"amount":0.4}' });
    expect(c).toMatchObject({ type: "ADD_EFFECT", effectKey: "saturation-up", target: "all", params: { amount: 0.4 } });
  });

  it("ADD_EFFECT — target clip", () => {
    expect(mapOne({ type: "ADD_EFFECT", effectKey: "vignette-soft", targetMode: "clip", clipId: "c0" }).target)
      .toEqual({ clipId: "c0" });
  });

  it("ADD_EFFECT — target range from window", () => {
    expect(mapOne({ type: "ADD_EFFECT", effectKey: "zoom-punch", targetMode: "range", windowStartTick: 3000, windowEndTick: 9000 }).target)
      .toEqual({ range: { startTick: 3000, endTick: 9000 } });
  });

  it("ADD_TRANSITION — betweenClipIds becomes a 2-tuple", () => {
    const c = mapOne({ type: "ADD_TRANSITION", betweenClipIds: ["c0", "c1"], transitionKey: "trans-whip-pan-l", durationTicks: 6000 });
    expect(c).toMatchObject({ type: "ADD_TRANSITION", betweenClipIds: ["c0", "c1"], transitionKey: "trans-whip-pan-l", durationTicks: 6000 });
  });

  it("ADD_OVERLAY — window + placement xy", () => {
    const c = mapOne({ type: "ADD_OVERLAY", overlayKey: "overlay-skull", windowStartTick: 0, windowEndTick: 30000, placementMode: "xy", placeX: 0.5, placeY: 0.2 });
    expect(c).toMatchObject({ type: "ADD_OVERLAY", overlayKey: "overlay-skull", window: { startTick: 0, endTick: 30000 }, placement: { mode: "xy", x: 0.5, y: 0.2 } });
  });

  it("ADD_OVERLAY — placement center default + face", () => {
    expect(mapOne({ type: "ADD_OVERLAY", overlayKey: "overlay-skull", windowStartTick: 0, windowEndTick: 1000 }).placement).toEqual({ mode: "center" });
    expect(mapOne({ type: "ADD_OVERLAY", overlayKey: "overlay-skull", windowStartTick: 0, windowEndTick: 1000, placementMode: "face", placeFaceId: "face_1" }).placement)
      .toEqual({ mode: "face", trackFaceId: "face_1" });
  });

  it("ADD_EFFECT — target range keeps the window as the effect's enable gate", () => {
    const c = mapOne({ type: "ADD_EFFECT", effectKey: "glitch", targetMode: "range", windowStartTick: 90_000, windowEndTick: 270_000 });
    expect(c.target).toEqual({ range: { startTick: 90_000, endTick: 270_000 } });
    expect(c.window).toEqual({ startTick: 90_000, endTick: 270_000 });
  });

  it("COMPOSE_LOOK", () => {
    expect(mapOne({ type: "COMPOSE_LOOK", lookKey: "look-a24" })).toMatchObject({ type: "COMPOSE_LOOK", lookKey: "look-a24" });
    expect(mapOne({ type: "COMPOSE_LOOK", lookKey: "look-a24", targetClipIds: ["c0"] }).targetClipIds).toEqual(["c0"]);
  });

  it("ADD_CAPTION", () => {
    expect(mapOne({ type: "ADD_CAPTION", windowStartTick: 0, windowEndTick: 30000, captionText: "HITE" }))
      .toMatchObject({ type: "ADD_CAPTION", window: { startTick: 0, endTick: 30000 }, text: "HITE" });
  });

  it("ADD_AUDIO_BED", () => {
    expect(mapOne({ type: "ADD_AUDIO_BED", assetId: ASSET, windowStartTick: 0, windowEndTick: 30000, volume: 0.6, loop: true }))
      .toMatchObject({ type: "ADD_AUDIO_BED", assetId: ASSET, window: { startTick: 0, endTick: 30000 }, volume: 0.6, loop: true });
  });

  it("ADD_MARKER", () => {
    expect(mapOne({ type: "ADD_MARKER", atTick: 5000, title: "drop", markerColor: "RED", markerKind: "ai" }))
      .toMatchObject({ type: "ADD_MARKER", atTick: 5000, title: "drop", color: "RED", kind: "ai" });
  });

  it("SET_OUTPUT_VARIANT", () => {
    expect(mapOne({ type: "SET_OUTPUT_VARIANT", aspect: "9:16", maxTicks: 450000 }))
      .toMatchObject({ type: "SET_OUTPUT_VARIANT", aspect: "9:16", maxTicks: 450000 });
  });
});

describe("flat batch: safety + edge cases", () => {
  it("rejects an empty batch", () => {
    expect(() => flatBatchToEditBatch({ commands: [], summary: "x" })).toThrow();
  });

  it("fails loudly when a required field is missing (no silent bad edit)", () => {
    // ADD_CAPTION without a window → canonical schema requires it.
    expect(() => flatBatchToEditBatch({ commands: [{ type: "ADD_CAPTION", captionText: "x" }], summary: "x" })).toThrow();
  });

  it("bad paramsJson throws, command-attributed (the requested strength is intent, not decoration)", () => {
    // Probe: a truncated object and a valid-JSON-wrong-shape both used to map to {} — the effect then
    // applied at registry defaults while the turn reported success ("10% grain" silently ignored).
    expect(() => flatBatchToEditBatch({ commands: [{ type: "ADD_EFFECT", effectKey: "saturation-up", paramsJson: '{"amount":0.4' }], summary: "x" }))
      .toThrow(/command #1 \(ADD_EFFECT\).*paramsJson/s);
    expect(() => flatBatchToEditBatch({ commands: [{ type: "ADD_EFFECT", effectKey: "saturation-up", paramsJson: "[1,2]" }], summary: "x" }))
      .toThrow(/paramsJson must be a JSON object/);
    expect(() => flatBatchToEditBatch({ commands: [{ type: "ADD_EFFECT", effectKey: "saturation-up", paramsJson: '"x"' }], summary: "x" }))
      .toThrow(/paramsJson must be a JSON object/);
    // An omitted paramsJson is still the legal "no params" case.
    expect(mapOne({ type: "ADD_EFFECT", effectKey: "saturation-up" }).params).toEqual({});
  });

  it("ADD_EFFECT targetMode='range' without a window throws (never silently grades ALL clips)", () => {
    expect(() => flatBatchToEditBatch({ commands: [{ type: "ADD_EFFECT", effectKey: "saturation-up", targetMode: "range" }], summary: "x" })).toThrow(/range/i);
  });

  it("ADD_EFFECT targetMode='clip' without a clipId throws", () => {
    expect(() => flatBatchToEditBatch({ commands: [{ type: "ADD_EFFECT", effectKey: "saturation-up", targetMode: "clip" }], summary: "x" })).toThrow(/clip/i);
  });

  it("ADD_EFFECT range maps the window into BOTH target.range and effect.window", () => {
    // target.range picks WHICH clips; window is the only thing that gates WHEN the effect paints
    // (compile.ts → IR window → HiteRoot). Dropping it graded whole clips — see the e2e test below.
    const c = mapOne({ type: "ADD_EFFECT", effectKey: "saturation-up", targetMode: "range", windowStartTick: 3000, windowEndTick: 9000 });
    expect(c.target).toEqual({ range: { startTick: 3000, endTick: 9000 } });
    expect(c.window).toEqual({ startTick: 3000, endTick: 9000 });
  });

  it("ADD_EFFECT targetMode='range' with an inverted window throws (never silently grades whole clips)", () => {
    // Probe: window 9000..3000 passed every check and applied the effect to the seed clip, while the
    // same inverted window on ADD_CAPTION threw. Both are degenerate; both must fail.
    expect(() =>
      flatBatchToEditBatch({
        commands: [{ type: "ADD_EFFECT", effectKey: "saturation-up", targetMode: "range", windowStartTick: 9000, windowEndTick: 3000 }],
        summary: "x",
      }),
    ).toThrow(/windowStartTick < windowEndTick/);
    // Equal bounds render in exactly zero frames — same failure, same rejection.
    expect(() =>
      flatBatchToEditBatch({
        commands: [{ type: "ADD_EFFECT", effectKey: "saturation-up", targetMode: "range", windowStartTick: 3000, windowEndTick: 3000 }],
        summary: "x",
      }),
    ).toThrow(/windowStartTick < windowEndTick/);
  });

  it("ADD_OVERLAY placement fails loud instead of defaulting to (0,0) / face ''", () => {
    const overlay = { type: "ADD_OVERLAY" as const, overlayKey: "overlay-skull", windowStartTick: 0, windowEndTick: 30000 };
    expect(() => flatBatchToEditBatch({ commands: [{ ...overlay, placementMode: "xy" }], summary: "x" }))
      .toThrow(/placementMode='xy' requires placeX and placeY/);
    expect(() => flatBatchToEditBatch({ commands: [{ ...overlay, placementMode: "xy", placeX: 0.5 }], summary: "x" }))
      .toThrow(/placementMode='xy' requires placeX and placeY/);
    expect(() => flatBatchToEditBatch({ commands: [{ ...overlay, placementMode: "face" }], summary: "x" }))
      .toThrow(/placementMode='face' requires placeFaceId/);
  });

  it("fractional ticks are rounded, not fatal (one .5 must not kill the batch)", () => {
    // Probe: SPLIT_CLIP atTick 15000.5 threw 'atTick — Expected integer, received float' AFTER the
    // whole tool-loop ran and a daily prompt credit was spent. 1 tick = 1/30000 s.
    expect(mapOne({ type: "SPLIT_CLIP", clipId: "c0", atTick: 15000.5 }).atTick).toBe(15001);
    expect(mapOne({ type: "ADD_MARKER", atTick: 430499.6, title: "drop" }).atTick).toBe(430500);
    const clip = mapOne({ type: "ADD_CLIP", assetId: ASSET, trackId: "track_0", atTick: 0.4, inTick: 10.5, outTick: 29999.5 });
    expect(clip).toMatchObject({ atTick: 0, inTick: 11, outTick: 30000 });
    const fx = mapOne({ type: "ADD_EFFECT", effectKey: "zoom-punch", targetMode: "range", windowStartTick: 89999.5, windowEndTick: 270000.4 });
    expect(fx.window).toEqual({ startTick: 90000, endTick: 270000 });
    const cuts = mapOne({ type: "PROPOSE_CUTS", proposedClips: [{ inTick: 0.2, outTick: 5999.7 }] });
    expect((cuts.clips as Array<{ inTick: number; outTick: number }>)[0]).toMatchObject({ inTick: 0, outTick: 6000 });
  });

  it("missing required field yields a readable, command-attributed error", () => {
    expect(() => flatBatchToEditBatch({ commands: [{ type: "ADD_CAPTION", captionText: "x" }], summary: "x" })).toThrow(/ADD_CAPTION/);
  });

  it("readNoOpEmit recognises the prompt's zero-command answer (and nothing else)", () => {
    // The system prompts tell the model to answer an impossible/empty request with an explanatory
    // summary and no commands; the routes stream that instead of erroring on a compliant emit.
    expect(readNoOpEmit({ commands: [], summary: "Nothing to cut — the timeline is empty." }))
      .toEqual({ summary: "Nothing to cut — the timeline is empty." });
    expect(readNoOpEmit({ commands: [{ type: "REMOVE_CLIP", clipId: "c0" }], summary: "x" })).toBeNull();
    // Malformed emits stay null so flatBatchToEditBatch still produces the real, field-named error.
    expect(readNoOpEmit({ summary: "x" })).toBeNull();
    expect(readNoOpEmit(null)).toBeNull();
    // …and the mapper itself still refuses an empty batch (a caller here has committed to an edit).
    expect(() => flatBatchToEditBatch({ commands: [], summary: "x" })).toThrow(/empty edit batch/);
  });

  it("preserves the user-facing summary", () => {
    const b = flatBatchToEditBatch({ commands: [{ type: "REMOVE_CLIP", clipId: "c0" }], summary: "removed the dead intro" });
    expect(b.summary).toBe("removed the dead intro");
    expect(() => EditBatch.parse(b)).not.toThrow();
  });
});

describe("end-to-end: a time-scoped effect stays time-scoped (P0 range-effect-window-dropped)", () => {
  const env: RenderEnv = { aspect: "16:9", quality: "full", tier: "pro", fps: 30, engineFingerprint: "remotion@4.0.450/chrome-x" };
  const resolver: MediaResolver = {
    urlForAsset: (a, k) => `https://blob/${a}.${k}.mp4`,
    faceTrack: (_a, f) => ({ trackId: f, keyframes: [] }),
    lookRecipe: () => ({ steps: [] }),
    registryEntry: () => ({ engine: "remotion" }),
    recipeVars: () => ({}),
  };

  it("'glitch from 0:03 to 0:09' on a 30s one-clip timeline gates 3s..9s, not the whole video", () => {
    const seed = emptyEdl2(ASSET, msToTicks(30_000), "https://example.com/clip.mp4");
    const batch = flatBatchToEditBatch({
      summary: "glitch on the 3-9s stretch",
      commands: [{ type: "ADD_EFFECT", effectKey: "glitch", targetMode: "range", windowStartTick: 90_000, windowEndTick: 270_000 }],
    });
    const { edl } = reduceBatch(seed, batch.commands);

    const clips = edl.tracks[0].items.filter((i): i is Extract<typeof i, { schema: "Clip.1" }> => i.schema === "Clip.1");
    expect(clips).toHaveLength(1);
    expect(clips[0].effects).toHaveLength(1);
    // The whole point: the effect instance carries the window the user asked for.
    expect(clips[0].effects[0]).toMatchObject({ effectKey: "glitch", enabled: true, window: { startTick: 90_000, endTick: 270_000 } });

    // …and it survives to the render IR both preview and export compile from (30fps → 90..270).
    const ir = edlToRenderIR(edl, env, resolver);
    const clipNode = ir.scene.layers[0].items[0] as ClipNode;
    expect(clipNode.effects[0].window).toEqual({ startFrame: 90, endFrame: 270 });
  });
});

describe("end-to-end: flat batch reduces to a valid Edl", () => {
  it("multi-command batch applies against the seed timeline", () => {
    const seed = emptyEdl2(ASSET, msToTicks(15000), "https://example.com/clip.mp4");
    const batch = flatBatchToEditBatch({
      summary: "warm look, slow c0, caption, marker",
      commands: [
        { type: "COMPOSE_LOOK", lookKey: "look-cinema-warm" },
        { type: "SET_CLIP_SPEED", clipId: "c0", speed: 0.5 },
        { type: "ADD_CAPTION", windowStartTick: 0, windowEndTick: 30000, captionText: "MORFEU x HITE" },
        { type: "ADD_MARKER", atTick: 150000, title: "drop" },
        { type: "ADD_EFFECT", effectKey: "saturation-up", targetMode: "all", paramsJson: '{"amount":0.5}' },
      ],
    });
    const { edl } = reduceBatch(seed, batch.commands);
    // The reduced timeline must still be a valid Edl.2.
    expect(() => Edl.parse(edl)).not.toThrow();
    expect(edl.captions.length).toBeGreaterThan(0);
    expect(edl.looksApplied.length).toBeGreaterThan(0);
  });
});
