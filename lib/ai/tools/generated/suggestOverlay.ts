import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry"; // type-only import (no runtime cycle)
import { byCategory } from "@/lib/registry/catalog";
import { partitionRenderableEntries, withheldNote } from "../renderableEntry";

/**
 * suggestOverlay — ADVISOR. Resolves a desired overlay vibe (e.g. "skull",
 * "light-leak", "scan-lines", "lightning") to REAL overlay keys from the live
 * registry. Backs `byCategory("overlays")` and ranks the matches by how well the
 * entry's key/label/tags/description match `kind`. Never invents keys: returns
 * { suggestions: [] } when nothing in the registry matches.
 *
 * Runs through the same renderability gate as every other advisor. It withholds nothing today —
 * overlays are not effect keys, they lower to ADD_OVERLAY, which HiteRoot paints procedurally for
 * every key in the manifest — but the gate is where a future "this overlay has no renderer" answer
 * arrives, and no advisor should be the one that skipped it.
 */
export const spec: ToolSpec = {
  name: "suggestOverlay",
  tier: "vision",
  whenToUse: "Pick an overlay key (skull, light-leak, scan-lines, lightning).",
  tool: tool({
    description:
      "Suggest REAL overlay registry keys for a desired look (e.g. 'skull', 'light-leak', 'scan-lines', 'lightning'). Returns exact keys to pass to applyOverlay — never invent overlay keys; call this first.",
    inputSchema: z.object({
      kind: z
        .string()
        .describe("desired overlay vibe, e.g. 'skull', 'light-leak', 'scan-lines', 'lightning'"),
    }),
    execute: async ({ kind }) => {
      const entries = await byCategory("overlays");
      const q = kind.trim().toLowerCase();
      const terms = q.split(/[^a-z0-9]+/).filter(Boolean);

      const scored = entries
        .map((e) => {
          const hay = [e.key, e.label, e.description ?? "", ...e.tags]
            .join(" ")
            .toLowerCase();
          let score = 0;
          if (q && hay.includes(q)) score += 10;
          for (const t of terms) if (hay.includes(t)) score += 1;
          return { e, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

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
