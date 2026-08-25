/**
 * objects/paths.ts — P_curl, P_flat and their derivatives, written TWICE on purpose.
 *
 * The vertex shader evaluates the path per vertex (the ribbon is one PlaneGeometry deformed on the
 * GPU, never rebuilt). The CPU needs the SAME functions to aim the camera, land tool chips on the
 * exact clip they modify, place markers and measure the curl's self-clearance. The GLSL chunk and
 * the TS functions below are line-for-line twins; `paths.test.ts` compares them numerically at 64
 * stations so they cannot drift apart.
 *
 * The shape (spec §4): three phases — a bezier approach from off-screen bottom-left, a partial
 * revolution (0.84 turns, never a loop) in a plane tilted out of the screen in two axes with a large
 * depth excursion at its apex, and a bezier exit to middle-right that dies in fog. The joins are
 * derived from the curl's own end tangents blended 42% toward the chord, which is what removes the
 * kink without whipping the approach into a spike.
 */
import { Matrix3, Matrix4, Vector3 } from "three";

export const TAU = Math.PI * 2;

/**
 * A full LOOP (owner's call, 2026-08-21, superseding the spec's partial curl): 1.2 revolutions, so
 * the strands cross on screen. What keeps it from intersecting in 3D is `advance` — the loop
 * travels 36 units along its own local X as it turns, on top of the depth excursion. Measured with
 * the probe that produced these numbers: clearance ≈ 11u against the 2× width = 9.2u floor.
 */
export const CURL = {
  turns: 1.2,
  radius: 22,
  contract: 0.12,
  tiltYDeg: 34,
  tiltXDeg: 12,
  zExcursion: 46,
  advance: 36,
  twistPeakDeg: 145,
  width: 4.6,
} as const;

export const ENTRY = new Vector3(-158, -86, 42);
/** Far enough right that the head runs clean off the frame's right edge at mid-height. */
export const EXIT = new Vector3(262, 4, -36);
/** `t` split between the three phases. Approach 0.30, curl 0.42, exit 0.28. */
export const SEG_A = 0.3;
export const SEG_B = 0.42;
const JOIN_REACH = 62;
const JOIN_MIX = 0.42;
/**
 * How much further the EXIT control reaches than the entry's.
 *
 * The two joins are not symmetric problems. The entry approaches the loop from roughly the
 * direction the loop starts in, so 62 units is enough to blend. The exit has to turn 56.5 degrees —
 * the loop finishes heading at the camera and EXIT is due right — and over 62 units that turn is a
 * crease rather than a curve.
 */
const EXIT_REACH = 1.55;

/** The flat timeline: a line along +X past both frame edges with a slight Z wave. */
export const FLAT = { half: 190, y: -20, waveAmp: 2 } as const;

/**
 * The flat line's LIVE half-width, written by the scene every frame and read by both twins. It is
 * fitted to the viewport by casting rays through the screen's edges, so the timeline spans the whole
 * x-axis on any screen, at any camera angle.
 *
 * `pFlat` takes a NORMALISED 0..1 position, not a path length: 0 is the left edge of the span and 1
 * is the right, always. The ripple delete slides clips within that span (see `ribbon.vert.ts`); it
 * can never change where the span ends.
 */
export const FLAT_LIVE: { half: number } = { half: FLAT.half };

/** The lab's hero camera, the end of the Act 1 orbit. */
export const HERO_CAM = { r: 286, theta: 0.5, phi: 1.33, target: new Vector3(-46, 4, 0) } as const;

export function sphericalToPosition(r: number, theta: number, phi: number, target: Vector3, out = new Vector3()): Vector3 {
  return out.set(
    target.x + r * Math.sin(phi) * Math.sin(theta),
    target.y + r * Math.cos(phi),
    target.z + r * Math.sin(phi) * Math.cos(theta),
  );
}

/** Ry(tiltY) · Rx(tiltX) — rotates the curl out of the screen plane. Constant; uploaded once. */
export const CURL_ROTATION: Matrix3 = (() => {
  const ry = new Matrix4().makeRotationY((CURL.tiltYDeg * Math.PI) / 180);
  const rx = new Matrix4().makeRotationX((CURL.tiltXDeg * Math.PI) / 180);
  return new Matrix3().setFromMatrix4(ry.multiply(rx));
})();

