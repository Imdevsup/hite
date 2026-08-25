/**
 * `n8ao` ships no type declarations. This covers exactly the surface `components/landing3d/stage/
 * Post.ts` uses — the post-processing-compatible pass and its configuration object — typed from the
 * package's own README and the defaults in `dist/N8AO.js` (aoRadius 5, distanceFalloff 1,
 * intensity 5, colour black, gammaCorrection true).
 */
declare module "n8ao" {
  import type { Camera, Color, Scene } from "three";
  import { Pass } from "postprocessing";

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    denoiseSamples: number;
    denoiseRadius: number;
    aoSamples: number;
    renderMode: 0 | 1 | 2 | 3 | 4;
    accumulate: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    readonly configuration: N8AOConfiguration;
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
}
