import { ffprobePath } from "./bin";
import { runBinary } from "./run";

/**
 * ffprobe — the AUTHORITATIVE measurement of a media file.
 *
 * The browser-side probe at upload time (U1) is the fast path so the clip can go on the timeline
 * immediately; this is the correction, and it is the number the EDL is ultimately cut against.
 *
 * Everything here fails loud or reports null. A media file whose duration cannot be read produces
 * `durationMs: null`, never a plausible-looking default — the DB constraint `asset_probe_sane`
 * (migration 005) exists because a fabricated 10-second duration silently truncated real footage.
 */

export interface ProbeResult {
  /** Container duration in integer ms, or null when no stream reports one. */
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** Average frame rate, rounded to 3dp. Null for audio-only files. */
  fps: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** The raw ffprobe JSON, stored on `asset.probe` for debugging. */
  raw: FfprobeJson;
}

export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  /** Some containers (MOV/MP4) carry per-stream duration only in the tag. */
  tags?: Record<string, string>;
}

export interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string; bit_rate?: string };
}

export async function probeMedia(input: string, opts: { signal?: AbortSignal } = {}): Promise<ProbeResult> {
  const { stdout } = await runBinary(
    ffprobePath(),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input],
    opts,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`ffprobe returned output that is not JSON (${stdout.slice(0, 200)})`);
  }
  return normalizeProbe(parsed as FfprobeJson);
}

/**
 * ffprobe JSON → the measurement. Pure, and exported because this mapping — not the spawn — is
 * where "a 7.000s file reads as 7000ms" is decided, and it is the half a test can pin.
 */
export function normalizeProbe(raw: FfprobeJson): ProbeResult {
  const streams = raw.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  // Prefer the container duration; fall back to the longest stream duration for formats that carry
  // it per stream only (raw ADTS/AAC, some MPEG-TS). Missing everywhere ⇒ null, never 0: a zero
  // would pass a truthiness check and put a zero-length clip on the timeline.
  const durationSeconds =
    parseNumber(raw.format?.duration) ??
    streams.map((s) => parseNumber(s.duration) ?? parseNumber(s.tags?.DURATION)).reduce<number | null>(
      (max, d) => (d !== null && (max === null || d > max) ? d : max),
      null,
    );

  return {
    durationMs: durationSeconds !== null && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null,
    width: positiveInt(video?.width),
    height: positiveInt(video?.height),
    fps: parseFps(video?.avg_frame_rate) ?? parseFps(video?.r_frame_rate),
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    raw,
  };
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveInt(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * `"30000/1001"` → 29.97. ffprobe reports `0/0` for streams with no meaningful rate (a still image
 * stream, some audio-only containers) — that is "unknown", so it maps to null rather than 0.
 */
export function parseFps(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null;
  return Math.round((num / den) * 1000) / 1000;
}