export function easeInOutQuad(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}
function dEaseInOutQuad(u: number): number {
  return u < 0.5 ? 4 * u : 4 * (1 - u);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const _l = new Vector3();
const _dl = new Vector3();

/** Curl in its own frame, then rotated. `u` in [0,1]. Writes position and d/du. */
export function curlPoint(u: number, p: Vector3, d: Vector3): void {
  const th = TAU * CURL.turns * easeInOutQuad(u);
  const dth = TAU * CURL.turns * dEaseInOutQuad(u);
  const r = CURL.radius * (1 - CURL.contract * u);
  const dr = -CURL.radius * CURL.contract;
  const s = Math.sin(Math.PI * u);
  const c = Math.cos(Math.PI * u);
  _l.set(r * Math.sin(th) + CURL.advance * easeInOutQuad(u), r * (1 - Math.cos(th)), -CURL.zExcursion * Math.pow(Math.max(s, 0), 1.6));
  _dl.set(
    dr * Math.sin(th) + r * Math.cos(th) * dth + CURL.advance * dEaseInOutQuad(u),
    dr * (1 - Math.cos(th)) + r * Math.sin(th) * dth,
    -CURL.zExcursion * 1.6 * Math.pow(Math.max(s, 1e-4), 0.6) * c * Math.PI,
  );
  p.copy(_l).applyMatrix3(CURL_ROTATION);
  d.copy(_dl).applyMatrix3(CURL_ROTATION);
}

function bezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3): Vector3 {
  const it = 1 - t;
  const a = it * it * it;
  const b = 3 * it * it * t;
  const c = 3 * it * t * t;
  const d = t * t * t;
  return out.set(
    p0.x * a + p1.x * b + p2.x * c + p3.x * d,
    p0.y * a + p1.y * b + p2.y * c + p3.y * d,
    p0.z * a + p1.z * b + p2.z * c + p3.z * d,
  );
}
function dBezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, out: Vector3): Vector3 {
  const it = 1 - t;
  return out.set(
    3 * it * it * (p1.x - p0.x) + 6 * it * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    3 * it * it * (p1.y - p0.y) + 6 * it * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
    3 * it * it * (p1.z - p0.z) + 6 * it * t * (p2.z - p1.z) + 3 * t * t * (p3.z - p2.z),
  );
}

export interface JoinPoints {
  readonly A0: Vector3; readonly A1: Vector3; readonly A2: Vector3; readonly A3: Vector3;
  readonly C0: Vector3; readonly C1: Vector3; readonly C2: Vector3; readonly C3: Vector3;
}

/**
 * The curl's end tangents, as secants over its first and last 2%.
 *
 * NOT the analytic derivative: at u → 0 the depth excursion (∝ u^1.6) outgrows the revolution
 * (∝ u²), so dP/du points almost straight into −Z and has nearly zero length. Aiming the approach
 * at that direction parks the control point in the wrong place and costs 3 units of clearance
 * (measured: 7.2u analytic vs 11.8u secant, against the 2× width = 9.2u the spec requires).
 * The secant is the direction the curl visibly leaves in, which is what the join has to match.
 */
const JOIN_SECANT = 0.02;

/** Bezier control points, derived from the curl's end tangents (spec §4 "joining without a kink"). */
export const JOINS: JoinPoints = (() => {
  const L0 = new Vector3(); const L1 = new Vector3();
  const scratchD = new Vector3(); const near = new Vector3();
  curlPoint(0, L0, scratchD);
  curlPoint(JOIN_SECANT, near, scratchD);
  const T0 = new Vector3().subVectors(near, L0).normalize();
  curlPoint(1, L1, scratchD);
  curlPoint(1 - JOIN_SECANT, near, scratchD);
  const T1 = new Vector3().subVectors(L1, near).normalize();
  const dirA = new Vector3().subVectors(L0, ENTRY).normalize().multiplyScalar(JOIN_MIX)
    .addScaledVector(T0, 1 - JOIN_MIX).normalize();
  // THE EXIT LEAVES ON THE CURL'S OWN TANGENT, with no blend toward EXIT.
  //
  // The loop finishes heading (0.58, -0.07, 0.81) — mostly toward the camera — while EXIT sits
  // almost due +X, so the run out of the loop has to turn 56.5 degrees. Blending the two directions
  // into ONE control point crammed that turn into the first third of the segment and it read as a
  // fold: two near-straight lengths of ribbon meeting at a visible crease. Leaving on the pure
  // tangent and arriving on the pure exit direction spreads the same turn across the whole segment,
  // which is the difference between a bend and a kink.
  const dirC = T1.clone();
  return {
    A0: ENTRY.clone(),
    A1: new Vector3(ENTRY.x + 82, ENTRY.y + 30, ENTRY.z - 20),
    A2: L0.clone().addScaledVector(dirA, -JOIN_REACH),
    A3: L0.clone(),
    C0: L1.clone(),
    // Both reaches are long and opposed, so the segment is a single sweep rather than an S. C2 no
    // longer carries a +30 Z offset either: that pushed the last third back toward the camera after
    // the curve had already committed to leaving, which is the second half of the same crease.
    C1: L1.clone().addScaledVector(dirC, JOIN_REACH * EXIT_REACH),
    C2: new Vector3(EXIT.x - 112, EXIT.y - 4, EXIT.z),
    C3: EXIT.clone(),
  };
})();

