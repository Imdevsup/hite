/**
 * React controlled-input helper.
 *
 * Playwright's `fill()` and `pressSequentially()` don't always trigger
 * React's synthetic onChange — the value setter is intercepted by React's
 * ValueTracker. This helper uses the native HTMLInputElement prototype
 * setter plus a manual input event dispatch.
 *
 * Copied verbatim from Altab/ANVIL's QA helpers.
 */
import type { Page } from "@playwright/test";

export async function fillReactInput(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await page.locator(selector).evaluate((el, val) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    const setter = descriptor?.set;
    if (!setter) return;
    setter.call(el, val);
    const tracker = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
    if (tracker) tracker.setValue("");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
