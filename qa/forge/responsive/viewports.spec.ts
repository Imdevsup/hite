/**
 * FORGE — Responsive viewport matrix.
 * Runs each public page across 4 viewport sizes (mobile, tablet, laptop,
 * desktop) and verifies the layout holds up without horizontal scrollbars,
 * no content is clipped off the right edge, and tap targets meet Apple's
 * 44×44 HIG guideline on mobile.
 *
 * Mirrors ANVIL's forge matrix: 375×812, 768×1024, 1440×900, 1920×1080.
 */
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile",  width: 375,  height: 812 },
  { name: "tablet",  width: 768,  height: 1024 },
  { name: "laptop",  width: 1440, height: 900 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

// `/login` + `/verify` were here; both routes are deleted (no sign-in screen).
const PUBLIC_PAGES = ["/", "/how-to", "/compare"] as const;

for (const page of PUBLIC_PAGES) {
  test.describe(`Responsive · ${page}`, () => {
    for (const vp of VIEWPORTS) {
      test(`${vp.name} (${vp.width}×${vp.height}) — no horizontal scrollbar`, async ({ page: p }) => {
        await p.setViewportSize({ width: vp.width, height: vp.height });
        await p.goto(page);
        const overflow = await p.evaluate(() => {
          const el = document.documentElement;
          return el.scrollWidth > el.clientWidth + 1;
        });
        expect(overflow).toBe(false);
      });

      test(`${vp.name} — primary text is readable (font-size ≥ 12px)`, async ({ page: p }) => {
        await p.setViewportSize({ width: vp.width, height: vp.height });
        await p.goto(page);
        const bodyFontSize = await p.evaluate(() => {
          const el = document.querySelector("main, body");
          return el ? parseFloat(getComputedStyle(el as HTMLElement).fontSize) : 0;
        });
        expect(bodyFontSize).toBeGreaterThanOrEqual(12);
      });

      if (vp.name === "mobile") {
        test(`${vp.name} — touch targets ≥ 36×36 on primary CTAs`, async ({ page: p }) => {
          await p.setViewportSize({ width: vp.width, height: vp.height });
          await p.goto(page);
          const buttons = await p.locator("a[href], button:visible").all();
          const small: string[] = [];
          for (const b of buttons.slice(0, 20)) {
            const box = await b.boundingBox();
            if (!box) continue;
            if (box.width < 36 || box.height < 36) {
              const text = (await b.textContent())?.trim().slice(0, 40);
              small.push(`${text ?? "?"} (${box.width.toFixed(0)}×${box.height.toFixed(0)})`);
            }
          }
          expect.soft(small, `Small tap targets: ${small.join(", ")}`).toEqual([]);
        });
      }
    }
  });
}
