/**
 * Editor chrome smoke — requires a signed-in session. Attempts to enter as
 * a Supabase anonymous guest; skips cleanly when guest mode is disabled.
 *
 * REWRITTEN FOR THE PROMPT-FIRST EDITOR (DESIGN-DIRECTION §8.1). A new project no longer opens the
 * workspace at all: it opens `PromptStage` — the composer, the machine-checked example prompts and
 * a drop target, and nothing else. This file used to create a fresh project and then assert
 * workspace chrome on top of it, so every one of those assertions now describes a screen that is
 * one deliberate click away. Two of them described nothing at all:
 *
 *   · the StatusBar's command hint — the component is deleted (§8.2 merged its two real signals
 *     into the TopBar and `EditorAlerts`);
 *   · "Default layout opens Media + Chat windows" — panels are opt-in now, so nothing floats until
 *     the user asks. Chat is still there, but as the dock's first tab, not as a floating window.
 *
 * The suite therefore covers BOTH surfaces in the order a real first run meets them.
 */
import { test, expect } from "@playwright/test";
import { enterAsGuest } from "../../helpers/guest-auth";
import {
  TOPBAR_RESET,
  TOPBAR_HOW,
  TOPBAR_EXPORT,
  TIMELINE_LABEL,
  TOOL_RAIL_TILES,
  TOOL_RAIL_ALL_TOOLS,
  PROMPT_STAGE_COMPOSER,
  PROMPT_STAGE_ENTER_WORKSPACE,
  PROMPT_STAGE_EXAMPLE,
  CHAT_COMPOSER,
  MEDIA_DROPZONE,
} from "../../helpers/selectors";

/**
 * Leave the first screen the way a user does — the explicit escape hatch, not a store poke.
 *
 * `exact: true` on the timeline label is load-bearing: Playwright's string text match is a
 * case-insensitive SUBSTRING match, and the escape hatch's own label contains the word "timeline".
 */
async function enterWorkspace(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: PROMPT_STAGE_ENTER_WORKSPACE }).click();
  await expect(page.getByText(TIMELINE_LABEL, { exact: true }).first()).toBeVisible({ timeout: 8_000 });
}

test.describe("Editor chrome (authed)", () => {
  test.beforeEach(async ({ page }) => {
    const result = await enterAsGuest(page);
    test.skip(!result.ok, result.reason ?? "Not signed in");
    // ALWAYS a fresh project. The old beforeEach opened an existing one when the list was not
    // empty, which made "what is on screen" depend on whether that project already had a timeline —
    // the exact thing the first assertion below is about.
    await page.getByRole("button", { name: /new project/i }).first().click();
    await expect(page).toHaveURL(/\/app\/[0-9a-f-]+/, { timeout: 20_000 });
  });

  test("a new project opens on the prompt, not the workspace", async ({ page }) => {
    await expect(page.locator(PROMPT_STAGE_COMPOSER)).toBeVisible({ timeout: 15_000 });
    // The examples come from the one allowlist (`lib/landing/prompts.ts`), never retyped here.
    await expect(page.getByRole("button", { name: PROMPT_STAGE_EXAMPLE })).toBeVisible();
    // …and none of the workspace chrome is on screen yet.
    await expect(page.getByText(TIMELINE_LABEL, { exact: true })).toHaveCount(0);
    await expect(page.locator("header").getByRole("button", { name: new RegExp(TOPBAR_RESET, "i") })).toHaveCount(0);
  });

  test("the escape hatch reaches the workspace: TopBar shows RESET / HOW / EXPORT", async ({ page }) => {
    await enterWorkspace(page);
    // Scope to the <header>: the tool rail's EXPORT tile and FloatingWindow's "Reset to default
    // size" title also match these patterns globally.
    const header = page.locator("header");
    await expect(header.getByRole("button", { name: new RegExp(TOPBAR_RESET, "i") })).toBeVisible();
    await expect(header.getByRole("button", { name: new RegExp(TOPBAR_HOW, "i") })).toBeVisible();
    await expect(header.getByRole("button", { name: new RegExp(TOPBAR_EXPORT, "i") })).toBeVisible();
  });

  test("the tool rail is five tools and a way to the rest", async ({ page }) => {
    await enterWorkspace(page);
    for (const label of TOOL_RAIL_TILES) {
      await expect(page.locator(`[aria-label="${label}"]`).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: TOOL_RAIL_ALL_TOOLS })).toBeVisible();
  });

  test("panels are opt-in: the dock opens on Chat, nothing floats over the workspace", async ({ page }) => {
    await enterWorkspace(page);
    // Chat is the dock's first tab and is always mounted, so its composer is on screen…
    await expect(page.locator(CHAT_COMPOSER)).toBeVisible({ timeout: 8_000 });
    // …but no tool WINDOW has opened itself. Media used to be the default-open panel.
    await expect(page.getByRole("button", { name: new RegExp(MEDIA_DROPZONE, "i") })).toHaveCount(0);
  });

  test("Command palette opens on ⌘K / Ctrl+K", async ({ page }) => {
    // In the workspace, not on the prompt screen: the prompt composer takes focus on mount and
    // react-hotkeys-hook does not fire inside a textarea unless a binding opts in.
    await enterWorkspace(page);
    await page.keyboard.press("Control+KeyK");
    await expect(page.locator("[cmdk-root]")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("[cmdk-root]")).not.toBeVisible();
  });

  test("Shortcut overlay opens on ?", async ({ page }) => {
    await enterWorkspace(page);
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByText("WINDOWS", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });
});
