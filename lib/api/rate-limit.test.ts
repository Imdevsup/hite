import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted: the static `import ... from "./rate-limit"` below is hoisted above these declarations,
// so the mock factory must not close over ordinary module-scope consts.
const { checkRateLimitMock, checkIpRateLimitMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  checkIpRateLimitMock: vi.fn(),
}));
vi.mock("@/lib/cache/jobs", () => ({
  checkRateLimit: checkRateLimitMock,
  checkIpRateLimit: checkIpRateLimitMock,
}));

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdmin: () => ({ rpc: rpcMock }) }));

import {
  beginByokRun,
  clientIpKey,
  requireByokIpRateLimit,
  requireIpRateLimit,
  requirePlannerBudget,
  requireRateLimit,
} from "./rate-limit";
import { HttpError } from "./errors";

/**
 * The gate exists so an expensive route cannot forget the 429 — /api/refine ran the full Gemini
 * tool-loop unmetered because the check was open-coded in /api/plan only.
 */
describe("requireRateLimit", () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("passes through silently when the bucket has room", async () => {
    checkRateLimitMock.mockResolvedValue({ ok: true, remaining: 9 });
    await expect(requireRateLimit("u1", "refine")).resolves.toBeUndefined();
    expect(checkRateLimitMock).toHaveBeenCalledWith("u1", "refine");
  });

  test("throws a 429 HttpError when the bucket is spent", async () => {
    checkRateLimitMock.mockResolvedValue({ ok: false, remaining: 0 });
    const err = await requireRateLimit("u1", "refine").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const res = (err as HttpError).response;
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily limit reached" });
  });

  test("fails CLOSED: a broken RPC (ok:false) blocks rather than opening the gate", async () => {
    checkRateLimitMock.mockResolvedValue({ ok: false, remaining: 0 });
    await expect(requireRateLimit("u1", "plan")).rejects.toBeInstanceOf(HttpError);
  });
});

