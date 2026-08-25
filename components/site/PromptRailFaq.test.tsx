/**
 * components/site/PromptRailFaq.test.tsx — the gates DESIGN-DIRECTION asks this section to survive.
 *
 * These are not smoke tests. Each one guards a rule the direction states as non-negotiable and that
 * a well-meaning future edit could quietly break:
 *
 *   §5.9  motion is OPT-IN — nothing animates or transitions outside `prefers-reduced-motion:
 *         no-preference`, so the static state is what server-renders.
 *   §6.6  every rail item is a real link to an ALLOWLISTED prompt, the loop copies are inert, and
 *         the marquee carries role/label/tabindex/pause.
 *   §6.7  the questions are verbatim, and the array the page renders is the array the FAQPage node
 *         will serialise.
 *   §7.1  the catalog number is interpolated, never typed — and "76" never reaches the page.
 *   §7.3  every number in the copy comes from the generated fixture.
 *   §9.1  the FAQ answers are visible text, never `sr-only`.
 *   honesty rules — no banned phrase, and "beta" exactly once (this section owns the property's
 *         second and final use).
 *
 * The environment is vitest's `node` (see vitest.config.ts), so the component is exercised through
 * `react-dom/server` rather than a DOM. That is the right level here: everything this unit does is
 * markup and CSS, and server output is exactly what a crawler, an answer engine and the §9.1 build
 * gate see.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EXAMPLE_PROMPTS, promptHref } from "@/lib/landing/prompts";
import { RENDERABLE_ENTRY_COUNT } from "@/lib/landing/catalog";
import { MECHANISM_HEADLINE, MECHANISM_SOURCE } from "@/lib/landing/fixture";
import { LANDING_FAQ, PromptRailFaq, RAIL_FAQ_CSS, RAIL_NOTE } from "./PromptRailFaq";
import { EDITOR_REACHABILITY } from "@/lib/site/primaryCta";
import { CTA_MICROLINE } from "./SiteChrome";

const MARKUP = renderToStaticMarkup(<PromptRailFaq />);
/**
 * Markup with any hoisted <style> removed — the copy checks are about what a reader reads.
 *
 * The entity pass is load-bearing, not tidying: React escapes `'` to `&#x27;` (and `&`/`<`/`>`/`"`
 * likewise) on the way out, so a `toContain` against the source string fails for copy that renders
 * perfectly. It caught the FAQ's "this browser's cookie" answer and reported it as *missing* — the
 * exact opposite of what happened. These checks ask "does a reader see this sentence", so they have
 * to compare against what a reader sees. Only the five characters React escapes are decoded; nothing
 * here should be inventing a general HTML decoder.
 */
const CONTENT = MARKUP.replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  // Last, so a literal `&amp;#x27;` in the copy is not double-decoded into an apostrophe.
  .replace(/&amp;/g, "&");

/** §5.9's dividing line. Everything before it must be inert. */
const MOTION_GATE = "@media (prefers-reduced-motion: no-preference)";

