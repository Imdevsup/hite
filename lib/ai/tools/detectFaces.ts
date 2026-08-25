import { z } from "zod";
import { tool } from "ai";
import { msToTicks } from "@/lib/edl/time";
import { assertAssetAllowed } from "./_guard";
import { readAnalysisData, TICKS_UNITS_NOTE } from "./db";

/**
 * Face tracks, summarised (the LLM must never receive every frame's bbox) and timed in TICKS.
 * An absent analysis row is an honest empty result; a FAILED query throws (see ./db.ts).
 */

export interface FaceFrame {
  t_ms: number;
  conf: number;
}
export interface FaceTrack {
  faceId: string;
  frames: FaceFrame[];
}

/**
 * Exported because `generated/planReframe.ts` reads the same rows and must reach the same verdict:
 * one validator means "no usable track" can never mean two different things in two tools.
 */
export function readFaceTracks(value: unknown): FaceTrack[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is FaceTrack => {
    const track = t as Partial<FaceTrack> | null;
    return (
      !!track &&
      typeof track.faceId === "string" &&
      Array.isArray(track.frames) &&
      track.frames.length > 0 &&
      track.frames.every((f) => typeof f?.t_ms === "number" && typeof f?.conf === "number")
    );
  });
}

const readNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export const detectFaces = tool({
  description:
    "Return the clip's detected face tracks (id + when each face is on screen, in editor TICKS at 30000/sec). Call before placing a face-anchored overlay or reframe. An empty list means no face analysis exists for this clip — never invent a faceId.",
  inputSchema: z.object({
    assetId: z.string().uuid(),
  }),
  execute: async ({ assetId }, { experimental_context }) => {
    assertAssetAllowed(assetId, experimental_context);
    const data = await readAnalysisData(assetId, "faces");
    const tracks = readFaceTracks(data?.tracks);
    if (!data || tracks.length === 0) {
      return { tracks: [], fps: 0, width: 0, height: 0, analyzed: !!data, units: TICKS_UNITS_NOTE };
    }
    return {
      tracks: tracks.map((t) => {
        const totalConf = t.frames.reduce((sum, f) => sum + f.conf, 0);
        return {
          faceId: t.faceId,
          firstTick: msToTicks(t.frames[0].t_ms),
          lastTick: msToTicks(t.frames[t.frames.length - 1].t_ms),
          frameCount: t.frames.length,
          avgConfidence: Math.round((totalConf / t.frames.length) * 100) / 100,
        };
      }),
      fps: readNumber(data.fps),
      width: readNumber(data.width),
      height: readNumber(data.height),
      analyzed: true,
      units: TICKS_UNITS_NOTE,
    };
  },
});
