/**
 * Middleware smoke — `/app/*` mints a session instead of bouncing to a login page.
 *
 * This file used to assert the opposite ("unauthenticated /app redirects to /login?next=/app").
 * The login wall is gone: middleware.ts signs a cookieless visitor in anonymously so RLS still has
 * an `auth.uid()` to work with, and the visitor never sees a form. The assertions below are the
 * inverse of the old ones on purpose — a redirect here is now the failure.
 */
import { test, expect } from "@playwright/test";

test.describe("Middleware session mint", () => {
  test("a cookieless visitor to /app lands in /app, not on a login page", async ({ page }) => {
    const res = await page.goto("/app");
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/app(\/|\?|$)/);
  });

  test("the visit leaves a Supabase session cookie behind", async ({ page, context }) => {
    await page.goto("/app");
    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))).toBe(true);
  });

  test("a deep link to a project id that isn't theirs is a 404, not a login bounce", async ({ page }) => {
    const res = await page.goto("/app/00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("public routes stay public", async ({ page }) => {
    for (const path of ["/", "/how-to", "/compare"]) {
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
    }
  });

  test("/login and /verify are gone — the wall is not merely hidden", async ({ page }) => {
    for (const path of ["/login", "/verify"]) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(404);
    }
  });
});
