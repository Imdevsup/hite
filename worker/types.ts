import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRow } from "@/lib/jobs/types";
import type { WorkerConfig } from "./config";

/** Everything a job handler is given. Handlers throw to fail; returning means success. */
export interface JobContext {
  job: JobRow;
  /** Service-role client. The job was already authorised when the API route created it. */
  admin: SupabaseClient;
  config: WorkerConfig;
  /**
   * Aborted when the worker is shutting down and the grace period has run out. Passed to every
   * child process and fetch so a shutdown does not leave an orphaned ffmpeg or Chromium behind.
   */
  signal: AbortSignal;
  /** Prefixed logger — job id included, so interleaved concurrent jobs stay readable. */
  log: (message: string) => void;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;
