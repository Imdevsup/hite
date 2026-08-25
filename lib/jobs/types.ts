/**
 * The job queue's shared vocabulary — one definition for the API routes and the worker.
 *
 * Mirrors `public.job` (migration 006). The queue replaced Vercel Workflow DevKit + @vercel/sandbox,
 * neither of which ever ran: the workflow directives were never compiled (`start()` threw on every
 * request) and the sandbox provisioned Debian packages onto an Amazon Linux microVM.
 */

/** Mirrors the `kind` check constraint on `public.job`. */
export type JobKind = "analyze" | "render";

/** Mirrors the `status` check constraint on `public.job`. */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** A row of `public.job`. `asset_id` and `export_id` are mutually exclusive (job_target_ck). */
export interface JobRow {
  id: string;
  kind: JobKind;
  asset_id: string | null;
  export_id: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  error: string | null;
  claimed_at: string | null;
  heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What the status routes report back. Never carries the analysis `data` blobs. */
export interface JobState {
  id: string;
  status: JobStatus;
  error: string | null;
  attempts: number;
  updatedAt: string;
}

export function toJobState(row: Pick<JobRow, "id" | "status" | "error" | "attempts" | "updated_at">): JobState {
  return { id: row.id, status: row.status, error: row.error, attempts: row.attempts, updatedAt: row.updated_at };
}

/**
 * WHEN A QUEUED JOB HAS WAITED LONG ENOUGH TO BE WORTH MENTIONING, AND WHAT IS SAID ABOUT IT.
 *
 * `reap_stale_jobs` only moves rows that are `running` with a dead heartbeat, so a job nothing ever
 * CLAIMS has no server-side end state at all: with no worker process, the analysis line reads
 * "0 of 3 done" and the Export control reads "Queued" for as long as the tab stays open. The cause
 * is almost always the second process (`pnpm worker`) not running — README's quickstart step, and
 * the single easiest thing to forget.
 *
 * This is a UI AFFORDANCE ONLY. Nothing here fails or expires a job, because "still queued" is also
 * the honest state of a job waiting behind another one (renders run one at a time), and inventing a
 * client-side timeout would turn a healthy queue into a fake failure. Hence the wording: it reports
 * that nothing has started the work and names the process that would, without claiming a fault.
 */
export const WORKER_IDLE_HINT_MS = 30_000;
export const WORKER_IDLE_HINT =
  "Nothing has picked this up yet. HITE does this work in a second process, so check that pnpm worker is running.";

/** Postgres unique-violation. The analyze route turns it into "that asset is already being analyzed". */
export const PG_UNIQUE_VIOLATION = "23505";

/**
 * The analysis branches this build actually runs.
 *
 * `faces` is deliberately absent. It was MediaPipe-in-Python, it never ran once, and there is no
 * JS replacement — so it is cut rather than faked. Nothing downstream fabricates a face track
 * either: the resolver returns an empty track and the compiler degrades to a VISIBLE centered
 * placement (lib/render/compile.ts `resolvePlacement`).
 */
export type AnalysisBranch = "transcribe" | "beats" | "scenes";

/**
 * Which branches apply to an asset of this kind — the denominator the UI counts progress against.
 *
 * Audio assets get analyzed, which they never used to (`audio-assets-never-analyzed`): only video
 * triggered analysis, so "sync the cuts to the beat of my song" asked for beats on a music file
 * that had none, and never would. They get no scene detection because a sound file has no shots —
 * reporting "0 cuts found" there would be a measurement of nothing.
 *
 * Images get nothing: a still has no soundtrack and no shot boundaries, so analysis has nothing to
 * measure. POST /api/analyze refuses them rather than queueing a job that writes empty rows.
 */
export function analysisBranchesForKind(kind: "video" | "audio" | "image"): AnalysisBranch[] {
  if (kind === "video") return ["transcribe", "beats", "scenes"];
  if (kind === "audio") return ["transcribe", "beats"];
  return [];
}
