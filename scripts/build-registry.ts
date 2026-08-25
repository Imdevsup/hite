#!/usr/bin/env tsx
/**
 * Build-time registry expansion. Reads every `entries/**\/*.json` as a
 * base entry; for each category that declares a generator, expands into
 * derived entries and writes the combined `public/registry/manifest.json`.
 *
 * Run: pnpm tsx scripts/build-registry.ts
 */
import fg from "fast-glob";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { RegistryEntry } from "../lib/registry/types";

const ROOT = process.cwd();

const LUT_SOURCES = [
  "a24-moonlight", "a24-dusk", "kodachrome-64", "fuji-pro-400h", "portra-160",
  "cinestill-800t", "ektachrome-100", "vhs-worn", "vhs-fresh", "polaroid-sx70",
  // …placeholder — real build expands to 300 when LUT packs are dropped in public/luts
];

const TRANSITION_SOURCES = [
  "fade", "crossfade", "dissolve", "wipe-left", "wipe-right", "wipe-up", "wipe-down",
  "slide-left", "slide-right", "zoom-in", "zoom-out", "whip-pan-l", "whip-pan-r",
  "cube-rotate-l", "cube-rotate-r", "glitch-cut", "rgb-split-cut", "flash-cut",
  "burn-to-white", "burn-to-black",
  // …expands to 120 when gl-transitions shaders are imported.
];

async function main() {
  const base: RegistryEntry[] = [];

  // Read authored entries first (they override generators on key collision).
  // Sorted: fast-glob's order is filesystem-dependent, and the de-dupe below keeps the FIRST
  // entry for a key — so unsorted input makes collision precedence vary by machine, not just
  // the output ordering. Sort here and again before writing so the manifest is reproducible.
  const files = (await fg(["entries/**/*.json"], { cwd: ROOT })).sort();
  for (const f of files) {
    const raw = JSON.parse(await readFile(join(ROOT, f), "utf8"));
    try {
      base.push(RegistryEntry.parse(raw));
    } catch (e) {
      console.warn(`[registry] bad entry ${f}:`, e);
    }
  }

  // Expand LUTs.
  for (const key of LUT_SOURCES) {
    if (base.some((b) => b.key === `lut-${key}`)) continue;
    base.push(RegistryEntry.parse({
      key: `lut-${key}`,
      label: key.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
      category: "luts",
      tags: ["lut", key.split("-")[0]],
      engine: "lut",
      lutFile: `/luts/${key}.cube`,
      params: [
        { key: "intensity", label: "Intensity", kind: "percent", default: 1 },
      ],
      stability: "stable",
    }));
  }

  // Expand gl-transitions.
  for (const key of TRANSITION_SOURCES) {
    if (base.some((b) => b.key === `trans-${key}`)) continue;
    base.push(RegistryEntry.parse({
      key: `trans-${key}`,
      label: key.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
      category: "transitions",
      tags: ["transition", key.split("-")[0]],
      engine: "gl-transitions",
      params: [
        { key: "duration", label: "Duration", kind: "duration", default: 400, min: 100, max: 2000, step: 50 },
      ],
      stability: "stable",
    }));

    // Variant: twice-as-fast
    base.push(RegistryEntry.parse({
      key: `trans-${key}-fast`,
      label: `${key.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")} · Fast`,
      category: "transitions",
      tags: ["transition", key.split("-")[0], "fast"],
      engine: "gl-transitions",
      params: [
        { key: "duration", label: "Duration", kind: "duration", default: 200 },
      ],
      stability: "stable",
    }));
  }

  // De-dupe & write.
  const seen = new Set<string>();
  const manifest = base
    .filter((e) => {
      if (seen.has(e.key)) return false;
      seen.add(e.key);
      return true;
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const outPath = join(ROOT, "public/registry/manifest.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(manifest, null, 2));
  console.log(`[registry] wrote ${manifest.length} entries → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
