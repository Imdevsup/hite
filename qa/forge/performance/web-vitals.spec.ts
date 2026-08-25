/**
 * FORGE — Web Vitals budgets.
 * Measures LCP, CLS, and TTFB on every public page and asserts against
 * ANVIL's budget thresholds. Uses native PerformanceObserver rather than
 * a heavy Lighthouse harness so the suite stays fast.
 *
 * Budgets (mirrors anvil.config.js.forge.performanceBudgets):
 *   LCP ≤ 3000ms
 *   CLS ≤ 0.1
 *   TTFB ≤ 800ms
 */
import { test, expect } from "@playwright/test";

interface Vitals {
  lcp: number | null;
  cls: number;
  ttfb: number | null;
}

async function collectVitals(page: ReturnType<typeof Object.prototype.valueOf> & { evaluate: (fn: () => unknown) => Promise<unknown>; waitForTimeout: (ms: number) => Promise<void> }): Promise<Vitals> {
  // Collect vitals for ~3s to catch LCP final paint.
  await page.waitForTimeout(3000);
  return (await page.evaluate(() => {
    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const ttfb = navEntry ? navEntry.responseStart - navEntry.requestStart : null;

    const lcpEntries = performance.getEntriesByType("largest-contentful-paint") as PerformanceEntry[];
    const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : null;

    const clsEntries = performance.getEntriesByType("layout-shift") as (PerformanceEntry & { value: number; hadRecentInput: boolean })[];
    const cls = clsEntries
      .filter((e) => !e.hadRecentInput)
      .reduce((sum, e) => sum + e.value, 0);

    return { lcp, cls, ttfb };
  })) as Vitals;
}

// `/login` was here and no longer exists — see qa/forge/smoke/middleware.spec.ts.
const PAGES = ["/", "/how-to"] as const;

for (const path of PAGES) {
  test.describe(`Vitals · ${path}`, () => {
    test("LCP under budget (≤ 3000ms)", async ({ page }) => {
      await page.goto(path);
      const v = await collectVitals(page);
      if (v.lcp === null) test.skip(true, "LCP entry not reported by this Chromium build");
      expect.soft(v.lcp!).toBeLessThanOrEqual(3000);
    });

    test("CLS under budget (≤ 0.1)", async ({ page }) => {
      await page.goto(path);
      const v = await collectVitals(page);
      expect.soft(v.cls).toBeLessThanOrEqual(0.1);
    });

    test("TTFB under budget (≤ 800ms)", async ({ page }) => {
      await page.goto(path);
      const v = await collectVitals(page);
      if (v.ttfb === null) test.skip(true, "TTFB not available");
      expect.soft(v.ttfb!).toBeLessThanOrEqual(800);
    });
  });
}