describe("PromptRailFaq — §5.9 motion is opt-in, not opt-out", () => {
  it("declares no animation or transition outside the no-preference gate", () => {
    const gateIndex = RAIL_FAQ_CSS.indexOf(MOTION_GATE);
    expect(gateIndex).toBeGreaterThan(0);

    const staticHalf = RAIL_FAQ_CSS.slice(0, gateIndex);
    // `animation-play-state`, `transition`, `animation` — none of them may appear in the state that
    // server-renders. A comment mentioning them would trip this too, which is the point: keep the
    // static half free of motion vocabulary.
    expect(staticHalf).not.toMatch(/\banimation\b/);
    expect(staticHalf).not.toMatch(/\btransition\b/);
  });

  it("keeps the loop copies hidden in the static state so reduced motion gets one clean list", () => {
    const gateIndex = RAIL_FAQ_CSS.indexOf(MOTION_GATE);
    const staticHalf = RAIL_FAQ_CSS.slice(0, gateIndex);
    expect(staticHalf).toContain('.prompt-rail__group[data-rail-loop-copy="true"] { display: none; }');
    // …and hides the pause control, because in the static state there is nothing to pause.
    expect(staticHalf).toContain(".prompt-rail__pause { display: none; }");
  });

  /**
   * §16 budgets `filter: blur()` in the LCP viewport at zero, and this section's own stylesheet is
   * the place a blur would come back. The `--settle-blur: 0px` half of this gate is gone with the
   * class it tuned: `.settle` and `@keyframes settle` were deleted from app/globals.css, so an
   * override for a variable no rule reads was pinning a dead string. What is worth asserting is that
   * neither the blur NOR a re-added consumer of the removed class ships from here.
   */
  it("uses no filter: blur anywhere, and no longer reaches for the deleted SETTLE arrival", () => {
    expect(RAIL_FAQ_CSS).not.toContain("blur(");
    // The declaration and the selector, not the word — the note above the rules names both.
    expect(RAIL_FAQ_CSS).not.toMatch(/--settle-[a-z]+\s*:/);
    expect(RAIL_FAQ_CSS).not.toMatch(/\.settle\b/);
    expect(MARKUP).not.toMatch(/class="[^"]*\bsettle\b/);
  });

  it("derives the seamless-loop translation from the copy count instead of hard-coding it", () => {
    // Four copies ⇒ the track must travel exactly one copy's width, i.e. -25%.
    expect(RAIL_FAQ_CSS).toContain("translate3d(-25%, 0, 0)");
  });

  it("reaches the document intact — React must not HTML-escape the stylesheet", () => {
    // React escapes `&` and `<` in text children; either would silently corrupt the CSS. Assert both
    // the invariant (the source has neither) and the outcome (the rendered rules are byte-identical).
    expect(RAIL_FAQ_CSS).not.toContain("&");
    expect(RAIL_FAQ_CSS).not.toContain("<");
    expect(MARKUP).toContain(RAIL_FAQ_CSS);
    expect(MARKUP).toContain("@keyframes prompt-rail-drift");
  });

  it("spends only tokens — no raw oklch, rgb, hex colour or literal duration", () => {
    const declarations = RAIL_FAQ_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).not.toMatch(/oklch\(/);
    expect(declarations).not.toMatch(/\brgba?\(/);
    // The only hex allowed is the mask's alpha stops (#000 / #0000), which are not design colours.
    const hexes = declarations.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(new Set(hexes)).toEqual(new Set(["#0000", "#000"]));
    // Durations and easings are always var(--d-*) / var(--ease-*), never literals.
    expect(declarations).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    expect(declarations).not.toMatch(/cubic-bezier\(/);
  });
});

describe("PromptRailFaq — §6.6 the rail is a launcher, not decoration", () => {
  it("carries the marquee contract: role, label, tabindex and a describedby note", () => {
    expect(MARKUP).toContain('role="marquee"');
    expect(MARKUP).toContain('aria-label="Example prompts"');
    expect(MARKUP).toMatch(/role="marquee"[^>]*tabindex="0"/);
    // The note is read from its owner, not restated: it has to describe what a tap DOES, and that
    // differs between a build that serves the editor and the landing-only build (`RAIL_NOTE`). A
    // hard-coded sentence here is how the caption starts lying about its own links.
    expect(CONTENT).toContain(RAIL_NOTE);
  });

  it("promises the editor in the rail note only when the build serves one", () => {
    // Landing-only is the default under test. The note must not say "open it in the editor" when
    // every chip below it leads to the quickstart instead.
    expect(EDITOR_REACHABILITY).toBe("hosted-landing");
    expect(CONTENT).not.toContain("open it in the editor");
  });

  it("ships a visible, zero-JS pause control (WCAG 2.2.2) wired to the rail", () => {
    expect(MARKUP).toContain('type="checkbox"');
    expect(MARKUP).toContain("prompt-rail__pause-label");
    expect(CONTENT).toContain("Pause");
    expect(RAIL_FAQ_CSS).toContain(
      ".prompt-rail__band:has(.prompt-rail__pause-input:checked) .prompt-rail__track",
    );
    // Only revealed where the animation runs AND :has() can drive it — never a dead control.
    expect(RAIL_FAQ_CSS).toContain("@supports selector(:has(*))");
  });

  it("renders every item as a real link, and every link from the machine-checked allowlist", () => {
    const allowed = new Set(EXAMPLE_PROMPTS.map((p) => promptHref(p.text)));
    const railHrefs = [...MARKUP.matchAll(/<a[^>]*class="prompt-rail__chip"[^>]*href="([^"]+)"/g)].map(
      (m) => m[1],
    );

    const copies = MARKUP.split("</ul>").length - 1;
    expect(copies).toBeGreaterThan(1);
    expect(railHrefs.length).toBe(copies * EXAMPLE_PROMPTS.length);
    for (const href of railHrefs) expect(allowed.has(href)).toBe(true);
    // Every allowlisted prompt is on the rail — the list is the source, not a hand-picked subset.
    for (const href of allowed) expect(railHrefs).toContain(href);
  });

  it("exposes exactly one focusable copy and makes the loop copies inert", () => {
    // Split on the closing tag: chunk i holds group i's opening tag and its items.
    const groups = MARKUP.split("</ul>").slice(0, -1);
    expect(groups.length).toBeGreaterThan(1);

    groups.forEach((group, index) => {
      const isLoopCopy = index > 0;
      expect(group).toContain(`data-rail-loop-copy="${isLoopCopy}"`);
      expect(group.includes('aria-hidden="true"')).toBe(isLoopCopy);
      // aria-hidden alone does not remove a link from the tab order — the anchors must opt out too.
      const unfocusable = group.match(/tabindex="-1"/g)?.length ?? 0;
      expect(unfocusable).toBe(isLoopCopy ? EXAMPLE_PROMPTS.length : 0);
    });

    const focusablePromptLinks =
      MARKUP.match(/<a[^>]*class="prompt-rail__chip"(?![^>]*tabindex="-1")/g)?.length ?? 0;
    expect(focusablePromptLinks).toBe(EXAMPLE_PROMPTS.length);
  });

  it("never puts an interactive prompt link inside sr-only", () => {
    expect(MARKUP).not.toMatch(/class="[^"]*sr-only[^"]*"[^>]*>\s*<a/);
  });
});

