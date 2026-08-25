import { describe, expect, test } from "vitest";
import { edlToRenderIR } from "./compile";
import type { RenderEnv, MediaResolver, ClipNode, TransitionNode, EffectNode, TrackNode } from "./ir";
import { emptyEdl2 } from "@/lib/edl/schema";
import { reduceBatch } from "@/lib/edl/reducer";
import { ticksToFrame } from "@/lib/edl/time";
import type { EditCommand } from "@/lib/edl/commands";

/**
 * Compiler unit tests against a HAND-WRITTEN resolver — good for isolating compiler behaviour, blind
 * to whether the real `makeMediaResolver` supplies what the compiler expects. It did not: the
 * look-recipe P0 (dropped target/startMs/endMs/placement, every `{{…}}` resolved to 0) passed every
 * test in this file. Anything about the CONTRACT between the manifest, the resolver and the compiler
 * belongs in compile.manifest.test.ts, which drives the real ones.
 */
const env: RenderEnv = { aspect: "16:9", quality: "full", tier: "pro", fps: 30, engineFingerprint: "remotion@4.0.450/chrome-x" };
const resolver: MediaResolver = {
  urlForAsset: (a, k) => `https://blob/${a}.${k}.mp4`,
  faceTrack: (_a, f) => ({ trackId: f, keyframes: [] }),
  lookRecipe: () => ({ steps: [] }),
  registryEntry: () => ({ engine: "remotion" }),
  recipeVars: () => ({}),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clipIds = (e: any) => e.tracks[0].items.filter((i: any) => i.schema === "Clip.1").map((c: any) => c.id);

describe("edlToRenderIR", () => {
  test("compiles seed EDL; frames materialized once; deterministic", () => {
    const edl = emptyEdl2("a", 300_000); // 10s @ 30fps → 300 frames
    const ir1 = edlToRenderIR(edl, env, resolver);
    const ir2 = edlToRenderIR(edl, env, resolver);
    expect(ir1).toEqual(ir2);
    expect(ir1.rootHash).toBe(ir2.rootHash);
    expect(ir1.durationInFrames).toBe(300);
    const clip = ir1.scene.layers[0].items[0] as ClipNode;
    expect(clip.startFrame).toBe(0);
    expect(clip.endFrame).toBe(300);
    expect(clip.source.url).toBe("https://blob/a.full.mp4");
    expect(clip.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("proxy quality flips refKey + resolution and yields a disjoint cache namespace", () => {
    const edl = emptyEdl2("a", 300_000);
    const full = edlToRenderIR(edl, env, resolver);
    const proxy = edlToRenderIR(edl, { ...env, quality: "proxy" }, resolver);
    expect(proxy.resolution.width).toBeLessThan(full.resolution.width);
    expect((proxy.scene.layers[0].items[0] as ClipNode).source.refKey).toBe("proxy");
    expect(proxy.rootHash).not.toBe(full.rootHash);
  });

  test("transition offset per §6.5 (c1 4s, c2 6s, 0.4s xfade @30fps)", () => {
    let edl = emptyEdl2("a", 120_000); // c0 0..120000 = 4s
    edl = reduceBatch(edl, [{ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 120_000, inTick: 0, outTick: 180_000 }] as EditCommand[]).edl;
    const ids = clipIds(edl);
    edl = reduceBatch(edl, [{ type: "ADD_TRANSITION", betweenClipIds: [ids[0], ids[1]], transitionKey: "fade", durationTicks: 12_000, params: {} }] as EditCommand[]).edl;
    const ir = edlToRenderIR(edl, env, resolver);
    const trans = ir.scene.layers[0].items.find((n) => n.kind === "transition") as TransitionNode;
    expect(trans.offsetTick).toBe(108_000); // 120000 - 12000 — marks where a crossfade WOULD begin
    expect(trans.offsetFrame).toBe(108);
    expect(trans.fromHash).not.toBe("");
    expect(trans.toHash).not.toBe("");
    // v1: transitions are NOT rendered (HiteRoot draws them null) and clips are laid end-to-end, so
    // the output is the FULL sequential length — NOT shortened by the transition. Shortening it made
    // durationInFrames < the last clip's endFrame and silently dropped the final clip's tail.
    expect(ir.durationInFrames).toBe(ticksToFrame((120_000 + 180_000) as number, 30)); // 300, no dropped tail
  });

  test("no clip's endFrame exceeds durationInFrames (no silently-dropped tail, with a transition)", () => {
    let edl = emptyEdl2("a", 120_000);
    edl = reduceBatch(edl, [{ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 120_000, inTick: 0, outTick: 180_000 }] as EditCommand[]).edl;
    const ids = clipIds(edl);
    edl = reduceBatch(edl, [{ type: "ADD_TRANSITION", betweenClipIds: [ids[0], ids[1]], transitionKey: "fade", durationTicks: 12_000, params: {} }] as EditCommand[]).edl;
    const ir = edlToRenderIR(edl, env, resolver);
    const clipNodes = ir.scene.layers.flatMap((l) => l.items).filter((n): n is ClipNode => n.kind === "clip");
    expect(clipNodes.length).toBeGreaterThan(0);
    for (const c of clipNodes) {
      expect(c.endFrame).toBeLessThanOrEqual(ir.durationInFrames);
    }
  });

  test("look expansion evaluates arithmetic placeholders in ticks (fixes the {{dropMs_minus}} bug)", () => {
    const lookResolver: MediaResolver = {
      ...resolver,
      lookRecipe: () => ({ steps: [{ kind: "effect", effectKey: "zoom-punch", params: { scale: "{{intensity_times_2}}", startTick: "{{dropTick_minus_48000}}" } }] }),
      recipeVars: () => ({ intensity: 1.5, dropTick: 100_000 }),
    };
    let edl = emptyEdl2("a", 300_000);
    edl = reduceBatch(edl, [{ type: "COMPOSE_LOOK", lookKey: "look-test" }] as EditCommand[]).edl;
    const ir = edlToRenderIR(edl, env, lookResolver);
    const clip = ir.scene.layers[0].items[0] as ClipNode;
    const fx = clip.effects.find((e) => e.effectKey === "zoom-punch") as EffectNode;
    expect(fx.params.scale).toBe(3); // 1.5 * 2
    expect(fx.params.startTick).toBe(52_000); // 100000 - 48000
  });

  test("LUT effect resolves its .cube path and lut engine", () => {
    const lutResolver: MediaResolver = { ...resolver, registryEntry: () => ({ engine: "lut", lutFile: "/luts/a24.cube" }) };
    let edl = emptyEdl2("a", 300_000);
    edl = reduceBatch(edl, [{ type: "ADD_EFFECT", target: "all", effectKey: "lut-a24", params: {} }] as EditCommand[]).edl;
    const ir = edlToRenderIR(edl, env, lutResolver);
    const fx = (ir.scene.layers[0].items[0] as ClipNode).effects[0];
    expect(fx.engine).toBe("lut");
    expect(fx.params.lutFile).toBe("/luts/a24.cube");
  });

  test("free tier injects exactly one watermark overlay", () => {
    const ir = edlToRenderIR(emptyEdl2("a", 300_000), { ...env, tier: "free" }, resolver);
    const overlayTrack = ir.scene.layers.find((l: TrackNode) => l.trackKind === "overlay");
    expect(overlayTrack).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(overlayTrack!.items.filter((n: any) => n.overlayKey === "system-watermark")).toHaveLength(1);
  });
});
