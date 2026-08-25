import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { createAdmin } from "@/lib/supabase/admin";
import { msToTicks } from "@/lib/edl/time";
import { assertAssetAllowed } from "../_guard";
import { readAssetDurationMs, readTranscript, TICKS_UNITS_NOTE } from "../db";

/**
 * findSilences — locate dead air so the planner can trim it.
 *
 * Three kinds, and the first and third were previously invisible: LEADING silence before the first
 * word, gaps BETWEEN spoken segments, and TRAILING silence after the last word. "Cut the dead air"
 * is a flagship prompt and the fumbling intro / hanging outro is what people actually mean by it;
 * reporting only mid-speech pauses answered a different question and looked like success. The edges
 * need the asset's probed duration, so this reads it (and says so when it is unavailable, rather
 * than quietly dropping the trailing edge).
 *
 * Timings are integer TICKS. An absent transcript is an honest empty result; a FAILED query throws.
 */

type SilenceKind = "leading" | "between" | "trailing";

interface Silence {
  startTick: number;
  endTick: number;
  kind: SilenceKind;
}

const DEFAULT_MIN_MS = 600;

export const spec: ToolSpec = {
  name: "findSilences",
  tier: "speech",
  whenToUse: "Find silent gaps / dead air to trim — including the dead intro before the first word and the tail after the last.",
  tool: tool({
    description:
      "Find dead air in a clip: leading silence before the first word, pauses between spoken segments, and trailing silence after the last word. Returns { startTick, endTick, kind } ranges in editor TICKS (30000/sec). An empty list means no transcript exists or no gap passes the threshold — say which, never claim the clip has no pauses if it was never transcribed.",
    inputSchema: z.object({
      assetId: z.string().describe("the asset whose transcript to scan for silent gaps"),
      minMs: z
        .number()
        .optional()
        .describe("minimum gap length in milliseconds to count as silence (default 600)"),
    }),
    execute: async ({ assetId, minMs }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const threshold = typeof minMs === "number" && minMs > 0 ? minMs : DEFAULT_MIN_MS;

      const admin = createAdmin();
      const [transcript, durationMs] = await Promise.all([
        readTranscript(assetId, admin),
        readAssetDurationMs(assetId, admin),
      ]);

      const segments = transcript?.segments ?? [];
      if (segments.length === 0) {
        return {
          silences: [] as Silence[],
          transcribed: false,
          note: "No transcript exists for this clip, so dead air cannot be located. Do not claim the clip has none.",
          units: TICKS_UNITS_NOTE,
        };
      }

      const silences: Silence[] = [];
      const push = (startMs: number, endMs: number, kind: SilenceKind) => {
        if (endMs - startMs > threshold) {
          silences.push({ startTick: msToTicks(startMs), endTick: msToTicks(endMs), kind });
        }
      };

      // `segments` arrives chronological from readTranscript.
      push(0, segments[0].startMs, "leading");
      for (let i = 0; i < segments.length - 1; i++) {
        push(segments[i].endMs, segments[i + 1].startMs, "between");
      }
      const lastEndMs = segments[segments.length - 1].endMs;
      if (durationMs !== null) push(lastEndMs, durationMs, "trailing");

      return {
        silences,
        transcribed: true,
        ...(durationMs === null
          ? { note: "This asset has no probed duration, so silence AFTER the last word could not be measured — only the intro and mid-clip pauses are listed." }
          : {}),
        units: TICKS_UNITS_NOTE,
      };
    },
  }),
};
