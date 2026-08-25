import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry"; // type-only import (no runtime cycle)
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * suggestCaptionStyle — REGISTRY-ADVISOR for the planner's text tier.
 *
 * Surfaces REAL caption/title/text style keys from the live registry's "text"
 * category so the model can pick one instead of inventing a key. When a `vibe`
 * is given, entries are ranked by how well their label/description/tags match
 * the vibe words; otherwise the natural catalog order is preserved. Never
 * fabricates — returns { suggestions: [] } if the category is empty.
 *
 * Runs through the same renderability gate as every other advisor. It withholds nothing today —
 * these are caption STYLES for ADD_CAPTION, which CaptionView renders style-aware, not effect keys —
 * but no advisor should be the one that skipped the gate.
 */
export const spec: ToolSpec = {
  name: "suggestCaptionStyle",
  tier: "text",
  whenToUse: "Pick a caption/title/text style key.",
  tool: tool({
    description:
      "Suggest REAL caption/title/text style keys from the registry's text category, optionally ranked by a vibe. Use to choose a caption/title style key — never invent text keys.",
    inputSchema: z.object({
      vibe: z
        .string()
        .optional()
        .describe("optional mood/feel, e.g. 'bold phonk', 'clean minimal', 'retro glitch'"),
    }),
    execute: async ({ vibe }) => {
      const entries = await byCategory("text");

      const terms = (vibe ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);

      const scored = entries.map((e) => {
        const haystack = [e.label, e.description ?? "", ...e.tags].join(" ").toLowerCase();
        const score = terms.reduce((acc, t) => (haystack.includes(t) ? acc + 1 : acc), 0);
        return { e, score };
      });

      if (terms.length > 0) {
        scored.sort((a, b) => b.score - a.score);
      }

      const { renderable, unrenderable } = partitionRenderableEntries(scored.map((s) => s.e));
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
