import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobKind, JobRow } from "@/lib/jobs/types";
import { FfmpegError, describeArgs } from "@/lib/ffmpeg/run";
import { RENDER_CONCURRENCY, assertWorkerEnv, loadWorkerConfig, type WorkerConfig } from "./config";
import { claimJob, heartbeat, markFailed, markSucceeded, reapStaleJobs, releaseJobs, workerClient } from "./db";
import { runWithDeadline } from "./deadline";
import { errorText } from "./errors";
import { runAnalyzeJob } from "./analyze";
import { prepareRenderer, runRenderJob } from "./render";
import type { JobContext, JobHandler } from "./types";

/**
 * `pnpm worker` — the process that actually does the work.
 *
 * A plain long-lived Node loop: claim → dispatch → mark succeeded/failed. No platform primitives,
 * so it runs the same on a laptop, a VPS, a container or a Fly/Railway box, and a stranger who
 * clones this repo can run the whole pipeline. That portability is the point: what it replaces
 * (Vercel Workflow DevKit + @vercel/sandbox) assembled an OS toolchain per request and had never
 * successfully executed once, in any environment.
 *
 * Operational guarantees, each present because its absence was a named defect:
 *   • Startup + periodic reaper — a crashed worker cannot strand a user forever.
 *   • Heartbeats — a 40-minute render is told apart from a worker that died 40 minutes ago.
 *   • A per-job deadline — a WEDGED handler is told apart from a slow one, which the heartbeat
 *     alone cannot do: it keeps a hung job looking alive, so the reaper never fires for it.
 *   • Every failure writes a human-readable `job.error`; nothing is swallowed.
 *   • Every terminal write is fenced on the claim, so a worker can only ever report the outcome of
 *     work it still owns.
 *   • Graceful SIGINT/SIGTERM — in-flight work is finished, or released back to the queue.
 *   • One render at a time, N analyses.
 */

const HANDLERS: Record<JobKind, JobHandler> = {
  analyze: runAnalyzeJob,
  render: runRenderJob,
};

interface InFlight {
  job: JobRow;
  done: Promise<void>;
  abort: AbortController;
  /**
   * Set once the handler is done and only the outcome write is left. The heartbeat reads it: a job
   * whose row has just been marked terminal no longer heartbeats, and without this the next sweep
   * would report the worker as having "lost the claim" on work it had in fact just finished.
   */
  finalizing: boolean;
}

async function main(): Promise<void> {
  assertWorkerEnv();
  const config = loadWorkerConfig();
  const admin = workerClient();

  const inFlight = new Map<string, InFlight>();
  let shuttingDown = false;

  log(
    `starting — analyze x${config.analyzeConcurrency}, render x${RENDER_CONCURRENCY}, ` +
      `poll ${config.pollIntervalMs}ms, stale after ${config.staleAfterMs}ms`,
  );

  // Chrome BEFORE the loop: see prepareRenderer. A ~110 MB download must not happen inside a job's
  // deadline while holding the only render slot.
  await prepareRenderer(config, log);

  // Reap BEFORE claiming anything: whatever the previous worker was holding when it died is the
  // first thing that should move.
  await reap(admin, config);
  const reapTimer = setInterval(() => {
    void reap(admin, config);
  }, config.reapIntervalMs);
  const heartbeatTimer = setInterval(() => {
    void beat(admin, inFlight);
  }, config.heartbeatIntervalMs);

  const shutdown = makeShutdownHandler({
    admin,
    config,
    inFlight,
    stop: () => {
      shuttingDown = true;
    },
    timers: [reapTimer, heartbeatTimer],
  });
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  while (!shuttingDown) {
    let claimedAny = false;
    try {
      for (const kind of ["render", "analyze"] as const) {
        // Render first: it is the job a user is actively waiting on with a progress bar open.
        while (!shuttingDown && capacityFor(kind, inFlight, config) > 0) {
          const job = await claimJob(admin, [kind]);
          if (!job) break;
          claimedAny = true;
          start(job, { admin, config, inFlight });
        }
      }
    } catch (e) {
      // A database blip must not take the worker down: exiting here would abandon every in-flight
      // job to the stale window, turning a two-second network hiccup into minutes of dead time for
      // whoever is watching a render. Log it and try again on the next tick.
      log(`could not claim work: ${errorText(e)}`);
      claimedAny = false;
    }
    // Only idle when nothing was taken; otherwise loop straight back and drain the queue.
    if (!claimedAny) await sleep(config.pollIntervalMs);
  }
}

