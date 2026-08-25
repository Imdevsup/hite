import { describe, expect, test } from "vitest";
import {
  RENDERABLE_EFFECT_KEYS,
  isRenderableEffectKey,
  partitionRenderableEffectKeys,
  isRenderableTransitionKey,
} from "./renderable";
import { getEffectRenderer } from "./registry";
import { validateManifest } from "@/lib/registry/catalog";
import manifestData from "@/public/registry/manifest.json";

/**
 * The canonical answer to "can the pipeline actually paint this key?", checked against the REAL
 * manifest. `ClipFx` skips an effect with no renderer, the reducer accepts any key, and the advisors
 * surface every key to the model — so an unrenderable key travels all the way to a success message
 * over a pixel-identical video. These tests pin which keys are in that hole so the layers above can
 * filter them out and so a newly-registered renderer is reflected automatically.
 */
const catalog = validateManifest(manifestData);

describe("RENDERABLE_EFFECT_KEYS is DERIVED from the renderer registry", () => {
  test("every key in the set really resolves to a renderer", () => {
    expect(RENDERABLE_EFFECT_KEYS.size).toBeGreaterThan(0);
    for (const key of RENDERABLE_EFFECT_KEYS) expect(getEffectRenderer(key), key).toBeDefined();
  });

  test("isRenderableEffectKey agrees with the set and with getEffectRenderer", () => {
    for (const key of ["chromatic-flash", "zoom-punch", "lut-a24-moonlight", "curve-lift-blacks"]) {
      expect(isRenderableEffectKey(key), key).toBe(true);
      expect(RENDERABLE_EFFECT_KEYS.has(key), key).toBe(true);
    }
    expect(isRenderableEffectKey("not-a-real-key")).toBe(false);
  });
});

describe("the manifest keys the renderer CANNOT paint", () => {
  const clipEffectKeys = catalog.filter((e) => ["color", "luts", "glitch"].includes(e.category)).map((e) => e.key);

  test("every clip-effect category entry has a renderer (lint-registry enforces this at build time)", () => {
    const { unrenderable } = partitionRenderableEffectKeys(clipEffectKeys);
    expect(unrenderable).toEqual([]);
  });

  test("the audio + procedural entries are advertised but unpaintable — U5 must filter them", () => {
    // These are the keys `searchRegistry` surfaces today with no renderer behind them. If one of
    // them ever gains a renderer this test fails and the exclusion list gets shorter, deliberately.
    const noRenderer = catalog.filter((e) => !isRenderableEffectKey(e.key) && ["audio", "procedural"].includes(e.category)).map((e) => e.key);
    expect(noRenderer.sort()).toEqual(["compressor-vocal", "eq-bright", "proc-lens-flare-cool", "proc-lens-flare-warm", "reverb-plate"]);
  });

  test("look-vhs-dream's recipe references a key that is not even IN the manifest", () => {
    const recipe = catalog.find((e) => e.key === "look-vhs-dream")!.recipe as { effectKey?: string }[];
    expect(recipe.some((s) => s.effectKey === "audio-saturation-soft")).toBe(true);
    expect(catalog.some((e) => e.key === "audio-saturation-soft")).toBe(false);
    expect(isRenderableEffectKey("audio-saturation-soft")).toBe(false);
  });

  test("partitionRenderableEffectKeys splits a mixed list", () => {
    expect(partitionRenderableEffectKeys(["zoom-punch", "reverb-plate", "vignette-soft"])).toEqual({
      renderable: ["zoom-punch", "vignette-soft"],
      unrenderable: ["reverb-plate"],
    });
  });
});

describe("transitions: only the ones that render as their own name are advertised", () => {
  const transitionKeys = catalog.filter((e) => e.category === "transitions").map((e) => e.key);

  test("the honest ones (a dip / flash / streak over the cut IS the effect)", () => {
    for (const key of ["trans-fade", "trans-flash-cut", "trans-flash-cut-fast", "trans-burn-to-black", "trans-burn-to-white-fast", "trans-glitch-cut", "trans-rgb-split-cut", "trans-whip-pan-l", "trans-whip-pan-r-fast"]) {
      expect(isRenderableTransitionKey(key), key).toBe(true);
    }
  });

  test("the over-promising ones — every one needs the two clips' pixels blended or moved", () => {
    for (const key of ["trans-crossfade", "trans-crossfade-fast", "trans-dissolve", "trans-wipe-left", "trans-slide-right", "trans-zoom-in", "trans-cube-rotate-l"]) {
      expect(isRenderableTransitionKey(key), key).toBe(false);
    }
  });

  test("`crossfade` is NOT matched by the `fade` stem (substring matching would let it through)", () => {
    expect(isRenderableTransitionKey("trans-fade")).toBe(true);
    expect(isRenderableTransitionKey("trans-crossfade")).toBe(false);
  });

  test("the honest list is a real, non-empty subset of the manifest's transitions", () => {
    const honest = transitionKeys.filter(isRenderableTransitionKey);
    expect(honest.length).toBeGreaterThan(0);
    expect(honest.length).toBeLessThan(transitionKeys.length);
  });
});
