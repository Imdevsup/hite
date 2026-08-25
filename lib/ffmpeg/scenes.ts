import { ffmpegPath } from "./bin";
import { runBinary } from "./run";

/**
 * Shot-boundary detection via ffmpeg's own `scdet` filter.
 *
 * Replaces `lib/analysis/scenes.py` (PySceneDetect in a Python sandbox that never booted). Same
 * OUTPUT contract, because the planner's tools already read it: `{ cuts_ms, scenes_ms,
 * duration_ms }` — see lib/ai/tools/generated/planSceneCuts.ts and planCutDown.ts.
 *
 * `scdet` scores each frame against its predecessor and prints `lavfi.scd.time` on the frames that
 * exceed the threshold. Decode-only (`-f null -`), so nothing is encoded and a 10-minute clip is a
 * single fast pass.
 */

/**
 * Mean-absolute-frame-difference score, 0–100, above which a frame starts a new shot.
 *
 * 10 is `scdet`'s own default and the value it is tuned for. This is deliberately NOT the 27 the
 * deleted Python version passed to PySceneDetect: that number lives on ContentDetector's HSV
 * content scale, and carrying it across to MAFD makes the detector far too blunt — a hard cut from
 * a full red frame to a full blue one scores 15.6 here, so a 27 threshold reports a clip with an
 * obvious cut in it as a single unbroken shot. Verified in analysis.test.ts against both a real cut
 * (detected) and a full-motion single shot (no false positive).
 */
export const DEFAULT_SCENE_THRESHOLD = 10;

export interface ScenesAnalysis {
  /** Shot boundaries in ms — the START of each shot after the first. */
  cuts_ms: number[];
  /** `[startMs, endMs)` per shot, covering the whole clip. */
  scenes_ms: [number, number][];
  duration_ms: number;
  threshold: number;
}

export async function analyzeScenes(
  input: string,
  durationMs: number,
  opts: { threshold?: number; signal?: AbortSignal } = {},
): Promise<ScenesAnalysis> {
  const threshold = opts.threshold ?? DEFAULT_SCENE_THRESHOLD;
  // `metadata=print:file=-` writes to STDOUT, which is why the log level can stay at `error`:
  // stderr keeps carrying only real diagnostics, so a failure here still reports its own reason.
  const { stdout } = await runBinary(
    ffmpegPath(),
    [
      "-nostdin", "-v", "error",
      "-i", input,
      "-filter_complex", `scdet=threshold=${threshold},metadata=print:key=lavfi.scd.time:file=-`,
      "-an", "-f", "null", "-",
    ],
    { signal: opts.signal },
  );
  return buildScenes(parseSceneTimes(stdout), durationMs, threshold);
}

/**
 * Pull `lavfi.scd.time` values out of ffmpeg's metadata output.
 *
 * The printer emits a two-line record per hit:
 *   `frame:90   pts:46080   pts_time:3`
 *   `lavfi.scd.time=3`
 * `scdet` sets `lavfi.scd.time` ONLY on the frames that cross the threshold (every frame gets a
 * `lavfi.scd.score`/`mafd`), so keying on it is what makes this a list of cuts rather than a list
 * of frames.
 *
 * Exported for tests — this parse is where a working detector turns into an empty `cuts_ms`.
 */
export function parseSceneTimes(output: string): number[] {
  const times: number[] = [];
  for (const match of output.matchAll(/lavfi\.scd\.time=([0-9]+(?:\.[0-9]+)?)/g)) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds >= 0) times.push(Math.round(seconds * 1000));
  }
  return times;
}

/**
 * Cut times → the stored shape. Pure, exported for tests.
 *
 * A cut at 0 is dropped: the first frame is not a boundary between two shots, and a leading 0
 * would make `planSceneCuts` propose a cut at the very start of the timeline.
 */
export function buildScenes(cutTimesMs: number[], durationMs: number, threshold: number): ScenesAnalysis {
  const cuts = Array.from(new Set(cutTimesMs.filter((t) => t > 0 && (durationMs <= 0 || t < durationMs)))).sort(
    (a, b) => a - b,
  );
  const scenes: [number, number][] = [];
  let start = 0;
  for (const cut of cuts) {
    scenes.push([start, cut]);
    start = cut;
  }
  if (durationMs > start) scenes.push([start, durationMs]);
  return { cuts_ms: cuts, scenes_ms: scenes, duration_ms: durationMs, threshold };
}
