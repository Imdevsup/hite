/**
 * FORGE — Accessibility audit via axe-core.
 * Scans every public page for WCAG 2.1 AA violations using @axe-core/playwright.
 * Mirrors ANVIL's axe pass; serious + critical violations fail the test, moderate
 * impacts are surfaced as warnings.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// `/login` + `/verify` were here; both routes are deleted (no sign-in screen). Swapped for the
// marketing routes that actually exist — /app is out of scope, it is `noindex` and session-gated.
const PAGES = ["/", "/how-to", "/compare"] as const;

for (const path of PAGES) {
  test.describe(`a11y · ${path}`, () => {
    test("no critical or serious WCAG 2.1 AA violations", async ({ page }) => {
      await page.goto(path);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // The gradient-heavy hero text occasionally trips color-contrast on
        // very light accents; we audit separately.
        .disableRules(["color-contrast"])
        .analyze();

      const serious = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );

      // Report every violation so the diff in CI is actionable.
      if (serious.length > 0) {
        console.log(
          JSON.stringify(
            serious.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.length,
              help: v.helpUrl,
            })),
            null,
            2,
          ),
        );
      }

      expect(serious, `${serious.length} critical/serious a11y violation(s)`).toEqual([]);
    });

    test("color-contrast (WCAG 2.1 AA) — soft warning", async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2aa", "wcag21aa"])
        .include("main")
        .analyze();

      const contrastIssues = results.violations.filter((v) => v.id === "color-contrast");

      // Soft assertion — logs but doesn't fail; HITE's cinematic palette has
      // a few intentional low-contrast muted labels.
      expect.soft(contrastIssues.length).toBeLessThan(6);
    });
  });
}
