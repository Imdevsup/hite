import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * suggestTransition — REGISTRY-ADVISOR (motion tier).
 *
 * Resolves a free-text style word (whip, glitch, fade, crossfade, cube, …) to transition keys from
 * the live registry, ranked by how well each entry matches — and gated on whether v1 renders the
 * thing the key is NAMED after (../renderableEntry). Most of the catalog names a blend or move of
 * the two clips' pixels, which v1 does not do; suggesting "trans-crossfade" got the user a dip to
 * black under a message saying they had a crossfade. When the gate is what emptied the list, the
 * `note` says so, so the model can offer an honest alternative instead of guessing again.
 */
export const spec: ToolSpec = {
  name: "suggestTransition",
  tier: "motion",
  whenToUse: "Pick a transition key for a style (whip, glitch, fade, crossfade, cube).",
  tool: tool({
    description:
      "Suggest transition registry keys for a desired style (e.g. 'whip', 'glitch', 'fade', 'crossfade', 'cube'). Returns ranked { key, name, description } entries that this build renders faithfully — pass a key straight to ADD_TRANSITION. Empty list means nothing renderable matched; read `note` before answering, and never invent keys.",
    inputSchema: z.object({
      style: z
        .string()
        .describe("desired transition style, e.g. 'whip', 'glitch', 'fade', 'crossfade', 'cube'"),
    }),
    execute: async ({ style }) => {
      const entries = await byCategory("transitions");
      const q = style.trim().toLowerCase();

      const scored = entries
        .map((e) => {
          const key = e.key.toLowerCase();
          const label = e.label.toLowerCase();
          const desc = (e.description ?? "").toLowerCase();
          let score = 0;
          if (q.length > 0) {
            if (key === q || label === q) score += 100;
            if (key.includes(q)) score += 40;
            if (label.includes(q)) score += 30;
            if (desc.includes(q)) score += 10;
          }
          return { entry: e, score };
        })
        .filter((s) => (q.length === 0 ? true : s.score > 0))
        .sort((a, b) => b.score - a.score);

      const { renderable, unrenderable } = partitionRenderableEntries(scored.map((s) => s.entry));
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
