import { describe, expect, test } from "vitest";
import { speedToSlider, sliderToSpeed, SPEED_MIN, SPEED_MAX, SPEED_PRESETS } from "./speedScale";

describe("speedScale — log mapping over the reducer's 0.1×–100× envelope", () => {
  test("slider endpoints map to the reducer's exact clamp bounds", () => {
    expect(sliderToSpeed(0)).toBeCloseTo(SPEED_MIN, 2);
    expect(sliderToSpeed(1)).toBeCloseTo(SPEED_MAX, 2);
  });

  test("envelope speeds map to slider endpoints", () => {
    expect(speedToSlider(SPEED_MIN)).toBeCloseTo(0, 5);
    expect(speedToSlider(SPEED_MAX)).toBeCloseTo(1, 5);
  });

  test("1× sits at the decade-true position (0.1→1 is one decade of three: ~1/3)", () => {
    // The range spans 3 decades (0.1→1→10→100). 1× is one decade up from the min, so it lands at
    // ~1/3 of the track — deliberately giving the upper 2 decades (the speed-up / velocity side,
    // where ramps live) the majority of the travel. Not centered, and that's intentional.
    expect(speedToSlider(1)).toBeCloseTo(1 / 3, 2);
    // 10× is two decades up → ~2/3.
    expect(speedToSlider(10)).toBeCloseTo(2 / 3, 2);
  });

  test("round-trips every preset (slider→speed→slider is stable)", () => {
    for (const sp of SPEED_PRESETS) {
      expect(sliderToSpeed(speedToSlider(sp))).toBeCloseTo(sp, 1);
    }
  });

  test("monotonic: a higher slider position is a strictly higher speed", () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const s = sliderToSpeed(p);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  test("a velocity-ramp speed above the OLD linear max (4×) is representable, not pinned", () => {
    // The bug: the old slider maxed at 4×, so an AI-set 8× pinned the thumb AND the first drag
    // reset it. With the log map, 8× lands strictly inside (0,1) and round-trips back to ~8×.
    const pos = speedToSlider(8);
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThan(1);
    expect(sliderToSpeed(pos)).toBeCloseTo(8, 0);
  });

  test("out-of-envelope / invalid speeds clamp into range (never NaN, never out of [0,1])", () => {
    for (const bad of [0, -3, 0.001, 250, NaN]) {
      const pos = speedToSlider(bad);
      expect(Number.isFinite(pos)).toBe(true);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThanOrEqual(1);
    }
    // A speed past the max clamps to the top of the track (≙ 100×), not beyond.
    expect(speedToSlider(250)).toBeCloseTo(1, 5);
  });

  test("sliderToSpeed clamps its input position to [0,1]", () => {
    expect(sliderToSpeed(-1)).toBeCloseTo(SPEED_MIN, 2);
    expect(sliderToSpeed(2)).toBeCloseTo(SPEED_MAX, 2);
  });
});
