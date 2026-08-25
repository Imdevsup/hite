/**
 * objects/Backdrop.ts — L0 (z −1400): gradient fog wall, slow drifting nebula, sparse stars.
 *
 * A back-faced sphere around the camera with a procedural fragment: a vertical gradient, a slow
 * fbm nebula, a violet bloom upper-left that the curl rises into, and a sparse star field. It takes
 * the live fog colour so the grade in tool call #8 re-tints the whole world. 2% parallax comes free
 * from the sphere being camera-centred but not camera-locked.
 */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from "three";

const VERT = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uFog;
uniform vec3 uTint;
uniform float uTime;
uniform float uNebula;
varying vec3 vP;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
  return n;
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vP);
  float h = d.y * 0.5 + 0.5;
  vec3 c = mix(uFog * 0.9, uFog * 2.6 + vec3(0.01, 0.01, 0.03), pow(h, 1.5));
  // Nebula, drifting slowly.
  float n = fbm(d * 3.2 + vec3(uTime * 0.012, uTime * 0.006, 0.0));
  float n2 = fbm(d * 7.0 - vec3(0.0, uTime * 0.01, uTime * 0.008));
  vec3 neb = uTint * (0.16 * pow(n, 2.2) + 0.08 * pow(n2, 3.0));
  c += neb * uNebula;
  // The violet bloom upper-left the curl rises into.
  c += uTint * 0.9 * pow(max(0.0, 1.0 - length(d.xy - vec2(-0.22, 0.18)) * 1.5), 3.0);
  // Sparse stars.
  vec3 sp = d * 260.0;
  float s = hash(floor(sp));
  float star = step(0.9985, s) * pow(fract(s * 91.7), 2.0);
  float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + s * 60.0);
  c += vec3(0.8, 0.9, 1.0) * star * twinkle * 0.6 * smoothstep(-0.2, 0.4, d.y);
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Backdrop {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;

  constructor() {
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uFog: { value: new Color("#05060C") },
        uTint: { value: new Color("#3A2A8C") },
        uTime: { value: 0 },
        uNebula: { value: 1 },
      },
      side: BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new Mesh(new SphereGeometry(2400, 40, 28), material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.mesh.name = "backdrop";
  }

  update(time: number, fog: Color, cameraX: number, cameraY: number, cameraZ: number): void {
    this.mesh.material.uniforms.uTime.value = time;
    (this.mesh.material.uniforms.uFog.value as Color).copy(fog);
    // 2% parallax: the sphere follows the camera at 98% so the far field barely moves.
    this.mesh.position.set(cameraX * 0.98, cameraY * 0.98, cameraZ * 0.98);
  }

  setTint(color: Color): void {
    (this.mesh.material.uniforms.uTint.value as Color).copy(color);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
