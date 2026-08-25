import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { assertAssetAllowed } from "../_guard";
import { readAnalysisData } from "../db";

/**
 * suggestPacing — recommends an editing pace (cuts per second) for a style.
 *
 * Reads the clip's detected bpm (rhythm analysis) when available and derives a
 * cuts-per-second target from the tempo scaled by the requested style. If the
 * beats analysis has not run, falls back to a sensible style-based default and
 * says so in `note` — never fabricates a bpm.
 */

type StyleProfile = {
  /** cuts per beat — how many cuts to land per musical beat at this energy */
  cutsPerBeat: number;
  /** fallback cuts/sec when no bpm is available */
  fallbackCps: number;
};

const STYLE_PROFILES: Record<string, StyleProfile> = {
  phonk: { cutsPerBeat: 1, fallbackCps: 2 },
  hype: { cutsPerBeat: 1, fallbackCps: 2.2 },
  energetic: { cutsPerBeat: 1, fallbackCps: 2 },
  montage: { cutsPerBeat: 0.5, fallbackCps: 1.2 },
  vlog: { cutsPerBeat: 0.25, fallbackCps: 0.6 },
  cinematic: { cutsPerBeat: 0.25, fallbackCps: 0.4 },
  calm: { cutsPerBeat: 0.125, fallbackCps: 0.25 },
  documentary: { cutsPerBeat: 0.2, fallbackCps: 0.4 },
};

const DEFAULT_PROFILE: StyleProfile = { cutsPerBeat: 0.5, fallbackCps: 1 };

function resolveProfile(style: string): { key: string; profile: StyleProfile } {
  const normalized = style.trim().toLowerCase();
  for (const key of Object.keys(STYLE_PROFILES)) {
    if (normalized.includes(key)) return { key, profile: STYLE_PROFILES[key] };
  }
  return { key: "balanced", profile: DEFAULT_PROFILE };
}

export const spec: ToolSpec = {
  name: "suggestPacing",
  tier: "planning",
  whenToUse: "Recommend pacing (cuts per second / energy) for a style.",
  tool: tool({
    description:
      "Recommend an editing pace for a clip given a target style. Reads detected bpm from rhythm analysis when available and returns { bpm, cutsPerSecond, note }. If no beats were detected, returns a sensible style-based default and says so in note. Use to set cut density before laying out beat-synced or stylistic edits.",
    inputSchema: z.object({
      assetId: z.string().describe("The asset to pace, used to look up detected bpm."),
      style: z
        .string()
        .describe("Target style/energy, e.g. 'phonk', 'cinematic', 'vlog', 'calm montage'."),
    }),
    execute: async ({ assetId, style }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const { key: styleKey, profile } = resolveProfile(style);

      const beats = await readAnalysisData(assetId, "beats");
      const bpm = typeof beats?.bpm === "number" && beats.bpm > 0 ? beats.bpm : 0;

      if (bpm > 0) {
        const beatsPerSecond = bpm / 60;
        const cutsPerSecond = Number((beatsPerSecond * profile.cutsPerBeat).toFixed(3));
        return {
          bpm,
          cutsPerSecond,
          note: `Derived from detected ${bpm} bpm for '${styleKey}' style at ${profile.cutsPerBeat} cuts/beat.`,
        };
      }

      return {
        bpm: 0,
        cutsPerSecond: profile.fallbackCps,
        note: `No beats analysis available for this asset; using a style-based default for '${styleKey}'.`,
      };
    },
  }),
};
