import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

/**
 * /api/errors is deliberately unauthenticated, so everything it logs is attacker-controlled. These
 * pin the bounds: strict shape, size cap, IP rate limit, and one flattened log line — the route used
 * to `console.error("[client-error]", body)` for any JSON of any size from anyone.
 *
 * Only the rate-limit RPC is faked; the schema, the caps and the sanitiser are the real thing.
 */

const checkIpRateLimitMock = vi.fn();
vi.mock("@/lib/cache/jobs", () => ({ checkIpRateLimit: checkIpRateLimitMock }));

const { POST } = await import("./route");

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/errors", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
    body,
  });
}

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  checkIpRateLimitMock.mockReset().mockResolvedValue({ ok: true, remaining: 99 });
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const logLines = () => logged.mock.calls.map((c) => String(c[0]));

describe("POST /api/errors", () => {
  test("accepts what lib/sentry.ts actually posts and logs one line", async () => {
    const res = await POST(post(JSON.stringify({ message: "TypeError: x is undefined", context: { route: "/app" } })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toContain("TypeError: x is undefined");
    expect(logLines()[0]).toContain('context={"route":"/app"}');
  });

  test("newlines cannot forge extra log records", async () => {
    const injected = "boom\n[client-error] FAKE: database wiped\r\nmore";
    await POST(post(JSON.stringify({ message: injected })));
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).not.toContain("\n");
    expect(logLines()[0]).not.toContain("\r");
  });

  test("an accepted-but-long message is truncated in the log, not written whole", async () => {
    const res = await POST(post(JSON.stringify({ message: "A".repeat(1500) })));
    expect(res.status).toBe(200);
    expect(logLines()[0].length).toBeLessThan(600);
  });

  test("a long context object is truncated too", async () => {
    await POST(post(JSON.stringify({ message: "boom", context: { blob: "B".repeat(2000) } })));
    expect(logLines()[0].length).toBeLessThan(1100);
  });

  test("a long message inside the body cap is TRUNCATED, not rejected", async () => {
    // The message field carried its own 2000-char max, so a 2.5 KB stack trace 400d — and
    // lib/sentry.ts discards the response, so the biggest crashes were the ones silently dropped.
    const res = await POST(post(JSON.stringify({ message: `TypeError: boom ${"A".repeat(2500)}` })));
    expect(res.status).toBe(200);
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0]).toContain("TypeError: boom");
    expect(logLines()[0].length).toBeLessThan(600);
  });

  test("an oversized body is a 413 and is never logged", async () => {
    // The one bound that must reject: truncated JSON does not parse.
    const res = await POST(post(JSON.stringify({ message: "A".repeat(9000) })));
    expect(res.status).toBe(413);
    expect(logLines()).toHaveLength(0);
  });

  test("an unrecognised shape is a 400 naming the problem, not a logged blob", async () => {
    const res = await POST(post(JSON.stringify({ msg: "x", tracking: "beacon" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("message");
    expect(logLines()).toHaveLength(0);
  });

  test("non-JSON is a 400", async () => {
    const res = await POST(post("<html>not json"));
    expect(res.status).toBe(400);
    expect(logLines()).toHaveLength(0);
  });

  test("over the IP bucket it is a 429 and nothing reaches the log", async () => {
    checkIpRateLimitMock.mockResolvedValue({ ok: false, remaining: 0 });
    const res = await POST(post(JSON.stringify({ message: "spam" })));
    expect(res.status).toBe(429);
    expect(logLines()).toHaveLength(0);
    expect(checkIpRateLimitMock).toHaveBeenCalledWith("1.2.3.4", "client-error");
  });
});
