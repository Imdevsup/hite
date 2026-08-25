/** Landing smoke — root route renders the HITE workshop hero and CTA. */
import { test, expect } from "@playwright/test";
import { LANDING_HEADLINE, LANDING_TAGLINE, LANDING_CTA } from "../../helpers/selectors";

test.describe("Landing", () => {
  test("renders headline + tagline + CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(LANDING_HEADLINE, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(LANDING_TAGLINE)).toBeVisible();
    await expect(page.getByRole("link", { name: LANDING_CTA })).toBeVisible();
  });

  test("CTA routes straight into the workshop — no login stop", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: LANDING_CTA }).click();
    // There is no login page to be bounced to: middleware mints an anonymous session in place.
    await expect(page).toHaveURL(/\/app(\/|\?|$)/);
  });

  test("no horizontal scrollbar at desktop width", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
  });
});
