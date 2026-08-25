import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { rafThrottle } from "./rafThrottle";

let rafCallbacks: Array<() => void> = [];
let rafHandleCounter = 0;

describe("rafThrottle", () => {
  beforeEach(() => {
    rafCallbacks = [];
    rafHandleCounter = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCallbacks.push(cb);
      return ++rafHandleCounter;
    });
    vi.stubGlobal("cancelAnimationFrame", (_handle: number) => {
      // Our stub flushes all pending on tick(); cancel is test-driven.
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function tick() {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb();
  }

  test("runs at most once per frame even with many calls", () => {
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t.call(1);
    t.call(2);
    t.call(3);
    expect(fn).not.toHaveBeenCalled();
    tick();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3); // trailing edge: latest args
  });

  test("a subsequent call after the frame fires a new rAF", () => {
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t.call("a");
    tick();
    t.call("b");
    tick();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "a");
    expect(fn).toHaveBeenNthCalledWith(2, "b");
  });

  test("cancel() drops the pending call", () => {
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t.call(1);
    t.cancel();
    tick();
    expect(fn).not.toHaveBeenCalled();
  });

  test("falls back to setTimeout when rAF unavailable", () => {
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t.call("x");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(fn).toHaveBeenCalledWith("x");
    vi.useRealTimers();
  });
});
