import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedPersister } from "./debounce";

describe("createDebouncedPersister", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("coalesces multiple calls within the wait window", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 100 });
    p.persist("a");
    p.persist("b");
    p.persist("c");
    await vi.advanceTimersByTimeAsync(99);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("c", { keepalive: false });
  });

  test("a second batch fires after the first settles", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 50 });
    p.persist("first");
    await vi.advanceTimersByTimeAsync(50);
    p.persist("second");
    await vi.advanceTimersByTimeAsync(50);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, "first", { keepalive: false });
    expect(send).toHaveBeenNthCalledWith(2, "second", { keepalive: false });
  });

  test("flush() sends immediately", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 1000 });
    p.persist("payload");
    await p.flush();
    expect(send).toHaveBeenCalledWith("payload", { keepalive: false });
  });

  test("flush({ keepalive }) tells send the request must outlive the document (unload path)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 1000 });
    p.persist("payload");
    await p.flush({ keepalive: true });
    expect(send).toHaveBeenCalledWith("payload", { keepalive: true });
  });

  test("flush() is a no-op when nothing pending", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 100 });
    await p.flush();
    expect(send).not.toHaveBeenCalled();
  });

  test("cancel() drops pending payload", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 100 });
    p.persist("x");
    p.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(send).not.toHaveBeenCalled();
  });

  test("forwards errors to onError without throwing", async () => {
    const err = new Error("server down");
    const send = vi.fn().mockRejectedValue(err);
    const onError = vi.fn();
    const p = createDebouncedPersister({ send, waitMs: 50, onError });
    p.persist("x");
    await vi.advanceTimersByTimeAsync(50);
    // Allow the catch branch to run
    await Promise.resolve();
    await Promise.resolve();
    // The payload rides along: a send outlives the state that queued it, so the receiver has to be
    // able to tell whose failure this is before writing it anywhere (see the editor store's
    // cross-project guard).
    expect(onError).toHaveBeenCalledWith(err, "x");
  });

  test("swallows errors silently when no onError given", async () => {
    const send = vi.fn().mockRejectedValue(new Error("x"));
    const p = createDebouncedPersister({ send, waitMs: 50 });
    p.persist("x");
    await vi.advanceTimersByTimeAsync(50);
    // Allow the catch branch to run
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });

  // A dropped payload is silent data loss — the editor's autosave runs through here.
  test("retries a failed send with exponential backoff, then reports the failure once", async () => {
    const send = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    const onError = vi.fn();
    const onStatusChange = vi.fn();
    const p = createDebouncedPersister({ send, waitMs: 50, retries: 2, retryDelayMs: 100, onError, onStatusChange });
    p.persist("x");
    await vi.advanceTimersByTimeAsync(50);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); // first backoff
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); // second backoff — doubled
    expect(send).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onStatusChange.mock.calls.map((c) => c[0])).toEqual(["saving", "error"]);
    expect(onStatusChange.mock.calls.map((c) => c[1])).toEqual(["x", "x"]); // every status names its payload
  });

  test("keeps a payload that never sent, so a later flush can still save it", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 50 });
    p.persist("x");
    await vi.advanceTimersByTimeAsync(50);
    expect(send).toHaveBeenCalledTimes(1);
    // The unload flush retries the payload the failed send would previously have thrown away.
    await p.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("x", { keepalive: false });
  });

  test("abandons a retry once a newer payload supersedes it", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("HTTP 500")).mockResolvedValue(undefined);
    const p = createDebouncedPersister({ send, waitMs: 50, retries: 3, retryDelayMs: 100 });
    p.persist("old");
    await vi.advanceTimersByTimeAsync(50);
    expect(send).toHaveBeenCalledTimes(1);
    p.persist("new"); // whole-state snapshot — resending "old" would write a stale state
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("new", { keepalive: false });
  });
});
