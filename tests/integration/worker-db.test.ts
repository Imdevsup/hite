import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { claimJob, heartbeat, holdsClaim, markFailed, markSucceeded, reapStaleJobs } from "@/worker/db";
import type { JobRow } from "@/lib/jobs/types";
import { acquireQueueLock, type ReleaseQueue } from "./queue-lock";

/**
 * The worker's terminal writes, against a real Postgres and the real `claim_job` / `reap_stale_jobs`
 * functions.
 *
 * What this pins down: a job can change hands mid-flight. A worker whose heartbeats stop landing —
 * a network partition, a long GC pause, a laptop lid — is reaped, and the job it is still working
 * on is requeued and claimed by somebody else. Both workers are then alive and both believe the job
 * is theirs. Writing `succeeded`/`failed` by job id alone means the loser gets to overwrite the
 * winner's outcome, and the user is told their render failed while a good MP4 lands (or told it
 * succeeded when the file was never written). Every write is therefore fenced on the CLAIM —
 * `(id, status='running', attempts)` — because `attempts` is incremented by `claim_job` and so
 * names one handover generation exactly.
 *
 * Requires the local Supabase env vars AND that no worker process is polling the same database:
 * these tests claim jobs directly, and a live worker would claim them first.
 */

const URL = process.env.SUPABASE_LOCAL_URL;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && SERVICE);

describe.skipIf(!ENABLED)("worker queue writes are fenced on the claim", () => {
  const admin: SupabaseClient = ENABLED
    ? createClient(URL!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } })
    : (null as never);

  let userId: string;
  let projectId: string;
  let editId: string;
  let releaseQueue: ReleaseQueue | null = null;

  beforeAll(async () => {
    if (!ENABLED) return;
    // These tests call the real `claim_job`, which hands out the oldest queued job of a kind
    // regardless of who queued it — so they need the queue to themselves or they will claim (and
    // finish) another test file's render.
    releaseQueue = await acquireQueueLock();
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email: `fence-${Date.now()}@hite.test`,
      password: "not-a-password-xyz-1234",
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = user.user!.id;

    const { data: project, error: projectError } = await admin
      .from("project")
      .insert({ owner_user_id: userId, title: "claim fence" })
      .select("id")
      .single();
    if (projectError) throw projectError;
    projectId = project!.id;

    const { data: edit, error: editError } = await admin
      .from("edit")
      .insert({ project_id: projectId, version: 1, edl: { schema: "Edl.2" } })
      .select("id")
      .single();
    if (editError) throw editError;
    editId = edit!.id;
    // Long, because this may be queued behind worker.test.ts's full render pass.
  }, 300_000);

  afterAll(async () => {
    if (!ENABLED) return;
    await admin.from("project").delete().eq("id", projectId);
    await admin.auth.admin.deleteUser(userId);
    await releaseQueue?.();
  });

  /** A queued render job, then the claim on it — the state a worker starts a job in. */
  async function claimFreshJob(): Promise<JobRow> {
    const { data: exportRow, error: exportError } = await admin
      .from("export")
      .insert({ edit_id: editId, aspect: "16:9", tier: "free", status: "queued" })
      .select("id")
      .single();
    if (exportError) throw exportError;
    const { error: jobError } = await admin
      .from("job")
      .insert({ kind: "render", export_id: exportRow!.id })
      .select("id")
      .single();
    if (jobError) throw jobError;

    const claim = await claimJob(admin, ["render"]);
    if (!claim) throw new Error("claim_job returned nothing for a job that was just queued");
    return claim;
  }

  /** Exactly what the reaper does to a worker that went quiet, without waiting out a real timeout. */
  async function reapInto(jobId: string): Promise<void> {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { error } = await admin.from("job").update({ heartbeat_at: past, claimed_at: past }).eq("id", jobId);
    if (error) throw error;
    expect(await reapStaleJobs(admin, 10_000)).toBeGreaterThanOrEqual(1);
  }

  async function readJob(jobId: string) {
    const { data, error } = await admin
      .from("job")
      .select("status, attempts, error")
      .eq("id", jobId)
      .single();
    if (error) throw error;
    return data as { status: string; attempts: number; error: string | null };
  }

  test("a stale worker cannot mark SUCCEEDED a job that was re-claimed under it", async () => {
    const first = await claimFreshJob();
    expect(first.attempts).toBe(1);

    await reapInto(first.id);
    const second = await claimJob(admin, ["render"]);
    expect(second?.id).toBe(first.id);
    expect(second!.attempts).toBe(2);

    // The stale worker finishes its (now duplicated) work and tries to record the outcome.
    expect(await markSucceeded(admin, first)).toBe(false);
    expect(await readJob(first.id)).toMatchObject({ status: "running", attempts: 2 });

    // The worker that actually holds the job still records it.
    expect(await markSucceeded(admin, second!)).toBe(true);
    expect(await readJob(first.id)).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  test("a stale worker cannot mark FAILED a job somebody else is about to succeed at", async () => {
    const first = await claimFreshJob();
    await reapInto(first.id);
    const second = await claimJob(admin, ["render"]);
    expect(second?.id).toBe(first.id);

    // This is the one the user sees: "your render failed" written over a render that is fine.
    expect(await markFailed(admin, first, "chromium died")).toBe(false);
    const row = await readJob(first.id);
    expect(row.status).toBe("running");
    expect(row.error).not.toBe("chromium died");

    expect(await markSucceeded(admin, second!)).toBe(true);
    expect(await readJob(first.id)).toMatchObject({ status: "succeeded", error: null });
  });

  test("the heartbeat is how a worker LEARNS it lost the claim", async () => {
    const first = await claimFreshJob();
    // Still ours: the heartbeat lands and reports the job as held.
    expect(await heartbeat(admin, [first])).toEqual([first.id]);
    expect(await holdsClaim(admin, first)).toBe(true);

    await reapInto(first.id);
    const second = await claimJob(admin, ["render"]);
    expect(second?.id).toBe(first.id);

    // Not ours any more — which is what lets the worker stop burning a Chromium on it.
    expect(await heartbeat(admin, [first])).toEqual([]);
    expect(await holdsClaim(admin, first)).toBe(false);
    expect(await heartbeat(admin, [second!])).toEqual([second!.id]);
    expect(await holdsClaim(admin, second!)).toBe(true);

    expect(await markFailed(admin, second!, "no browser could be started")).toBe(true);
    expect(await readJob(first.id)).toMatchObject({ status: "failed", error: "no browser could be started" });
  });

  test("the ordinary path is untouched: claim, heartbeat, succeed", async () => {
    const claim = await claimFreshJob();
    expect(await heartbeat(admin, [claim])).toEqual([claim.id]);
    expect(await markSucceeded(admin, claim)).toBe(true);
    expect(await readJob(claim.id)).toMatchObject({ status: "succeeded", attempts: 1, error: null });
  });

  test("a job that fails for a real reason records the reason and stays failed", async () => {
    const claim = await claimFreshJob();
    expect(await markFailed(admin, claim, "moov atom not found")).toBe(true);
    expect(await readJob(claim.id)).toMatchObject({ status: "failed", error: "moov atom not found" });
    // And a second write from the same worker no longer applies — the claim is over.
    expect(await markSucceeded(admin, claim)).toBe(false);
    expect(await readJob(claim.id)).toMatchObject({ status: "failed" });
  });
});
