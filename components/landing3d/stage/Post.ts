/**
 * stage/Post.ts — the effect chain, in the order that matters (spec §9).
 *
 *   1. N8AO        radius 8, intensity 1.4 — the curl's overlap reads as depth because of this.
 *   2. Selective bloom on the ribbon, chips, caption ticks and playhead only. Never the scene.
 *   3. Depth of field, focus driven by FocusRig. Real rack focus between L3 and L2.
 *   4. Chromatic aberration, 0.0006 at rest, spiking during chip flight and the Act 2 shockwave.
 *   5. Vignette, darkness .55, offset .3.
 *   6. Film grain, animated. What stops the gradients banding.
 *
 * Every pass has a toggle for the `?debug` harness.
 */
import {
  BlendFunction,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SelectiveBloomEffect,
  VignetteEffect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { HalfFloatType, Vector2, type Object3D } from "three";
import type { Stage } from "./Stage";

export type PassName = "ao" | "bloom" | "dof" | "aberration" | "vignette" | "grain";

export class Post {
  readonly composer: EffectComposer;
  readonly ao: N8AOPostPass;
  readonly bloom: SelectiveBloomEffect;
  readonly dof: DepthOfFieldEffect;
  readonly aberration: ChromaticAberrationEffect;
  readonly vignette: VignetteEffect;
  readonly grain: NoiseEffect;
  readonly effectPass: EffectPass;
  private readonly stage: Stage;
  private readonly unsubscribeResize: () => void;
  /** Aberration and grain are OFF by default (owner: too chaotic). The harness can still toggle them. */
  readonly enabled: Record<PassName, boolean> = {
    ao: true,
    bloom: true,
    dof: true,
    aberration: false,
    vignette: true,
    grain: false,
  };
  private readonly caOffset = new Vector2(0.0006, 0.0006);

  constructor(stage: Stage) {
    this.stage = stage;
    const { renderer, scene, camera } = stage;
    const maxSamples = renderer.capabilities.maxSamples;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      multisampling: Math.min(4, maxSamples),
    });
    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new N8AOPostPass(scene, camera, stage.width * stage.pixelRatio, stage.height * stage.pixelRatio);
    this.ao.configuration.aoRadius = 8;
    this.ao.configuration.intensity = 1.4;
    this.ao.configuration.distanceFalloff = 1.2;
    this.ao.configuration.halfRes = true;
    this.ao.setQualityMode("Medium");
    this.composer.addPass(this.ao);

    this.bloom = new SelectiveBloomEffect(scene, camera, {
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 0.85,
      luminanceSmoothing: 0.18,
      intensity: 1.1,
      radius: 0.6,
      levels: 7,
    });
    this.bloom.inverted = false;
    this.bloom.ignoreBackground = true;

    this.dof = new DepthOfFieldEffect(camera, {
      worldFocusDistance: 286,
      worldFocusRange: 120,
      bokehScale: 2.0,
      resolutionScale: 0.5,
    });

    this.aberration = new ChromaticAberrationEffect({
      offset: this.caOffset,
      radialModulation: true,
      modulationOffset: 0.25,
    });

    this.vignette = new VignetteEffect({ eskil: false, offset: 0.3, darkness: 0.4 });

    this.grain = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: true });
    this.grain.blendMode.opacity.value = 0.12;

    this.effectPass = new EffectPass(camera, this.bloom, this.dof, this.aberration, this.vignette, this.grain);
    this.composer.addPass(this.effectPass);

    this.unsubscribeResize = stage.onResized((w, h, dpr) => {
      this.composer.setSize(w, h);
      this.ao.setSize(w * dpr, h * dpr);
    });
    this.composer.setSize(stage.width, stage.height);
    stage.render = (dt): void => this.composer.render(dt);
    for (const pass of Object.keys(this.enabled) as PassName[]) this.setEnabled(pass, this.enabled[pass]);
  }

  /** Add an object to the selective bloom. Only the ribbon, chips, ticks and playhead qualify. */
  bloomSelect(...objects: Object3D[]): void {
    for (const o of objects) this.bloom.selection.add(o);
  }

  bloomDeselect(...objects: Object3D[]): void {
    for (const o of objects) this.bloom.selection.delete(o);
  }

  /** Baseline 0.0006; spikes to 0.004 during chip travel, the shockwave and the curl's apex. */
  setAberration(amount: number): void {
    this.caOffset.set(amount, amount);
  }

  setBloomIntensity(intensity: number): void {
    this.bloom.intensity = intensity;
  }

  setEnabled(pass: PassName, on: boolean): void {
    this.enabled[pass] = on;
    switch (pass) {
      case "ao":
        this.ao.enabled = on;
        break;
      case "bloom":
        this.bloom.blendMode.opacity.value = on ? 1 : 0;
        break;
      case "dof":
        this.dof.blendMode.opacity.value = on ? 1 : 0;
        break;
      case "aberration":
        this.aberration.blendMode.opacity.value = on ? 1 : 0;
        break;
      case "vignette":
        this.vignette.blendMode.opacity.value = on ? 1 : 0;
        break;
      case "grain":
        this.grain.blendMode.opacity.value = on ? 0.12 : 0;
        break;
    }
  }

  dispose(): void {
    this.unsubscribeResize();
    this.stage.render = (): void => this.stage.renderer.render(this.stage.scene, this.stage.camera);
    this.composer.dispose();
    this.ao.dispose();
  }
}
