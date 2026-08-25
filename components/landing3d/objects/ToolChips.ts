/**
 * objects/ToolChips.ts — L5: the tool-call chips that eject from the panel and land on the ribbon.
 *
 * Three stages per chip, all driven by ONE progress number so scrubbing backward replays them:
 *   0.00–0.45  eject: off the rail, arcing toward the camera and over the top of the ribbon,
 *              stretched along its velocity, billboarded.
 *   0.45–0.62  land: decelerate onto the exact clip range, rotate flat, squash into a marker.
 *   0.62–1.00  discharge: the glow dumps into the ribbon (an impact ring), the chip dims to a tag.
 *
 * Chips are monospace, glassy, with a coloured left rule keyed to category. They show the call
 * signature, never prose. Each is one canvas texture on one plane.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { TOOL_CALLS, type ToolCall } from "../choreography/script";

// World units. Chips fly between the panel and the ribbon, so a chip is much closer to the lens
// than the timeline is: sized like the timeline it renders several times over-large on screen.
const CHIP_W = 19;
const CHIP_H = 3.1;
const PX = 34;

const RULE: Record<ToolCall["category"], string> = {
  analysis: "#22D3EE",
  edit: "#FF4D7D",
  advisor: "#6E56F8",
  registry: "#F5A524",
  terminal: "#34D399",
};

export interface ChipFlight {
  /** World-space start (the rail slot), target (the clip range on the ribbon). */
  readonly from: Vector3;
  readonly to: Vector3;
}

interface Chip {
  readonly call: ToolCall;
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly glow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly prev: Vector3;
  progress: number;
}

function bezier3(a: Vector3, b: Vector3, c: Vector3, t: number, out: Vector3): Vector3 {
  const it = 1 - t;
  return out.set(
    it * it * a.x + 2 * it * t * b.x + t * t * c.x,
    it * it * a.y + 2 * it * t * b.y + t * t * c.y,
    it * it * a.z + 2 * it * t * b.z + t * t * c.z,
  );
}

export class ToolChips {
  readonly group = new Group();
  readonly chips: Chip[] = [];
  /** Everything that should bloom. */
  readonly bloomTargets: Mesh[] = [];
  /** Chromatic-aberration demand this frame: peak speed of any chip in flight, 0..1. */
  aberrationDemand = 0;
  private readonly flights = new Map<string, ChipFlight>();
  private readonly geometry = new PlaneGeometry(CHIP_W, CHIP_H);
  private readonly ringGeometry = new RingGeometry(3, 3.6, 48);
  private readonly glowGeometry = new PlaneGeometry(CHIP_W * 1.5, CHIP_H * 3);
  private readonly tmp = new Vector3();
  private readonly ctrl = new Vector3();
  private readonly vel = new Vector3();
  private readonly camRight = new Vector3();
  private readonly camUp = new Vector3();

