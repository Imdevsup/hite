/**
 * FORGE — Visual regression (Landing).
 * Pixel-level screenshot snapshot of the landing hero. First run creates
 * the baseline; subsequent runs fail on any pixel drift beyond the small
 * anti-aliasing threshold. Update with: `pnpm qa:forge --update-snapshots`.
 */
import { test, expect } from "@playwright/test";

test.describe("Visual · Landing", () => {
  test("hero above the fold matches baseline", async ({ page }) => {
    await page.goto("/");
    // Wait for fonts + radial glow render to settle
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot("landing-hero.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    });
  });
});
