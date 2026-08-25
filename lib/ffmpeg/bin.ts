import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

/**
 * Where the ffmpeg/ffprobe binaries are.
 *
 * The previous code spawned a bare `ffprobe`, which meant it worked on a developer laptop with
 * ffmpeg on PATH and failed with ENOENT everywhere else — including inside the serverless function
 * that was supposed to run it (`ffprobe-binary-absent-in-serverless`). `ffmpeg-static` /
 * `ffprobe-static` ship a real binary per platform, so the worker carries its own toolchain and a
 * stranger cloning this repo gets a working analyze pipeline from `pnpm install` alone.
 *
 * The env overrides exist for the one case the static packages cannot serve: a platform they have
 * no build for (e.g. linux/riscv64, or an Alpine image where the glibc build will not run). Set
 * FFMPEG_PATH / FFPROBE_PATH to a system binary there.
 */

/** Raised when the toolchain is missing. Never degraded into "analysis found nothing". */
export class FfmpegUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegUnavailableError";
  }
}

function resolve(name: "ffmpeg" | "ffprobe", envVar: string, staticPath: string | null): string {
  const override = process.env[envVar]?.trim();
  if (override) return override;
  if (!staticPath) {
    throw new FfmpegUnavailableError(
      `no ${name} binary for ${process.platform}/${process.arch}: ${name}-static ships no build for this platform. ` +
        `Install ${name} and set ${envVar} to its path.`,
    );
  }
  return staticPath;
}

export function ffmpegPath(): string {
  return resolve("ffmpeg", "FFMPEG_PATH", ffmpegStatic);
}

export function ffprobePath(): string {
  return resolve("ffprobe", "FFPROBE_PATH", ffprobeStatic.path);
}
