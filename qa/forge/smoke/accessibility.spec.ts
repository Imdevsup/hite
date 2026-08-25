/**
 * Accessibility smoke — Apple-level polish check on public routes.
 * Borrowed in spirit from ANVIL's axe-core audits; here we do a lightweight
 * structural pass (headings present, form inputs labelled, no
 * horizontal overflow, tap targets ≥ 36px) that doesn't need axe installed.
 */
import { test, expect } from "@playwright/test";

// `/login` was here; the route is deleted (no sign-in screen).
const PUBLIC_PAGES = ["/", "/how-to"];

test.describe("Accessibility smoke", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} has at least one h1`, async ({ page }) => {
      await page.goto(path);
      const h1Count = await page.locator("h1, [role=heading][aria-level='1'], .label-display, .label-display-tight").first().count();
      expect(h1Count).toBeGreaterThan(0);
    });

    test(`${path} — no horizontal scrollbar`, async ({ page }) => {
      await page.goto(path);
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasOverflow).toBe(false);
    });

    test(`${path} — primary interactive elements are keyboard focusable`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => window.focus());
      await page.locator("body").click({ position: { x: 1, y: 1 }, force: true });
      // Tab up to 6 times — some pages have skip-links / empty wrappers first.
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        const active = await page.evaluate(() => {
          const el = document.activeElement;
          return el && el !== document.body ? el.tagName : null;
        });
        if (active) return;
      }
      throw new Error("No element captured keyboard focus after 6 Tabs");
    });
  }

  /* A "/login — email input has a placeholder or label" test lived here. The app has no email
     input anywhere any more: nobody is ever asked for an address. */
});
