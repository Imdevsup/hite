import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { enqueueAnalyzeJob, enqueueRenderJob, readAnalyzeJob, readRenderJob } from "@/lib/jobs/queue";
import { acquireQueueLock, type ReleaseQueue } from "./queue-lock";

/**
 * `lib/jobs/queue.ts` against a real Postgres — the half of the API routes that is not a one-liner.
 *
 * The dedupe path in particular cannot be verified without the database: it depends on the
 * `job_analyze_live_uq` partial unique index actually rejecting the second insert, and on the
 * follow-up read finding the job that won. A mocked test of that logic proves nothing.
 *
 * Skipped unless the local Supabase env vars are set.
 */

const URL = process.env.SUPABASE_LOCAL_URL;
const ANON = process.env.SUPABASE_LOCAL_ANON_KEY;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && ANON && SERVICE);
const PASSWORD = "not-a-password-xyz-1234";

describe.skipIf(!ENABLED)("job queue helpers", () => {
  const admin: SupabaseClient = ENABLED
    ? createClient(URL!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } })
    : (null as never);

  let userId: string;
  let accessToken: string;
  let projectId: string;
  let assetId: string;
  let editId: string;
  let releaseQueue: ReleaseQueue | null = null;

  beforeAll(async () => {
    if (!ENABLED) return;
    // The jobs queued here are left QUEUED on purpose — the dedupe is defined in terms of live
    // jobs, and the status assertions are about rows nothing has touched. Any worker polling the
    // same database would claim them and both of those stop being true, so this file needs the
    // queue to itself as much as the ones that claim from it do.
    releaseQueue = await acquireQueueLock();
    const email = `queue-${Date.now()}@hite.test`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = created.user!.id;

    const signIn = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: session, error: signInError } = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw signInError;
    accessToken = session.session!.access_token;

    const { data: project } = await admin
      .from("project")
      .insert({ owner_user_id: userId, title: "queue" })
      .select("id")
      .single();
    projectId = project!.id;

    const { data: asset } = await admin
      .from("asset")
      .insert({
        project_id: projectId,
        kind: "video",
        filename: "q.mp4",
        blob_url: `local://queue-${Date.now()}`,
      })
      .select("id")
      .single();
    assetId = asset!.id;

    const { data: edit } = await admin
      .from("edit")
      .insert({ project_id: projectId, version: 1, edl: { schema: "Edl.2" } })
      .select("id")
      .single();
    editId = edit!.id;
  }, 300_000);

  afterAll(async () => {
    if (!ENABLED) return;
    await admin.from("project").delete().eq("id", projectId);
    await admin.auth.admin.deleteUser(userId);
    await releaseQueue?.();
  });

  test("a second analyze request joins the live job instead of queueing a duplicate pass", async () => {
    const first = await enqueueAnalyzeJob(admin, assetId);
    expect(first.deduped).toBe(false);

    // Two tabs, or a double-click, or a reopened project. Both used to enqueue a full second
    // analysis of the same file — a read-then-insert check does not stop it, because both requests
    // pass the check before either inserts.
    const second = await enqueueAnalyzeJob(admin, assetId);
    expect(second.deduped).toBe(true);
    expect(second.jobId).toBe(first.jobId);

    const { count } = await admin
      .from("job")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", assetId)
      .eq("kind", "analyze");
    expect(count).toBe(1);
  });

  test("once the live job finishes, a new analyze can be queued again", async () => {
    const first = await enqueueAnalyzeJob(admin, assetId);
    await admin.from("job").update({ status: "succeeded" }).eq("id", first.jobId);

    const second = await enqueueAnalyzeJob(admin, assetId);
    expect(second.deduped).toBe(false);
    expect(second.jobId).not.toBe(first.jobId);
  });

  test("the owner reads their own analyze job's status and error under RLS", async () => {
    const { jobId } = await enqueueAnalyzeJob(admin, assetId);
    await admin.from("job").update({ status: "failed", error: "GROQ_API_KEY is not set" }).eq("id", jobId);

    // This is exactly what GET /api/analyze/[assetId] does, on the caller's own session — the honest
    // failure state that replaced polling forever with no error field to read.
    const state = await readAnalyzeJob(clientAs(accessToken), assetId);
    expect(state?.status).toBe("failed");
    expect(state?.error).toBe("GROQ_API_KEY is not set");
  });

  test("an asset that was never analyzed reports null, not a fabricated 'queued'", async () => {
    const { data: other } = await admin
      .from("asset")
      .insert({
        project_id: projectId,
        kind: "video",
        filename: "never.mp4",
        blob_url: `local://never-${Date.now()}`,
      })
      .select("id")
      .single();
    expect(await readAnalyzeJob(clientAs(accessToken), other!.id)).toBeNull();
  });

  test("render jobs are NOT deduped — a second export of the same edit is a real request", async () => {
    const exports = await Promise.all([insertExport(), insertExport()]);
    const jobs = await Promise.all(exports.map((id) => enqueueRenderJob(admin, id)));
    expect(jobs[0].jobId).not.toBe(jobs[1].jobId);
    expect(jobs.every((j) => !j.deduped)).toBe(true);

    const state = await readRenderJob(clientAs(accessToken), exports[0]);
    expect(state?.status).toBe("queued");
    expect(state?.error).toBeNull();
  });

  async function insertExport(): Promise<string> {
    const { data, error } = await admin
      .from("export")
      .insert({ edit_id: editId, aspect: "16:9", tier: "free", status: "queued" })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id;
  }

  function clientAs(token: string): SupabaseClient {
    return createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
});
