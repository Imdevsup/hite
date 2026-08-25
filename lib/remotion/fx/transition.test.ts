import { describe, expect, test } from "vitest";
import { classifyTransition, pulse, ramp, transitionVeil, boundaryWindow } from "./transition";

describe("classifyTransition", () => {
  test("maps the registry transition families", () => {
    expect(classifyTransition("trans-fade").family).toBe("dissolve");
    expect(classifyTransition("trans-crossfade-fast").family).toBe("dissolve");
    expect(classifyTransition("trans-dissolve").family).toBe("dissolve");
    expect(classifyTransition("trans-burn-to-white").family).toBe("flash");
    expect(classifyTransition("trans-flash-cut-fast").family).toBe("flash");
    expect(classifyTransition("trans-burn-to-black").family).toBe("burn-black");
    expect(classifyTransition("trans-wipe-left").family).toBe("wipe");
    expect(classifyTransition("trans-slide-right-fast").family).toBe("slide");
    expect(classifyTransition("trans-zoom-in").family).toBe("zoom");
    expect(classifyTransition("trans-whip-pan-l").family).toBe("whip");
    expect(classifyTransition("trans-rgb-split-cut").family).toBe("rgbsplit");
    expect(classifyTransition("trans-cube-rotate-r").family).toBe("rgbsplit");
  });

  test("bare reducer/test keys classify too", () => {
    expect(classifyTransition("fade").family).toBe("dissolve");
  });

  test("burn-to-black is not mis-classified as flash (specificity order)", () => {
    expect(classifyTransition("trans-burn-to-black-fast").family).toBe("burn-black");
  });

  test("extracts direction", () => {
    expect(classifyTransition("trans-wipe-left").dir).toBe("left");
    expect(classifyTransition("trans-wipe-right").dir).toBe("right");
    expect(classifyTransition("trans-wipe-up").dir).toBe("up");
    expect(classifyTransition("trans-wipe-down").dir).toBe("down");
  });

  test("unknown key falls back to dissolve", () => {
    expect(classifyTransition("totally-made-up").family).toBe("dissolve");
  });
});

describe("pulse", () => {
  test("0 at the edges, 1 at the midpoint", () => {
    expect(pulse(0, 0, 10)).toBe(0);
    expect(pulse(10, 0, 10)).toBe(0);
    expect(pulse(5, 0, 10)).toBeCloseTo(1, 5);
  });
  test("0 outside the window", () => {
    expect(pulse(-5, 0, 10)).toBe(0);
    expect(pulse(20, 0, 10)).toBe(0);
  });
  test("symmetric ramp up/down", () => {
    expect(pulse(2.5, 0, 10)).toBeCloseTo(0.5, 5);
    expect(pulse(7.5, 0, 10)).toBeCloseTo(0.5, 5);
  });
});

describe("ramp", () => {
  test("clamps 0→1 across the window", () => {
    expect(ramp(0, 0, 10)).toBe(0);
    expect(ramp(5, 0, 10)).toBeCloseTo(0.5, 5);
    expect(ramp(10, 0, 10)).toBe(1);
    expect(ramp(-3, 0, 10)).toBe(0);
    expect(ramp(13, 0, 10)).toBe(1);
  });
});

describe("transitionVeil", () => {
  const d = classifyTransition("trans-fade");

  test("returns null outside the window", () => {
    expect(transitionVeil(d, -1, 0, 10)).toBeNull();
    expect(transitionVeil(d, 10, 0, 10)).toBeNull();
  });

  test("dissolve paints a dark veil that peaks at the midpoint", () => {
    const mid = transitionVeil(d, 5, 0, 10);
    expect(mid).not.toBeNull();
    expect(String(mid!.background)).toContain("rgba(0,0,0,");
  });

  test("flash paints a white veil", () => {
    const f = transitionVeil(classifyTransition("trans-flash-cut"), 5, 0, 10);
    expect(String(f!.background)).toContain("rgba(255,255,255,");
  });

  test("wipe is visible across the window (directional, not just at the peak)", () => {
    const w = classifyTransition("trans-wipe-left");
    // wipe travels — it should paint even near the window edges (where pulse≈0)
    expect(transitionVeil(w, 1, 0, 10)).not.toBeNull();
    expect(transitionVeil(w, 9, 0, 10)).not.toBeNull();
  });

  test("every registry transition family produces a non-null veil at its peak", () => {
    const keys = [
      "trans-fade",
      "trans-crossfade",
      "trans-dissolve",
      "trans-burn-to-white",
      "trans-burn-to-black",
      "trans-flash-cut",
      "trans-wipe-left",
      "trans-slide-right",
      "trans-zoom-in",
      "trans-zoom-out",
      "trans-whip-pan-l",
      "trans-rgb-split-cut",
      "trans-cube-rotate-r",
    ];
    for (const k of keys) {
      expect(transitionVeil(classifyTransition(k), 5, 0, 10), k).not.toBeNull();
    }
  });

  test("deterministic — same inputs give the same style (WYSIWYG: preview==export)", () => {
    expect(transitionVeil(d, 4, 0, 10)).toEqual(transitionVeil(d, 4, 0, 10));
  });
});

describe("boundaryWindow", () => {
  test("straddles the cut boundary by ±dur/2", () => {
    expect(boundaryWindow(100, 12, 300)).toEqual({ startFrame: 94, endFrame: 106 });
  });
  test("clamps to [0, compDuration]", () => {
    expect(boundaryWindow(2, 12, 300)).toEqual({ startFrame: 0, endFrame: 8 });
    expect(boundaryWindow(298, 12, 300)).toEqual({ startFrame: 292, endFrame: 300 });
  });
  test("never produces a zero/negative-length window", () => {
    const w = boundaryWindow(0, 1, 1);
    expect(w.endFrame).toBeGreaterThan(w.startFrame);
  });
});
