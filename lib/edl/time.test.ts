import { describe, expect, test } from "vitest";
import {
  TICKS_PER_SECOND,
  ticksToFrame,
  framesToTicks,
  msToTicks,
  tickToMs,
  tick,
} from "./time";

/**
 * The mandatory tick↔frame invariants (docs/CANONICAL-IR-SPEC.md §2.3, corrected).
 *
 * Note: the spec's literal test asserts `framesToTicks(ticksToFrame(t)) === t` for arbitrary
 * ms, which is FALSE for sub-frame ticks (1ms @ 24fps quantizes to frame 0). The real
 * invariants are: (a) ticksToFrame equals the naive ms→frame for integer ms at divisor fps,
 * and (b) frame→ticks→frame round-trips losslessly on frame boundaries.
 */
describe("time — ticks ↔ frames", () => {
  for (const fps of [24, 25, 30, 60]) {
    test(`fps=${fps}: ticksToFrame matches naive ms→frame for integer ms`, () => {
      for (const ms of [0, 1, 16, 1000, 4200, 90_000]) {
        const t = msToTicks(ms);
        expect(Number.isInteger(t)).toBe(true);
        const frame = ticksToFrame(t, fps);
        expect(Number.isInteger(frame)).toBe(true);
        expect(frame).toBe(Math.round((ms / 1000) * fps));
      }
    });

    test(`fps=${fps}: frame → ticks → frame round-trips losslessly on boundaries`, () => {
      for (const f of [0, 1, 7, 24, 100, 2700]) {
        expect(ticksToFrame(framesToTicks(f, fps), fps)).toBe(f);
      }
    });
  }
});

describe("time — primitives", () => {
  test("TICKS_PER_SECOND is 30000", () => expect(TICKS_PER_SECOND).toBe(30_000));
  test("30 ticks per millisecond", () => expect(msToTicks(1)).toBe(30));
  test("tickToMs inverts msToTicks at ms precision", () =>
    expect(tickToMs(msToTicks(4200))).toBe(4200));
  test("tick() rounds and survives values beyond 2^31", () => {
    expect(tick(4200.6)).toBe(4201);
    expect(tick(1.08e9)).toBe(1.08e9); // ~10h timeline — would corrupt under `| 0`
  });
  test("divisor fps → exact integer division", () => {
    expect(ticksToFrame(TICKS_PER_SECOND, 30)).toBe(30);
    expect(ticksToFrame(TICKS_PER_SECOND, 24)).toBe(24);
    expect(ticksToFrame(TICKS_PER_SECOND, 60)).toBe(60);
  });
});
