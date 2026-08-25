import { tool } from "ai";
import { z } from "zod";
import type { ToolSpec } from "../registry";
import { assertAssetAllowed } from "../_guard";
import { readAnalysisData } from "../db";
import { readFaceTracks, type FaceTrack } from "../detectFaces";

/**
 * planReframe — how to crop a clip to another aspect, and how much of that is measured.
 *
 * FACE ANALYSIS IS NOT IN THIS BUILD (`worker/analyze.ts` has no face branch; the resolver returns
 * an empty track). This tool used to answer "No faces detected. Center-crop to 9:16" for an analysis
 * that had never run — a measurement of nothing, reported to the model as a finding, which is the
 * one thing this repo does not do. The two cases are now separate the way `detectFaces` and
 * `findSilences` separate them: `analyzed: false` means nothing ever looked, and the center-weighted
 * plan that comes back with it is a LAYOUT DEFAULT, not evidence that the shot has no subject.
 *
 * It still reads the `faces` row rather than hard-coding "unavailable", because the row is what the
 * pipeline would write if the branch ever lands — and the shape of the answer would not change.
 */

/** Longest-lived first, then most confident. The clip the eye follows, not the first row returned. */
function mostProminent(tracks: readonly FaceTrack[]): FaceTrack {
  let best = tracks[0];
  let bestScore = -1;
  for (const t of tracks) {
    const span = t.frames[t.frames.length - 1].t_ms - t.frames[0].t_ms;
    const avgConf = t.frames.reduce((sum, f) => sum + f.conf, 0) / t.frames.length;
    const score = span * (1 + avgConf);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function centerStrategy(aspect: "9:16" | "1:1" | "16:9"): string {
  return aspect === "16:9"
    ? "Keep the original framing; pad or center-crop to 16:9 from the source center."
    : `Center-crop to ${aspect}, keeping the horizontal/vertical midline of the frame.`;
}

export const spec: ToolSpec = {
  name: "planReframe",
  tier: "planning",
  whenToUse: "Suggest how to reframe to a vertical/square aspect (face-anchored only where face analysis exists).",
  tool: tool({
    description:
      "Plan a reframe of a clip to a target aspect ratio (9:16, 1:1, or 16:9). Returns `analyzed: false` when no face analysis exists for the clip, and the plan is then a center-weighted DEFAULT — do not report it as 'no faces were found', because nothing looked. `analyzed: true` with no tracks is the one case where the clip really has no detected face. Call before emitting a reframe/crop edit.",
    inputSchema: z.object({
      assetId: z.string().describe("the asset to reframe"),
      aspect: z
        .enum(["9:16", "1:1", "16:9"])
        .describe("target output aspect ratio"),
    }),
    execute: async ({ assetId, aspect }, { experimental_context }) => {
      assertAssetAllowed(assetId, experimental_context);
      const data = await readAnalysisData(assetId, "faces");
      const tracks = readFaceTracks(data?.tracks);

      if (!data) {
        return {
          aspect,
          analyzed: false,
          strategy: centerStrategy(aspect),
          note: "No face analysis exists for this clip, so nothing has looked for a subject. The crop above is a safe default, not a finding — never tell the user the clip has no faces in it.",
        };
      }

      if (tracks.length === 0) {
        return {
          aspect,
          analyzed: true,
          strategy: `No face track was detected in this clip. ${centerStrategy(aspect)}`,
        };
      }

      const best = mostProminent(tracks);
      return {
        aspect,
        analyzed: true,
        strategy:
          aspect === "16:9"
            ? `Anchor the frame on face "${best.faceId}", keeping it within the action-safe area while preserving the 16:9 width.`
            : `Crop to ${aspect} and track face "${best.faceId}": keep the face centered horizontally (and within the upper third for ${aspect}) so the subject stays in frame across the clip.`,
        anchorFaceId: best.faceId,
      };
    },
  }),
};
