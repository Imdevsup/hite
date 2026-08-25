#!/usr/bin/env tsx
/**
 * Bundle the planner/refiner system prompts into a TS module.
 *
 * The prompts are AUTHORED as markdown (lib/ai/prompts/*.md) but must never be `readFileSync`'d at
 * runtime — a serverless function has no repo on disk, which ENOENT-500ed /api/plan + /api/refine.
 * So the .md files are the source of truth and this script mirrors them into
 * `lib/ai/prompts/prompts.generated.ts` as plain string exports, which the bundler inlines.
 *
 * The generated file is COMMITTED (the build does not run this), so re-run it after editing a .md:
 *   pnpm tsx scripts/build-prompts.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PROMPT_DIR = join(process.cwd(), "lib", "ai", "prompts");

/** Each entry: the authored markdown → the export name the AI layer imports. */
const PROMPTS = [
  { file: "system-planner.md", exportName: "systemPlanner" },
  { file: "system-refiner.md", exportName: "systemRefiner" },
] as const;

const HEADER = [
  "// AUTO-GENERATED — do not edit by hand.",
  "// Source of truth: the .md files next to this one; regenerate with `pnpm tsx scripts/build-prompts.ts`.",
  "// Bundled as a TS module so serverless functions never readFileSync the prompts at runtime",
  "// (that ENOENT 500ed /api/plan + /api/refine).",
].join("\n");

async function main() {
  const bodies: string[] = [];
  for (const { file, exportName } of PROMPTS) {
    const md = await readFile(join(PROMPT_DIR, file), "utf8");
    // JSON.stringify is the whole transform: exact bytes, escaped as a TS string literal.
    bodies.push(`export const ${exportName} = ${JSON.stringify(md)};`);
  }
  const outPath = join(PROMPT_DIR, "prompts.generated.ts");
  await writeFile(outPath, `${HEADER}\n${bodies.join("\n")}\n`);
  console.log(`[prompts] wrote ${PROMPTS.length} prompts → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
