import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { assertAssetAllowed } from "../_guard";
import { msArrayToTicks, readAnalysisData, TICKS_UNITS_NOTE } from "../db";

/**
 * planSceneCuts — turns the analyzed shot/scene boundaries into editor cut TICKS.
 *
 * Reads the `scenes` analysis row (data.cuts_ms, in MILLISECONDS) and converts each boundary to
 * integer ticks. Returns an empty list when scene detection has not produced cuts, so the planner
 * never fabricates them; a FAILED query throws instead of posing as "no cuts" (see ../db.ts).
 */
export const spec: ToolSpec = {
  name: "planSceneCuts",
  tier: "structure",
  whenToUse: "Get cut ticks at existing shot/scene boundaries.",
  tool: tool({
    description:
      "Return cut points (in editor ticks, 30000/sec) at the clip's existing shot/scene boundaries, derived from scene-detection analysis, ready to use verbatim. `analyzed: false` means scene detection has not run for this clip — say so rather than guessing boundaries.",
    inputSchema: z.object({
      assetId: z.string().describe("The asset id of the clip to read scene boundaries for."),
    }),
    execute: async ({ assetId }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const scenes = await readAnalysisData(assetId, "scenes");
      return {
        cutTicks: msArrayToTicks(scenes?.cuts_ms),
        analyzed: scenes !== null,
        units: TICKS_UNITS_NOTE,
      };
    },
  }),
};
