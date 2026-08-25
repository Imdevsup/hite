import { describe, expect, test } from "vitest";
import { edlToRenderIR } from "./compile";
import { makeMediaResolver } from "./resolver";
import type { RenderEnv, ClipNode, OverlayNode, CaptionNode, TrackNode } from "./ir";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { reduceBatch } from "@/lib/edl/reducer";
import type { EditCommand } from "@/lib/edl/commands";
import { validateManifest } from "@/lib/registry/catalog";
import { RENDERABLE_EFFECT_KEYS } from "@/lib/remotion/renderable";
import manifestData from "@/public/registry/manifest.json";

/**
 * The compiler against the REAL registry manifest and the REAL resolver.
 *
 * Every other test in this directory hands `edlToRenderIR` a hand-written resolver — which is
 * exactly how the look-recipe P0 shipped: the stub returned the fields the compiler wanted, while
 * `makeMediaResolver` silently dropped each recipe step's target/startMs/endMs/placement and
 * resolved every `{{…}}` template to 0. Preview and export agreed perfectly, on garbage. These tests
 * drive the same path the editor and the export workflow do, so a divergence between the manifest
 * and the compiler fails here.
 */

const env: RenderEnv = { aspect: "16:9", quality: "full", tier: "pro", fps: 30, engineFingerprint: "manifest-test" };
const catalog = validateManifest(manifestData);
const SIXTY_SECONDS = 1_800_000; // ticks @ 30000/s

function resolverFor(assetUrls: Record<string, string> = { a: "https://blob/a.full.mp4" }) {
  return makeMediaResolver({ assetUrls, catalog });
}
function seedWithLook(lookKey: string, durationTicks = SIXTY_SECONDS): Edl {
  const edl = emptyEdl2("a", durationTicks);
  return reduceBatch(edl, [{ type: "COMPOSE_LOOK", lookKey }] as EditCommand[]).edl;
}
const overlaysOf = (layers: TrackNode[]): OverlayNode[] =>
  (layers.find((l) => l.trackKind === "overlay")?.items ?? []) as OverlayNode[];

describe("the manifest's looks are real entries (guards the fixtures below)", () => {
  test("look-skull-face-drop + look-vhs-dream exist with recipes", () => {
    for (const key of ["look-skull-face-drop", "look-vhs-dream"]) {
      const entry = catalog.find((e) => e.key === key);
      expect(entry, key).toBeDefined();
      expect(entry!.recipe!.length).toBeGreaterThan(0);
    }
  });
});

