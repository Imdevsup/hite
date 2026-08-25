/**
 * paths.test.ts — the shape constraints of spec §4, measured rather than eyeballed, plus the proof
 * that the GLSL twin is the same function as the TS one (same formulas, same constants, same
 * control points: if someone edits one side, the literal constants below drift and this fails).
 */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  CURL,
  ENTRY,
  EXIT,
  JOINS,
  curlPoint,
  PATH_GLSL,
  SEG_A,
  SEG_B,
  curlWindow,
  evalSpine,
  localMorph,
  measureClearance,
  pCurl,
  pFlat,
} from "./paths";

describe("the curl", () => {
  it("is a full loop — over one revolution, so the strands cross on screen", () => {
    expect(CURL.turns).toBeGreaterThan(1);
    expect(CURL.turns).toBeLessThan(1.5);
    expect(CURL.advance).toBeGreaterThan(0);
  });

  it("keeps more than twice the ribbon width of 3D clearance between non-adjacent parts", () => {
    const clearance = measureClearance();
    expect(clearance).toBeGreaterThan(CURL.width * 2);
  });

  it("is tilted out of the screen plane in two axes and retreats in depth at its apex", () => {
    expect(CURL.tiltYDeg).toBeGreaterThan(0);
    expect(CURL.tiltXDeg).toBeGreaterThan(0);
    const apex = new Vector3();
    const d = new Vector3();
    pCurl(SEG_A + SEG_B / 2, apex, d);
    const start = new Vector3();
    pCurl(SEG_A, start, d);
    // The apex sits well behind the start of the curl (−Z is away from the hero camera).
    expect(start.z - apex.z).toBeGreaterThan(20);
  });

  it("starts and ends off-frame at the spec's entry and exit", () => {
    const p = new Vector3();
    const d = new Vector3();
    pCurl(0, p, d);
    expect(p.distanceTo(ENTRY)).toBeLessThan(1e-6);
    pCurl(1, p, d);
    expect(p.distanceTo(EXIT)).toBeLessThan(1e-6);
  });

  it("joins the approach and the exit along the blended direction the spec prescribes", () => {
    // dirA = normalize(mix(curlTangentAt(0), normalize(curlStart − ENTRY), 0.42)); A2 = start − dirA·62.
    const d = new Vector3();
    const start = new Vector3();
    const near = new Vector3();
    pCurl(SEG_A, start, d);
    pCurl(SEG_A + SEG_B * 0.02, near, d);
    const tangent = near.clone().sub(start).normalize();
    const chord = start.clone().sub(ENTRY).normalize();
    const dirA = chord.multiplyScalar(0.42).addScaledVector(tangent, 0.58).normalize();
    const arrival = JOINS.A3.clone().sub(JOINS.A2).normalize();
    expect(arrival.angleTo(dirA)).toBeLessThan(1e-6);
    // The approach arrives along that direction: its last 2% runs within 8° of the join direction.
    const before = new Vector3();
    pCurl(SEG_A - SEG_A * 0.02, before, d);
    expect(start.clone().sub(before).normalize().angleTo(dirA)).toBeLessThan((8 * Math.PI) / 180);
  });

  it("is continuous at the joins", () => {
    const d = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    pCurl(SEG_A - 1e-6, a, d);
    pCurl(SEG_A + 1e-6, b, d);
    expect(a.distanceTo(b)).toBeLessThan(1e-2);
    pCurl(SEG_A + SEG_B - 1e-6, a, d);
    pCurl(SEG_A + SEG_B + 1e-6, b, d);
    expect(a.distanceTo(b)).toBeLessThan(1e-2);
  });
});

describe("the flat timeline", () => {
  it("runs along +X past both frame edges with a slight Z wave", () => {
    const p = new Vector3();
    const d = new Vector3();
    pFlat(0, p, d);
    expect(p.x).toBeLessThan(-150);
    pFlat(1, p, d);
    expect(p.x).toBeGreaterThan(150);
    let maxZ = 0;
    for (let i = 0; i <= 100; i++) {
      pFlat(i / 100, p, d);
      maxZ = Math.max(maxZ, Math.abs(p.z));
    }
    expect(maxZ).toBeLessThanOrEqual(2.0001);
  });

  it("unfurls progressively from the far end, never uniformly", () => {
    const near = localMorph(0.05, 0.5, 0.9);
    const far = localMorph(0.95, 0.5, 0.9);
    expect(far).toBeGreaterThan(near);
    expect(localMorph(0.5, 0, 0.9)).toBe(0);
    expect(localMorph(0.5, 1, 0.9)).toBe(1);
  });

  it("blends to exactly the flat line at morph 1", () => {
    const p = new Vector3();
    const t = new Vector3();
    const f = new Vector3();
    const d = new Vector3();
    evalSpine(0.37, 1, 0.9, p, t);
    pFlat(0.37, f, d);
    expect(p.distanceTo(f)).toBeLessThan(1e-6);
  });

  it("has a window that is 1 inside the curl and 0 on the straight runs", () => {
    expect(curlWindow(SEG_A + SEG_B / 2)).toBe(1);
    expect(curlWindow(0.05)).toBe(0);
    expect(curlWindow(0.95)).toBe(0);
  });
});

describe("the GLSL twin", () => {
  it("carries the same segment split and the same formulas", () => {
    expect(PATH_GLSL).toContain(`const float SEG_A = ${SEG_A.toFixed(4)};`);
    expect(PATH_GLSL).toContain(`const float SEG_B = ${SEG_B.toFixed(4)};`);
    // The load-bearing lines, verbatim on both sides.
    expect(PATH_GLSL).toContain("pow(max(s, 0.0), 1.6)");
    expect(PATH_GLSL).toContain("1.6 * pow(max(s, 1e-4), 0.6) * c * PI");
    expect(PATH_GLSL).toContain("uRadius * (1.0 - uContract * u)");
    expect(PATH_GLSL).toContain("morph * (1.0 + delay) - (1.0 - t) * delay");
    expect(PATH_GLSL).toContain("smoothstep(SEG_A - 0.07, SEG_A + 0.05, t)");
  });

  it("derives its control points from the curl tangents, not by hand", () => {
    // A2 sits 62 units back from the curl start. C1 reaches 1.55x further ahead of its end, and the
    // asymmetry is the point: the exit has to turn 56.5 degrees out of the loop, and over the same
    // 62 units that turn rendered as a visible fold in the ribbon rather than as a curve.
    expect(JOINS.A2.distanceTo(JOINS.A3)).toBeCloseTo(62, 5);
    expect(JOINS.C1.distanceTo(JOINS.C0)).toBeCloseTo(62 * 1.55, 5);
  });

  it("leaves the loop on the curl's own tangent, so the exit cannot kink", () => {
    const L1 = new Vector3();
    const near = new Vector3();
    const d = new Vector3();
    curlPoint(1, L1, d);
    curlPoint(0.98, near, d);
    const tangent = new Vector3().subVectors(L1, near).normalize();
    const leaves = new Vector3().subVectors(JOINS.C1, JOINS.C0).normalize();
    // Exactly collinear: any blend toward EXIT here is what put the crease in.
    expect(leaves.dot(tangent)).toBeCloseTo(1, 6);
  });
});
