import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { createAdmin } from "@/lib/supabase/admin";
import { msToTicks } from "@/lib/edl/time";
import { assertAssetAllowed } from "../_guard";
import { msNumbers, readAnalysisData, readAssetDurationMs, TICKS_UNITS_NOTE } from "../db";

/**
 * findHighlights — proposes candidate highlight RANGES where structure and energy concentrate.
 *
 * Reads two analysis rows: `scenes` (cuts_ms — shot starts) and `beats` (drops_ms / beats_ms —
 * musical energy). It anchors ~count windows on the strongest markers (drops first, then scene
 * starts, then beats), snaps each start back to the nearest preceding scene boundary, and returns
 * ranges in editor TICKS. Returns an empty list when no analysis exists so the planner never
 * fabricates moments.
 *
 * Every window is CLAMPED to the asset's real duration. A fixed 4s window on an anchor near the end
 * used to run past the media, and a clip whose outTick exceeds its source fails the whole batch in
 * the reducer — one late drop turned "make a montage" into a hard error.
 */

const DEFAULT_COUNT = 3;
const MAX_COUNT = 12;
const WINDOW_MS = 4000; // ~4s candidate window per highlight
const MIN_WINDOW_MS = 500; // shorter than this is not a highlight, it is a frame

export const spec: ToolSpec = {
  name: "findHighlights",
  tier: "structure",
  whenToUse: "Find candidate highlight ranges (where scenes + beat energy concentrate).",
  tool: tool({
    description:
      "Find candidate highlight RANGES for a clip — short windows (in editor ticks, 30000/sec) anchored where scene boundaries and beat/drop energy concentrate, clamped to the clip's real length. Use to surface the best moments to feature, trim to, or build a montage around. Returns an empty list if no scene/beat analysis is available — never invent ranges.",
    inputSchema: z.object({
      assetId: z.string().describe("The asset id of the clip to find highlight ranges for."),
      count: z
        .number()
        .optional()
        .describe("How many highlight ranges to return (default 3, max 12)."),
    }),
    execute: async ({ assetId, count }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const admin = createAdmin();

      const wanted = Math.max(
        1,
        Math.min(MAX_COUNT, Math.round(typeof count === "number" && count > 0 ? count : DEFAULT_COUNT)),
      );

      const [scenes, beats, durationMs] = await Promise.all([
        readAnalysisData(assetId, "scenes", admin),
        readAnalysisData(assetId, "beats", admin),
        readAssetDurationMs(assetId, admin),
      ]);

      const cutsMs = msNumbers(scenes?.cuts_ms);
      const dropsMs = msNumbers(beats?.drops_ms);
      const beatsMs = msNumbers(beats?.beats_ms);
      const sortedCuts = [...cutsMs].sort((a, b) => a - b);

      // Anchor priority: drops (peak energy) -> scene starts (structure) -> beats (fallback rhythm).
      const anchors: Array<{ ms: number; reason: string }> = [
        ...dropsMs.map((ms) => ({ ms, reason: "beat drop (peak energy)" })),
        ...sortedCuts.map((ms) => ({ ms, reason: "scene start (shot boundary)" })),
        ...beatsMs.map((ms) => ({ ms, reason: "strong beat" })),
      ];

      const highlights: Array<{ startTick: number; endTick: number; reason: string }> = [];
      const usedStartsMs: number[] = [];

      for (const anchor of anchors) {
        if (highlights.length >= wanted) break;
        if (durationMs !== null && anchor.ms >= durationMs) continue; // anchor past the media

        // Snap start back to the nearest preceding scene boundary, if any.
        const precedingCut = sortedCuts.filter((c) => c <= anchor.ms).pop();
        const startMs = precedingCut !== undefined ? precedingCut : anchor.ms;
        const endMs = durationMs === null ? startMs + WINDOW_MS : Math.min(startMs + WINDOW_MS, durationMs);
        if (endMs - startMs < MIN_WINDOW_MS) continue; // clamped away to nothing

        // De-duplicate windows that overlap one already chosen.
        if (usedStartsMs.some((s) => Math.abs(s - startMs) < WINDOW_MS)) continue;
        usedStartsMs.push(startMs);

        const reason =
          precedingCut !== undefined && precedingCut !== anchor.ms
            ? `${anchor.reason}, snapped to scene start`
            : anchor.reason;

        highlights.push({ startTick: msToTicks(startMs), endTick: msToTicks(endMs), reason });
      }

      highlights.sort((a, b) => a.startTick - b.startTick);

      return {
        highlights,
        analyzed: scenes !== null || beats !== null,
        ...(durationMs === null
          ? { note: "This asset has no probed duration, so these windows could not be bounded to the clip length — verify each range against the asset before emitting a clip." }
          : {}),
        units: TICKS_UNITS_NOTE,
      };
    },
  }),
};
