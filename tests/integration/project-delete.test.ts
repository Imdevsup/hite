import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EXPORTS_BUCKET, MEDIA_BUCKET, mediaObjectPath } from "@/lib/storage/media";

/**
 * DELETE /api/projects/[id] — the real handler, against real Postgres and real Storage.
 *
 * Deleting a project cascades its `asset`, `edit` and `export` rows, and those rows are the only
 * record of which storage objects belonged to it. Storage has no cascade, so every uploaded clip
 * and every rendered MP4 stayed in the bucket permanently, referenced by nothing: the local stack
 * had 82 objects against 2 live asset rows when this was found. `storage_path` /
 * `output_storage_path` exist exactly so this is cleanable; nothing used them for it.
 *
 * Only the auth boundary is faked, and it is faked with a REAL signed-in client, so RLS, the
 * storage policies and the cascade are all doing their actual jobs here.
 */

const URL = process.env.SUPABASE_LOCAL_URL;
const ANON = process.env.SUPABASE_LOCAL_ANON_KEY;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && ANON && SERVICE);
const PASSWORD = "not-a-password-xyz-1234";
const BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);

/** Set in beforeAll; read by the mocked `withAuth` when the route runs. */
let session: { user: { id: string }; supabase: SupabaseClient } | null = null;

vi.mock("@/lib/api/auth", () => ({
  withAuth: async (handler: (ctx: { user: { id: string }; supabase: SupabaseClient }) => unknown) => {
    if (!session) throw new Error("the test has no signed-in session");
    return handler(session);
  },
}));

const { DELETE } = await import("@/app/api/projects/[id]/route");

describe.skipIf(!ENABLED)("DELETE /api/projects/[id] takes the storage objects with it", () => {
  const admin: SupabaseClient = ENABLED
    ? createClient(URL!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } })
    : (null as never);

  let userId: string;
  let userClient: SupabaseClient;

  beforeAll(async () => {
    if (!ENABLED) return;
    const email = `del-${Date.now()}@hite.test`;
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
    userClient = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signedIn.session!.access_token}` } },
    });
    session = { user: { id: userId }, supabase: userClient };
  });

  afterAll(async () => {
    if (!ENABLED) return;
    await admin.auth.admin.deleteUser(userId);
  });

  /** A project with one uploaded clip and one rendered export, bytes and rows both real. */
  async function makeProject(title: string) {
    const { data: project, error: projectError } = await userClient
      .from("project")
      .insert({ owner_user_id: userId, title })
      .select("id")
      .single();
    if (projectError) throw projectError;
    const projectId = project!.id as string;

    const mediaPath = mediaObjectPath({ userId, uploadId: crypto.randomUUID(), filename: `${title}.mp4` });
    const upload = await userClient.storage
      .from(MEDIA_BUCKET)
      .upload(mediaPath, new File([BYTES], "clip.mp4", { type: "video/mp4" }), { contentType: "video/mp4" });
    if (upload.error) throw upload.error;
    const { error: assetError } = await userClient.from("asset").insert({
      project_id: projectId,
      kind: "video",
      storage_path: mediaPath,
      blob_url: `https://storage.test/${crypto.randomUUID()}`,
      filename: `${title}.mp4`,
      duration_ms: 2_000,
    });
    if (assetError) throw assetError;

    const { data: edit, error: editError } = await userClient
      .from("edit")
      .insert({ project_id: projectId, version: 1, edl: { schema: "Edl.2" } })
      .select("id")
      .single();
    if (editError) throw editError;

    const exportPath = `${userId}/${crypto.randomUUID()}.mp4`;
    const rendered = await userClient.storage
      .from(EXPORTS_BUCKET)
      .upload(exportPath, new File([BYTES], "out.mp4", { type: "video/mp4" }), { contentType: "video/mp4" });
    if (rendered.error) throw rendered.error;
    const { error: exportError } = await userClient.from("export").insert({
      edit_id: edit!.id,
      aspect: "16:9",
      tier: "free",
      status: "succeeded",
      output_storage_path: exportPath,
    });
    if (exportError) throw exportError;

    return { projectId, mediaPath, exportPath };
  }

  /** Does the object still exist? Read through the admin client so RLS cannot mask the answer. */
  async function exists(bucket: string, path: string): Promise<boolean> {
    const { data } = await admin.storage.from(bucket).download(path);
    return data !== null;
  }

  function del(projectId: string): Promise<Response> {
    return DELETE(new Request(`http://localhost/api/projects/${projectId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: projectId }),
    }) as Promise<Response>;
  }

  test("the uploaded clip and the rendered MP4 are removed with the project", async () => {
    const doomed = await makeProject("doomed");
    const keeper = await makeProject("keeper");

    expect(await exists(MEDIA_BUCKET, doomed.mediaPath)).toBe(true);
    expect(await exists(EXPORTS_BUCKET, doomed.exportPath)).toBe(true);

    const res = await del(doomed.projectId);
    expect(res.status).toBe(200);

    // The rows went with the cascade…
    const { data: rows } = await admin.from("project").select("id").eq("id", doomed.projectId);
    expect(rows).toHaveLength(0);
    // …and so did the bytes, which is what nothing did before.
    expect(await exists(MEDIA_BUCKET, doomed.mediaPath)).toBe(false);
    expect(await exists(EXPORTS_BUCKET, doomed.exportPath)).toBe(false);

    // Scoped to the project that was deleted — the other one is untouched.
    expect(await exists(MEDIA_BUCKET, keeper.mediaPath)).toBe(true);
    expect(await exists(EXPORTS_BUCKET, keeper.exportPath)).toBe(true);

    expect(await res.json()).toMatchObject({ ok: true, objectsRemoved: 2 });

    await del(keeper.projectId);
  });

  test("a project with nothing in it still deletes cleanly", async () => {
    const { data: project, error } = await userClient
      .from("project")
      .insert({ owner_user_id: userId, title: "empty" })
      .select("id")
      .single();
    if (error) throw error;

    const res = await del(project!.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, objectsRemoved: 0 });
  });
});