describe("look-skull-face-drop — the recipe fields that used to be dropped (P0)", () => {
  const ir = edlToRenderIR(seedWithLook("look-skull-face-drop"), env, resolverFor());
  const clip = ir.scene.layers[0].items[0] as ClipNode;

  test("no effect is applied at a fabricated strength over the whole video", () => {
    // BEFORE: rgb-split-hard {strength: 0}, chromatic-flash {strength: 10}, zoom-punch and
    // glitch-bars ALL with window undefined — i.e. permanently on, for the entire 60s, in preview
    // and export alike. Every one of those steps is scoped to a `{{dropMs…}}` range that no beat
    // analysis backs, so the honest compile applies none of them.
    expect(clip.effects).toHaveLength(0);
    expect(overlaysOf(ir.scene.layers)).toHaveLength(0);
  });

  test("every dropped step is RECORDED, not silently swallowed", () => {
    // 5 recipe steps: overlay-skull + rgb-split-hard + zoom-punch + glitch-bars + chromatic-flash.
    expect(ir.diagnostics).toHaveLength(5);
    for (const d of ir.diagnostics) {
      expect(d.code).toBe("look-step-unresolved");
      expect(d.key).toBe("look-skull-face-drop");
    }
    const details = ir.diagnostics.map((d) => d.detail).join("\n");
    expect(details).toContain("overlay-skull");
    expect(details).toContain("chromatic-flash");
    expect(details).toContain("dropMs");
  });

  test("with beat data supplied, the SAME recipe produces real windows and params", () => {
    // The proof that the fields are threaded, not just discarded: give the resolver the vars the
    // recipe asks for and every step lands at its authored time, in ticks converted from the
    // recipe's milliseconds (30 ticks per ms).
    const base = resolverFor();
    const withBeats = {
      ...base,
      recipeVars: () => ({ dropMs: 20_000, faceId: 1, scale: 1.4, splitStrength: 0.9 }),
    };
    const beatIr = edlToRenderIR(seedWithLook("look-skull-face-drop"), env, withBeats);
    const beatClip = beatIr.scene.layers[0].items[0] as ClipNode;

    const flash = beatClip.effects.find((e) => e.effectKey === "chromatic-flash");
    expect(flash).toBeDefined();
    expect(flash!.params.strength).toBe(10);
    // chromatic-flash: [dropMs, dropMs+50) → [20.0s, 20.05s) → frames [600, 602) at 30fps.
    expect(flash!.window).toEqual({ startFrame: 600, endFrame: 602 });
    expect(flash!.window!.endFrame).toBeLessThan(beatIr.durationInFrames); // NOT the whole video

    const split = beatClip.effects.find((e) => e.effectKey === "rgb-split-hard");
    expect(split!.params.strength).toBe(0.9); // was 0 — invisible
    expect(split!.window).toEqual({ startFrame: 591, endFrame: 609 }); // ±300ms around the drop

    const punch = beatClip.effects.find((e) => e.effectKey === "zoom-punch");
    expect(punch!.window).toEqual({ startFrame: 597, endFrame: 603 }); // ±100ms
    const bars = beatClip.effects.find((e) => e.effectKey === "glitch-bars");
    expect(bars!.window).toEqual({ startFrame: 597, endFrame: 612 }); // -100ms → +400ms

    const [skull] = overlaysOf(beatIr.scene.layers);
    expect(skull.overlayKey).toBe("overlay-skull");
    // startMs {{dropMs_minus_1600}} → 18.4s = frame 552; endMs {{dropMs_plus_1900}} → 21.9s = 657.
    expect(skull.window).toEqual({ startFrame: 552, endFrame: 657 });
    expect(skull.window.endFrame - skull.window.startFrame).toBeGreaterThan(1); // was a 1-frame flash
    expect(skull.params.scale).toBe(1.4); // was 0
    // `placement.trackFaceId` is still a template (no face pipeline) → visible centered fallback,
    // recorded as a diagnostic rather than the old 0×0 box.
    expect(skull.placement).toEqual({ mode: "static", x: 576, y: 324, w: 768, h: 432 });
    expect(beatIr.diagnostics.map((d) => d.detail).join("\n")).toContain("placed centered");
  });
});

describe("look-skull-face-drop at the edges of the timeline", () => {
  test("a drop at 0:00.5 clamps the pre-roll to frame 0 instead of going negative", () => {
    // `{{dropMs_minus_1600}}` = -1100ms. A negative window start is not a legal frame.
    const resolver = { ...resolverFor(), recipeVars: () => ({ dropMs: 500, faceId: 1, scale: 1, splitStrength: 1 }) };
    const ir = edlToRenderIR(seedWithLook("look-skull-face-drop"), env, resolver);
    const [skull] = overlaysOf(ir.scene.layers);
    expect(skull.window).toEqual({ startFrame: 0, endFrame: 72 }); // 0 → dropMs+1900 = 2.4s
    for (const fx of (ir.scene.layers[0].items[0] as ClipNode).effects) {
      expect(fx.window!.startFrame, fx.effectKey).toBeGreaterThanOrEqual(0);
    }
  });

  test("a drop past the end of the timeline covers no clip, and says so", () => {
    const resolver = { ...resolverFor(), recipeVars: () => ({ dropMs: 900_000, faceId: 1, scale: 1, splitStrength: 1 }) };
    const ir = edlToRenderIR(seedWithLook("look-skull-face-drop", 300_000), env, resolver); // a 10s timeline
    expect((ir.scene.layers[0].items[0] as ClipNode).effects).toHaveLength(0);
    expect(ir.diagnostics.map((d) => d.detail).join("\n")).toContain("covers no clip");
  });
});

