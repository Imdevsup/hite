/**
 * objects/Furniture.ts — the playhead (L3). Everything else that reads as an NLE — ruler, ticks,
 * timecodes, markers, in/out points, fade handles, transition bowties, keyframe diamonds, caption
 * ticks, track lanes — is painted by the ribbon shader on lanes that ride the same deformation.
 *
 * The playhead is the one piece of furniture that moves independently of the state texture: a
 * vertical line spanning every lane with a triangular head, a soft glow, and the practical light
 * attached to it. Its timecode readout is DOM (see ui/hud.ts), positioned from the projection of
 * this mesh.
 */
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShapeGeometry, Shape, Vector3 } from "three";

export class Playhead {
  readonly group = new Group();
  readonly line: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly head: Mesh<ShapeGeometry, MeshBasicMaterial>;
  readonly glow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly bloomTargets: Mesh[] = [];
  /** Top of the line in world space — where the timecode readout sits. */
  readonly tip = new Vector3();
  opacity = 0;

  constructor(spanHeight: number) {
    this.line = new Mesh(new PlaneGeometry(0.45, spanHeight), new MeshBasicMaterial({ color: "#F2F4F8", transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
    const tri = new Shape();
    tri.moveTo(-2.2, 0);
    tri.lineTo(2.2, 0);
    tri.lineTo(0, -3.2);
    tri.closePath();
    this.head = new Mesh(new ShapeGeometry(tri), new MeshBasicMaterial({ color: "#F2F4F8", transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
    this.head.position.y = spanHeight / 2 + 2.6;
    this.glow = new Mesh(new PlaneGeometry(6, spanHeight + 8), new MeshBasicMaterial({ color: "#7FE6FF", transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
    this.glow.position.z = -0.2;
    this.group.add(this.glow, this.line, this.head);
    this.group.visible = false;
    this.group.renderOrder = 8;
    this.bloomTargets.push(this.line, this.head);
  }

  /** Place at a world point on the ribbon's V1 spine; the group is already vertical. */
  place(position: Vector3): void {
    this.group.position.copy(position);
    this.group.position.z += 0.6;
    this.tip.copy(this.group.position);
    this.tip.y += (this.line.geometry.parameters.height ?? 0) / 2 + 6;
  }

  update(): void {
    this.group.visible = this.opacity > 0.001;
    this.line.material.opacity = this.opacity;
    this.head.material.opacity = this.opacity;
    this.glow.material.opacity = this.opacity * 0.18;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.head.geometry.dispose();
    this.head.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
  }
}
