/**
 * lib/landing/fixture.ts — what the landing sections import to draw the timeline proof.
 *
 * DESIGN-DIRECTION §7.3: "Every number the page animates — the digit roll, the duration decrement,
 * the clip count, the catalog count — reads from generated output. There are no numeric literals in
 * landing components."
 *
 * This module is that read. It exposes ONLY generated values: durations already formatted as the
 * strings the page prints ("0:48", "0:39"), clip rectangles with their derived timeline spans, the
 * silent spans a waveform highlights, and the pretty-printed `EditCommand[]` the §6.2 `<pre>`
 * quotes. Nothing here is typed by hand; `fixture.test.ts` re-runs the generator and fails the build
 * if the committed artifact and the real reducer ever disagree.
 *
 * NO FOOTAGE EXISTS. `asset.hasMedia` is `false` and stays false until §11's capture session. A
 * consumer must draw the honest media-offline instrument state where a program frame would go —
 * never a stock image, never a mock screenshot.
 */
import raw from "@/public/landing/mechanism.display.json";
import type { LandingFixtureDisplay } from "./build-fixture";

export type { FixtureClip, FixtureSpan, LandingFixtureDisplay } from "./build-fixture";
export { LANDING_FIXTURE_URL } from "./fixture-path";

/**
 * A JSON module import widens every literal (`kind: "leading"` becomes `string`), so the artifact
 * cannot structurally satisfy its own type without an assertion. The assertion is safe for a reason
 * stronger than a runtime `safeParse` would give: `fixture.test.ts` regenerates the artifact from
 * `buildMechanismFixture()` — which IS typed — and diffs it byte-for-byte against this file. If the
 * shapes ever diverge, the test fails before the page can render a wrong number.
 */
export const MECHANISM = raw as unknown as LandingFixtureDisplay;

/** A single variant of the §6.3 segmented control, or `undefined` for an unknown id. */
export function mechanismVariant(id: string): LandingFixtureDisplay["variants"][number] | undefined {
  return MECHANISM.variants.find((v) => v.id === id);
}

/**
 * The variant §6.2's set-piece animates — the one §2.2 names ("the duration readout rolls
 * 0:48 → 0:39"). Resolved at module scope so a bad `headlineVariantId` is a build-time crash rather
 * than a section that silently renders nothing.
 */
export const MECHANISM_HEADLINE: LandingFixtureDisplay["variants"][number] = (() => {
  const headline = mechanismVariant(MECHANISM.headlineVariantId);
  if (!headline) {
    throw new Error(
      `landing fixture: headlineVariantId "${MECHANISM.headlineVariantId}" is not in the generated variants`,
    );
  }
  return headline;
})();

/** The take before the edit — `"0:48"` and the single full-length clip the theater opens on. */
export const MECHANISM_SOURCE: LandingFixtureDisplay["source"] = MECHANISM.source;

/** Every variant, in the order §6.3's segmented control lists them. */
export const MECHANISM_VARIANTS: readonly LandingFixtureDisplay["variants"][number][] = MECHANISM.variants;
