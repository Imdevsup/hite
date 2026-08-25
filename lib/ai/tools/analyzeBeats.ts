import { z } from "zod";
import { tool } from "ai";
import { assertAssetAllowed } from "./_guard";
import { msArrayToTicks, readAnalysisData, TICKS_UNITS_NOTE } from "./db";

/**
 * Beat/tempo analysis, converted to TICKS at the tool boundary.
 *
 * The stored row is in milliseconds; every command field the model writes is in ticks. Handing the
 * model a raw `beats_ms` list made the correctness of "cut on the beat" depend on Gemini
 * multiplying a hundred five-digit numbers by 30 without a slip. The conversion happens here, once,
 * in the one place that is trusted with it.
 *
 * An absent analysis row is reported as an honest empty result; a FAILED query throws (see ./db.ts).
 */
export const analyzeBeats = tool({
  description:
    "Return the detected tempo and beat/onset/drop positions for a clip, in editor TICKS (30000/sec) ready to use verbatim in commands. bpm 0 with empty lists means the beat analysis has not run for this clip — say so rather than guessing a tempo.",
  inputSchema: z.object({
    assetId: z.string().uuid(),
  }),
  execute: async ({ assetId }, { experimental_context }) => {
    assertAssetAllowed(assetId, experimental_context);
    const data = await readAnalysisData(assetId, "beats");
    if (!data) {
      return { bpm: 0, beatTicks: [], onsetTicks: [], dropTicks: [], analyzed: false, units: TICKS_UNITS_NOTE };
    }
    const bpm = typeof data.bpm === "number" && Number.isFinite(data.bpm) ? data.bpm : 0;
    return {
      bpm,
      beatTicks: msArrayToTicks(data.beats_ms),
      onsetTicks: msArrayToTicks(data.onsets_ms),
      dropTicks: msArrayToTicks(data.drops_ms),
      analyzed: true,
      units: TICKS_UNITS_NOTE,
    };
  },
});
