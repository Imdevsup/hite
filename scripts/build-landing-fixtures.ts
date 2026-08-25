#!/usr/bin/env tsx
/**
 * Build-time landing fixture generation (DESIGN-DIRECTION §7.3).
 *
 * Runs the REAL `reduceBatch` over real `EditCommand[]` and writes the resulting Edl.2, the derived
 * clip geometry, the before/after durations and the pretty-printed command JSON to
 * `public/landing/` — the single source every number on the landing page is read from. There are no
 * numeric literals in the landing components; they interpolate these files.
 *
 * Two outputs, one reduction (see `toDisplayFixture` for why): the full artifact with its EDLs, and
 * the display projection the components import.
 *
 * Belongs next to `scripts/build-registry.ts` in `prebuild`. All the logic lives in
 * `lib/landing/build-fixture.ts` (pure), so `lib/landing/fixture.test.ts` can re-run it and fail the
 * build the moment a committed artifact drifts from what the pipeline produces.
 *
 * Run: pnpm tsx scripts/build-landing-fixtures.ts
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildMechanismFixture, serializeFixture, toDisplayFixture } from "../lib/landing/build-fixture";
import {
  LANDING_FIXTURE_DISPLAY_PATH,
  LANDING_FIXTURE_PATH,
  LANDING_FIXTURE_URL,
} from "../lib/landing/fixture-path";

const ROOT = process.cwd();

/**
 * Write only when the bytes change, so the artifact's mtime moves only when its contents do — a
 * rebuild that changed nothing should not show up in `git status` or bust a file watcher.
 */
async function writeIfChanged(relPath: string, body: string): Promise<boolean> {
  const out = join(ROOT, relPath);
  const existing = await readFile(out, "utf8").catch(() => null);
  if (existing === body) return false;
  await mkdir(join(ROOT, "public", "landing"), { recursive: true });
  await writeFile(out, body, "utf8");
  return true;
}

async function main(): Promise<void> {
  const fixture = buildMechanismFixture();
  const headline = fixture.variants.find((v) => v.id === fixture.headlineVariantId);
  if (!headline) throw new Error(`headline variant "${fixture.headlineVariantId}" missing from build output`);

  const wroteFull = await writeIfChanged(LANDING_FIXTURE_PATH, serializeFixture(fixture));
  const wroteDisplay = await writeIfChanged(
    LANDING_FIXTURE_DISPLAY_PATH,
    serializeFixture(toDisplayFixture(fixture, LANDING_FIXTURE_URL)),
  );

  console.log(
    `[landing] ${wroteFull || wroteDisplay ? "wrote" : "up to date"} ${LANDING_FIXTURE_PATH} + ` +
      `${LANDING_FIXTURE_DISPLAY_PATH} — ${fixture.variants.length} variants; ` +
      `headline "${headline.prompt}": ${fixture.source.timecode} → ${headline.timecode}, ` +
      `${fixture.source.clipCount} clip → ${headline.clipCount} clips, ${headline.commandCount} commands`,
  );
}

main().catch((err: unknown) => {
  console.error("[landing] fixture build failed:", err);
  process.exit(1);
});