describe("PromptRailFaq — §6.7 the FAQ is one array rendered twice", () => {
  /**
   * The questions, in order. §6.7 specifies six; "Can AI edit a video timeline?" was merged into the
   * first, because the two shared one answer — see the note on `LANDING_FAQ`. Changing a question
   * still means changing the direction, not this file.
   */
  const SPEC_QUESTIONS = [
    "What is vibe coding for video editing?",
    "What can I actually type?",
    // Not from the direction. Added when the login wall was deleted: the CTA became one click from
    // an editor, and the session cookie became the only key to a project. See LANDING_FAQ's note.
    "Do I need an account?",
    "Does the export match the preview?",
    "Is HITE open source?",
    "Is this finished?",
  ];

  it("asks the questions the direction specifies, in order and byte-identical", () => {
    expect(LANDING_FAQ.map((f) => f.q)).toEqual(SPEC_QUESTIONS);
  });

  it("renders every question and every answer as visible text (§9.1)", () => {
    for (const { q, a } of LANDING_FAQ) {
      expect(CONTENT).toContain(q);
      expect(CONTENT).toContain(a);
    }
    // No heading on this section may be visually hidden — the §9.1 grep gate, enforced locally.
    expect(MARKUP).not.toMatch(/<h[1-6][^>]*class="[^"]*sr-only/);
    expect(MARKUP).not.toMatch(/<p[^>]*class="[^"]*sr-only[^"]*"[^>]*>[^<]{80,}/);
  });

  it("gives every answer real substance and a unique question", () => {
    expect(new Set(LANDING_FAQ.map((f) => f.q)).size).toBe(LANDING_FAQ.length);
    for (const { a } of LANDING_FAQ) expect(a.length).toBeGreaterThan(80);
  });
});

describe("PromptRailFaq — honesty gates", () => {
  const BANNED = ["to the pixel", "in seconds", "in minutes"];

  it("contains no banned phrase", () => {
    const haystack = CONTENT.toLowerCase();
    for (const phrase of BANNED) expect(haystack).not.toContain(phrase);
  });

  it("uses the word beta exactly once — the property's second and final use", () => {
    expect(CONTENT.toLowerCase().match(/\bbeta\b/g)?.length ?? 0).toBe(1);
  });

  it("never advertises beat-sync, a price, or a purchase", () => {
    const haystack = CONTENT.toLowerCase();
    // Beats are not wired (lib/render/resolver.ts) — the page may explain that, never offer it.
    expect(haystack).not.toContain("beat-sync");
    expect(haystack).not.toContain("sync the cuts to the beat");
    expect(haystack).not.toMatch(/\$\d/);
    expect(haystack).not.toContain("buy ");
    expect(haystack).not.toContain("upgrade to pro");
  });

  it("prints the gated catalog count, never the manifest's advertised size", () => {
    expect(CONTENT).toContain(`${RENDERABLE_ENTRY_COUNT} entries`);
    expect(CONTENT).not.toContain("76");
  });

  it("takes every timeline number from the generated fixture (§7.3)", () => {
    expect(CONTENT).toContain(`${MECHANISM_HEADLINE.commandCount} commands`);
    expect(CONTENT).toContain(MECHANISM_SOURCE.timecode);
    expect(CONTENT).toContain(MECHANISM_HEADLINE.timecode);
  });

  it("keeps the single glow for the nav's CTA (§4.4) and paints the close with the solid accent", () => {
    expect(RAIL_FAQ_CSS).not.toContain("--glow-accent");
    expect(RAIL_FAQ_CSS).toContain("background-color: var(--color-accent-cta)");
    // One owner for the microline — see SiteChrome's CTA_MICROLINE.
    expect(CONTENT).toContain(CTA_MICROLINE);
  });

  it("answers the account question without a login route to send anyone to", () => {
    // `/login` and `/verify` are deleted. A section that mentioned either would be advertising a
    // 404; a section that promised "you keep your edits" would be promising an account.
    expect(CONTENT).not.toMatch(/\/login|\/verify/);
    expect(CONTENT.toLowerCase()).not.toContain("you keep your edits");
    const account = LANDING_FAQ.find((f) => f.q === "Do I need an account?");
    expect(account).toBeDefined();
    // The answer must carry BOTH halves: the good news and the caveat that makes it honest.
    expect(account?.a).toMatch(/no sign-up screen/i);
    expect(account?.a).toMatch(/cookie/i);
  });
});
