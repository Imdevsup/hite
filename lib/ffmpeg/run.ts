import { spawn } from "node:child_process";

/**
 * Spawn an ffmpeg/ffprobe process and capture BOTH streams.
 *
 * The one rule this module exists to enforce: stderr is never discarded. The sandbox path this
 * replaces threw `"${cmd} exited ${exitCode}"` and dropped the output, so a failed analyze reached
 * the user as a bare exit code and was undebuggable — the actual reason ("moov atom not found",
 * "Invalid data found when processing input", "No such file or directory") was right there and
 * thrown away. ffmpeg writes everything, including its real diagnostics, to stderr.
 */

/** Bytes of stderr retained. ffmpeg is chatty; the tail is where the failure is. */
const MAX_STDERR_BYTES = 64 * 1024;
/** ffprobe's JSON is the payload, so stdout gets a much bigger budget than a diagnostic tail. */
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;

export class FfmpegError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
    /** The full argument list, for the server log. Deliberately NOT in `message` — see below. */
    readonly args: string[],
    message: string,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a binary to completion. Resolves with both streams on exit 0, throws `FfmpegError` carrying
 * the stderr tail otherwise. `signal` lets a shutting-down worker kill a long encode.
 */
export function runBinary(
  bin: string,
  args: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    let stdout = "";
    let stderr = "";
    let stdoutOverflow = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk.toString("utf8");
      else stdoutOverflow = true;
    });
    // Keep the TAIL of stderr: ffmpeg prints its banner and per-stream summary first and the actual
    // error last, so a head-truncated buffer is exactly the half that says nothing.
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_STDERR_BYTES) stderr = stderr.slice(-MAX_STDERR_BYTES);
    });

    proc.on("error", (err) => {
      reject(new FfmpegError(null, null, stderr, args, `could not start ${toolName(bin)}: ${err.message}`));
    });
    proc.on("close", (code, signal) => {
      if (stdoutOverflow) {
        reject(
          new FfmpegError(code, signal, stderr, args, `${toolName(bin)} produced more than ${MAX_STDOUT_BYTES} bytes of output`),
        );
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      // The message leads with ffmpeg's OWN reason and names the tool, nothing else. It ends up in
      // `job.error`, which is rendered to the user: the full argv would put an absolute server path
      // and a signed url in front of someone trying to understand why their upload failed. The argv
      // travels on the error object instead, for whoever is reading the log.
      reject(
        new FfmpegError(code, signal, stderr, args, `${toolName(bin)} exited ${signal ?? code}: ${tail(stderr)}`),
      );
    });
  });
}

/** `…/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe` → `ffprobe`. */
function toolName(bin: string): string {
  return bin.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? bin;
}

/** Last few stderr lines — the part that names the failure. */
export function tail(text: string, lines = 6): string {
  const trimmed = text.trim();
  if (!trimmed) return "no output";
  return trimmed.split(/\r?\n/).slice(-lines).join(" | ");
}

/**
 * Argument list for an error message with signed-url query strings stripped. A signed url is a
 * bearer credential and error strings end up in the `job.error` column, the server log and the
 * user's browser.
 */
export function describeArgs(args: string[]): string {
  return args.map((a) => (a.includes("://") ? a.split("?")[0] : a)).join(" ");
}
