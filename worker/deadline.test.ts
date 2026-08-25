import { describe, expect, test, vi } from "vitest";
import { JobTimeoutError, runWithDeadline } from "./deadline";

/**
 * The deadline's contract, which is entirely about the case that has no natural end: a handler that
 * never settles. Without it the heartbeat kept a wedged job looking alive forever and the reaper —
 * which only moves jobs whose heartbeat has gone quiet — could not fire by construction.
 */

/** A promise nothing ever resolves: the wedged handler. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("runWithDeadline", () => {
  test("a handler that never settles fails with a readable, timed reason", async () => {
    const onExpire = vi.fn();
    await expect(runWithDeadline(never(), { timeoutMs: 20, label: "the render", onExpire })).rejects.toThrow(
      JobTimeoutError,
    );
    // The string reaches `job.error` and the Export window, so it has to name the thing and the wait
    // — and it has to say "timed out", which is what the Export window classifies it by.
    await expect(runWithDeadline(never(), { timeoutMs: 20, label: "the render", onExpire })).rejects.toThrow(
      "the render timed out after 0s and was given up on",
    );
    // The abort is raised at the deadline — what can be stopped (ffmpeg, downloads) is stopped.
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  test("work that finishes in time is untouched — no abort, no timer left running", async () => {
    const onExpire = vi.fn();
    await expect(
      runWithDeadline(Promise.resolve("done"), { timeoutMs: 10_000, label: "the analysis", onExpire }),
    ).resolves.toBe("done");
    expect(onExpire).not.toHaveBeenCalled();
  });

  test("a real failure inside the deadline is reported as itself, not as a timeout", async () => {
    const onExpire = vi.fn();
    await expect(
      runWithDeadline(Promise.reject(new Error("moov atom not found")), {
        timeoutMs: 10_000,
        label: "the analysis",
        onExpire,
      }),
    ).rejects.toThrow("moov atom not found");
    expect(onExpire).not.toHaveBeenCalled();
  });

  test("an abandoned handler that fails LATE is reported, never left as an unhandled rejection", async () => {
    const late = vi.fn();
    let failLate: (e: Error) => void = () => {};
    const work = new Promise<void>((_, rejectWork) => {
      failLate = rejectWork;
    });

    await expect(
      runWithDeadline(work, { timeoutMs: 20, label: "the render", onExpire: () => {}, onLateSettle: late }),
    ).rejects.toThrow(JobTimeoutError);

    failLate(new Error("chromium finally gave up"));
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ message: "chromium finally gave up" }));
  });

  test("an abandoned handler that SUCCEEDS late is reported too — the artifact may well exist", async () => {
    const late = vi.fn();
    let finishLate: () => void = () => {};
    const work = new Promise<void>((resolveWork) => {
      finishLate = resolveWork;
    });

    await expect(
      runWithDeadline(work, { timeoutMs: 20, label: "the render", onExpire: () => {}, onLateSettle: late }),
    ).rejects.toThrow(JobTimeoutError);

    finishLate();
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith(null);
  });
});