describe("look-vhs-dream — the full-length overlay the compiler CAN resolve", () => {
  const ir = edlToRenderIR(seedWithLook("look-vhs-dream"), env, resolverFor());

  test("`{{durationMs}}` resolves from the EDL, so scan-lines span the whole video", () => {
    const [scan] = overlaysOf(ir.scene.layers);
    expect(scan.overlayKey).toBe("overlay-scan-lines");
    // BEFORE: window {startFrame: 0, endFrame: 0} → Sequence Math.max(1,…) → a 1-frame flash at 0:00.
    expect(scan.window).toEqual({ startFrame: 0, endFrame: 1800 });
    expect(scan.params.opacity).toBe(0.25);
  });

  test("its whole-timeline effects carry no window and keep their authored params", () => {
    const clip = ir.scene.layers[0].items[0] as ClipNode;
    const drift = clip.effects.find((e) => e.effectKey === "chromatic-aberration-drift");
    expect(drift!.window).toBeUndefined(); // target "all" ⇒ whole clip
    expect(drift!.params.strength).toBe(2.5);
    expect(clip.effects.find((e) => e.effectKey === "lut-vhs-worn")!.params.lutFile).toBe("/luts/vhs-worn.cube");
  });

  test("the recipe still references an effectKey nothing can render (why U5 must filter)", () => {
    const clip = ir.scene.layers[0].items[0] as ClipNode;
    const keys = clip.effects.map((e) => e.effectKey);
    expect(keys).toContain("audio-saturation-soft");
    expect(RENDERABLE_EFFECT_KEYS.has("audio-saturation-soft")).toBe(false);
  });
});

describe("target:'all' looks reach every clip on the timeline", () => {
  test("look-a24 applies its four graded steps to both clips", () => {
    let edl = emptyEdl2("a", 300_000);
    edl = reduceBatch(edl, [{ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 300_000, inTick: 0, outTick: 300_000 }] as EditCommand[]).edl;
    edl = reduceBatch(edl, [{ type: "COMPOSE_LOOK", lookKey: "look-a24" }] as EditCommand[]).edl;
    const ir = edlToRenderIR(edl, env, resolverFor());
    const clips = ir.scene.layers[0].items.filter((n): n is ClipNode => n.kind === "clip");
    expect(clips).toHaveLength(2);
    for (const c of clips) {
      expect(c.effects.map((e) => e.effectKey)).toEqual(["lut-a24-moonlight", "vignette-soft", "grain-fine-medium", "curve-lift-blacks"]);
      for (const fx of c.effects) expect(fx.window).toBeUndefined();
    }
    expect(ir.diagnostics).toEqual([]);
  });

  test("every effect look-a24 emits has a renderer (else it is a silent no-op)", () => {
    const recipe = catalog.find((e) => e.key === "look-a24")!.recipe as { effectKey?: string }[];
    for (const step of recipe) {
      if (step.effectKey) expect(RENDERABLE_EFFECT_KEYS.has(step.effectKey), step.effectKey).toBe(true);
    }
  });
});

describe("SET_OUTPUT_VARIANT.maxTicks is honoured (was read by nothing)", () => {
  const cap = 1_800_000; // 60s
  function sixtySecondCut(): Edl {
    let edl = emptyEdl2("a", 5_400_000); // a 3-minute source
    edl = reduceBatch(edl, [{ type: "SET_OUTPUT_VARIANT", aspect: "16:9", maxTicks: cap }] as EditCommand[]).edl;
    return edl;
  }

  test('"make it a 60s cut" produces a 60s composition, not a 3-minute one', () => {
    const ir = edlToRenderIR(sixtySecondCut(), env, resolverFor());
    expect(ir.durationTicks).toBe(cap);
    expect(ir.durationInFrames).toBe(1800);
  });

  test("the straddling clip is trimmed to the cap — no clip outlives the composition", () => {
    const ir = edlToRenderIR(sixtySecondCut(), env, resolverFor());
    const clips = ir.scene.layers.flatMap((l) => l.items).filter((n): n is ClipNode => n.kind === "clip");
    expect(clips).toHaveLength(1);
    expect(clips[0].endTick).toBe(cap);
    expect(clips[0].endFrame).toBe(1800);
    expect(clips[0].outTick).toBe(cap); // source range shrinks with the timeline span (speed 1)
    for (const c of clips) expect(c.endFrame).toBeLessThanOrEqual(ir.durationInFrames);
  });

  test("content that starts past the cap is dropped, content that straddles it is clamped", () => {
    let edl = sixtySecondCut();
    edl = reduceBatch(edl, [
      { type: "ADD_CAPTION", window: { startTick: 1_500_000, endTick: 2_100_000 }, text: "straddles the cap", style: "default" },
      { type: "ADD_CAPTION", window: { startTick: 3_000_000, endTick: 3_300_000 }, text: "past the cap", style: "default" },
    ] as EditCommand[]).edl;
    const ir = edlToRenderIR(edl, env, resolverFor());
    const captions = (ir.scene.layers.find((l) => l.trackKind === "caption")?.items ?? []) as CaptionNode[];
    expect(captions.map((c) => c.text)).toEqual(["straddles the cap"]);
    expect(captions[0].window.endFrame).toBe(1800);
  });

  test("no cap ⇒ the EDL's own duration, unchanged", () => {
    const ir = edlToRenderIR(emptyEdl2("a", 5_400_000), env, resolverFor());
    expect(ir.durationTicks).toBe(5_400_000);
  });
});

