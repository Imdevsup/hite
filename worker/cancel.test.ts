import { describe, expect, test, vi } from "vitest";
import { cancelOnAbort } from "./cancel";

describe("cancelOnAbort", () => {
  test("aborting later cancels", () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    cancelOnAbort(controller.signal, cancel);
    expect(cancel).not.toHaveBeenCalled();
    controller.abort();
    expect(cancel).toHaveBeenCalledOnce();
  });

  /** An already-aborted signal never fires again, so waiting on it would wait forever. */
  test("a signal that is ALREADY aborted cancels immediately", () => {
    const cancel = vi.fn();
    cancelOnAbort(AbortSignal.abort(), cancel);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("the disposer detaches, so a finished job is not cancelled by a later abort", () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    cancelOnAbort(controller.signal, cancel)();
    controller.abort();
    expect(cancel).not.toHaveBeenCalled();
  });

  test("the disposer is safe to call on the already-aborted path", () => {
    const cancel = vi.fn();
    expect(() => cancelOnAbort(AbortSignal.abort(), cancel)()).not.toThrow();
  });

  test("two aborts cancel once — the listener is once-only", () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    cancelOnAbort(controller.signal, cancel);
    controller.abort();
    controller.abort();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
