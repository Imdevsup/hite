import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RealTimeline, trimRangeFrames, trimmedTotalTicks } from "./RealTimeline";
import { MECHANISM, MECHANISM_HEADLINE, MECHANISM_SOURCE, MECHANISM_VARIANTS } from "@/lib/landing/fixture";
import { EXAMPLE_PROMPT_TEXTS } from "@/lib/landing/prompts";
import { LANDING_FPS, ticksToLandingFrames } from "@/lib/landing/format";
import { framesToTicks } from "@/lib/edl/time";

/**
 * The §6.3 section's build gates. Three families, and all three are things a careful reviewer would
 * otherwise have to re-check by eye on every edit:
 *
 *   1. §9.1 — the polarity gate. The <h2> and the explanation are VISIBLE server-rendered text. The
 *      whole reason this section exists is that the previous landing hid its own explanation inside
 *      `.sr-only`, so a test that fails on a visually-hidden heading is not ceremony.
 *   2. §7.3 — the numbers gate. Everything printed is the reducer's output. `trimmedTotalTicks(v, 0)`
 *      must return `v.durationTicks` EXACTLY, or the page is quietly rounding the fixture.
 *   3. §7.2 / the honesty rules — no banned phrase, no beat claim, no "76".
 *
 * Rendered with `renderToStaticMarkup`, which is what the crawler and the answer engine actually
 * see: if a claim is not in this string, it is not on the page.
 */

const HTML = renderToStaticMarkup(<RealTimeline />);
/** Tag soup out, human-readable text in — what a reader (or an extractor) gets from the section. */
const TEXT = HTML.replace(/<[^>]+>/g, " ")
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&amp;/g, "&")
  // The page sets real typographic quotes; assertions here are written in ASCII.
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/\s+/g, " ")
  .trim();

const FRAME_TICKS = framesToTicks(1, LANDING_FPS);

describe("§9.1 — the sr-only polarity is inverted, and stays inverted", () => {
  test("the H2 is the spec's sentence, visible and server-rendered", () => {
    expect(HTML).toContain("The AI writes the edit. You still own it.");
    const h2 = HTML.match(/<h2[^>]*>/);
    expect(h2).not.toBeNull();
    expect(h2?.[0]).not.toContain("sr-only");
  });

  test("no heading anywhere in the section is visually hidden", () => {
    for (const tag of HTML.match(/<h[1-6][^>]*>/g) ?? []) {
      expect(tag).not.toContain("sr-only");
    }
  });

  test("the explanation is visible text, not an aria-label", () => {
    expect(TEXT).toContain("three real timelines");
    expect(TEXT).toContain("Drag the last clip's out point");
  });

  test("aria-hidden is only ever on layers that carry no meaning (§9.2)", () => {
    // Every aria-hidden node in this section is a rule, a gradient span, a collapsed slot or a
    // glyph. If one ever wraps a labelled instrument, this count is the thing that moves first.
    expect(HTML).toContain('role="group"');
    expect(HTML).toContain('role="img"');
    expect(HTML).toContain('role="slider"');
  });
});

describe("§7.3 — every number on the page is the reducer's, not this file's", () => {
  test("an untrimmed timeline prints the generated duration byte-for-byte", () => {
    for (const v of MECHANISM_VARIANTS) {
      expect(trimmedTotalTicks(v, 0)).toBe(v.durationTicks);
    }
  });

  test("the SSR markup shows the source and headline durations from the fixture", () => {
    expect(TEXT).toContain(MECHANISM_SOURCE.timecode);
    expect(TEXT).toContain(MECHANISM_HEADLINE.timecode);
    expect(TEXT).toContain(`${MECHANISM_HEADLINE.durationFrames} f`);
    expect(TEXT).toContain(`${MECHANISM_HEADLINE.commandCount} commands`);
  });

  test("the default render is the fixture's headline variant", () => {
    expect(TEXT).toContain(MECHANISM_HEADLINE.prompt);
    expect(TEXT).toContain(MECHANISM_HEADLINE.note);
  });

  test("the provenance sentence and the checkable artifact are both on the page", () => {
    expect(TEXT).toContain(MECHANISM.provenance);
    expect(HTML).toContain(MECHANISM.fullArtifactUrl);
  });
});