function capacityFor(kind: JobKind, inFlight: Map<string, InFlight>, config: WorkerConfig): number {
  const limit = kind === "render" ? RENDER_CONCURRENCY : config.analyzeConcurrency;
  let running = 0;
  for (const entry of inFlight.values()) if (entry.job.kind === kind) running += 1;
  return limit - running;
}

function start(
  job: JobRow,
  deps: { admin: SupabaseClient; config: WorkerConfig; inFlight: Map<string, InFlight> },
): void {
  const abort = new AbortController();
  const ctx: JobContext = {
    job,
    admin: deps.admin,
    config: deps.config,
    signal: abort.signal,
    log: (message) => log(`[${job.kind} ${job.id.slice(0, 8)}] ${message}`),
  };

  const done = (async () => {
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    ctx.log(`claimed (attempt ${job.attempts}/${job.max_attempts})`);

    // The handler's outcome is captured BEFORE anything is written, so that a database blip while
    // recording SUCCESS cannot be caught by the failure branch and mark finished work as failed —
    // the MP4 is already uploaded and the export row already says succeeded at that point.
    let failure: unknown = null;
    try {
      await runWithDeadline(HANDLERS[job.kind](ctx), {
        timeoutMs: deps.config.jobTimeoutMs[job.kind],
        label: job.kind === "render" ? "the render" : "the analysis",
        // Everything that took the signal (ffmpeg, the source download) stops here. A Chromium
        // already inside `renderMedia` did not, so it may still finish in the background — which is
        // why its late outcome is logged rather than ignored.
        onExpire: () => abort.abort(),
        onLateSettle: (error) =>
          ctx.log(
            error === null
              ? "the abandoned handler finished after all — its output is not being recorded"
              : `the abandoned handler failed later: ${errorText(error)}`,
          ),
      });
    } catch (e) {
      failure = e;
    }

    const entry = deps.inFlight.get(job.id);
    if (entry) entry.finalizing = true;

    try {
      if (failure === null) {
        // False means the claim was taken over mid-job (reaped, then re-claimed). The work is done
        // and the artifact is written, but the OUTCOME belongs to whoever holds the job now —
        // overwriting it is how a user gets told the opposite of what actually happened.
        const recorded = await markSucceeded(deps.admin, job);
        ctx.log(
          recorded
            ? `succeeded in ${elapsed()}`
            : `succeeded in ${elapsed()}, but this claim had already been taken over — outcome NOT recorded`,
        );
      } else {
        const message = errorText(failure);
        ctx.log(`FAILED after ${elapsed()}: ${message}`);
        // The command line goes to the LOG, never into `job.error`: it carries absolute server
        // paths and (query-stripped) urls a user has no use for and an operator has every use for.
        if (failure instanceof FfmpegError) ctx.log(`command: ${describeArgs(failure.args)}`);
        const recorded = await markFailed(deps.admin, job, message);
        if (!recorded) ctx.log("this claim had already been taken over — the failure was NOT recorded");
      }
    } catch (e) {
      // Reached when the outcome itself could not be written. The row stays 'running' and the
      // reaper requeues it; both handlers are idempotent (analysis rows upsert on
      // `(asset_id, kind)`, the MP4 overwrites a stable `{userId}/{exportId}.mp4`), so a repeat is
      // wasteful but never wrong — which beats a lie in either direction.
      ctx.log(`could not record the outcome: ${errorText(e)}`);
    } finally {
      deps.inFlight.delete(job.id);
    }
  })();

  deps.inFlight.set(job.id, { job, done, abort, finalizing: false });
}

/** How long an aborted handler gets to finish writing its own outcome before its job is requeued. */
const ABORT_SETTLE_MS = 2_000;

