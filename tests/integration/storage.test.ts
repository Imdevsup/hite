import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ASSET_URL_TTL_SECONDS,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  MEDIA_MIME_TYPES,
  mediaObjectPath,
} from "@/lib/storage/media";
import { buildStorageUploadBody, storageObjectEndpoint, storageUploadHeaders } from "@/lib/storage/upload";

/**
 * Storage integration tests against a local Supabase instance (migration 005).
 *
 * These prove the three things the unit tests cannot:
 *   1. the bucket policies actually isolate tenants — user B is denied user A's object,
 *      and no public url exists to guess (the Vercel Blob era's P1);
 *   2. an asset row round-trips a REAL measured duration through RLS, and the database
 *      refuses a fabricated one;
 *   3. the exact query /api/plan runs now finds a usable asset where it previously found
 *      none — i.e. typing an edit can work at all.
 *
 * Setup: see tests/integration/README.md. Skipped unless the local env vars are set so
 * they don't break plain `pnpm test`.
 */

const URL = process.env.SUPABASE_LOCAL_URL;
const ANON = process.env.SUPABASE_LOCAL_ANON_KEY;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && ANON && SERVICE);
const PASSWORD = "not-a-password-xyz-1234";

/** The same filename for both users — the collision that used to fail the second upload. */
const SHARED_FILENAME = "IMG_1234.MOV";
const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);

