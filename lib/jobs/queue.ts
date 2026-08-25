import type { SupabaseClient } from "@supabase/supabase-js";
import { PG_UNIQUE_VIOLATION, toJobState, type JobKind, type JobState } from "./types";

/**
 * Enqueue + read helpers for `public.job`. The API routes' whole contact with the queue.
 *
 * The routes are deliberately thin: POST inserts a row and returns its id; the worker does the
 * work. That split is the point of the unit — the previous design ran an OS package install, an
 * npm install, a Chromium download and a full `renderMedia` inside one serverless function's
 * timeout budget.
 *
 * Every function takes its client rather than reaching for one: inserts run under the service role
 * (after the route has checked ownership), reads run under the caller's RLS session so the job's
 * own policy is what proves the row is theirs.
 */

export interface EnqueueResult {
  jobId: string;
  /** True when an equivalent job was already live and this call joined it instead of queueing a second. */
  deduped: boolean;
}

/**
 * Queue an analysis of an asset, or return the job already doing it.
 *
 * The dedupe is enforced by `job_analyze_live_uq`, not by a read-then-insert: two tabs posting at
 * the same moment both pass a "is one running?" check and both insert. Letting the unique index
 * decide is the only version that is actually atomic.
 */
export async function enqueueAnalyzeJob(admin: SupabaseClient, assetId: string): Promise<EnqueueResult> {
  const { data, error } = await admin
    .from("job")
    .insert({ kind: "analyze" satisfies JobKind, asset_id: assetId })
    .select("id")
    .single();

  if (!error && data) return { jobId: data.id, deduped: false };

  if (error?.code === PG_UNIQUE_VIOLATION) {
    const { data: live } = await admin
      .from("job")
      .select("id")
      .eq("kind", "analyze")
      .eq("asset_id", assetId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // The live job can finish between the violation and this read; there is then nothing to join,
    // so say so rather than returning a job id that is not the one doing the work.
    if (live) return { jobId: live.id, deduped: true };
    throw new Error(`analyze job for asset ${assetId} conflicted but no live job could be found`);
  }

  throw new Error(`could not queue analyze job: ${error?.message ?? "insert returned no row"}`);
}

export async function enqueueRenderJob(admin: SupabaseClient, exportId: string): Promise<EnqueueResult> {
  const { data, error } = await admin
    .from("job")
    .insert({ kind: "render" satisfies JobKind, export_id: exportId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not queue render job: ${error?.message ?? "insert returned no row"}`);
  return { jobId: data.id, deduped: false };
}

const JOB_STATE_COLUMNS = "id, status, error, attempts, updated_at";

/** The newest job for an asset, under the caller's RLS session. Null when analysis was never started. */
export async function readAnalyzeJob(client: SupabaseClient, assetId: string): Promise<JobState | null> {
  return readLatest(client, "asset_id", assetId, "analyze");
}

export async function readRenderJob(client: SupabaseClient, exportId: string): Promise<JobState | null> {
  return readLatest(client, "export_id", exportId, "render");
}

async function readLatest(
  client: SupabaseClient,
  column: "asset_id" | "export_id",
  id: string,
  kind: JobKind,
): Promise<JobState | null> {
  const { data, error } = await client
    .from("job")
    .select(JOB_STATE_COLUMNS)
    .eq(column, id)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A read failure is NOT "no job": reporting it as one is how a broken query became an infinite
  // "still analyzing" spinner. Let it throw so the route answers 500 and the log names the cause.
  if (error) throw new Error(`could not read ${kind} job: ${error.message}`);
  return data ? toJobState(data) : null;
}
