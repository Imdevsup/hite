/**
 * Throttle a function to run at most once per animation frame. Trailing
 * edge wins: if called multiple times within a frame, only the last
 * argument set runs at the next frame boundary.
 *
 * Used for pointer-rate events that update React state — without this,
 * moving the pointer at 120 Hz causes 120 re-renders per second.
 *
 * Returns a `{ call, cancel }` pair. Cancel drops the pending call.
 */

export interface RafThrottled<A extends unknown[]> {
  call: (...args: A) => void;
  cancel: () => void;
}

export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): RafThrottled<A> {
  let handle: number | null = null;
  let lastArgs: A | null = null;

  const run = () => {
    handle = null;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  function call(...args: A): void {
    lastArgs = args;
    if (handle !== null) return;
    handle = typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(run)
      : (setTimeout(run, 16) as unknown as number);
  }

  function cancel(): void {
    if (handle !== null) {
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(handle);
      else clearTimeout(handle);
      handle = null;
    }
    lastArgs = null;
  }

  return { call, cancel };
}
