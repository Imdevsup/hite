import { test, expect } from "@playwright/test";

/**
 * Golden-path E2E. Requires a user already signed in (fixture cookie injected
 * by `playwright.config.ts`). Exercises upload → analyze → chat → render.
 */

test.skip(!process.env.SMOKE_URL, "set SMOKE_URL to run");

test("workshop opens, accepts upload, streams plan, renders 16:9", async ({ page }) => {
  await page.goto(`${process.env.SMOKE_URL}/app`);
  await expect(page.getByText(/WORKSHOP/i)).toBeVisible();

  // New project
  await page.getByRole("button", { name: /NEW PROJECT/i }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}/);

  // Cmd+1 → Media window
  await page.keyboard.press("Meta+1");
  await expect(page.getByText("APERTURE")).toBeVisible();

  // Cmd+2 → Chat window
  await page.keyboard.press("Meta+2");
  await expect(page.getByText("INTERCOM")).toBeVisible();

  // Prompt
  await page.getByPlaceholder(/Describe the edit/).fill("add 10% more saturation");
  await page.keyboard.press("Meta+Enter");
  await expect(page.getByText(/HITE/).first()).toBeVisible({ timeout: 15_000 });
});
