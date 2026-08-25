import { z } from "zod";
import { tool } from "ai";
import { loadCatalog } from "@/lib/registry/catalog";
import { search } from "@/lib/registry/search";
import type { RegistryCategory } from "@/lib/registry/types";
import { filterRenderable } from "./renderableEntry";

/**
 * searchRegistry — lets the planner DISCOVER real registry keys instead of guessing them.
 *
 * "Real" means two things, and only one of them used to be checked: the key must exist in the
 * manifest AND the render pipeline must actually paint it. Entries that fail the second test are
 * removed here (see ./renderableEntry.ts) — surfacing one produced an edit the model reported as
 * done over a pixel-identical video.
 */
export const SearchRegistryInput = z.object({
  query: z.string().describe("keyword(s), e.g. 'warm cinematic', 'glitch', 'whip pan'"),
  category: z.enum(["transitions", "luts", "color", "glitch", "text", "audio", "overlays", "looks", "procedural"]).optional(),
  limit: z.number().int().positive().max(50).default(12),
});
export type SearchRegistryInput = z.infer<typeof SearchRegistryInput>;

export async function runSearchRegistry(input: SearchRegistryInput) {
  const entries = filterRenderable(await loadCatalog());
  const results = search(entries, input.query, {
    category: input.category as RegistryCategory | undefined,
    stability: ["stable", "beta"],
    limit: input.limit,
  });
  return {
    count: results.length,
    results: results.map((e) => ({
      key: e.key,
      label: e.label,
      category: e.category,
      engine: e.engine,
      description: e.description,
    })),
  };
}

export const searchRegistry = tool({
  description:
    "Search the effect/look/LUT/transition/overlay/caption registry by keyword. Returns the EXACT registry keys to pass to applyEffect / applyOverlay / composeLook. Only keys this build can actually render are returned, so anything you get back is safe to emit. Call this whenever you are unsure of a key — never invent keys, and never emit a key this tool did not return.",
  inputSchema: SearchRegistryInput,
  execute: runSearchRegistry,
});
