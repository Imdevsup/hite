import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * suggestLook — REGISTRY-ADVISOR for curated multi-effect LOOK recipes.
 *
 * The planner names a vibe (a24, cinema-warm, skull, brutalist, document…) and this ranks the REAL
 * "looks" entries by how well their key/label/tags/description match, returning exact keys for
 * COMPOSE_LOOK. A look is only offered when EVERY step of its recipe lands (../renderableEntry):
 * one dead step is a dead look — the compiler drops steps whose analysis vars nothing supplies and
 * the renderer skips effect keys it has no component for, both silently, so a half-applied look is
 * indistinguishable to the user from a no-op that was reported as done.
 */
export const spec: ToolSpec = {
  name: "suggestLook",
  tier: "color",
  whenToUse:
    "Pick a curated multi-effect LOOK recipe key for a vibe (a24, cinema-warm, skull, brutalist, document).",
  tool: tool({
    description:
      "Suggest curated multi-effect LOOK recipe keys that match a vibe. Returns EXACT registry 'looks' keys (for COMPOSE_LOOK) ranked by relevance, limited to looks whose every recipe step actually renders in this build — never invented keys. Empty list means no renderable match; read `note` before answering.",
    inputSchema: z.object({
      vibe: z
        .string()
        .describe(
          "The desired aesthetic vibe, e.g. 'a24', 'cinema-warm', 'skull', 'brutalist', 'document'.",
        ),
    }),
    execute: async ({ vibe }) => {
      const looks = await byCategory("looks");

      const terms = vibe
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 0);

      const scored = looks
        .map((e) => {
          const hay = [
            e.key,
            e.label,
            e.description ?? "",
            ...(e.tags ?? []),
          ]
            .join(" ")
            .toLowerCase();
          let score = 0;
          for (const t of terms) {
            if (e.key.toLowerCase() === t) score += 5;
            else if (hay.includes(t)) score += 1;
          }
          return { entry: e, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

      const { renderable, unrenderable } = partitionRenderableEntries(scored.map((s) => s.entry));
      const note = withheldNote(unrenderable);

      return {
        suggestions: renderable.map((entry) => ({
          key: entry.key,
          name: entry.label,
          description: entry.description ?? "",
        })),
        ...(note ? { note } : {}),
      };
    },
  }),
};
