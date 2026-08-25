/**
 * stage/FocusRig.ts — where the lens is focused, and rack focus between layers.
 *
 * The DOF effect takes a world-space focus distance. The rig tracks a focus TARGET (a point on the
 * ribbon at L3, or the chat panel at L2) and exposes `focus` as a tweenable 0..1 blend between two
 * targets, so a 700ms rack from the ribbon to the panel and back is one GSAP tween on one number,
 * and the bokeh genuinely blooms on the ribbon's highlights while the panel is sharp.
 */
import { Vector3, type PerspectiveCamera } from "three";
import type { DepthOfFieldEffect } from "postprocessing";

export class FocusRig {
  /** 0 → `a` is in focus, 1 → `b` is in focus. Tweened by the choreography. */
  blend = 0;
  readonly a = new Vector3();
  readonly b = new Vector3();
  /** Depth of field range as a fraction of focus distance. Smaller = shallower. */
  rangeFraction = 0.42;
  private readonly tmp = new Vector3();
  private readonly dof: DepthOfFieldEffect;
  private readonly camera: PerspectiveCamera;

  constructor(dof: DepthOfFieldEffect, camera: PerspectiveCamera) {
    this.dof = dof;
    this.camera = camera;
  }

  update(): void {
    this.tmp.copy(this.a).lerp(this.b, this.blend);
    const distance = Math.max(2, this.camera.position.distanceTo(this.tmp));
    const coc = this.dof.cocMaterial;
    coc.worldFocusDistance = distance;
    coc.worldFocusRange = Math.max(20, distance * this.rangeFraction);
  }
}
