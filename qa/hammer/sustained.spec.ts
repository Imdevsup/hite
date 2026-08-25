/**
 * HAMMER — Sustained light load against /api/health.
 * Deliberately restrained — we fire 10 concurrent requests per burst × 6
 * bursts (60 reqs total) rather than the 1.8k ANVIL production numbers,
 * because we don't want to trip rate limits or wake oncall on prod.
 *
 * Failing if: any request 5xx's, or p95 latency > 1500ms. Use
 * `QA_HAMMER_DURATION_SEC` to extend locally.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const CONCURRENCY = Number(process.env.QA_HAMMER_CONCURRENCY ?? 10);
const BURSTS = Number(process.env.QA_HAMMER_BURSTS ?? 6);
const LATENCY_P95_BUDGET_MS = 1500;

async function fireBurst(request: APIRequestContext, size: number): Promise<number[]> {
  const latencies: number[] = [];
  const results = await Promise.all(
    Array.from({ length: size }, async () => {
      const start = Date.now();
      const res = await request.get("/api/health");
      const latency = Date.now() - start;
      latencies.push(latency);
      return res.status();
    }),
  );
  for (const status of results) {
    expect(status).toBeLessThan(500);
  }
  return latencies;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

test.describe("HAMMER · Sustained", () => {
  test(`${CONCURRENCY}×${BURSTS} bursts against /api/health — no 5xx, p95 ≤ ${LATENCY_P95_BUDGET_MS}ms`, async ({ request }) => {
    const all: number[] = [];
    for (let i = 0; i < BURSTS; i++) {
      const latencies = await fireBurst(request, CONCURRENCY);
      all.push(...latencies);
      // Give the edge a breath between bursts — avoids rate-limit thrash.
      await new Promise((r) => setTimeout(r, 1000));
    }

    const p50 = percentile(all, 0.50);
    const p95 = percentile(all, 0.95);
    const p99 = percentile(all, 0.99);

    console.log(`HAMMER sustained: ${all.length} req · p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
    expect(p95).toBeLessThanOrEqual(LATENCY_P95_BUDGET_MS);
  });
});
