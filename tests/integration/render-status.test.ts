import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acquireQueueLock, type ReleaseQueue } from "./queue-lock";

/**
 * GET /api/render/[id] — the route the Export window polls every 1.5 s — against the real database.
 *
 * The claim this covers is "a render can no longer look like it is still going when it is not". The
 * export row is only a CACHE of the outcome, written by the worker when it gets the chance, and
 * there are three ordinary ways it never gets the chance: the worker is killed mid-render, its
 * handler is given up on by the per-job deadline, or the reaper exhausts the last attempt. In every
 * one of them the row is left saying `running` with nothing working on it — verified live: a job
 * timed out at 8 s and left `export.status = 'running'` behind. The job row always knows, so the
 * route derives the answer from it.
 *
 * Only the auth boundary is faked, with a real signed-in client, so RLS decides what is readable.
 */

const URL = process.env.SUPABASE_LOCAL_URL;
const ANON = process.env.SUPABASE_LOCAL_ANON_KEY;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && ANON && SERVICE);
const PASSWORD = "not-a-password-xyz-1234";

let session: { user: { id: string }; supabase: SupabaseClient } | null = null;

vi.mock("@/lib/api/auth", () => ({
  withAuth: async (handler: (ctx: { user: { id: string }; supabase: SupabaseClient }) => unknown) => {
    if (!session) throw new Error("the test has no signed-in session");
    return handler(session);
  },
}));

const { GET } = await import("@/app/api/render/[id]/route");

interface PollBody {
  status: string;
  error: string | null;
  progress: number;
  attempts: number;
  output_blob_url?: string;
}

describe.skipIf(!ENABLED)("GET /api/render/[id] always reaches an answer", () => {
  const admin: SupabaseClient = ENABLED
    ? createClient(URL!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } })
    : (null as never);

  let userId: string;
  let projectId: string;
  let editId: string;
  let releaseQueue: ReleaseQueue | null = null;

  beforeAll(async () => {
    if (!ENABLED) return;
    // The job rows here stand in for renders in flight. A reaper sweeping the same database would
    // requeue them and a worker would then claim them, so the queue has to be this file's alone.
    releaseQueue = await acquireQueueLock();
    const email = `poll-${Date.now()}@hite.test`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = created.user!.id;

    const signIn = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signedIn, error: signInError } = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw signInError;
    session = {
      user: { id: userId },
      supabase: createClient(URL!, ANON!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${signedIn.session!.access_token}` } },
      }),
    };

    const { data: project } = await admin
      .from("project")
      .insert({ owner_user_id: userId, title: "poll" })
      .select("id")
      .single();
    projectId = project!.id;
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

  /** An export mid-render, with the job row the worker claimed for it. */
  async function startedRender(exportPatch: Record<string, unknown> = {}) {
    const { data: exportRow, error } = await admin
      .from("export")
      .insert({ edit_id: editId, aspect: "16:9", tier: "free", status: "running", ...exportPatch })
      .select("id")
      .single();
    if (error) throw error;
    const { data: job, error: jobError } = await admin
      .from("job")
      .insert({
        kind: "render",
        export_id: exportRow!.id,
        status: "running",
        attempts: 1,
        // Fresh, so nothing sweeping for abandoned jobs can mistake a fixture for a dead worker.
        heartbeat_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (jobError) throw jobError;
    return { exportId: exportRow!.id as string, jobId: job!.id as string };
  }

  async function poll(exportId: string): Promise<PollBody> {
    const res = (await GET(new Request(`http://localhost/api/render/${exportId}`), {
      params: Promise.resolve({ id: exportId }),
    })) as Response;
    expect(res.status).toBe(200);
    return (await res.json()) as PollBody;
  }

  test("a job the worker gave up on ends the poll, with the worker's own reason", async () => {
    const { exportId, jobId } = await startedRender();
    expect(await poll(exportId)).toMatchObject({ status: "running", progress: 0.5 });

    // Exactly the state observed live: the deadline fired, the job is terminal, and the export row
    // still says `running` because the abandoned handler never got to write it.
    await admin
      .from("job")
      .update({ status: "failed", error: "the render timed out after 8s and was given up on" })
      .eq("id", jobId);

    const answer = await poll(exportId);
    expect(answer.status).toBe("failed");
    expect(answer.error).toBe("the render timed out after 8s and was given up on");
    expect(answer.progress).toBe(0);
  });

  test("the reaper giving up after the last attempt is an answer too", async () => {
    const { exportId, jobId } = await startedRender();
    await admin
      .from("job")
      .update({
        status: "failed",
        attempts: 3,
        error: "worker stopped responding mid-job and the job ran out of attempts (3 of 3)",
      })
      .eq("id", jobId);

    const answer = await poll(exportId);
    expect(answer.status).toBe("failed");
    expect(answer.error).toContain("ran out of attempts");
    expect(answer.attempts).toBe(3);
  });

  test("a finished export outranks the job row — the file exists either way", async () => {
    const { exportId, jobId } = await startedRender();
    await admin.from("export").update({ status: "succeeded" }).eq("id", exportId);
    // A late worker that lost its claim can still leave a failed job behind.
    await admin.from("job").update({ status: "failed", error: "lost the claim" }).eq("id", jobId);

    expect(await poll(exportId)).toMatchObject({ status: "succeeded", progress: 1 });
  });

  test("a render genuinely still running is still reported as running", async () => {
    const { exportId } = await startedRender();
    expect(await poll(exportId)).toMatchObject({ status: "running", progress: 0.5 });
  });

  test("the week-long signed url is not handed to the browser on every tick", async () => {
    // `output_blob_url` holds the 7-day signed url the worker minted, and a signed url is a bearer
    // credential. The download goes through /api/export/[id], which signs a fresh 10-minute one.
    const { exportId } = await startedRender({
      status: "succeeded",
      output_blob_url: "https://storage.test/object/sign/exports/x.mp4?token=week-long",
      output_storage_path: `${userId}/x.mp4`,
    });
    const answer = await poll(exportId);
    expect(answer.status).toBe("succeeded");
    expect(answer.output_blob_url).toBeUndefined();
    expect(JSON.stringify(answer)).not.toContain("token=");
  });
});
