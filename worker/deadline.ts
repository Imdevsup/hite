/**
 * A hard ceiling on one job.
 *
 * Why this exists. The loop `await`ed the handler with no timeout while a separate timer
 * heartbeated every job in flight, so a WEDGED handler was indistinguishable from a slow one: the
 * heartbeat stayed fresh, the reaper (which only moves jobs whose heartbeat has gone quiet) could
 * never fire by construction, and the row sat `running` forever with the Export window polling it
 * every 1.5 s. That is the silent-degradation-no-failure-state this whole unit exists to remove,
 * reached from inside the machinery meant to prevent it. It is not hypothetical: on Windows
 * `ensureBrowser()`'s auto-download unpacks two files out of the Chrome Headless Shell archive and
 * then hangs, with no signal, no error and no end.
 *
 * The deadline is measured against the handler, not against the process, and expiring ABANDONS the
 * handler rather than killing it — a promise cannot be cancelled. `onExpire` is where the abort
 * signal is raised, which does stop the children that were given it (ffmpeg, downloads); a Chromium
 * mid-render is not one of those, so it may run on to completion in the background. That is why the
 * abandoned promise is still watched: its late outcome is reported rather than surfacing as an
 * unhandled rejection that takes the whole worker down.
 */

/**
 * The words matter, not just the meaning. This message is written into `job.error`, and the Export
 * window classifies that string by keyword (`describeExportFailure` in components/editor/exportJob.ts
 * matches on timeout / timed out / deadline). It read "was still running after 900s and was given up
 * on" — true, readable, and matching none of them — so every real timeout was shown to the user as
 * the generic "the render stopped before it finished" instead of the one message that tells them the
 * cut was too long for the window. `exportJob.test.ts` now runs a real instance of this error through
 * that matcher, so the two cannot drift apart again silently.
 */
export class JobTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)}s and was given up on`);
    this.name = "JobTimeoutError";
  }
}

export interface DeadlineOptions {
  timeoutMs: number;
  /** Named in the error the user reads, e.g. "the render". */
  label: string;
  /** Raised the moment the deadline expires — abort whatever can still be stopped. */
  onExpire: () => void;
  /** How the abandoned work eventually ended, if it ever does. Error, or null for a late success. */
  onLateSettle?: (error: unknown) => void;
}

export function runWithDeadline<T>(work: Promise<T>, options: DeadlineOptions): Promise<T> {
  const { timeoutMs, label, onExpire, onLateSettle } = options;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      onExpire();
      reject(new JobTimeoutError(label, timeoutMs));
    }, timeoutMs);
    // The deadline must never be the reason the process stays alive.
    timer.unref?.();

    // Both callbacks are attached unconditionally, so the abandoned promise always has a handler
    // and a late rejection can never become an unhandled one.
    work.then(
      (value) => {
        clearTimeout(timer);
        if (settled) return onLateSettle?.(null);
        settled = true;
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (settled) return onLateSettle?.(error);
        settled = true;
        reject(error);
      },
    );
  });
}
