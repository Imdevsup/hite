import { z } from "zod";
import { tool } from "ai";
import { assertAssetAllowed } from "./_guard";
import { msArrayToTicks, msRangesToTicks, readAnalysisData, TICKS_UNITS_NOTE } from "./db";

/**
 * Shot boundaries, converted to TICKS at the tool boundary (see analyzeBeats.ts for why).
 * An absent analysis row reports an honest empty result; a FAILED query throws (see ./db.ts).
 */
export const analyzeScenes = tool({
  description:
    "Return the clip's detected shot boundaries in editor TICKS (30000/sec), ready to use verbatim in commands. `cutTicks` are the moments the shot changes; `sceneRanges` are the {startTick, endTick} spans between them. `analyzed: false` means scene detection has not run for this clip — never invent boundaries.",
  inputSchema: z.object({
    assetId: z.string().uuid(),
  }),
  execute: async ({ assetId }, { experimental_context }) => {
    assertAssetAllowed(assetId, experimental_context);
    const data = await readAnalysisData(assetId, "scenes");
    if (!data) return { sceneRanges: [], cutTicks: [], analyzed: false, units: TICKS_UNITS_NOTE };
    return {
      // Ranges, not a flat list: the producer emits pairs. See `msRangesToTicks`.
      sceneRanges: msRangesToTicks(data.scenes_ms),
      cutTicks: msArrayToTicks(data.cuts_ms),
      analyzed: true,
      units: TICKS_UNITS_NOTE,
    };
  },
});