describe("requireIpRateLimit", () => {
  beforeEach(() => {
    checkIpRateLimitMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("429s on the IP bucket for unauthenticated endpoints", async () => {
    checkIpRateLimitMock.mockResolvedValue({ ok: false, remaining: 0 });
    const err = await requireIpRateLimit("1.2.3.4", "client-error").catch((e: unknown) => e);
    expect((err as HttpError).response.status).toBe(429);
    expect(checkIpRateLimitMock).toHaveBeenCalledWith("1.2.3.4", "client-error");
  });
});

describe("clientIpKey", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("http://localhost/api/errors", { method: "POST", headers });

  test("uses the first x-forwarded-for hop", () => {
    expect(clientIpKey(withHeaders({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  test("falls back to x-real-ip, then to a single shared 'unknown' key", () => {
    expect(clientIpKey(withHeaders({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    // One shared key, NOT a fresh quota per unidentifiable caller.
    expect(clientIpKey(withHeaders({}))).toBe("unknown");
    expect(clientIpKey(withHeaders({ "x-forwarded-for": "   " }))).toBe("unknown");
  });

  test("caps the attacker-supplied header so it cannot become an unbounded key or log line", () => {
    const key = clientIpKey(withHeaders({ "x-forwarded-for": "a".repeat(5000) }));
    expect(key).toHaveLength(64);
  });
});

/**
 * The bring-your-own-key path.
 *
 * The point of BYOK is that the visitor is paying Google, so continuing to charge them against the
 * deployer's daily pool budget would make the whole feature pointless — they would still hit "daily
 * limit reached" while spending their own money. What the deployer DOES still pay for is
 * function-seconds, so the daily count cap is replaced by a per-IP concurrency cap. Both halves are
 * asserted here: the shared bucket must not be touched on the BYOK path, and the pool must stay
 * exactly as protected as it is today when no key is supplied.
 */
describe("requirePlannerBudget", () => {
  const okRun = { data: [{ ok: true, run_id: "run-1", inflight: 1, reason: null }], error: null };

  beforeEach(() => {
    checkRateLimitMock.mockReset().mockResolvedValue({ ok: true, remaining: 9 });
    rpcMock.mockReset().mockResolvedValue(okRun);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // NOTE for whoever owns lib/api/rate-limit.ts: `{ kind: "pool" }` no longer exists — BYOK is the
  // only path, so the only credential-free source is a SELF-HOSTED endpoint (`{ kind: "none" }`).
  // That still takes this branch, which means a local-model run is metered by the per-user DAILY
  // count rather than the per-IP CONCURRENCY cap. The server pays function-seconds either way, so
  // the concurrency cap is arguably the right instrument for it too. Flagged, not changed here:
  // `requirePlannerBudget` is that file's to decide, and no route calls it yet.
  test("a credential-free (self-hosted) run takes the per-user daily bucket, and holds no slot", async () => {
    const release = await requirePlannerBudget({
      userId: "u1",
      ipKey: "1.2.3.4",
      source: { kind: "none" },
      bucket: "plan",
    });
    expect(checkRateLimitMock).toHaveBeenCalledWith("u1", "plan");
    expect(rpcMock).not.toHaveBeenCalled();
    await expect(release()).resolves.toBeUndefined();
  });

  test("that path over the cap still 429s", async () => {
    checkRateLimitMock.mockResolvedValue({ ok: false, remaining: 0 });
    const err = await requirePlannerBudget({
      userId: "u1",
      ipKey: "1.2.3.4",
      source: { kind: "none" },
      bucket: "plan",
    }).catch((e: unknown) => e);
    expect((err as HttpError).response.status).toBe(429);
  });

  test("own key → the shared daily budget is NOT consulted; a concurrency slot is claimed instead", async () => {
    const release = await requirePlannerBudget({
      userId: "u1",
      ipKey: "1.2.3.4",
      source: { kind: "byok", key: "AIzaSySENTINELdoNOTleak0123456789abcdef" },
      bucket: "plan",
    });

    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("begin_byok_run", {
      p_key: "1.2.3.4",
      p_concurrency: 2,
      p_daily_limit: 500,
      p_ttl_seconds: 360,
    });

    await release();
    expect(rpcMock).toHaveBeenLastCalledWith("end_byok_run", { p_run: "run-1" });
  });

  test("the visitor's key is never an argument to the rate limiter", async () => {
    const key = "AIzaSySENTINELdoNOTleak0123456789abcdef";
    await requirePlannerBudget({ userId: "u1", ipKey: "1.2.3.4", source: { kind: "byok", key }, bucket: "plan" });
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain(key);
  });
});

describe("beginByokRun", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("over the concurrency cap → a 429 that says what to do about it", async () => {
    rpcMock.mockResolvedValue({ data: [{ ok: false, run_id: null, inflight: 2, reason: "concurrency" }], error: null });
    const err = await beginByokRun("1.2.3.4").catch((e: unknown) => e);
    expect((err as HttpError).response.status).toBe(429);
    expect(await (err as HttpError).response.json()).toEqual({
      error: "another edit is already running — wait for it to finish",
    });
  });

  test("over the daily tripwire → a plain 429", async () => {
    rpcMock.mockResolvedValue({ data: [{ ok: false, run_id: null, inflight: 0, reason: "daily" }], error: null });
    const err = await beginByokRun("1.2.3.4").catch((e: unknown) => e);
    expect(await (err as HttpError).response.json()).toEqual({ error: "too many requests" });
  });

  test("fails CLOSED when the RPC is missing, and names the migration in the log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function begin_byok_run does not exist' } });
    await expect(beginByokRun("1.2.3.4")).rejects.toBeInstanceOf(HttpError);
    expect(logged.mock.calls.map(String).join(" ")).toContain("008");
  });

  test("HITE_BYOK_MAX_CONCURRENT is honoured; a nonsense value warns and falls back", async () => {
    rpcMock.mockResolvedValue({ data: [{ ok: true, run_id: "r", inflight: 1, reason: null }], error: null });

    vi.stubEnv("HITE_BYOK_MAX_CONCURRENT", "5");
    await beginByokRun("1.2.3.4");
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_concurrency: 5 });

    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HITE_BYOK_MAX_CONCURRENT", "lots");
    await beginByokRun("1.2.3.4");
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_concurrency: 2 });
    expect(warned.mock.calls.map(String).join(" ")).toContain("HITE_BYOK_MAX_CONCURRENT");
  });

  test("release is idempotent — a `finally` that runs twice does not double-free a slot", async () => {
    rpcMock.mockResolvedValue({ data: [{ ok: true, run_id: "run-9", inflight: 1, reason: null }], error: null });
    const release = await beginByokRun("1.2.3.4");
    await release();
    await release();
    expect(rpcMock.mock.calls.filter((c) => c[0] === "end_byok_run")).toHaveLength(1);
  });

  test("a failed release is logged, never thrown — it must not mask the run's own outcome", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock
      .mockResolvedValueOnce({ data: [{ ok: true, run_id: "run-9", inflight: 1, reason: null }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    const release = await beginByokRun("1.2.3.4");
    await expect(release()).resolves.toBeUndefined();
    expect(logged.mock.calls.map(String).join(" ")).toContain("end_byok_run");
  });
});

describe("requireByokIpRateLimit", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("consumes the key-check bucket against the existing IP counter", async () => {
    rpcMock.mockResolvedValue({ data: [{ ok: true, remaining: 59 }], error: null });
    await expect(requireByokIpRateLimit("1.2.3.4", "key-check")).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith("consume_ip_rate_limit", {
      p_key: "1.2.3.4",
      p_bucket: "key-check",
      p_limit: 60,
    });
  });

  test("429s when spent, and fails CLOSED when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: [{ ok: false, remaining: 0 }], error: null });
    await expect(requireByokIpRateLimit("1.2.3.4", "key-check")).rejects.toBeInstanceOf(HttpError);

    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(requireByokIpRateLimit("1.2.3.4", "key-check")).rejects.toBeInstanceOf(HttpError);
  });
});
