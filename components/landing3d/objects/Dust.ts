/**
 * objects/Dust.ts — L1 (z −700 … +200): volumetric motes on one Points geometry, additive.
 *
 * Drift is authored in the vertex shader from a seed per particle, so the CPU never touches the
 * buffer. `uStreak` stretches every mote upward for Act 2's descent (the camera travels down, the
 * dust streaks past it); `uWake` is the ribbon's nose in world space so motes near it are pushed
 * aside — secondary motion the spec asks for and nobody sees unless it is missing. Tinted by the
 * live palette so the grade reaches it too.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from "three";

const COUNT = 1400;

const VERT = /* glsl */ `
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uStreak;
uniform vec3 uWake;
uniform float uWakeStrength;
uniform float uBeat;
uniform float uPixelRatio;
varying float vAlpha;
varying float vStreak;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vec3 p = position;
  float t = uTime * (0.06 + hash(aSeed) * 0.08);
  p.x += sin(t + aSeed * 6.0) * 6.0;
  p.y += cos(t * 0.8 + aSeed * 3.0) * 4.0 + sin(uTime * 0.05 + aSeed) * 2.0;
  p.z += sin(t * 0.6 + aSeed * 9.0) * 5.0;
  // Upward streak during the descent.
  p.y += uStreak * (hash(aSeed * 3.1) * 180.0);
  // Pushed aside by the ribbon's nose.
  vec3 away = p - uWake;
  float d = length(away);
  float push = uWakeStrength * smoothstep(60.0, 0.0, d) * 18.0;
  p += normalize(away + vec3(0.001)) * push;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_PointSize = aSize * uPixelRatio * (380.0 / max(depth, 40.0)) * (1.0 + 0.15 * pow(1.0 - uBeat, 5.0));
  gl_Position = projectionMatrix * mv;
  vAlpha = smoothstep(2200.0, 300.0, depth) * (0.35 + 0.65 * hash(aSeed * 7.7));
  vStreak = uStreak;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vAlpha;
varying float vStreak;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // Stretch the disc vertically while streaking.
  c.y /= (1.0 + vStreak * 4.0);
  float d = length(c);
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  gl_FragColor = vec4(uColor * (0.6 + 0.4 * (1.0 - d * 2.0)), a * 0.32);
}
`;

export class Dust {
  readonly points: Points<BufferGeometry, ShaderMaterial>;

  constructor(pixelRatio: number) {
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT);
    const size = new Float32Array(COUNT);
    let s = 17;
    const rnd = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (rnd() - 0.5) * 900;
      pos[i * 3 + 1] = (rnd() - 0.5) * 520 - 60;
      pos[i * 3 + 2] = -700 + (rnd() - 0.2) * 900;
      seed[i] = rnd() * 1000;
      size[i] = 0.9 + rnd() * 2.6;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(pos, 3));
    geometry.setAttribute("aSeed", new BufferAttribute(seed, 1));
    geometry.setAttribute("aSize", new BufferAttribute(size, 1));
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uStreak: { value: 0 },
        uWake: { value: new Vector3(0, 0, -9999) },
        uWakeStrength: { value: 0 },
        uBeat: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uColor: { value: new Color("#9FB4FF") },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.name = "dust";
  }

  update(time: number, color: Color, pixelRatio: number): void {
    const u = this.points.material.uniforms;
    u.uTime.value = time;
    (u.uColor.value as Color).copy(color);
    u.uPixelRatio.value = pixelRatio;
  }

  setWake(position: Vector3, strength: number): void {
    (this.points.material.uniforms.uWake.value as Vector3).copy(position);
    this.points.material.uniforms.uWakeStrength.value = strength;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
