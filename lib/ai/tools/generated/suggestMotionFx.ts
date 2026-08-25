import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * suggestMotionFx — advisor that ranks REAL glitch/procedural motion-effect keys
 * against a free-text intent (e.g. "punch in on the drop", "rgb split flash").
 *
 * No fabrication, on both axes: keys come straight from the live manifest via byCategory, AND every
 * suggestion is gated on the render layer actually painting it (../renderableEntry). Without that
 * gate "add a lens flare" returned proc-lens-flare-warm, which has no renderer — the model emitted
 * it, the reducer stored it, and the video came back identical under a success message.
 */
export const spec: ToolSpec = {
  name: "suggestMotionFx",
  tier: "motion",
  whenToUse:
    "Pick glitch/zoom/motion effect keys (zoom-punch, rgb-split, glitch-bars, chromatic).",
  tool: tool({
    description:
      "Suggest REAL motion/glitch effect registry keys for an intent. Returns the exact keys to pass to applyEffect, filtered to the ones this build can actually render — never invent keys. Empty list means no renderable match; check `note` for anything that was withheld.",
    inputSchema: z.object({
      intent: z
        .string()
        .describe(
          "What the motion effect should do, e.g. 'zoom punch on the drop', 'rgb split flash', 'glitch bars'",
        ),
    }),
    execute: async ({ intent }) => {
      const entries = await byCategory(["glitch", "procedural"]);

      const terms = intent
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);

      const matched = entries
        .map((e) => {
          const hay = [e.key, e.label, e.description ?? "", e.tags.join(" ")]
            .join(" ")
            .toLowerCase();
          let score = 0;
          for (const term of terms) if (hay.includes(term)) score += 1;
          return { e, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.e);

      const { renderable, unrenderable } = partitionRenderableEntries(matched);
      const note = withheldNote(unrenderable);

      return {
        suggestions: renderable.slice(0, 12).map((e) => ({
          key: e.key,
          name: e.label,
          description: e.description ?? "",
        })),
        ...(note ? { note } : {}),
      };
    },
  }),
};
