import type { OpenGlRenderer } from "@remotion/renderer";
import type { JobKind } from "@/lib/jobs/types";

/**
 * Worker configuration, read from the environment ONCE at boot and validated loudly.
 *
 * A worker that starts with a missing service key and then fails every job with a driver error is
 * strictly worse than one that refuses to start and says which variable is missing.
 */

/** Remotion's own list. Validated at boot so a typo cannot fail a render 40 minutes in. */
const VALID_GL_RENDERERS = ["swangle", "angle", "egl", "swiftshader", "vulkan", "angle-egl"] as const;

export interface WorkerConfig {
  /** How long to wait before polling again when the queue is empty. */
  pollIntervalMs: number;
  /** Concurrent analyze jobs. ffmpeg is CPU-bound; the default assumes a small box. */
  analyzeConcurrency: number;
  /** How often a running job's `heartbeat_at` is refreshed. */
  heartbeatIntervalMs: number;
  /** A running job whose heartbeat is older than this is treated as abandoned. */
  staleAfterMs: number;
  /** How often the reaper sweeps (it also runs once at boot). */
  reapIntervalMs: number;
  /** How long a shutdown waits for in-flight work before releasing it back to the queue. */
  shutdownGraceMs: number;
  /**
   * The longest ONE job of each kind may run before it is given up on and honestly failed.
   *
   * The heartbeat cannot cover this: it proves the WORKER is alive, and a wedged handler is
   * heartbeated exactly as diligently as a working one — so a hang looked like a slow render
   * forever and the reaper, which only moves jobs whose heartbeat stopped, could never fire. These
   * are ceilings, not budgets: they should be comfortably above any real job, because the only
   * thing they are there to catch is work that is never going to end.
   */
  jobTimeoutMs: Record<JobKind, number>;
  /** Remotion's Chromium GL backend. `swangle` is the portable software path for headless servers. */
  remotionGl: OpenGlRenderer;
  /**
   * An already-installed Chrome Headless Shell to render with, instead of the one
   * `@remotion/renderer` downloads for itself.
   *
   * Set `REMOTION_BROWSER_EXECUTABLE` on any image that already ships a Chromium (most container
   * base images for rendering do): the automatic path downloads and unpacks ~110 MB into
   * `node_modules/.remotion` on first render, which on a cold container is a slow first job and on
   * a read-only filesystem is a failed one. Null ⇒ let Remotion manage it.
   *
   * On Windows that download is worse than slow: it has been observed to unpack two files out of
   * the archive and then hang with no error, re-fetching the whole thing on every restart. Point
   * this at an installed Chrome there (`jobTimeoutMs` is what stops such a hang from stranding the
   * job, but a render that never starts is still a render the user does not get).
   */
  browserExecutable: string | null;
}

/**
 * Exactly one render at a time, not configurable.
 *
 * Chromium rendering a 1080p composition is the heaviest thing this process does — two at once on
 * the same box turns a slow render into two stalled renders and, on a small instance, into an OOM
 * kill that strands both. Scale renders by running more worker processes, not by raising this.
 */
export const RENDER_CONCURRENCY = 1;

export function loadWorkerConfig(): WorkerConfig {
  return {
    pollIntervalMs: intFromEnv("WORKER_POLL_INTERVAL_MS", 2_000, 250, 60_000),
    analyzeConcurrency: intFromEnv("WORKER_ANALYZE_CONCURRENCY", 2, 1, 16),
    heartbeatIntervalMs: intFromEnv("WORKER_HEARTBEAT_INTERVAL_MS", 15_000, 1_000, 120_000),
    staleAfterMs: intFromEnv("WORKER_STALE_AFTER_MS", 90_000, 10_000, 3_600_000),
    reapIntervalMs: intFromEnv("WORKER_REAP_INTERVAL_MS", 60_000, 5_000, 3_600_000),
    shutdownGraceMs: intFromEnv("WORKER_SHUTDOWN_GRACE_MS", 20_000, 0, 600_000),
    jobTimeoutMs: {
      analyze: intFromEnv("WORKER_ANALYZE_TIMEOUT_MS", 15 * 60_000, 5_000, 24 * 3_600_000),
      render: intFromEnv("WORKER_RENDER_TIMEOUT_MS", 60 * 60_000, 5_000, 24 * 3_600_000),
    },
    remotionGl: glFromEnv(),
    browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE?.trim() || null,
  };
}

function glFromEnv(): OpenGlRenderer {
  const raw = process.env.REMOTION_GL?.trim();
  if (!raw) return "swangle";
  // Checked here rather than cast at the call site: an unrecognised value would otherwise surface
  // as a Chromium launch failure partway into a render, long after the typo was made.
  const match = VALID_GL_RENDERERS.find((v) => v === raw);
  if (!match) throw new Error(`REMOTION_GL=${raw} is not one of ${VALID_GL_RENDERERS.join(", ")}`);
  return match;
}

/**
 * The variables without which nothing can work. Checked before the first claim so the failure is
 * one clear line at boot rather than a driver exception per job.
 */
export function assertWorkerEnv(): void {
  const missing = (["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const).filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length) {
    throw new Error(
      `worker cannot start: ${missing.join(", ")} not set. ` +
        `Copy .env.example to .env.local (the worker loads it automatically) or export them.`,
    );
  }
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  // A typo'd interval is a real operational hazard (a 0 ms poll is a busy loop against Postgres),
  // so an unusable value stops the worker instead of quietly reverting to the default.
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name}=${raw} is not an integer in [${min}, ${max}]`);
  }
  return value;
}
