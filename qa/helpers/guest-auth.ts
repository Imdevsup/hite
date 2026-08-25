/**
 * App-entry helper for QA smoke tests.
 *
 * There is no sign-in screen and no guest button any more: `middleware.ts` mints a Supabase
 * anonymous session the first time a visitor touches `/app`, so entering the app IS just navigating
 * to it. What remains worth centralising is the tutorial suppression below and one honest failure
 * message when the target deployment cannot mint a session at all (middleware answers 503 when
 * anonymous sign-ins are disabled on that project) — callers still guard on `ok` and skip.
 */
import type { Page } from "@playwright/test";

export async function enterAsGuest(page: Page): Promise<{ ok: boolean; reason?: string }> {
  // Pre-seed the onboarding flag so the Tutorial overlay doesn't mount and
  // intercept clicks on the chat composer / dock during smoke runs.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("hite.tutorial.done.v1", "1");
    } catch {
      /* storage not available — tutorial will open but tests still work if
         beforeEach dismisses it explicitly */
    }
  });

  const res = await page.goto("/app");
  const status = res?.status() ?? 0;
  if (status === 503) {
    return {
      ok: false,
      reason: `/app answered 503 — ${(await page.textContent("body").catch(() => null)) ?? "no body"}`,
    };
  }
  if (status >= 400) return { ok: false, reason: `/app answered ${status}` };
  if (!/\/app(\/|\?|$)/.test(page.url())) {
    return { ok: false, reason: `/app redirected to ${page.url()}` };
  }
  return { ok: true };
}