describe.skipIf(!ENABLED)("Supabase Storage — buckets, isolation, and the probed duration", () => {
  const admin = ENABLED ? createClient(URL!, SERVICE!, { auth: { persistSession: false } }) : null;

  let userA: { id: string; accessToken: string };
  let userB: { id: string; accessToken: string };
  let projectA: string;
  let pathA: string;
  let pathB: string;

  beforeAll(async () => {
    if (!admin) return;
    userA = await createUser(admin, `sa-${Date.now()}@hite.test`);
    userB = await createUser(admin, `sb-${Date.now()}@hite.test`);
    const { data: pa, error } = await admin
      .from("project")
      .insert({ owner_user_id: userA.id, title: "A" })
      .select("id")
      .single();
    if (error) throw error;
    projectA = pa!.id;
    pathA = mediaObjectPath({ userId: userA.id, uploadId: crypto.randomUUID(), filename: SHARED_FILENAME });
    pathB = mediaObjectPath({ userId: userB.id, uploadId: crypto.randomUUID(), filename: SHARED_FILENAME });
  });

  afterAll(async () => {
    if (!admin) return;
    // storage.objects blocks direct SQL deletes (storage.protect_delete) — go through the API.
    await admin.storage.from(MEDIA_BUCKET).remove([pathA, pathB]);
    await admin.from("project").delete().eq("id", projectA);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  // ── The buckets exist and match the ONE allowlist in lib/storage/media.ts ───────────

  test("migration 005 created the three buckets with the right visibility", async () => {
    // Read through the Storage admin API, not PostgREST — the `storage` schema is not exposed.
    const buckets = await Promise.all(
      ["media", "exports", "previews"].map(async (id) => {
        const { data, error } = await admin!.storage.getBucket(id);
        expect(error).toBeNull();
        return data!;
      }),
    );
    const [media, exports, previews] = buckets;
    expect(media.public).toBe(false);
    expect(exports.public).toBe(false);
    // Effect previews are catalog build artifacts with no user data — public on purpose.
    expect(previews.public).toBe(true);
  });

  test("the bucket's MIME allowlist and size cap match the TypeScript constants", async () => {
    // The SQL copy and the TS copy are the one place this design can drift. Fail here, loudly,
    // rather than letting the picker offer something the bucket will reject mid-upload.
    const { data, error } = await admin!.storage.getBucket(MEDIA_BUCKET);
    expect(error).toBeNull();
    expect([...(data!.allowed_mime_types ?? [])].sort()).toEqual([...MEDIA_MIME_TYPES].sort());
    expect(data!.file_size_limit).toBe(MAX_UPLOAD_BYTES);
  });

  // ── (a) a user may write under their own prefix ─────────────────────────────────────

  test("user A uploads to their own {userId}/ prefix", async () => {
    const sb = clientAs(userA.accessToken);
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(pathA, mp4File(), { contentType: "video/mp4" });
    expect(error).toBeNull();
  });

  test("user B uploads the IDENTICAL filename and also succeeds", async () => {
    // Vercel Blob used one global namespace with addRandomSuffix off, so the second upload
    // of any common filename failed outright — across users.
    const sb = clientAs(userB.accessToken);
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(pathB, mp4File(), { contentType: "video/mp4" });
    expect(error).toBeNull();
  });

  test("user A can sign and then actually fetch their own object", async () => {
    const sb = clientAs(userA.accessToken);
    const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(pathA, ASSET_URL_TTL_SECONDS);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
    const res = await fetch(data!.signedUrl);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP4_BYTES);
  });

  test("the request uploadToStorage builds is accepted by a real storage server", async () => {
    // The browser uploader speaks the storage REST protocol directly so it can report real
    // byte progress. Hand-rolling that is only defensible if the wire format is VERIFIED —
    // so fire the module's own endpoint + headers + body at the live server. Only the XHR
    // transport is unexercised here (it does not exist outside a browser).
    const sb = clientAs(userA.accessToken);
    const path = mediaObjectPath({ userId: userA.id, uploadId: crypto.randomUUID(), filename: "wire.mp4" });
    const res = await fetch(storageObjectEndpoint(URL!, MEDIA_BUCKET, path), {
      method: "POST",
      headers: storageUploadHeaders({ accessToken: userA.accessToken, apiKey: ANON! }),
      body: buildStorageUploadBody(new File([MP4_BYTES], "wire.mp4", { type: "video/mp4" })),
    });
    expect(res.status).toBe(200);

    // …and the object it created is real, complete, and typed from the file part.
    const signed = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    const fetched = await fetch(signed.data!.signedUrl);
    expect(fetched.headers.get("content-type")).toContain("video/mp4");
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(MP4_BYTES);

    await admin!.storage.from(MEDIA_BUCKET).remove([path]);
  });

  test("a user may not write into ANOTHER user's prefix", async () => {
    const sb = clientAs(userB.accessToken);
    const forged = `${userA.id}/${crypto.randomUUID()}/stolen.mp4`;
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(forged, mp4File(), { contentType: "video/mp4" });
    expect(error).toBeTruthy();
  });

  test("the bucket refuses a type outside the allowlist", async () => {
    const sb = clientAs(userA.accessToken);
    const path = `${userA.id}/${crypto.randomUUID()}/notes.txt`;
    const { error } = await sb.storage
      .from(MEDIA_BUCKET)
      .upload(path, new File(["hello"], "notes.txt", { type: "text/plain" }), { contentType: "text/plain" });
    expect(error).toBeTruthy();
  });

  // ── (b) a second user is DENIED the first user's object ─────────────────────────────

  test("user B cannot download user A's object", async () => {
    const sb = clientAs(userB.accessToken);
    const { data, error } = await sb.storage.from(MEDIA_BUCKET).download(pathA);
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  test("user B cannot mint a signed url for user A's object", async () => {
    const sb = clientAs(userB.accessToken);
    const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(pathA, 60);
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  test("there is no public url to guess — the bucket is private", async () => {
    // The Vercel Blob path served every upload from a PUBLIC url whose last segment was the
    // user's own filename, so `IMG_1234.MOV` was reachable by anyone who typed it.
    const res = await fetch(`${URL}/storage/v1/object/public/${MEDIA_BUCKET}/${pathA}`);
    expect(res.ok).toBe(false);
  });

  test("an unauthenticated caller cannot read the object either", async () => {
    const res = await fetch(`${URL}/storage/v1/object/${MEDIA_BUCKET}/${pathA}`, {
      headers: { apikey: ANON! },
    });
    expect(res.ok).toBe(false);
  });

  // ── (c) an asset row round-trips a real duration ────────────────────────────────────

  test("an asset row round-trips the measured duration through RLS", async () => {
    const sb = clientAs(userA.accessToken);
    const signed = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(pathA, ASSET_URL_TTL_SECONDS);
    const { data, error } = await sb
      .from("asset")
      .upsert(
        {
          project_id: projectA,
          kind: "video",
          storage_path: pathA,
          blob_url: signed.data!.signedUrl,
          filename: SHARED_FILENAME,
          duration_ms: 187_233,
          width: 1920,
          height: 1080,
        },
        { onConflict: "storage_path" },
      )
      .select("id, duration_ms, width, height, storage_path")
      .single();
    expect(error).toBeNull();
    expect(data!.duration_ms).toBe(187_233);
    expect(data!.width).toBe(1920);
    expect(data!.storage_path).toBe(pathA);
  });

  test.each([
    ["zero", 0],
    ["negative", -5],
    ["absurd (over 24h)", 86_400_001],
  ])("the database refuses a %s duration", async (_label, duration_ms) => {
    const sb = clientAs(userA.accessToken);
    const { error } = await sb.from("asset").insert({
      project_id: projectA,
      kind: "video",
      storage_path: `${userA.id}/${crypto.randomUUID()}/bad.mp4`,
      blob_url: `https://storage.test/${crypto.randomUUID()}`,
      filename: "bad.mp4",
      duration_ms,
    });
    expect(error).toBeTruthy();
  });

  test("re-registering the same object updates the row instead of duplicating it", async () => {
    // Idempotency moved from UNIQUE(blob_url) to UNIQUE(storage_path): `blob_url` is now a
    // signed url that differs every time it is minted, so it no longer identifies an object.
    const sb = clientAs(userA.accessToken);
    await sb.from("asset").upsert(
      {
        project_id: projectA,
        kind: "video",
        storage_path: pathA,
        blob_url: `https://storage.test/resigned-${crypto.randomUUID()}`,
        filename: SHARED_FILENAME,
        duration_ms: 187_233,
      },
      { onConflict: "storage_path" },
    );
    const { data } = await sb.from("asset").select("id").eq("storage_path", pathA);
    expect(data).toHaveLength(1);
  });

  // ── The core-loop unblock: the exact query /api/plan runs ────────────────────────────

  /**
   * A re-registration of the SAME object — a retried POST, a second tab, the same file dropped
   * twice — reaches POST /api/assets long AFTER the worker's ffmpeg probe wrote the authoritative
   * measurement, and it carries only what the browser could read (nothing, for a file it cannot
   * decode). Whether that erases the probe is decided entirely by the SHAPE of the upsert payload,
   * so this is where the A/B is real: one row, one probe, two payloads.
   *
   * (The other half of the contract — that the route builds the second payload and never the first
   * — is asserted in app/api/assets/route.test.ts against a fake with the same upsert semantics
   * this test pins down.)
   */
  test("a re-registration must not overwrite the worker's probe with the browser's blanks", async () => {
    const sb = clientAs(userA.accessToken);
    const path = mediaObjectPath({ userId: userA.id, uploadId: crypto.randomUUID(), filename: "again.mp4" });
    const probe = { duration_ms: 187_233, width: 1920, height: 1080, fps: 29.97 };
    const blank = { duration_ms: null, width: null, height: null, fps: null };

    /** POST /api/assets' upsert, with `extra` standing in for the measurement columns it sends. */
    const register = (extra: Record<string, unknown>) =>
      sb.from("asset").upsert(
        {
          project_id: projectA,
          kind: "video",
          storage_path: path,
          filename: "again.mp4",
          blob_url: `https://storage.test/${crypto.randomUUID()}`,
          ...extra,
        },
        { onConflict: "storage_path" },
      );
    const readRow = async () => {
      const { data, error } = await sb
        .from("asset")
        .select("duration_ms, width, height, fps")
        .eq("storage_path", path)
        .single();
      if (error) throw error;
      return data;
    };

    try {
      // 1. First registration: the browser could not decode the file, so nothing was measured.
      expect((await register({})).error).toBeNull();
      expect(await readRow()).toMatchObject(blank);

      // 2. The worker corrects it (worker/analyze.ts `persistProbe`).
      expect((await admin!.from("asset").update(probe).eq("storage_path", path)).error).toBeNull();
      expect(await readRow()).toMatchObject(probe);

      // 3. THE OLD PAYLOAD — every column present, the unmeasured ones as null. One retry and the
      //    probe is gone, which is /api/plan back to "no usable asset" on a working project.
      expect((await register(blank)).error).toBeNull();
      expect(await readRow()).toMatchObject(blank);

      // 4. THE PAYLOAD THE ROUTE SENDS NOW — an unmeasured column is not sent at all, so
      //    `on conflict do update` never names it and the measurement survives.
      expect((await admin!.from("asset").update(probe).eq("storage_path", path)).error).toBeNull();
      expect((await register({})).error).toBeNull();
      expect(await readRow()).toMatchObject(probe);

      // 5. …while a column the browser DID measure is still written.
      expect((await register({ duration_ms: 5_000 })).error).toBeNull();
      expect(await readRow()).toMatchObject({ ...probe, duration_ms: 5_000 });
    } finally {
      await admin!.from("asset").delete().eq("storage_path", path);
    }
  });

  test("the query /api/plan runs finds a usable asset only once a duration is recorded", async () => {
    const { data: project } = await admin!
      .from("project")
      .insert({ owner_user_id: userA.id, title: "core-loop" })
      .select("id")
      .single();
    const projectId = project!.id as string;
    const sb = clientAs(userA.accessToken);

    /**
     * Verbatim from app/api/plan/route.ts (the select at :62 and the find at :72). This pins the
     * QUERY's contract — a row with no duration is not usable, one with a duration is — not the
     * upload route's behaviour; the test above is the one that covers what the route writes.
     */
    const planQuery = async () => {
      const { data: assets } = await sb
        .from("asset")
        .select("id, filename, duration_ms, blob_url")
        .eq("project_id", projectId);
      return (assets ?? []).find((a) => a.duration_ms && a.duration_ms > 0) ?? null;
    };

    try {
      // BEFORE — what the old upload path wrote: a row with no duration, because the probe
      // result only ever reached the Zustand store. /api/plan answered 400 "no usable asset".
      const beforePath = mediaObjectPath({ userId: userA.id, uploadId: crypto.randomUUID(), filename: "before.mp4" });
      const { error: beforeErr } = await sb.from("asset").insert({
        project_id: projectId,
        kind: "video",
        storage_path: beforePath,
        blob_url: `https://storage.test/${crypto.randomUUID()}`,
        filename: "before.mp4",
      });
      expect(beforeErr).toBeNull();
      const before = await planQuery();
      expect(before).toBeNull(); // → 400 "no usable asset"

      // AFTER — what POST /api/assets writes now: the duration the browser actually measured.
      const afterPath = mediaObjectPath({ userId: userA.id, uploadId: crypto.randomUUID(), filename: "after.mp4" });
      const { error: afterErr } = await sb.from("asset").insert({
        project_id: projectId,
        kind: "video",
        storage_path: afterPath,
        blob_url: `https://storage.test/${crypto.randomUUID()}`,
        filename: "after.mp4",
        duration_ms: 187_233,
      });
      expect(afterErr).toBeNull();
      const after = await planQuery();
      expect(after).not.toBeNull();
      expect(after!.duration_ms).toBe(187_233);
      expect(after!.filename).toBe("after.mp4");
    } finally {
      await admin!.from("project").delete().eq("id", projectId);
    }
  });
});

function clientAs(accessToken: string): SupabaseClient {
  return createClient(URL!, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function mp4File(): File {
  return new File([MP4_BYTES], SHARED_FILENAME, { type: "video/mp4" });
}

async function createUser(admin: SupabaseClient, email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const userId = data.user!.id;

  // Sign in on a SEPARATE anon client — calling signInWithPassword on the admin client would
  // swap its service-role Authorization header for this user's token (see rls.test.ts).
  const signInClient = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signInErr } = await signInClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw signInErr;
  return { id: userId, accessToken: session.session!.access_token };
}
