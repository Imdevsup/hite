import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdmin } from "@/lib/supabase/admin";
import type { JobKind, JobRow } from "@/lib/jobs/types";

/**
 * The worker's queue operations. Everything runs under the service role, which bypasses RLS —
 * the worker has already been told which job to do by `claim_job`, and jobs are only ever created
 * by API routes that checked ownership first.
 */

export function workerClient(): SupabaseClient {
  return createAdmin();
}

/**
 * Take the next queued job of one of the given kinds, atomically. Null when the queue is empty.
 *
 * The atomicity lives in SQL (`for update skip locked`, migration 006), not here: a read-then-write
 * from two workers would hand the same render to both.
 *
 * The `data.id` check is load-bearing, not defensive noise. `claim_job` returns a composite
 * `public.job`, and a plpgsql `return null` for a composite type arrives over PostgREST as a row of
 * NULLs — `{"id": null, "kind": null, …}` — NOT as JSON `null`. `?? null` therefore never fires on
 * an empty queue, and the loop dispatches a phantom job whose every field is null. (It is `IS NULL`
 * in SQL, which is why this reads correctly from psql and wrongly from the client.)
 */
export async function claimJob(admin: SupabaseClient, kinds: JobKind[]): Promise<JobRow | null> {
  const { data, error } = await admin.rpc("claim_job", { p_kinds: kinds });
  if (error) throw new Error(`claim_job failed: ${error.message}`);
  const row = data as JobRow | null;
  return row?.id ? row : null;
}

/**
 * The identity of ONE claim on a job, not just of the job.
 *
 * `claim_job` increments `attempts` every time it hands a row out, so `(id, status='running',
 * attempts)` names the exact claim this worker holds and nobody else's. Every terminal write is
 * fenced on it, because "this job" is not specific enough once the reaper has been anywhere near
 * it: a worker whose heartbeats are failing is still running, and the row it thinks it owns may
 * already have been requeued and re-claimed by somebody else. Writing `succeeded`/`failed` by id
 * alone then means one worker deciding another's outcome — telling the user their render failed
 * while a good MP4 lands from the worker that actually did the work.
 */
export type JobClaim = Pick<JobRow, "id" | "attempts">;

/**
 * Record success. Returns false when the claim was already lost, in which case NOTHING was written
 * — whoever holds the job now reports its outcome.
 */
export async function markSucceeded(admin: SupabaseClient, claim: JobClaim): Promise<boolean> {
  const { data, error } = await admin
    .from("job")
    .update({ status: "succeeded", error: null, heartbeat_at: null })
    .eq("id", claim.id)
    .eq("status", "running")
    .eq("attempts", claim.attempts)
    .select("id");
  if (error) throw new Error(`could not mark job ${claim.id} succeeded: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Terminal failure. Deliberately NOT a requeue: `attempts`/`max_attempts` govern crash recovery
 * only. Re-running a job that failed for a real reason — a corrupt upload, an EDL that will not
 * compile — burns the same minutes twice more and tells the user the same thing at the end.
 *
 * Fenced on the claim for the same reason as success, and more urgently: this is the write that
 * puts a sentence in front of the user.
 */
export async function markFailed(admin: SupabaseClient, claim: JobClaim, message: string): Promise<boolean> {
  const { data, error } = await admin
    .from("job")
    .update({ status: "failed", error: message, heartbeat_at: null })
    .eq("id", claim.id)
    .eq("status", "running")
    .eq("attempts", claim.attempts)
    .select("id");
  // Log rather than throw: the job already failed, and losing the loop over a second failure would
  // leave the row 'running' forever — the exact state the reaper exists to prevent, reached by the
  // error handler itself.
  if (error) {
    console.error(`[worker] could not record failure for job ${claim.id}: ${error.message} (was: ${message})`);
    return false;
  }
  return (data ?? []).length > 0;
}

/** Does this worker still hold the claim it was given? Used before writing outside the `job` row. */
export async function holdsClaim(admin: SupabaseClient, claim: JobClaim): Promise<boolean> {
  const { data, error } = await admin
    .from("job")
    .select("id")
    .eq("id", claim.id)
    .eq("status", "running")
    .eq("attempts", claim.attempts)
    .maybeSingle();
  // Unreadable is not "lost": assuming the worst here would suppress a real failure message.
  if (error) {
    console.error(`[worker] could not confirm the claim on job ${claim.id}: ${error.message}`);
    return true;
  }
  return data !== null;
}

/**
 * Hand jobs back to the queue on shutdown so another worker takes them immediately instead of
 * waiting out the stale window.
 */
export async function releaseJobs(admin: SupabaseClient, jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { error } = await admin
    .from("job")
    .update({ status: "queued", claimed_at: null, heartbeat_at: null, error: "worker shut down mid-job; requeued" })
    .in("id", jobIds)
    .eq("status", "running");
  if (error) console.error(`[worker] could not release jobs ${jobIds.join(", ")}: ${error.message}`);
}

/**
 * One statement for every in-flight job, so heartbeat cost does not scale with concurrency.
 *
 * Returns the ids this worker STILL holds. The heartbeat is the only place a worker gets to find
 * out that a job was taken off it — it swallowed its result before, so a worker that had been
 * reaped went on burning CPU on a render somebody else was already redoing, and only discovered it
 * at the very end, when its outcome write was fenced out. The caller stops that work instead.
 */
export async function heartbeat(admin: SupabaseClient, claims: JobClaim[]): Promise<string[]> {
  if (claims.length === 0) return [];
  const { data, error } = await admin
    .from("job")
    .update({ heartbeat_at: new Date().toISOString() })
    .in("id", claims.map((c) => c.id))
    .eq("status", "running")
    .select("id, attempts");
  // A missed heartbeat is survivable (the next one lands in seconds); a throw here would kill the
  // interval and make every in-flight job look abandoned. A failed statement is also not evidence
  // that anything was lost, so it reports every job as still held.
  if (error) {
    console.error(`[worker] heartbeat failed: ${error.message}`);
    return claims.map((c) => c.id);
  }
  const beaten = new Map((data ?? []).map((row) => [row.id as string, row.attempts as number]));
  return claims.filter((c) => beaten.get(c.id) === c.attempts).map((c) => c.id);
}

/** Requeue or honestly fail jobs whose worker stopped reporting. Returns how many were touched. */
export async function reapStaleJobs(admin: SupabaseClient, staleAfterMs: number): Promise<number> {
  const { data, error } = await admin.rpc("reap_stale_jobs", { p_stale: `${Math.round(staleAfterMs / 1000)} seconds` });
  if (error) throw new Error(`reap_stale_jobs failed: ${error.message}`);
  return typeof data === "number" ? data : 0;
}
