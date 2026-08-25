import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry"; // type-only import (no runtime cycle)
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * browseRegistry — enumerate every USABLE key in one registry category.
 *
 * Where searchRegistry ranks by keyword, this is the exhaustive list: when the model is unsure what
 * even exists in a category, it browses the set and picks a real key. "Real" includes renderable —
 * an exhaustive listing was the widest hole in the advisors, handing the model every dead audio /
 * procedural / over-promising-transition key at once (../renderableEntry).
 */
export const spec: ToolSpec = {
  name: "browseRegistry",
  tier: "registry",
  whenToUse: "List every key in a category to choose from when unsure what exists.",
  tool: tool({
    description:
      "List every registry entry in one category (color, audio, glitch, luts, overlays, looks, procedural, text, transitions) that this build can actually render. Use this when you don't know what keys exist and want the full set to choose from — returns the EXACT keys to pass to applyEffect / applyOverlay / composeLook. An empty list with a `note` means the category exists on paper but nothing in it renders; never invent keys.",
    inputSchema: z.object({
      category: z
        .enum([
          "color",
          "audio",
          "glitch",
          "luts",
          "overlays",
          "looks",
          "procedural",
          "text",
          "transitions",
        ])
        .describe("the registry category to enumerate"),
    }),
    execute: async ({ category }) => {
      const { renderable, unrenderable } = partitionRenderableEntries(await byCategory(category));
      const note = withheldNote(unrenderable);
      return {
        suggestions: renderable.map((e) => ({
          key: e.key,
          name: e.label,
          description: e.description ?? "",
        })),
        ...(note ? { note } : {}),
      };
    },
  }),
};
