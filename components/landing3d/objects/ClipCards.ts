/**
 * objects/ClipCards.ts — L4: the six registry results that fan out of `searchRegistry`.
 *
 * One InstancedMesh, one atlas. Each card is a procedural poster (never footage) with its own
 * filename-style tag in the top-left, exactly like the clips. Two dim out as rejected; the other
 * four fly down and dock onto V2 with a magnetic snap. `fan` and per-card `dock` are the only
 * tweened numbers.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { DEMO_KEYS } from "../choreography/script";

export const CARD_COUNT = 6;
const CARD_W = 30;
const CARD_H = 17;
const PX = 12;

const CARD_NAMES = [
  `${DEMO_KEYS.overlay}`,
  "overlay-scan-lines",
  `${DEMO_KEYS.overlay}`,
  "overlay-lightning",
  `${DEMO_KEYS.overlay}`,
  "overlay-scan-lines",
];
/** Indices that get rejected. */
const REJECTED = new Set([1, 3]);

const VERT = /* glsl */ `
attribute float aIndex;
attribute float aDim;
varying vec2 vUv;
varying float vIndex;
varying float vDim;
void main() {
  vUv = uv;
  vIndex = aIndex;
  vDim = aDim;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform float uCount;
uniform float uOpacity;
uniform vec3 uRim;
varying vec2 vUv;
varying float vIndex;
varying float vDim;
void main() {
  vec4 c = texture2D(uAtlas, vec2((vIndex + vUv.x) / uCount, vUv.y));
  // Catch light along the top edge as the cards rotate.
  float rim = smoothstep(0.92, 1.0, vUv.y) * 0.5;
  vec3 col = mix(c.rgb, c.rgb * 0.35, vDim) + uRim * rim * (1.0 - vDim);
  gl_FragColor = vec4(col, c.a * uOpacity * (1.0 - vDim * 0.45));
}
`;

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class ClipCards {
  readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  /** Tweened. `fan` 0 → 1 spreads the arc; `dock[i]` 0 → 1 flies card i onto its V2 beat. */
  readonly anim = { fan: 0, opacity: 0, reject: 0 };
  readonly dock = new Float32Array(CARD_COUNT);
  /** Set by the choreography each frame: where the fan is centred and where each docks. */
  readonly origin = new Vector3();
  readonly dockTargets: Vector3[] = Array.from({ length: CARD_COUNT }, () => new Vector3());
  private readonly dim: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private readonly pos = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3(1, 1, 1);
  private readonly tilt = new Quaternion();
  private readonly axisY = new Vector3(0, 1, 0);

  constructor(mono: string) {
    const geometry = new PlaneGeometry(CARD_W, CARD_H);
    const index = new Float32Array(CARD_COUNT);
    for (let i = 0; i < CARD_COUNT; i++) index[i] = i;
    geometry.setAttribute("aIndex", new InstancedBufferAttribute(index, 1));
    this.dim = new InstancedBufferAttribute(new Float32Array(CARD_COUNT), 1);
    this.dim.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aDim", this.dim);
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uAtlas: { value: this.atlas(mono) },
        uCount: { value: CARD_COUNT },
        uOpacity: { value: 0 },
        uRim: { value: new Color("#7FE6FF") },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(geometry, material, CARD_COUNT);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = "clipcards";
  }

  private atlas(mono: string): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W * PX * CARD_COUNT;
    canvas.height = CARD_H * PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("landing3d: 2D canvas context unavailable");
    ctx.scale(PX, PX);
    for (let i = 0; i < CARD_COUNT; i++) {
      const x0 = i * CARD_W;
      const h1 = hash(i + 3);
      const hue = 20 + h1 * 40 + (i % 2) * 300;
      const g = ctx.createLinearGradient(x0, 0, x0 + CARD_W, CARD_H);
      g.addColorStop(0, `hsl(${hue} 70% ${22 + h1 * 10}%)`);
      g.addColorStop(1, `hsl(${hue + 40} 60% 8%)`);
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, CARD_W, CARD_H);
      // A leak / streak motif: it is an overlay, so it looks like light, not a scene.
      for (let k = 0; k < 3; k++) {
        const lg = ctx.createRadialGradient(x0 + hash(i * 5 + k) * CARD_W, hash(i * 9 + k) * CARD_H, 0, x0 + hash(i * 5 + k) * CARD_W, hash(i * 9 + k) * CARD_H, 8 + hash(k) * 10);
        lg.addColorStop(0, `hsla(${hue - 20} 90% 70% / 0.55)`);
        lg.addColorStop(1, "transparent");
        ctx.fillStyle = lg;
        ctx.fillRect(x0, 0, CARD_W, CARD_H);
      }
      if (i % 2 === 1) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        for (let y = 0; y < CARD_H; y += 0.9) ctx.fillRect(x0, y, CARD_W, 0.3);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 0.25;
      ctx.strokeRect(x0 + 0.15, 0.15, CARD_W - 0.3, CARD_H - 0.3);
      // Tag, top-left, dot + key.
      ctx.fillStyle = "rgba(4,5,10,0.6)";
      ctx.fillRect(x0 + 1, 1, 15, 2.6);
      ctx.fillStyle = "#F5A524";
      ctx.beginPath();
      ctx.arc(x0 + 2, 2.3, 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(242,244,248,0.8)";
      ctx.font = `500 1.5px ${mono}`;
      ctx.textBaseline = "middle";
      ctx.fillText(CARD_NAMES[i], x0 + 3, 2.35, 12.5);
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.anisotropy = 4;
    return tex;
  }

  update(camera: PerspectiveCamera, time: number): void {
    const { fan, opacity, reject } = this.anim;
    this.mesh.visible = opacity > 0.001;
    this.mesh.material.uniforms.uOpacity.value = opacity;
    if (!this.mesh.visible) return;
    const camQ = camera.quaternion;
    for (let i = 0; i < CARD_COUNT; i++) {
      const rejected = REJECTED.has(i);
      const spread = (i - (CARD_COUNT - 1) / 2) / ((CARD_COUNT - 1) / 2); // -1..1
      const ease = 1 - Math.pow(1 - fan, 3);
      // Fan: a 3D arc above the origin, the ends swinging back in Z.
      this.pos.set(spread * 58 * ease, 26 * ease + Math.abs(spread) * -6 * ease, -Math.abs(spread) * 14 * ease + 10);
      this.pos.add(this.origin);
      const dock = this.dock[i];
      if (!rejected && dock > 0) {
        const d = 1 - Math.pow(1 - dock, 4);
        // Overshoot for the magnetic snap.
        const snap = d + Math.sin(d * Math.PI) * 0.08 * (1 - d);
        this.pos.lerp(this.dockTargets[i], Math.min(1, snap));
      }
      // Slow rotation while fanned, settling flat as it docks.
      const yaw = Math.sin(time * 0.7 + i * 1.3) * 0.22 * ease * (1 - dock) + spread * 0.35 * ease * (1 - dock);
      this.tilt.setFromAxisAngle(this.axisY, yaw);
      this.q.copy(camQ).multiply(this.tilt);
      const sc = 0.2 + 0.8 * ease;
      const dockScale = 1 - dock * 0.22;
      this.s.set(sc * dockScale, sc * dockScale, 1);
      this.m.compose(this.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.dim.setX(i, rejected ? reject : 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dim.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material.uniforms.uAtlas.value as CanvasTexture).dispose();
    this.mesh.material.dispose();
  }
}
