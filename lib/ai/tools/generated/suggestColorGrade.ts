import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * suggestColorGrade — REGISTRY-ADVISOR.
 *
 * Resolves a mood/intent (warm, cold, cinematic, moody, vintage, high-contrast) to the EXACT
 * color/LUT registry keys, ranked by how well each entry's key/label/tags match the intent words.
 * Backed by the live manifest via byCategory(["color","luts"]) and gated on what the renderer can
 * actually paint (../renderableEntry) — never invents keys, never advertises a dead one. Returns
 * the top ~8 real entries (empty list if nothing matches).
 */

const MAX_SUGGESTIONS = 8;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

export const spec: ToolSpec = {
  name: "suggestColorGrade",
  tier: "color",
  whenToUse:
    "Pick exact color/LUT effect keys for a mood (warm, cold, cinematic, moody, vintage, high-contrast).",
  tool: tool({
    description:
      "Suggest the EXACT color/LUT registry keys for a desired mood or grade intent (e.g. 'warm cinematic', 'cold moody', 'vintage high-contrast'). Ranks real entries from the color + luts catalog by how well their key/name/tags match your intent words. Returns { suggestions: [{ key, name, description }] } — never invents keys; returns an empty list if nothing matches.",
    inputSchema: z.object({
      intent: z
        .string()
        .describe(
          "Mood / grade intent words, e.g. 'warm cinematic', 'cold moody', 'vintage', 'high-contrast'.",
        ),
    }),
    execute: async ({ intent }) => {
      const tokens = tokenize(intent);
      const entries = await byCategory(["color", "luts"]);

      const ranked = entries
        .map((e) => {
          const key = e.key.toLowerCase();
          const label = e.label.toLowerCase();
          const tags = e.tags.map((t) => t.toLowerCase());
          let score = 0;
          for (const token of tokens) {
            if (key.includes(token)) score += 3;
            if (label.includes(token)) score += 2;
            if (tags.some((tag) => tag.includes(token))) score += 2;
          }
          return { entry: e, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);

      const { renderable, unrenderable } = partitionRenderableEntries(ranked.map((r) => r.entry));
      const note = withheldNote(unrenderable);

      return {
        suggestions: renderable.slice(0, MAX_SUGGESTIONS).map((entry) => ({
          key: entry.key,
          name: entry.label,
          description: entry.description ?? "",
        })),
        ...(note ? { note } : {}),
      };
    },
  }),
};