  constructor(mono: string) {
    for (const call of TOOL_CALLS) {
      const tex = this.rasterise(call, mono);
      const material = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 });
      const mesh = new Mesh(this.geometry, material);
      mesh.name = `chip:${call.id}`;
      mesh.renderOrder = 20;
      mesh.visible = false;
      const ring = new Mesh(this.ringGeometry, new MeshBasicMaterial({ color: new Color(RULE[call.category]), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
      ring.visible = false;
      ring.renderOrder = 19;
      const glow = new Mesh(this.glowGeometry, new MeshBasicMaterial({ color: new Color(RULE[call.category]), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
      glow.visible = false;
      glow.renderOrder = 18;
      this.group.add(mesh, ring, glow);
      this.chips.push({ call, mesh, ring, glow, prev: new Vector3(), progress: 0 });
      this.bloomTargets.push(mesh, ring, glow);
    }
  }

  private rasterise(call: ToolCall, mono: string): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = CHIP_W * PX;
    canvas.height = CHIP_H * PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("landing3d: 2D canvas context unavailable");
    ctx.scale(PX, PX);
    const r = 0.7;
    ctx.fillStyle = "rgba(12,14,22,0.88)";
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(CHIP_W, 0, CHIP_W, CHIP_H, r);
    ctx.arcTo(CHIP_W, CHIP_H, 0, CHIP_H, r);
    ctx.arcTo(0, CHIP_H, 0, 0, r);
    ctx.arcTo(0, 0, CHIP_W, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 0.08;
    ctx.stroke();
    ctx.fillStyle = RULE[call.category];
    ctx.fillRect(0.28, 0.5, 0.3, CHIP_H - 1.0);
    ctx.fillStyle = "#F2F4F8";
    ctx.font = `500 1.35px ${mono}`;
    ctx.textBaseline = "middle";
    ctx.fillText(call.signature, 1.1, CHIP_H / 2 + 0.05, CHIP_W - 1.8);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 4;
    return tex;
  }

  setFlight(id: string, flight: ChipFlight): void {
    this.flights.set(id, flight);
  }

  setProgress(id: string, progress: number): void {
    const chip = this.chips.find((c) => c.call.id === id);
    if (chip) chip.progress = progress;
  }

  update(camera: PerspectiveCamera, dt: number): void {
    this.aberrationDemand = 0;
    camera.matrixWorld.extractBasis(this.camRight, this.camUp, this.tmp);
    for (const chip of this.chips) {
      const flight = this.flights.get(chip.call.id);
      const p = chip.progress;
      const visible = !!flight && p > 0.001 && p < 1.3;
      chip.mesh.visible = visible;
      chip.ring.visible = visible;
      chip.glow.visible = visible;
      if (!visible || !flight) continue;

      const fly = Math.min(1, p / 0.45);
      const land = Math.min(1, Math.max(0, (p - 0.45) / 0.17));
      const discharge = Math.min(1, Math.max(0, (p - 0.62) / 0.38));

      // Arc from the rail, out toward the camera and over the ribbon, down onto the clip.
      const toCam = this.tmp.copy(camera.position).sub(flight.to).normalize();
      this.ctrl.copy(flight.from).lerp(flight.to, 0.5).addScaledVector(toCam, 90).add(this.camUp.clone().multiplyScalar(40));
      const eased = 1 - Math.pow(1 - fly, 2.6);
      bezier3(flight.from, this.ctrl, flight.to, eased, chip.mesh.position);
      // Settle the last 4 units with the landing.
      chip.mesh.position.addScaledVector(toCam, (1 - land) * 6 + 4 * (1 - discharge));

      // Velocity → streak + aberration demand.
      if (dt > 0) {
        this.vel.copy(chip.mesh.position).sub(chip.prev).divideScalar(dt);
        const speed = this.vel.length();
        const streak = Math.min(0.5, speed / 2400) * (1 - land);
        chip.mesh.scale.set(1 + streak, 1 - 0.55 * land * (1 - discharge * 0.4), 1);
        this.aberrationDemand = Math.max(this.aberrationDemand, Math.min(1, speed / 1400) * (1 - land));
      }
      chip.prev.copy(chip.mesh.position);

      // Billboard in flight, flat on landing (the ribbon faces the camera, so both look alike; the
      // roll along the velocity is what sells the flight).
      chip.mesh.quaternion.copy(camera.quaternion);
      const roll = (1 - land) * Math.atan2(this.vel.dot(this.camUp), this.vel.dot(this.camRight)) * 0.12;
      chip.mesh.rotateZ(Number.isFinite(roll) ? roll : 0);

      const mat = chip.mesh.material;
      // Land, discharge, and leave: a chip that stays is clutter over the timeline.
      mat.opacity = Math.min(1, fly * 3) * (1 - discharge);

      chip.ring.position.copy(flight.to).addScaledVector(toCam, 1.5);
      chip.ring.quaternion.copy(camera.quaternion);
      const ringScale = 1 + discharge * 3.5;
      chip.ring.scale.set(ringScale, ringScale, 1);
      chip.ring.material.opacity = discharge > 0 ? (1 - discharge) * 0.9 : 0;

      chip.glow.position.copy(chip.mesh.position).addScaledVector(toCam, -0.5);
      chip.glow.quaternion.copy(camera.quaternion);
      const burst = Math.sin(Math.min(1, discharge * 1.6) * Math.PI);
      chip.glow.material.opacity = 0.08 * (1 - land) + burst * 0.35;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.ringGeometry.dispose();
    this.glowGeometry.dispose();
    for (const c of this.chips) {
      c.mesh.material.map?.dispose();
      c.mesh.material.dispose();
      c.ring.material.dispose();
      c.glow.material.dispose();
    }
  }
}
