import { describe, expect, test } from "vitest";
import {
  effectId,
  overlayId,
  lookId,
  transitionId,
  clipId,
  splitChildId,
  stableHash,
  stableStringify,
} from "./ids";

describe("ids — deterministic", () => {
  test("same content → same id (reproducible across calls)", () => {
    expect(effectId("saturation-up", { amount: 1.2 }, "all")).toBe(
      effectId("saturation-up", { amount: 1.2 }, "all"),
    );
  });

  test("key order does not affect the id", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(effectId("x", { a: 1, b: 2 })).toBe(effectId("x", { b: 2, a: 1 }));
  });

  test("nested key order does not affect the id", () => {
    expect(stableHash({ p: { a: 1, b: 2 } })).toBe(stableHash({ p: { b: 2, a: 1 } }));
  });
});

describe("ids — distinctness", () => {
  test("different content → different id", () => {
    expect(effectId("saturation-up", { amount: 1.2 })).not.toBe(
      effectId("saturation-up", { amount: 1.3 }),
    );
  });

  test("salt distinguishes deliberately-duplicated effects (look expansion)", () => {
    expect(effectId("zoom-punch", {}, "all", 0)).not.toBe(effectId("zoom-punch", {}, "all", 1));
  });

  test("split children are lineage-stable and distinct per ordinal", () => {
    expect(splitChildId("c0:45000", 1)).toBe(splitChildId("c0:45000", 1));
    expect(splitChildId("c0:45000", 0)).not.toBe(splitChildId("c0:45000", 1));
    expect(splitChildId("c0:45000", 1)).not.toBe(splitChildId("c0:60000", 1)); // different split point
  });
});

describe("ids — shape", () => {
  test("ids carry their type prefix", () => {
    expect(effectId("x", {})).toMatch(/^fx_/);
    expect(overlayId("x", {}, {})).toMatch(/^ov_/);
    expect(lookId("x")).toMatch(/^look_/);
    expect(transitionId(["a", "b"], "fade")).toMatch(/^xf_/);
    expect(clipId(0)).toMatch(/^c_/);
  });
});
