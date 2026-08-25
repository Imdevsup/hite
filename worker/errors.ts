/**
 * Turning a thrown thing into the string that lands in `job.error`.
 *
 * That column is the honest-state fix: before it existed a failed analyze or render had nowhere to
 * be recorded, so the UI polled every 1.5 s forever with no timeout and no failure state. Which
 * means the string has to be (a) present for every failure, (b) readable by a person, and (c) safe
 * to show them.
 */

/** Long enough for a real stack frame or an ffmpeg tail; short enough not to bloat every poll. */
const MAX_ERROR_LENGTH = 2_000;

/**
 * Strip the query string from any URL in the text.
 *
 * Signed storage URLs are bearer credentials, and this text is written to the database, printed to
 * the server log and returned to the browser by the status routes. `?token=…` in an ffmpeg or
 * Chromium error is a real leak of read access to the user's raw footage.
 */
export function redactUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s"'<>]+?)\?[^\s"'<>]*/g, "$1");
}

/**
 * A branch that could not run because this deployment is not configured for it — not a branch that
 * tried and failed.
 *
 * The distinction is load-bearing. Transcription needs `GROQ_API_KEY`; without it the transcribe
 * branch threw like any other error, so an analyze job that had probed the file, measured its tempo
 * exactly and found every shot boundary was still marked FAILED, and the editor told the user "HITE
 * couldn't read this video" about a video it had read perfectly. That is a false statement produced
 * by the software, which is the one thing this codebase will not ship.
 *
 * Unavailable branches are recorded and reported, never silently dropped: the tools that depend on
 * them already say so themselves (`findSilences` returns `transcribed: false` with a note), so the
 * model still cannot mistake "not analysed" for "nothing there".
 */
export class BranchUnavailableError extends Error {
  readonly branchName: string;

  constructor(branchName: string, message: string) {
    super(message);
    this.name = "BranchUnavailableError";
    this.branchName = branchName;
  }
}

export function errorText(e: unknown): string {
  const raw =
    e instanceof Error
      ? // A cause is usually where the real reason is (a storage driver error wrapped by ours).
        e.cause instanceof Error
        ? `${e.message}: ${e.cause.message}`
        : e.message
      : String(e);
  const cleaned = redactUrls(raw).trim() || "the job failed with no error message";
  return cleaned.length > MAX_ERROR_LENGTH ? `${cleaned.slice(0, MAX_ERROR_LENGTH)}…` : cleaned;
}

/**
 * One analyze job runs several independent branches. When some succeed and some fail, the
 * successful rows are already written and the job must still report the failure — silently
 * succeeding on 2 of 3 is precisely the silent degradation this unit exists to remove.
 */
export function branchFailureText(failures: { branch: string; error: unknown }[]): string {
  return failures.map((f) => `${f.branch}: ${errorText(f.error)}`).join(" — ");
}
