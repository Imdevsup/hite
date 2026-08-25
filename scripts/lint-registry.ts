#!/usr/bin/env tsx
/**
 * Catalog lint — CI check that every `entries/**\/*.json` is a valid
 * RegistryEntry and that keys are unique. Also warns about entries with
 * `engine: 'ffmpeg'` missing an `ffmpegFilter`, entries with `engine: 'lut'`
 * missing a `lutFile`, etc. — any dependency that the runtime would crash
 * on if violated.
 *
 * AND: every entry in a CLIP-EFFECT category must have a registered renderer. An effect the
 * pipeline cannot paint is worse than a missing one — `ClipFx` skips it silently, so the AI or the
 * palette applies it, reports success, and the video comes back pixel-identical. Catching that here
 * makes it a build failure at the moment the entry is authored instead of a support ticket.
 *
 * Exits non-zero on any error. Run in CI before `next build`.
 */
import fg from "fast-glob";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RegistryEntry, type RegistryCategory } from "../lib/registry/types";
import { RENDERABLE_EFFECT_KEYS } from "../lib/remotion/renderable";

const ROOT = process.cwd();

/**
 * Categories whose entries are applied as CLIP EFFECTS (ADD_EFFECT / a look recipe's applyEffect) and
 * therefore need an entry in the renderer registry. `transitions`, `overlays`, `text` and `looks`
 * render through their own paths; `audio` and `procedural` have no renderer at all, which is why
 * lib/remotion/renderable.ts exists to keep them out of what the AI is offered.
 */
const RENDERABLE_CATEGORIES: RegistryCategory[] = ["color", "luts", "glitch"];

interface LintError {
  file: string;
  message: string;
}

async function main() {
  const files = await fg(["entries/**/*.json"], { cwd: ROOT });
  const seenKeys = new Map<string, string>(); // key -> first file
  const errors: LintError[] = [];

  for (const f of files) {
    const full = join(ROOT, f);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(full, "utf8"));
    } catch (e) {
      errors.push({ file: f, message: `invalid JSON: ${(e as Error).message}` });
      continue;
    }

    const parsed = RegistryEntry.safeParse(raw);
    if (!parsed.success) {
      errors.push({ file: f, message: `schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
      continue;
    }

    const entry = parsed.data;
    if (seenKeys.has(entry.key)) {
      errors.push({ file: f, message: `duplicate key "${entry.key}" (first in ${seenKeys.get(entry.key)})` });
    } else {
      seenKeys.set(entry.key, f);
    }

    // Per-engine shape checks.
    if (entry.engine === "lut" && !entry.lutFile) {
      errors.push({ file: f, message: `engine=lut requires "lutFile"` });
    }
    if (entry.engine === "ffmpeg" && !entry.ffmpegFilter && !entry.recipe) {
      errors.push({ file: f, message: `engine=ffmpeg requires "ffmpegFilter" (or must be a recipe-stepped preset)` });
    }
    if (entry.engine === "overlay-asset" && !entry.overlayAsset) {
      errors.push({ file: f, message: `engine=overlay-asset requires "overlayAsset"` });
    }
    if (entry.engine === "composed" && (!Array.isArray(entry.recipe) || entry.recipe.length === 0)) {
      errors.push({ file: f, message: `engine=composed requires non-empty "recipe"` });
    }
    if (entry.engine === "remotion" && !entry.component) {
      errors.push({ file: f, message: `engine=remotion requires "component"` });
    }
    if (RENDERABLE_CATEGORIES.includes(entry.category) && !RENDERABLE_EFFECT_KEYS.has(entry.key)) {
      errors.push({
        file: f,
        message: `category=${entry.category} is a clip-effect category but "${entry.key}" has no renderer — register one in lib/remotion/registry.tsx, or the effect applies silently and changes nothing`,
      });
    }
  }

  if (errors.length === 0) {
    console.log(`[registry-lint] ✓ ${files.length} entries valid, ${seenKeys.size} unique keys`);
    return;
  }

  for (const e of errors) {
    console.error(`[registry-lint] ✗ ${e.file}: ${e.message}`);
  }
  console.error(`[registry-lint] ${errors.length} error(s)`);
  process.exit(1);
}

main().catch((e) => {
  console.error("[registry-lint] crashed:", e);
  process.exit(1);
});
