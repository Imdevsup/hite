/**
 * stage/Lighting.ts — three-point rig plus one moving practical (spec §9).
 *
 * Key: cool white from upper-left, raking along the ribbon. Fill: dim violet from lower-right.
 * Rim: bright cyan directly behind the ribbon — it does more work than any other light, because
 * it is what flashes on the edge when the ribbon rolls through the curl. Practical: a small point
 * light that travels with the playhead and lights the local clips as it passes.
 *
 * The ribbon is a ShaderMaterial and reads `keyDirection` as a uniform; the lights here shade the
 * panel, the chips and the cards, which are standard materials. Both read from the same vectors so
 * the grade in tool call #8 can re-tint the whole world in one place: `applyGrade()`.
 */
import { Color, DirectionalLight, Group, PointLight, Vector3, type Scene } from "three";

export interface WorldPalette {
  readonly key: Color;
  readonly fill: Color;
  readonly rim: Color;
  readonly fog: Color;
  readonly dust: Color;
}

export const PALETTE_PRE: WorldPalette = {
  key: new Color("#DCE8FF"),
  fill: new Color("#4B36C9"),
  rim: new Color("#22D3EE"),
  fog: new Color("#05060C"),
  dust: new Color("#9FB4FF"),
};

export const PALETTE_GRADED: WorldPalette = {
  key: new Color("#C9E3EA"),
  fill: new Color("#2A2F9E"),
  rim: new Color("#19B8B0"),
  fog: new Color("#040A0E"),
  dust: new Color("#7FD6D0"),
};

export class Lighting {
  readonly group = new Group();
  readonly key: DirectionalLight;
  readonly fill: PointLight;
  readonly rim: DirectionalLight;
  readonly practical: PointLight;
  readonly keyDirection = new Vector3(-0.55, 0.72, 0.42).normalize();
  /** The live, graded palette. Read by the ribbon, dust and backdrop every frame. */
  readonly live: WorldPalette = {
    key: PALETTE_PRE.key.clone(),
    fill: PALETTE_PRE.fill.clone(),
    rim: PALETTE_PRE.rim.clone(),
    fog: PALETTE_PRE.fog.clone(),
    dust: PALETTE_PRE.dust.clone(),
  };

  constructor(scene: Scene) {
    this.key = new DirectionalLight(this.live.key, 2.2);
    this.key.position.copy(this.keyDirection).multiplyScalar(400);
    this.fill = new PointLight(this.live.fill, 1.4, 900, 1.2);
    this.fill.position.set(180, -140, 160);
    this.rim = new DirectionalLight(this.live.rim, 3.2);
    this.rim.position.set(20, 30, -420);
    this.practical = new PointLight("#DFF6FF", 0, 60, 2);
    this.group.add(this.key, this.fill, this.rim, this.practical);
    scene.add(this.group);
  }

  /** 0 = pre-grade palette, 1 = the Halide-style teal/indigo world after apply_grade. */
  applyGrade(amount: number): void {
    const a = Math.min(1, Math.max(0, amount));
    this.live.key.copy(PALETTE_PRE.key).lerp(PALETTE_GRADED.key, a);
    this.live.fill.copy(PALETTE_PRE.fill).lerp(PALETTE_GRADED.fill, a);
    this.live.rim.copy(PALETTE_PRE.rim).lerp(PALETTE_GRADED.rim, a);
    this.live.fog.copy(PALETTE_PRE.fog).lerp(PALETTE_GRADED.fog, a);
    this.live.dust.copy(PALETTE_PRE.dust).lerp(PALETTE_GRADED.dust, a);
    this.key.color.copy(this.live.key);
    this.fill.color.copy(this.live.fill);
    this.rim.color.copy(this.live.rim);
  }

  /** Park the practical on the playhead. Intensity 0 hides it. */
  setPractical(position: Vector3, intensity: number): void {
    this.practical.position.copy(position);
    this.practical.intensity = intensity;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
