/**
 * Chat composer smoke — open chat, verify composer + send button behavior.
 *
 * STALE FOR THE SAME REASON `editor.spec.ts` WAS. A new project now opens on `PromptStage`
 * (DESIGN-DIRECTION §8.1), where the only composer on screen is the prompt-first one — the dock's
 * chat composer does not exist until the workspace is showing. Every test below therefore steps
 * through the escape hatch first. The composer's own selectors moved too (the placeholder and the
 * send button's label), and the example chips are `EXAMPLE_PROMPTS` now, so the hand-written
 * "Remove every um" this file used to click is not on the property at all.
 */
import { test, expect } from "@playwright/test";
import { enterAsGuest } from "../../helpers/guest-auth";
import { fillReactInput } from "../../helpers/react-input";
import {
  CHAT_COMPOSER,
  CHAT_SEND_BUTTON,
  PROMPT_STAGE_ENTER_WORKSPACE,
  PROMPT_STAGE_EXAMPLE,
  TIMELINE_LABEL,
} from "../../helpers/selectors";

test.describe("Chat composer", () => {
  test.beforeEach(async ({ page }) => {
    const result = await enterAsGuest(page);
    test.skip(!result.ok, result.reason ?? "Not signed in");

    await page.getByRole("button", { name: /new project/i }).first().click();
    await expect(page).toHaveURL(/\/app\/[0-9a-f-]+/, { timeout: 20_000 });

    // Past the prompt-first screen and into the workspace, where the dock (and its chat tab) lives.
    // `exact` matters: Playwright's string text match is a case-insensitive substring match, and the
    // escape hatch's own label contains the word "timeline".
    await page.getByRole("button", { name: PROMPT_STAGE_ENTER_WORKSPACE }).click({ timeout: 20_000 });
    await expect(page.getByText(TIMELINE_LABEL, { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  });

  test("composer exists and is editable", async ({ page }) => {
    const composer = page.locator(CHAT_COMPOSER);
    await expect(composer).toBeVisible({ timeout: 8_000 });
    await composer.focus();
    await fillReactInput(page, CHAT_COMPOSER, "Hello HITE");
    await expect(composer).toHaveValue("Hello HITE");
  });

  test("send button is disabled when empty, enabled when filled", async ({ page }) => {
    const send = page.locator(CHAT_SEND_BUTTON);
    await expect(send).toBeVisible({ timeout: 8_000 });
    await expect(send).toBeDisabled();
    await fillReactInput(page, CHAT_COMPOSER, "foo");
    await expect(send).toBeEnabled();
  });

  test("an example chip fills the composer without sending", async ({ page }) => {
    // The chips are `EXAMPLE_PROMPTS` — the one allowlist, whose test runs every entry through the
    // real flat mapper and the real reducer. They fill the field; they never fire a turn.
    const chip = page.getByRole("button", { name: PROMPT_STAGE_EXAMPLE }).first();
    const chipVisible = await chip.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!chipVisible, "Example prompts show only on a fresh chat");
    // The spring-in animation can briefly shift the target under the pointer — let it settle, then
    // force-click to avoid the race.
    await page.waitForTimeout(600);
    await chip.click({ force: true });
    await expect(page.locator(CHAT_COMPOSER)).toHaveValue(PROMPT_STAGE_EXAMPLE);
  });
});
