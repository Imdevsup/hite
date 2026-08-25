import { describe, expect, test } from "vitest";
import { gradeFor } from "./ColorGrade";

/**
 * Coverage for the PURE color-grade recipe resolver behind the CSS-filter LUT/color approximation
 * (fx/ColorGrade.tsx). The component itself is just three divs around `gradeFor`, so testing the pure
 * function covers the load-bearing logic: every registered key grades the picture, `intensity` scales
 * the look toward identity, and the determinism ban (no Math.random/Date.now) holds.
 */

const ALL_LUT_KEYS = [
  "lut-a24-moonlight",
  "lut-a24-dusk",
  "lut-kodachrome-64",
  "lut-fuji-pro-400h",
  "lut-portra-160",
  "lut-cinestill-800t",
  "lut-ektachrome-100",
  "lut-vhs-worn",
  "lut-vhs-fresh",
  "lut-polaroid-sx70",
];
const COLOR_KEYS = ["contrast-cream", "curve-lift-blacks", "saturation-up", "saturation-down"];

describe("gradeFor — coverage", () => {
  test("every LUT key produces a non-identity filter (the picture actually changes)", () => {
    for (const key of ALL_LUT_KEYS) {
      const g = gradeFor(key, {});
      expect(g.filter).not.toBe("none");
      expect(g.filter.length).toBeGreaterThan(0);
    }
  });

  test("every color-engine key produces a non-identity filter", () => {
    for (const key of COLOR_KEYS) {
      const g = gradeFor(key, {});
      expect(g.filter).not.toBe("none");
    }
  });

  test("an unknown lut-* key falls through to a generic grade (never a no-op)", () => {
    const g = gradeFor("lut-some-future-pack-key", {});
    expect(g.filter).toContain("contrast");
    expect(g.filter).not.toBe("none");
  });

  test("an unknown non-lut key is identity (filter: none)", () => {
    expect(gradeFor("totally-unknown", {}).filter).toBe("none");
  });
});

describe("gradeFor — intensity scaling", () => {
  test("intensity 0 collapses a LUT to identity (filter all 1×, no tint, no lift)", () => {
    const g = gradeFor("lut-a24-moonlight", { intensity: 0 });
    // contrast/saturate/brightness should all be 1.000 at i=0
    expect(g.filter).toContain("contrast(1.000)");
    expect(g.filter).toContain("saturate(1.000)");
    expect(g.filter).toContain("brightness(1.000)");
    expect(g.tint?.opacity ?? 0).toBe(0);
    expect(g.lift ?? 0).toBe(0);
  });

  test("intensity 1 (the default) applies the full look", () => {
    const full = gradeFor("lut-a24-moonlight", { intensity: 1 });
    const dflt = gradeFor("lut-a24-moonlight", {});
    expect(dflt).toEqual(full); // missing intensity defaults to 1
    expect(full.tint?.opacity ?? 0).toBeGreaterThan(0);
    expect(full.lift ?? 0).toBeGreaterThan(0);
  });

  test("intensity is monotonic — half strength sits between identity and full for the tint", () => {
    const half = gradeFor("lut-a24-moonlight", { intensity: 0.5 });
    const full = gradeFor("lut-a24-moonlight", { intensity: 1 });
    expect(half.tint!.opacity).toBeGreaterThan(0);
    expect(half.tint!.opacity).toBeLessThan(full.tint!.opacity);
  });

  test("out-of-range intensity is clamped to [0,1]", () => {
    const over = gradeFor("lut-a24-moonlight", { intensity: 5 });
    const one = gradeFor("lut-a24-moonlight", { intensity: 1 });
    expect(over).toEqual(one);
    const under = gradeFor("lut-a24-moonlight", { intensity: -3 });
    const zero = gradeFor("lut-a24-moonlight", { intensity: 0 });
    expect(under).toEqual(zero);
  });
});

describe("gradeFor — color-op params", () => {
  test("contrast-cream honors its `amount` param", () => {
    const strong = gradeFor("contrast-cream", { amount: 1.5 });
    const mild = gradeFor("contrast-cream", { amount: 1.05 });
    // higher amount → higher contrast() multiplier
    const num = (f: string) => Number(f.match(/contrast\(([\d.]+)\)/)![1]);
    expect(num(strong.filter)).toBeGreaterThan(num(mild.filter));
  });

  test("saturation-up boosts and saturation-down cuts saturation", () => {
    const up = Number(gradeFor("saturation-up", {}).filter.match(/saturate\(([\d.]+)\)/)![1]);
    const down = Number(gradeFor("saturation-down", {}).filter.match(/saturate\(([\d.]+)\)/)![1]);
    expect(up).toBeGreaterThan(1);
    expect(down).toBeLessThan(1);
  });
});

describe("gradeFor — determinism (lib/remotion/** ban on Math.random/Date.now)", () => {
  test("same inputs ⇒ byte-identical grade across calls", () => {
    for (const key of [...ALL_LUT_KEYS, ...COLOR_KEYS]) {
      expect(gradeFor(key, { intensity: 0.7 })).toEqual(gradeFor(key, { intensity: 0.7 }));
    }
  });
});