describe("image assets never reach OffthreadVideo", () => {
  test("the resolver reads the media kind off the asset URL", () => {
    const ir = edlToRenderIR(emptyEdl2("still", 120_000), env, resolverFor({ still: "https://blob/logo-8f2.png" }));
    expect((ir.scene.layers[0].items[0] as ClipNode).source.mediaKind).toBe("image");
  });

  test("an explicit assetKinds map wins over the URL (what the store will pass)", () => {
    const resolver = makeMediaResolver({ assetUrls: { x: "https://blob/opaque" }, assetKinds: { x: "image" }, catalog });
    const ir = edlToRenderIR(emptyEdl2("x", 120_000), env, resolver);
    expect((ir.scene.layers[0].items[0] as ClipNode).source.mediaKind).toBe("image");
  });

  test("video stays video, and the kind is part of the clip's cache key", () => {
    const asVideo = edlToRenderIR(emptyEdl2("a", 120_000), env, resolverFor({ a: "https://blob/a.mp4" }));
    const asImage = edlToRenderIR(emptyEdl2("a", 120_000), env, resolverFor({ a: "https://blob/a.png" }));
    expect((asVideo.scene.layers[0].items[0] as ClipNode).source.mediaKind).toBe("video");
    expect(asVideo.rootHash).not.toBe(asImage.rootHash);
  });
});

describe("face placement falls back to something you can SEE", () => {
  test("an overlay placed on a face renders centered, not 0×0, when no face track exists", () => {
    let edl = emptyEdl2("a", 300_000);
    edl = reduceBatch(edl, [
      { type: "ADD_OVERLAY", overlayKey: "overlay-skull", window: { startTick: 0, endTick: 60_000 }, placement: { mode: "face", trackFaceId: "face_1" }, params: {} },
    ] as EditCommand[]).edl;
    const [overlay] = overlaysOf(edlToRenderIR(edl, env, resolverFor()).scene.layers);
    expect(overlay.placement).toEqual({ mode: "static", x: 576, y: 324, w: 768, h: 432 });
  });

  test("a resolver WITH face keyframes still gets face mode", () => {
    let edl = emptyEdl2("a", 300_000);
    edl = reduceBatch(edl, [
      { type: "ADD_OVERLAY", overlayKey: "overlay-skull", window: { startTick: 0, endTick: 60_000 }, placement: { mode: "face", trackFaceId: "face_1" }, params: {} },
    ] as EditCommand[]).edl;
    const resolver = { ...resolverFor(), faceTrack: (_a: string, f: string) => ({ trackId: f, keyframes: [{ tick: 0, bbox: [10, 20, 30, 40] as [number, number, number, number], conf: 0.9 }] }) };
    const [overlay] = overlaysOf(edlToRenderIR(edl, env, resolver).scene.layers);
    expect(overlay.placement.mode).toBe("face");
  });
});

describe("determinism through the real resolver", () => {
  test("same EDL ⇒ identical IR and rootHash (the WYSIWYG/cache contract)", () => {
    const edl = seedWithLook("look-vhs-dream");
    expect(edlToRenderIR(edl, env, resolverFor())).toEqual(edlToRenderIR(edl, env, resolverFor()));
  });
});
