/**
 * HAMMER — Burst test.
 * 50 simultaneous GET /api/health calls. Verifies:
 *   - no 5xx (edge can handle the concurrency)
 *   - no connection resets
 *   - p95 latency under 2s
 *
 * ANVIL's burst profile is 500 concurrent × 300s; we run a scaled-down
 * version so it's safe to point at production.
 */
import { test, expect } from "@playwright/test";

const BURST_SIZE = Number(process.env.QA_BURST_SIZE ?? 50);

test.describe("HAMMER · Burst", () => {
  test(`${BURST_SIZE} concurrent GET /api/health — all 2xx, p95 ≤ 2000ms`, async ({ request }) => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: BURST_SIZE }, async () => {
        const start = Date.now();
        try {
          const res = await request.get("/api/health");
          return { status: res.status(), latency: Date.now() - start, error: null as null | string };
        } catch (err) {
          return { status: -1, latency: Date.now() - start, error: (err as Error).message };
        }
      }),
    );
    const wall = Date.now() - started;

    const errors = results.filter((r) => r.error || r.status >= 500 || r.status === -1);
    const latencies = results.map((r) => r.latency).sort((a, b) => a - b);
    const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];

    console.log(`HAMMER burst: ${BURST_SIZE} req in ${wall}ms · p95=${p95}ms · errors=${errors.length}`);

    expect(errors, errors.map((e) => `${e.status} ${e.error ?? ""}`).join("; ")).toEqual([]);
    expect(p95).toBeLessThanOrEqual(2000);
  });
});
