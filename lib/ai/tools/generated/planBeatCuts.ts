import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { msToTicks } from "@/lib/edl/time";
import { assertAssetAllowed } from "../_guard";
import { msNumbers, readAnalysisData, TICKS_UNITS_NOTE } from "../db";

/**
 * planBeatCuts — turn detected music beats into a ready-to-use list of cut points for the planner.
 * Reads the stored beat analysis (kind="beats"), takes its `beats_ms` (beat onsets in MILLISECONDS),
 * keeps every Nth beat (default 4 — i.e. cut once per bar in 4/4), and returns those cut points as
 * integer TICKS. Reports honestly when no beats row exists (the pipeline may not have run); a FAILED
 * query throws rather than posing as "this clip has no beats" (see ../db.ts).
 */

export const spec: ToolSpec = {
  name: "planBeatCuts",
  tier: "rhythm",
  whenToUse: "Get beat-aligned cut ticks for cutting on every Nth beat.",
  tool: tool({
    description:
      "Plan beat-synced cuts. Reads the clip's detected beats and returns cut points on every Nth beat as { bpm, cutTicks } where cutTicks are in ticks (30000/sec), ready to use verbatim. `analyzed: false` means beat detection has not run for this clip — say so instead of guessing a tempo.",
    inputSchema: z.object({
      assetId: z.string().describe("the asset whose beat analysis to turn into cut points"),
      everyNthBeat: z
        .number()
        .optional()
        .describe("cut on every Nth beat (default 4, i.e. once per bar in 4/4)"),
    }),
    execute: async ({ assetId, everyNthBeat }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const step = everyNthBeat && everyNthBeat >= 1 ? Math.floor(everyNthBeat) : 4;
      const beats = await readAnalysisData(assetId, "beats");
      const beatsMs = msNumbers(beats?.beats_ms);
      if (beatsMs.length === 0) {
        return { bpm: 0, cutTicks: [], analyzed: beats !== null, units: TICKS_UNITS_NOTE };
      }

      const cutTicks: number[] = [];
      for (let i = 0; i < beatsMs.length; i += step) {
        cutTicks.push(msToTicks(beatsMs[i]));
      }

      const bpm = typeof beats?.bpm === "number" && Number.isFinite(beats.bpm) ? beats.bpm : 0;
      return { bpm, cutTicks, analyzed: true, units: TICKS_UNITS_NOTE };
    },
  }),
};
