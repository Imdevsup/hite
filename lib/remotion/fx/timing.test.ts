import { describe, expect, test } from "vitest";
import { zoomPunchScale } from "./ZoomPunch";
import { clipRelativeWindow } from "../HiteRoot";

/**
 * Regression coverage for the effect-window TIMING that previously had a frames-vs-ms unit bug
 * (ZoomPunch multiplied a frame count by 30/1000 as if it were ms) and an absolute-vs-clip-relative
 * coordinate bug (the IR window is absolute-timeline, but useCurrentFrame() inside the clip Sequence
 * is clip-relative). Both are pure functions now, so they're testable in the node env.
 */
describe("clipRelativeWindow", () => {
  test("whole-clip effect (no window) → undefined bounds", () => {
    expect(clipRelativeWindow(undefined, 300)).toEqual({ startFrame: undefined, endFrame: undefined });
  });

  test("rebases an absolute window onto the clip's start frame", () => {
    // clip starts at frame 300; effect window is absolute [330, 360)
    expect(clipRelativeWindow({ startFrame: 330, endFrame: 360 }, 300)).toEqual({
      startFrame: 30,
      endFrame: 60,
    });
  });

  test("a window at the clip's own start rebases to 0", () => {
    expect(clipRelativeWindow({ startFrame: 300, endFrame: 312 }, 300)).toEqual({
      startFrame: 0,
      endFrame: 12,
    });
  });
});

describe("zoomPunchScale", () => {
  const amount = 1.2;

  test("identity (scale 1) before the window starts", () => {
    expect(zoomPunchScale(0, amount, 30, 60)).toBe(1);
    expect(zoomPunchScale(29, amount, 30, 60)).toBe(1);
  });

  test("ramps from 1 → amount over enterFrames, then holds", () => {
    expect(zoomPunchScale(30, amount, 30, 60)).toBeCloseTo(1, 5); // t=0 at window start
    expect(zoomPunchScale(32, amount, 30, 60, 4)).toBeCloseTo(1.1, 5); // halfway up (t=0.5)
    expect(zoomPunchScale(34, amount, 30, 60, 4)).toBeCloseTo(1.2, 5); // fully in (t=1)
    expect(zoomPunchScale(50, amount, 30, 60, 4)).toBeCloseTo(1.2, 5); // held
  });

  test("releases (scale 1) once the window closes", () => {
    expect(zoomPunchScale(60, amount, 30, 60)).toBe(1);
    expect(zoomPunchScale(80, amount, 30, 60)).toBe(1);
  });

  test("frame counts are NOT treated as milliseconds (the original bug)", () => {
    // Window starts at clip-relative frame 30. If the code wrongly did (start*30/1000) it would
    // think the window starts at ~0.9 frames and would already be punched in by frame 5.
    expect(zoomPunchScale(5, amount, 30, 60)).toBe(1);
  });

  test("no end window → holds amount after enter (open-ended)", () => {
    expect(zoomPunchScale(1000, amount, 30, undefined, 4)).toBeCloseTo(1.2, 5);
  });
});
