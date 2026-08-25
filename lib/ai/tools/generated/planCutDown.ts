import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { createAdmin } from "@/lib/supabase/admin";
import { msToTicks } from "@/lib/edl/time";
import { assertAssetAllowed } from "../_guard";
import { msNumbers, readAnalysisData, readAssetDurationMs, TICKS_UNITS_NOTE } from "../db";

/**
 * planCutDown — higher-order recipe: given a clip and a target length, propose the keep-ranges that
 * cut it down to ~targetSeconds while keeping the strongest parts.
 *
 * Strategy (all from REAL analysis, never fabricated):
 *  1. Prefer existing shot boundaries (analysis kind="scenes", `cuts_ms`) — segment the clip on real
 *     cuts, then keep whole shots, longest-first, until the target budget is spent. Whole-shot keeps
 *     avoid mid-shot jump cuts and bias toward the meatier (likely strongest) shots.
 *  2. Else snap the keep windows onto REAL BEAT TIMES so the cut lands with the music.
 *  3. Else even slices spread across the clip.
 *
 * The rationale must describe what the code did. Branch 2 used to claim it "used {bpm} bpm to pace"
 * windows while calling the same bpm-blind helper as branch 3 — byte-identical output under a
 * sentence that invented a mechanism. It now actually snaps to the stored beat times, and when those
 * are missing it says the pacing was even.
 *
 * Time math: DB analysis is in MILLISECONDS; the EDL is integer TICKS — converted here with msToTicks.
 */

interface KeepRange {
  startTick: number;
  endTick: number;
}
interface WindowMs {
  startMs: number;
  endMs: number;
}

/** How many windows to spread, and how long each is, for a given clip/target pair. */
function windowLayout(durationMs: number, targetMs: number): { sliceCount: number; windowMs: number; gapMs: number } {
  const sliceCount = Math.max(1, Math.min(6, Math.round(durationMs / Math.max(1, targetMs))));
  return {
    sliceCount,
    windowMs: targetMs / sliceCount,
    gapMs: (durationMs - targetMs) / sliceCount,
  };
}

/** N evenly-spaced windows across the clip, so the cut samples the whole timeline. */
function evenKeepWindows(durationMs: number, targetMs: number): WindowMs[] {
  if (targetMs <= 0 || durationMs <= 0) return [];
  const { sliceCount, windowMs, gapMs } = windowLayout(durationMs, targetMs);
  const windows: WindowMs[] = [];
  let cursorMs = gapMs / 2;
  for (let i = 0; i < sliceCount; i++) {
    const startMs = cursorMs;
    const endMs = Math.min(durationMs, startMs + windowMs);
    windows.push({ startMs, endMs });
    cursorMs = endMs + gapMs;
  }
  return windows;
}

/**
 * The same layout, with every window START pulled onto the nearest detected beat — a cut that lands
 * with the music instead of mid-bar. Windows stay in order and never overlap.
 */
function beatSnappedKeepWindows(durationMs: number, targetMs: number, beatsMs: number[]): WindowMs[] {
  const sorted = [...beatsMs].filter((ms) => ms < durationMs).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const nearestBeat = (ms: number): number =>
    sorted.reduce((best, beat) => (Math.abs(beat - ms) < Math.abs(best - ms) ? beat : best), sorted[0]);

  const windows: WindowMs[] = [];
  let previousEndMs = 0;
  for (const ideal of evenKeepWindows(durationMs, targetMs)) {
    const startMs = Math.max(previousEndMs, nearestBeat(ideal.startMs));
    const endMs = Math.min(durationMs, startMs + (ideal.endMs - ideal.startMs));
    if (endMs <= startMs) continue;
    windows.push({ startMs, endMs });
    previousEndMs = endMs;
  }
  return windows;
}

const toKeepRanges = (windows: WindowMs[]): KeepRange[] =>
  windows.map((w) => ({ startTick: msToTicks(w.startMs), endTick: msToTicks(w.endMs) }));

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

