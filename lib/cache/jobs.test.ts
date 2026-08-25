import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const mockRpc = vi.fn();
/** Flipped by the one test that proves an unconfigured service key still fails CLOSED, not 500. */
const adminThrows = { value: false };
vi.mock("@/lib/supabase/admin", () => ({
  createAdmin: () => {
    if (adminThrows.value) throw new Error("supabaseUrl is required.");
    return { rpc: mockRpc };
  },
}));

import { checkIpRateLimit, checkRateLimit, BUCKETS, IP_BUCKETS } from "./jobs";

describe("checkRateLimit", () => {
  beforeEach(() => { mockRpc.mockReset(); });

  test("returns ok=true + remaining when RPC succeeds", async () => {
    mockRpc.mockResolvedValue({ data: [{ ok: true, remaining: 7 }], error: null });
    const r = await checkRateLimit("u1", "plan");
    expect(r).toEqual({ ok: true, remaining: 7 });
    expect(mockRpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_user: "u1", p_bucket: "plan", p_limit: BUCKETS.plan,
    });
  });

  test("fails CLOSED (ok=false, remaining=0) when RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await checkRateLimit("u1", "render");
    expect(r).toEqual({ ok: false, remaining: 0 });
  });

  test("handles non-array RPC return shape", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, remaining: 3 }, error: null });
    const r = await checkRateLimit("u1", "plan");
    expect(r).toEqual({ ok: true, remaining: 3 });
  });

  test("fails closed when shape is totally unexpected", async () => {
    mockRpc.mockResolvedValue({ data: "totally wrong", error: null });
    const r = await checkRateLimit("u1", "plan");
    expect(r).toEqual({ ok: false, remaining: 0 });
  });

  test("meters the refine bucket — /api/refine is the same Gemini cost as /api/plan", async () => {
    // Regression: refine had NO bucket, so the plan cap was bypassable by planning once and
    // refining forever. Its own bucket (not plan's) because the chat sends every follow-up here.
    expect(BUCKETS.refine).toBeGreaterThan(0);
    mockRpc.mockResolvedValue({ data: [{ ok: true, remaining: 29 }], error: null });
    await checkRateLimit("u1", "refine");
    expect(mockRpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_user: "u1", p_bucket: "refine", p_limit: BUCKETS.refine,
    });
  });
});

describe("checkIpRateLimit", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    adminThrows.value = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    adminThrows.value = false; // never leak the throwing admin into the suites that follow
    vi.restoreAllMocks();
  });

  test("calls the IP-keyed RPC with the bucket's limit", async () => {
    mockRpc.mockResolvedValue({ data: [{ ok: true, remaining: 99 }], error: null });
    const r = await checkIpRateLimit("1.2.3.4", "client-error");
    expect(r).toEqual({ ok: true, remaining: 99 });
    expect(mockRpc).toHaveBeenCalledWith("consume_ip_rate_limit", {
      p_key: "1.2.3.4", p_bucket: "client-error", p_limit: IP_BUCKETS["client-error"],
    });
  });

  test("fails CLOSED when the RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await checkIpRateLimit("1.2.3.4", "client-error")).toEqual({ ok: false, remaining: 0 });
  });

  test("fails CLOSED (not 500) when the admin client cannot even be built", async () => {
    // /api/errors is the endpoint that COLLECTS errors — a throw here would start a report loop.
    adminThrows.value = true;
    expect(await checkIpRateLimit("1.2.3.4", "client-error")).toEqual({ ok: false, remaining: 0 });
  });
});