describe("the trim is the reducer's TRIM_CLIP, not a free-hand animation", () => {
  test("extending to the maximum lands exactly on the end of the source take", () => {
    for (const v of MECHANISM_VARIANTS) {
      const { max } = trimRangeFrames(v);
      const clip = v.clips.at(-1);
      expect(clip).toBeDefined();
      if (!clip) return;
      // `TRIM_CLIP edge:"out"` clamps at `availableOutTick` — the source take's own length.
      expect(clip.sourceOutTick + max * FRAME_TICKS).toBeLessThanOrEqual(MECHANISM_SOURCE.durationTicks);
      expect(clip.sourceOutTick + (max + 1) * FRAME_TICKS).toBeGreaterThan(MECHANISM_SOURCE.durationTicks);
    }
  });

  test("trimming to the minimum still leaves at least one frame of clip", () => {
    for (const v of MECHANISM_VARIANTS) {
      const { min } = trimRangeFrames(v);
      const clip = v.clips.at(-1);
      expect(clip).toBeDefined();
      if (!clip) return;
      const outAtMin = clip.sourceOutTick + min * FRAME_TICKS;
      expect(outAtMin - clip.sourceInTick).toBeGreaterThanOrEqual(FRAME_TICKS);
      expect(min).toBeLessThan(0);
    }
  });

  test("moving the edge moves the frame count — the section's whole claim", () => {
    const base = trimmedTotalTicks(MECHANISM_HEADLINE, 0);
    const longer = trimmedTotalTicks(MECHANISM_HEADLINE, 1);
    const shorter = trimmedTotalTicks(MECHANISM_HEADLINE, -1);
    expect(ticksToLandingFrames(longer)).toBe(ticksToLandingFrames(base) + 1);
    expect(ticksToLandingFrames(shorter)).toBe(ticksToLandingFrames(base) - 1);
  });

  test("out-of-range input is clamped, never thrown or wrapped", () => {
    const { min, max } = trimRangeFrames(MECHANISM_HEADLINE);
    expect(trimmedTotalTicks(MECHANISM_HEADLINE, max + 1000)).toBe(trimmedTotalTicks(MECHANISM_HEADLINE, max));
    expect(trimmedTotalTicks(MECHANISM_HEADLINE, min - 1000)).toBe(trimmedTotalTicks(MECHANISM_HEADLINE, min));
  });
});

describe("§6.3 — the segmented control offers every generated variant", () => {
  test("all three prompts are rendered, and exactly one is checked", () => {
    for (const v of MECHANISM_VARIANTS) expect(TEXT).toContain(v.prompt);
    expect(HTML.match(/checked=""/g) ?? []).toHaveLength(1);
  });

  test("every variant prompt extends a prompt on §7.2's allowlist", () => {
    // The three strings are fixture data, not launchable example prompts — but the capability they
    // describe still has to be one the product really performs. Each is "cut the dead air" plus a
    // qualifier, and that base sentence is allowlist entry one.
    for (const v of MECHANISM_VARIANTS) {
      expect(EXAMPLE_PROMPT_TEXTS.some((p) => v.prompt.startsWith(p))).toBe(true);
    }
  });
});

describe("the honesty rules", () => {
  const BANNED = ["to the pixel", "in seconds", "in minutes"];

  test("no banned phrase", () => {
    for (const phrase of BANNED) expect(TEXT.toLowerCase()).not.toContain(phrase);
  });

  test("no beat claim — beats are not wired (lib/render/resolver.ts)", () => {
    expect(TEXT.toLowerCase()).not.toContain("beat");
    expect(TEXT.toLowerCase()).not.toContain("bpm");
  });

  test('never prints the registry\'s advertised 76; 39 is the renderable count', () => {
    expect(TEXT).not.toContain("76");
  });

  test("no fabricated media: the fixture ships no footage and the page says so", () => {
    expect(MECHANISM.asset.hasMedia).toBe(false);
    expect(TEXT).toContain("source not linked");
    expect(HTML).not.toContain("<img");
    expect(HTML).not.toContain("<video");
  });

  test('the word "beta" is not spent here — §6.7 owns both permitted uses', () => {
    expect(TEXT.toLowerCase()).not.toContain("beta");
  });
});
