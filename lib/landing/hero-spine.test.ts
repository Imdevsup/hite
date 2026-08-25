/**
 * lib/landing/hero-spine.test.ts — the GPU strip and the DOM strip are ONE object.
 *
 * `components/site/HeroRibbonGL.tsx` draws a smooth mesh; `HeroSetpiece`'s `Ribbon` draws 144 CSS
 * plates behind it as the LCP paint, the no-WebGL fallback and the reduced-motion edition. A viewer
 * can see both — the DOM one first, the GPU one a moment later — so if the two curves ever drift
 * apart the handoff becomes a visible jump, and the fallback stops being a picture of the same thing.
 *
 * Nothing structural prevents that drift: they are produced by different functions. These tests are
 * what prevents it, by measuring the GPU spine against the solver's own emitted plates.
 */
import { describe, expect, it } from "vitest";
import { sampleSpine, type SpineSample } from "./hero-geometry";
import {
  BODY_KEYS_FLAT,
  FLAT_SCALE_STEPS,
  FLAT_SCALE_STEPS_FLAT,
  PERSPECTIVE_PX,
  RIBBON,
  RIBBON_LENGTH_PX,
  RIBBON_RUNS,
  RIBBON_RUNS_FLAT,
  RIBBON_SPINE,
  SILENCE_BANDS,
  SILENCE_BANDS_FLAT,
} from "./hero-scene";

const TWIST_DEG = 270;
const STATIONS = 512;

const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const spine: readonly SpineSample[] = sampleSpine(
  { net: RIBBON.net, lengthPx: RIBBON_LENGTH_PX, twistDeg: TWIST_DEG, perspective: PERSPECTIVE_PX },
  STATIONS,
);

const atArc = (arc: number): SpineSample =>
  spine[Math.min(STATIONS, Math.max(0, Math.round((arc / RIBBON_LENGTH_PX) * STATIONS)))];

describe("the GPU spine is the same curve the CSS plates ride", () => {
  it("reproduces every plate's normal well inside the solver's own seam budget", () => {
    // The solver publishes `maxRollStepDeg: 5` as the faceting it allows between neighbouring
    // plates. Agreement has to be comfortably tighter than that, or "same object" is a slogan.
    let worst = 0;
    for (const plate of RIBBON.plates) {
      const s = atArc(plate.leftPx + plate.widthPx / 2);
      worst = Math.max(worst, (Math.acos(Math.min(1, Math.abs(dot(s.normal, plate.normal)))) * 180) / Math.PI);
    }
    expect(worst).toBeLessThan(1.5);
  });

  it("is arc-length parameterised, so the flatten is rigid", () => {
    // The vertex shader mixes the curled station against `aU * lengthPx`. If the curve's arc length
    // were not exactly the flat strip's length, every station would have to stretch on the way down
    // and beat D would read as elastic — the "two different objects" the brief bans.
    expect(spine[STATIONS].arc).toBeCloseTo(RIBBON_LENGTH_PX, 6);
    for (let i = 1; i <= STATIONS; i += 1) {
      expect(spine[i].arc - spine[i - 1].arc).toBeCloseTo(RIBBON_LENGTH_PX / STATIONS, 6);
    }
  });

  it("emits an orthonormal right-handed frame at every station", () => {
    // The fragment shader lights from `cross(tangent, up)` and builds its anisotropic term from the
    // tangent. A frame that is not orthonormal shows up as shading that swims along the strip.
    for (const s of spine) {
      expect(Math.abs(dot(s.tangent, s.up))).toBeLessThan(1e-6);
      expect(Math.abs(dot(s.tangent, s.normal))).toBeLessThan(1e-6);
      expect(Math.abs(dot(s.up, s.normal))).toBeLessThan(1e-6);
      expect(Math.hypot(...s.normal)).toBeCloseTo(1, 9);
    }
  });
});

describe("what crosses the server/client boundary", () => {
  it("ships the spine as whole stations of six numbers, head to tail", () => {
    expect(RIBBON_SPINE.length % 6).toBe(0);
    const stations = RIBBON_SPINE.length / 6 - 1;
    expect(stations).toBeGreaterThan(64);
    for (const v of RIBBON_SPINE) expect(Number.isFinite(v)).toBe(true);
    // The frame halves are unit vectors; rounding must not have broken that.
    for (let i = 0; i <= stations; i += 1) {
      const up = RIBBON_SPINE.slice(i * 6 + 3, i * 6 + 6);
      expect(Math.hypot(up[0], up[1], up[2])).toBeCloseTo(1, 3);
    }
  });

  it("keeps the run and silence arrays in step with their source", () => {
    // These are the clip blocks and the pauses. If a flattening ever drops one, the strip quietly
    // stops matching the fixture the rest of the page quotes numbers from.
    expect(RIBBON_RUNS_FLAT.length).toBe(RIBBON_RUNS.length * 3);
    expect(SILENCE_BANDS_FLAT.length).toBe(SILENCE_BANDS.length * 3);
    RIBBON_RUNS.forEach((r, i) => {
      expect(RIBBON_RUNS_FLAT[i * 3]).toBe(r.startPx);
      expect(RIBBON_RUNS_FLAT[i * 3 + 1]).toBe(r.endPx);
      expect(RIBBON_RUNS_FLAT[i * 3 + 2]).toBe(r.removed ? 1 : 0);
    });
    SILENCE_BANDS.forEach((b, i) => {
      expect(SILENCE_BANDS_FLAT[i * 3 + 2]).toBe(b.removed ? 1 : 0);
    });
  });

  it("ships the settle ladder the CSS media queries use, not the raw ceiling", () => {
    // The GPU strip picks its flat scale from this array. Were it to use BODY_KEYS' 0.5 instead, the
    // settled strip would be 1440px wide on a 1440px stage — edge to edge, past both gutters, and
    // out of line with the lanes and the numeral beneath it.
    expect(FLAT_SCALE_STEPS_FLAT.length).toBe(FLAT_SCALE_STEPS.length * 2);
    expect(FLAT_SCALE_STEPS_FLAT[0]).toBe(-1);
    FLAT_SCALE_STEPS.forEach((s, i) => {
      expect(FLAT_SCALE_STEPS_FLAT[i * 2]).toBe(s.maxWidth ?? -1);
      expect(FLAT_SCALE_STEPS_FLAT[i * 2 + 1]).toBe(s.scale);
    });
  });

  it("ships the pose track as whole seven-number keys", () => {
    expect(BODY_KEYS_FLAT.length % 7).toBe(0);
    // Scale is authored at 1 until the settle: the object rides at its real size through the curl.
    const keys = BODY_KEYS_FLAT.length / 7;
    for (let i = 0; i < keys - 1; i += 1) expect(BODY_KEYS_FLAT[i * 7 + 6]).toBe(1);
  });
});
