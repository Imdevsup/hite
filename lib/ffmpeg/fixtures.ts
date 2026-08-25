import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegPath } from "./bin";
import { runBinary } from "./run";

/**
 * Synthesized media with KNOWN correct answers, for the analyzer's tests and for the worker's
 * end-to-end verification.
 *
 * This is the whole point of the analyze rewrite being testable at all: a beat detector that
 * returns garbage passes any test that only asserts "it returned an array". Each generator here
 * produces a file whose right answer is arithmetic — a click every 500 ms IS 120 BPM, a red-to-blue
 * splice at 3 s IS one cut at 3000 ms — so the assertion can actually fail.
 *
 * Everything is written to the OS temp directory. Nothing generated here belongs in the repo.
 */

export async function fixtureDir(prefix = "hite-fixture-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * A click track at an exact BPM: a 1 kHz tone burst with a fast exponential decay, restarting every
 * beat period. `mod(t, period)` is the sawtooth that makes the burst periodic.
 */
export async function makeClickTrack(dir: string, bpm: number, seconds: number): Promise<string> {
  const period = 60 / bpm;
  const out = join(dir, `click-${bpm}bpm.wav`);
  await runBinary(ffmpegPath(), [
    "-nostdin", "-y", "-v", "error",
    "-f", "lavfi",
    "-i", `aevalsrc=0.9*sin(2*PI*1000*t)*exp(-40*mod(t\\,${period})):d=${seconds}:s=44100`,
    "-ac", "1",
    out,
  ]);
  return out;
}

/** A solid-colour clip: one shot, no motion, no cuts. */
export async function makeSolidColorClip(
  dir: string,
  color: string,
  opts: { seconds: number; width?: number; height?: number; fps?: number },
): Promise<string> {
  const { seconds, width = 640, height = 360, fps = 30 } = opts;
  const out = join(dir, `${color}-${seconds}s.mp4`);
  await runBinary(ffmpegPath(), [
    "-nostdin", "-y", "-v", "error",
    "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}:r=${fps}:d=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    out,
  ]);
  return out;
}

/** Concatenate clips into one file — the splice points are the known scene cuts. */
export async function concatClips(dir: string, inputs: string[], name = "concat.mp4"): Promise<string> {
  const out = join(dir, name);
  const filter = `${inputs.map((_, i) => `[${i}:v]`).join("")}concat=n=${inputs.length}:v=1:a=0[v]`;
  await runBinary(ffmpegPath(), [
    "-nostdin", "-y", "-v", "error",
    ...inputs.flatMap((i) => ["-i", i]),
    "-filter_complex", filter,
    "-map", "[v]",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    out,
  ]);
  return out;
}

/** A clip of an exact length/size/rate, with a moving test pattern and an optional tone. */
export async function makeTestClip(
  dir: string,
  opts: { name: string; seconds: number; width: number; height: number; fps: number; withAudio?: boolean },
): Promise<string> {
  const out = join(dir, opts.name);
  const args = [
    "-nostdin", "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc=s=${opts.width}x${opts.height}:r=${opts.fps}:d=${opts.seconds}`,
  ];
  if (opts.withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${opts.seconds}`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (opts.withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(out);
  await runBinary(ffmpegPath(), args);
  return out;
}
