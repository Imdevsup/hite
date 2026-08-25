import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { providerFetch } from "./fetch";

/**
 * The request-amplification policy, which is only observable by COUNTING REQUESTS.
 *
 * This file inherits `gemini.test.ts`'s reason for existing. 5xx used to sit in the key-rotation set,
 * so a provider incident replayed the identical request across every key in the pool with no delay:
 * N× traffic aimed at an already-struggling upstream and N× latency against a wall-clock budget, per
 * serverless instance, on every planner step of every user. The pool is gone with BYOK, but the
 * split it taught us — "the PROVIDER is unhappy" retries once, everything else goes straight back —
 * is the part that must not regress, and the request count IS the bug.
 */

let fetchMock: ReturnType<typeof vi.fn>;

const respond = (status: number) => new Response(status === 200 ? "ok" : "err", { status });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider-wide failures are retried exactly once, never fanned out", () => {
  for (const status of [500, 502, 503, 504]) {
    test(`${status} → 2 requests, then the provider's REAL response is handed back`, async () => {
      fetchMock.mockResolvedValue(respond(status));
      const res = await providerFetch("https://provider/x");
      // The caller sees the provider's own status instead of a wrapped error after a fan-out.
      expect(res.status).toBe(status);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  }

  test("a transient 503 that clears on the retry succeeds", async () => {
    fetchMock.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));
    expect((await providerFetch("https://provider/x")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a dropped connection is retried once, then rethrown", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    await expect(providerFetch("https://provider/x")).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a network blip that clears on the retry succeeds", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(respond(200));
    expect((await providerFetch("https://provider/x")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the user's own key, quota and billing go straight back to them", () => {
  // These used to ROTATE onto another key. With BYOK there is nothing to rotate to, and hiding a 429
  // behind "all N keys failed" would remove the one fact that lets the user fix it.
  for (const status of [401, 403, 429]) {
    test(`${status} is one request and is surfaced verbatim`, async () => {
      fetchMock.mockResolvedValue(respond(status));
      expect((await providerFetch("https://provider/x")).status).toBe(status);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  test("a success is one request", async () => {
    fetchMock.mockResolvedValue(respond(200));
    expect((await providerFetch("https://provider/x")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a 400 is the caller's problem — never retried", async () => {
    fetchMock.mockResolvedValue(respond(400));
    expect((await providerFetch("https://provider/x")).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("no credential passes through this wrapper", () => {
  test("the request is forwarded byte-for-byte — the key is the factory's business, not ours", async () => {
    // Each provider factory puts the credential on its own header (x-goog-api-key / Bearer /
    // x-api-key). The old code ALSO rewrote a `?key=` query parameter, which is how a credential
    // ended up in a URL in the first place. It must not come back.
    fetchMock.mockResolvedValue(respond(200));
    const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };
    await providerFetch("https://provider/v1/chat?alt=sse", init);

    expect(fetchMock.mock.calls[0][0]).toBe("https://provider/v1/chat?alt=sse");
    expect(fetchMock.mock.calls[0][1]).toBe(init);
  });
});