/** P_curl(t) and dP/dt. */
export function pCurl(t: number, p: Vector3, d: Vector3): void {
  if (t < SEG_A) {
    const u = t / SEG_A;
    bezier(JOINS.A0, JOINS.A1, JOINS.A2, JOINS.A3, u, p);
    dBezier(JOINS.A0, JOINS.A1, JOINS.A2, JOINS.A3, u, d).divideScalar(SEG_A);
  } else if (t < SEG_A + SEG_B) {
    const u = (t - SEG_A) / SEG_B;
    curlPoint(u, p, d);
    d.divideScalar(SEG_B);
  } else {
    const segC = 1 - SEG_A - SEG_B;
    const u = (t - SEG_A - SEG_B) / segC;
    bezier(JOINS.C0, JOINS.C1, JOINS.C2, JOINS.C3, u, p);
    dBezier(JOINS.C0, JOINS.C1, JOINS.C2, JOINS.C3, u, d).divideScalar(segC);
  }
}

/** P_flat(t) and dP/dt. `t` is normalised: 0 is the span's left edge, 1 is its right edge. */
export function pFlat(t: number, p: Vector3, d: Vector3): void {
  const ph = t * Math.PI * 3;
  const half = FLAT_LIVE.half;
  p.set(-half + t * 2 * half, FLAT.y, FLAT.waveAmp * Math.sin(ph));
  d.set(2 * half, 0, FLAT.waveAmp * Math.cos(ph) * Math.PI * 3);
}

/** Per-vertex morph with the unfurl delay: the far end (t = 1) straightens first. */
export function localMorph(t: number, morph: number, delay: number): number {
  const l = Math.min(1, Math.max(0, morph * (1 + delay) - (1 - t) * delay));
  return l * l * (3 - 2 * l);
}

/** 1 inside the curl, 0 on the straight runs, soft shoulders. Same window as the shader. */
export function curlWindow(t: number): number {
  return smoothstep(SEG_A - 0.07, SEG_A + 0.05, t) * (1 - smoothstep(SEG_A + SEG_B - 0.05, SEG_A + SEG_B + 0.07, t));
}

const _pc = new Vector3(); const _dc = new Vector3();
const _pf = new Vector3(); const _df = new Vector3();

/**
 * World position and tangent of the ribbon's spine for a given global morph.
 * `t` is the path coordinate (curl space); `tFlat` is the NORMALISED position along the flat span
 * and defaults to `t` for callers that are the same in both.
 */
export function evalSpine(t: number, morph: number, delay: number, p: Vector3, tangent: Vector3, tFlat = t): void {
  const m = localMorph(t, morph, delay);
  pCurl(t, _pc, _dc);
  pFlat(tFlat, _pf, _df);
  p.copy(_pc).lerp(_pf, m);
  tangent.copy(_dc).lerp(_df, m).normalize();
}

