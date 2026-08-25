import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry"; // type-only import (no runtime cycle)
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * suggestAudioFx — ADVISOR over the registry's `audio` category, gated on what renders.
 *
 * As of this build that gate empties the category: compressor-vocal / eq-bright / reverb-plate are
 * advertised in the manifest but nothing renders a clip audio effect (the compiler handles audio
 * BEDS only). This tool therefore exists to say so. That is deliberate — returning the three keys
 * had the model emit ADD_EFFECT and report "vocals punched up" over audio that never changed, and
 * removing the tool entirely would leave the model free to invent a key with the same result.
 *
 * If an audio-effect renderer ever lands, the gate widens on its own and this becomes a real
 * advisor again with no edit here.
 */
export const spec: ToolSpec = {
  name: "suggestAudioFx",
  tier: "audio",
  whenToUse: "Check whether an audio effect (eq, compressor, reverb) can be applied at all before promising one.",
  tool: tool({
    description:
      "Look up audio-effect registry keys that this build can actually render. Returns { suggestions: [] } plus a `note` when the capability does not exist — in that case say so plainly instead of emitting an audio effectKey, which would change nothing.",
    inputSchema: z.object({
      intent: z
        .string()
        .optional()
        .describe("what the audio should do, e.g. 'punchy', 'tame harsh highs', 'roomy reverb'"),
    }),
    execute: async ({ intent }) => {
      const entries = await byCategory("audio");

      const terms = (intent ?? "")
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);

      const score = (e: (typeof entries)[number]): number => {
        if (terms.length === 0) return 0;
        const haystack = [e.key, e.label, e.description ?? "", ...e.tags].join(" ").toLowerCase();
        let n = 0;
        for (const t of terms) if (haystack.includes(t)) n += 1;
        return n;
      };

      const ranked = [...entries].sort((a, b) => score(b) - score(a));
      const { renderable, unrenderable } = partitionRenderableEntries(ranked);
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