/**
 * First signal: stop claiming and let in-flight work finish, so a render that is 95% done is not
 * thrown away. If the grace period expires (or a second signal arrives) the children are aborted
 * and the jobs are handed straight back to the queue — another worker picks them up immediately
 * rather than waiting out the stale window.
 */
function makeShutdownHandler(deps: {
  admin: SupabaseClient;
  config: WorkerConfig;
  inFlight: Map<string, InFlight>;
  stop: () => void;
  timers: NodeJS.Timeout[];
}): (signal: string) => Promise<void> {
  let shuttingDown = false;
  let forced = false;

  return async (signal: string) => {
    if (shuttingDown) {
      if (forced) return;
      forced = true;
      log(`${signal} again — aborting ${deps.inFlight.size} in-flight job(s) now`);
      for (const entry of deps.inFlight.values()) entry.abort.abort();
      return;
    }
    shuttingDown = true;
    deps.stop();
    for (const timer of deps.timers) clearInterval(timer);
    log(`${signal} — no longer claiming; ${deps.inFlight.size} job(s) in flight`);

    const graceExpired = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), deps.config.shutdownGraceMs).unref(),
    );
    const allDone = Promise.all([...deps.inFlight.values()].map((e) => e.done)).then(() => "done" as const);
    const outcome = await Promise.race([allDone, graceExpired]);

    if (outcome === "timeout" && deps.inFlight.size > 0) {
      log(`grace period expired — aborting ${deps.inFlight.size} job(s)`);
      for (const entry of deps.inFlight.values()) entry.abort.abort();
      // Let the aborted handlers unwind before requeueing: one that is finalizing right now
      // deserves to record its own outcome, and requeueing underneath it would hand a second worker
      // work that is already finished. (Its write is fenced on the claim either way, so this is
      // about not wasting the work, not about correctness.)
      await Promise.race([
        Promise.all([...deps.inFlight.values()].map((e) => e.done)),
        sleep(ABORT_SETTLE_MS),
      ]);
      const stillHeld = [...deps.inFlight.keys()];
      if (stillHeld.length > 0) {
        log(`releasing ${stillHeld.length} job(s) back to the queue`);
        await releaseJobs(deps.admin, stillHeld);
      }
    }
    log("stopped");
    process.exit(0);
  };
}

/**
 * One heartbeat for every job in flight — and the one place a worker can learn it has LOST one.
 *
 * A worker whose heartbeats stopped landing (a network partition, a long GC pause, a laptop lid)
 * gets reaped, and its jobs are handed to somebody else while it is still working on them. Its
 * writes are fenced out at the end, so it cannot corrupt the outcome, but without this it would
 * keep a whole Chromium busy on a render that is already being redone. Stop, and free the slot.
 */
async function beat(admin: SupabaseClient, inFlight: Map<string, InFlight>): Promise<void> {
  const entries = [...inFlight.values()].filter((e) => !e.finalizing);
  if (entries.length === 0) return;
  try {
    const held = new Set(await heartbeat(admin, entries.map((e) => e.job)));
    for (const entry of entries) {
      if (held.has(entry.job.id) || entry.finalizing || !inFlight.has(entry.job.id)) continue;
      log(`[${entry.job.kind} ${entry.job.id.slice(0, 8)}] lost the claim to another worker — aborting`);
      entry.abort.abort();
    }
  } catch (e) {
    // Same reasoning as the reaper: a failed sweep must not take the worker down.
    log(`heartbeat sweep failed: ${errorText(e)}`);
  }
}

async function reap(admin: SupabaseClient, config: WorkerConfig): Promise<void> {
  try {
    const count = await reapStaleJobs(admin, config.staleAfterMs);
    if (count > 0) log(`reaper moved ${count} abandoned job(s)`);
  } catch (e) {
    // A failed sweep must not take the worker down — the next one is a minute away.
    log(`reaper failed: ${errorText(e)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[worker] ${new Date().toISOString()} ${message}`);
}

main().catch((e: unknown) => {
  console.error(`[worker] fatal: ${errorText(e)}`);
  process.exit(1);
});