/** Minimum 3D distance between non-adjacent stations of the curled path. Spec §4 constraint 5. */
export function measureClearance(stations = 820): number {
  const pts: Vector3[] = [];
  const d = new Vector3();
  for (let i = 0; i < stations; i++) {
    const p = new Vector3();
    pCurl(i / (stations - 1), p, d);
    pts.push(p);
  }
  let clear = Infinity;
  for (let i = 0; i < stations; i += 3) {
    for (let j = i + 90; j < stations; j += 3) {
      const dist = pts[i].distanceTo(pts[j]);
      if (dist < clear) clear = dist;
    }
  }
  return clear;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   THE GLSL TWIN
   ──────────────────────────────────────────────────────────────────────────────────────────── */

export const PATH_GLSL = /* glsl */ `
#define TAU 6.283185307179586
#define PI 3.141592653589793
const float SEG_A = ${SEG_A.toFixed(4)};
const float SEG_B = ${SEG_B.toFixed(4)};

uniform vec3 uA0, uA1, uA2, uA3, uC0, uC1, uC2, uC3;
uniform mat3 uCurlRot;
uniform float uTurns, uRadius, uContract, uZExc, uAdvance;
uniform vec3 uFlat; // half, y, waveAmp

// Squared by multiplication, never pow(): pow() is undefined for a negative base in GLSL, and a
// single NaN here propagates into the vertex position and deletes geometry.
float easeIO(float u) { float k = -2.0 * u + 2.0; return u < 0.5 ? 2.0 * u * u : 1.0 - k * k / 2.0; }
float dEaseIO(float u) { return u < 0.5 ? 4.0 * u : 4.0 * (1.0 - u); }

vec3 bez(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float it = 1.0 - t;
  return p0 * (it * it * it) + p1 * (3.0 * it * it * t) + p2 * (3.0 * it * t * t) + p3 * (t * t * t);
}
vec3 dbez(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float it = 1.0 - t;
  return 3.0 * it * it * (p1 - p0) + 6.0 * it * t * (p2 - p1) + 3.0 * t * t * (p3 - p2);
}

void curlPoint(float u, out vec3 p, out vec3 d) {
  float th = TAU * uTurns * easeIO(u);
  float dth = TAU * uTurns * dEaseIO(u);
  float r = uRadius * (1.0 - uContract * u);
  float dr = -uRadius * uContract;
  float s = sin(PI * u);
  float c = cos(PI * u);
  vec3 l = vec3(r * sin(th) + uAdvance * easeIO(u), r * (1.0 - cos(th)), -uZExc * pow(max(s, 0.0), 1.6));
  vec3 dl = vec3(
    dr * sin(th) + r * cos(th) * dth + uAdvance * dEaseIO(u),
    dr * (1.0 - cos(th)) + r * sin(th) * dth,
    -uZExc * 1.6 * pow(max(s, 1e-4), 0.6) * c * PI);
  p = uCurlRot * l;
  d = uCurlRot * dl;
}

void pCurl(float t, out vec3 p, out vec3 d) {
  if (t < SEG_A) {
    float u = t / SEG_A;
    p = bez(uA0, uA1, uA2, uA3, u);
    d = dbez(uA0, uA1, uA2, uA3, u) / SEG_A;
  } else if (t < SEG_A + SEG_B) {
    float u = (t - SEG_A) / SEG_B;
    curlPoint(u, p, d);
    d /= SEG_B;
  } else {
    float segC = 1.0 - SEG_A - SEG_B;
    float u = (t - SEG_A - SEG_B) / segC;
    p = bez(uC0, uC1, uC2, uC3, u);
    d = dbez(uC0, uC1, uC2, uC3, u) / segC;
  }
}

void pFlat(float t, out vec3 p, out vec3 d) {
  float ph = t * PI * 3.0;
  p = vec3(-uFlat.x + t * 2.0 * uFlat.x, uFlat.y, uFlat.z * sin(ph));
  d = vec3(2.0 * uFlat.x, 0.0, uFlat.z * cos(ph) * PI * 3.0);
}

float localMorph(float t, float morph, float delay) {
  float l = clamp(morph * (1.0 + delay) - (1.0 - t) * delay, 0.0, 1.0);
  return l * l * (3.0 - 2.0 * l);
}

float curlWindow(float t) {
  return smoothstep(SEG_A - 0.07, SEG_A + 0.05, t) * (1.0 - smoothstep(SEG_A + SEG_B - 0.05, SEG_A + SEG_B + 0.07, t));
}
`;

/** The uniforms `PATH_GLSL` declares. Shared by every material that rides the path. */
export function pathUniforms(): Record<string, { value: unknown }> {
  return {
    uA0: { value: JOINS.A0 }, uA1: { value: JOINS.A1 }, uA2: { value: JOINS.A2 }, uA3: { value: JOINS.A3 },
    uC0: { value: JOINS.C0 }, uC1: { value: JOINS.C1 }, uC2: { value: JOINS.C2 }, uC3: { value: JOINS.C3 },
    uCurlRot: { value: CURL_ROTATION },
    uTurns: { value: CURL.turns },
    uRadius: { value: CURL.radius },
    uContract: { value: CURL.contract },
    uZExc: { value: CURL.zExcursion },
    uAdvance: { value: CURL.advance },
    uFlat: { value: new Vector3(FLAT.half, FLAT.y, FLAT.waveAmp) },
  };
}