export const spec: ToolSpec = {
  name: "planCutDown",
  tier: "planning",
  whenToUse: "Propose keep-ranges to cut a clip down to a target length, keeping the strongest parts.",
  tool: tool({
    description:
      "Plan a cut-down of a clip to a target length. Returns keepRanges (integer ticks @ 30000/sec) to retain, plus a rationale that states exactly which signal drove the plan. Prefers real shot boundaries, then real beat times, else even slices. Use this to tighten or shorten a clip.",
    inputSchema: z.object({
      assetId: z.string().describe("UUID of the source asset to cut down."),
      targetSeconds: z.number().describe("Desired final length of the cut-down, in seconds."),
    }),
    execute: async ({ assetId, targetSeconds }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const admin = createAdmin();
      const targetMs = Math.max(0, targetSeconds) * 1000;

      const [durationMs, scenes, beats] = await Promise.all([
        readAssetDurationMs(assetId, admin),
        readAnalysisData(assetId, "scenes", admin),
        readAnalysisData(assetId, "beats", admin),
      ]);

      if (durationMs === null) {
        return {
          keepRanges: [] as KeepRange[],
          rationale: "This asset has no probed duration yet, so there is nothing to plan a cut-down against.",
          units: TICKS_UNITS_NOTE,
        };
      }

      const safeTargetMs = Math.min(targetMs, durationMs);
      if (safeTargetMs <= 0) {
        return {
          keepRanges: [] as KeepRange[],
          rationale: "Target length is zero or negative; nothing to keep.",
          units: TICKS_UNITS_NOTE,
        };
      }
      if (safeTargetMs >= durationMs) {
        return {
          keepRanges: [{ startTick: 0, endTick: msToTicks(durationMs) }],
          rationale: `Target (${targetSeconds}s) is at or above the clip length (${seconds(durationMs)}s); keeping the whole clip.`,
          units: TICKS_UNITS_NOTE,
        };
      }

      // 1) Shot boundaries — build whole-shot segments from real cut points, keep longest-first.
      const cuts = msNumbers(scenes?.cuts_ms)
        .filter((m) => m > 0 && m < durationMs)
        .sort((a, b) => a - b);
      if (cuts.length > 0) {
        const bounds = [0, ...cuts, durationMs];
        const segments: WindowMs[] = [];
        for (let i = 0; i < bounds.length - 1; i++) {
          segments.push({ startMs: bounds[i], endMs: bounds[i + 1] });
        }
        // Rank by length (strongest ≈ meatiest shots), accumulate until the budget is spent.
        const ranked = [...segments].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs));
        const kept: WindowMs[] = [];
        let accMs = 0;
        for (const seg of ranked) {
          if (accMs >= safeTargetMs) break;
          kept.push(seg);
          accMs += seg.endMs - seg.startMs;
        }
        // Restore chronological order so the cut plays forward.
        kept.sort((a, b) => a.startMs - b.startMs);
        return {
          keepRanges: toKeepRanges(kept),
          rationale: `Kept ${kept.length} of ${segments.length} shots (longest-first, ~${seconds(accMs)}s) on real shot boundaries to reach the ${targetSeconds}s target.`,
          units: TICKS_UNITS_NOTE,
        };
      }

      // 2) Beats — snap the keep windows onto real beat times.
      const beatsMs = msNumbers(beats?.beats_ms);
      const bpm = typeof beats?.bpm === "number" && beats.bpm > 0 ? beats.bpm : 0;
      if (beatsMs.length > 0) {
        const windows = beatSnappedKeepWindows(durationMs, safeTargetMs, beatsMs);
        if (windows.length > 0) {
          return {
            keepRanges: toKeepRanges(windows),
            rationale: `No shot boundaries available; started each of the ${windows.length} keep windows on a detected beat${bpm > 0 ? ` (${bpm} bpm)` : ""} so the cut lands with the music, totalling ~${targetSeconds}s.`,
            units: TICKS_UNITS_NOTE,
          };
        }
      }

      // 3) Even slices fallback — say plainly that nothing paced this.
      const windows = evenKeepWindows(durationMs, safeTargetMs);
      const why =
        bpm > 0
          ? `A tempo of ${bpm} bpm was detected but no usable beat times are stored, so pacing could not use it`
          : "No scene or beat analysis is available for this clip";
      return {
        keepRanges: toKeepRanges(windows),
        rationale: `${why}; spread ${windows.length} even keep windows across the clip to reach ~${targetSeconds}s.`,
        units: TICKS_UNITS_NOTE,
      };
    },
  }),
};
