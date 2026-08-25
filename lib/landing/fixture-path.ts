/**
 * lib/landing/fixture-path.ts — where the generated fixtures live, stated once.
 *
 * Split out of `fixture.ts` so the build SCRIPT can name its output paths without importing the
 * consumer module (which imports a generated JSON — a file that does not exist on a clean checkout
 * until the script has run at least once).
 */

/**
 * The full artifact: every EDL, every command, the whole reduction. Nothing imports it as a module
 * (see `build-fixture.ts` `toDisplayFixture`); it is served as a static file so a reader can check
 * the page's claims against the real reduced timeline.
 */
export const LANDING_FIXTURE_PATH = "public/landing/mechanism.json" as const;
export const LANDING_FIXTURE_URL = "/landing/mechanism.json" as const;

/** The display projection — what `lib/landing/fixture.ts` imports and the sections render. */
export const LANDING_FIXTURE_DISPLAY_PATH = "public/landing/mechanism.display.json" as const;
