import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * RLS integration tests against a local Supabase instance.
 *
 * Each test provisions two fresh users, gives each a project, and asserts
 * that user A's authed queries cannot see user B's data.
 *
 * Setup: see tests/integration/README.md. These are skipped unless the
 * local env vars are set so they don't break plain `pnpm test`.
 */

const URL = process.env.SUPABASE_LOCAL_URL;
const ANON = process.env.SUPABASE_LOCAL_ANON_KEY;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && ANON && SERVICE);
const PASSWORD = "not-a-password-xyz-1234";

describe.skipIf(!ENABLED)("RLS — project ownership", () => {
  const admin = ENABLED
    ? createClient(URL!, SERVICE!, { auth: { persistSession: false } })
    : null;

  let userA: { id: string; accessToken: string };
  let userB: { id: string; accessToken: string };
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    if (!admin) return;
    userA = await createUser(admin, `a-${Date.now()}@hite.test`);
    userB = await createUser(admin, `b-${Date.now()}@hite.test`);

    const { data: pa } = await admin.from("project").insert({ owner_user_id: userA.id, title: "A" }).select("id").single();
    const { data: pb } = await admin.from("project").insert({ owner_user_id: userB.id, title: "B" }).select("id").single();
    projectA = pa!.id;
    projectB = pb!.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project").delete().in("id", [projectA, projectB]);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  test("user A sees only their own projects", async () => {
    const sb = clientAs(userA.accessToken);
    const { data } = await sb.from("project").select("id, title");
    expect((data ?? []).map((p) => p.id)).toEqual([projectA]);
  });

  test("user A cannot read user B's project by id", async () => {
    const sb = clientAs(userA.accessToken);
    const { data, error } = await sb.from("project").select("*").eq("id", projectB).maybeSingle();
    // Expect either null data or a non-2xx — both indicate RLS denial.
    expect(data).toBeNull();
    if (error) expect(error.code).toBeDefined();
  });

  test("user A cannot insert an asset into user B's project", async () => {
    const sb = clientAs(userA.accessToken);
    const { error } = await sb.from("asset").insert({
      project_id: projectB,
      kind: "video",
      blob_url: "https://blob/x",
      filename: "x.mp4",
    });
    expect(error).toBeTruthy();
  });

  test("user B's assets are invisible to user A via join", async () => {
    const sb = clientAs(userA.accessToken);
    const { data } = await sb.from("asset").select("id, project_id").eq("project_id", projectB);
    expect(data ?? []).toHaveLength(0);
  });
});

/**
 * RLS on `public.job` (migration 006).
 *
 * The queue is READ-ONLY to a browser session and reaches ownership through the same
 * asset/export → project join as everything else. Two things must hold: a user can watch their own
 * jobs (that is what the status routes poll), and a user can neither see nor touch anyone else's —
 * including their own, because a client that could INSERT here would queue unlimited renders
 * straight over PostgREST, bypassing the rate limit, and one that could UPDATE could mark its own
 * export succeeded.
 */
describe.skipIf(!ENABLED)("RLS — job queue", () => {
  const admin = ENABLED ? createClient(URL!, SERVICE!, { auth: { persistSession: false } }) : null;

  let userA: { id: string; accessToken: string };
  let userB: { id: string; accessToken: string };
  let projectA: string;
  let projectB: string;
  let assetA: string;
  let assetB: string;
  let jobA: string;
  let jobB: string;

  beforeAll(async () => {
    if (!admin) return;
    userA = await createUser(admin, `job-a-${Date.now()}@hite.test`);
    userB = await createUser(admin, `job-b-${Date.now()}@hite.test`);

    const { data: pa } = await admin.from("project").insert({ owner_user_id: userA.id, title: "jobs A" }).select("id").single();
    const { data: pb } = await admin.from("project").insert({ owner_user_id: userB.id, title: "jobs B" }).select("id").single();
    projectA = pa!.id;
    projectB = pb!.id;

    const stamp = Date.now();
    const { data: aa } = await admin
      .from("asset")
      .insert({ project_id: projectA, kind: "video", blob_url: `local://job-a-${stamp}`, filename: "a.mp4" })
      .select("id")
      .single();
    const { data: ab } = await admin
      .from("asset")
      .insert({ project_id: projectB, kind: "video", blob_url: `local://job-b-${stamp}`, filename: "b.mp4" })
      .select("id")
      .single();
    assetA = aa!.id;
    assetB = ab!.id;

    const { data: ja } = await admin.from("job").insert({ kind: "analyze", asset_id: assetA }).select("id").single();
    const { data: jb } = await admin.from("job").insert({ kind: "analyze", asset_id: assetB }).select("id").single();
    jobA = ja!.id;
    jobB = jb!.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("job").delete().in("id", [jobA, jobB]);
    await admin.from("project").delete().in("id", [projectA, projectB]);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  test("user A can read their own job — the status routes depend on it", async () => {
    const sb = clientAs(userA.accessToken);
    const { data } = await sb.from("job").select("id, status, error").eq("id", jobA).maybeSingle();
    expect(data?.id).toBe(jobA);
  });

  test("user A cannot see user B's job", async () => {
    const sb = clientAs(userA.accessToken);
    const { data } = await sb.from("job").select("id").eq("id", jobB).maybeSingle();
    expect(data).toBeNull();
  });

  test("user A's job list contains only their own", async () => {
    const sb = clientAs(userA.accessToken);
    const { data } = await sb.from("job").select("id");
    expect((data ?? []).map((j) => j.id)).toEqual([jobA]);
  });

  test("a client cannot INSERT a job — that would bypass the render rate limit entirely", async () => {
    const sb = clientAs(userA.accessToken);
    const { error } = await sb.from("job").insert({ kind: "render", export_id: null, asset_id: assetA });
    expect(error).toBeTruthy();
  });

  test("a client cannot mark its own job succeeded", async () => {
    const sb = clientAs(userA.accessToken);
    await sb.from("job").update({ status: "succeeded" }).eq("id", jobA);
    const { data } = await admin!.from("job").select("status").eq("id", jobA).single();
    expect(data!.status).toBe("queued");
  });

  test("a client cannot delete a job to hide a failure", async () => {
    const sb = clientAs(userA.accessToken);
    await sb.from("job").delete().eq("id", jobA);
    const { data } = await admin!.from("job").select("id").eq("id", jobA).maybeSingle();
    expect(data?.id).toBe(jobA);
  });

  test("claim_job is not callable by a signed-in user — it would hand them other users' jobs", async () => {
    const sb = clientAs(userA.accessToken);
    const { error } = await sb.rpc("claim_job", { p_kinds: ["analyze"] });
    expect(error).toBeTruthy();
  });

  test("reap_stale_jobs is not callable by a signed-in user", async () => {
    const sb = clientAs(userA.accessToken);
    const { error } = await sb.rpc("reap_stale_jobs", { p_stale: "1 second" });
    expect(error).toBeTruthy();
  });
});

/**
 * RLS under ANONYMOUS sessions — the ones `middleware.ts` mints for every visitor now that there is
 * no sign-in screen.
 *
 * This is the test that has to hold for the login wall to be safe to delete. The policies above are
 * proven against password users, but nobody signs in with a password any more: in production every
 * `auth.uid()` belongs to an anonymous user. Supabase gives those the SAME `authenticated` role, so
 * `to authenticated ... using (owner_user_id = auth.uid())` should be exactly as strong — "should
 * be" is the reason this exists. Two visitors, two anonymous sessions, and neither may see the
 * other's project.
 *
 * Note both users here sign THEMSELVES in and create their OWN project through the anon key, with no
 * service-role help anywhere — that is the real production path, and it also proves the WITH CHECK
 * side (an anonymous user can create a project it owns).
 */
describe.skipIf(!ENABLED)("RLS — anonymous sessions (the only kind the app mints now)", () => {
  const admin = ENABLED ? createClient(URL!, SERVICE!, { auth: { persistSession: false } }) : null;

  let anonA: { id: string; accessToken: string; isAnonymous: boolean };
  let anonB: { id: string; accessToken: string; isAnonymous: boolean };
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    if (!admin) return;
    anonA = await createAnonymousUser();
    anonB = await createAnonymousUser();

    projectA = await createOwnProject(anonA, "anon A");
    projectB = await createOwnProject(anonB, "anon B");
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project").delete().in("id", [projectA, projectB].filter(Boolean));
    if (anonA) await admin.auth.admin.deleteUser(anonA.id);
    if (anonB) await admin.auth.admin.deleteUser(anonB.id);
  });

  test("the session really is anonymous — a user row exists with is_anonymous = true and no email", async () => {
    expect(anonA.isAnonymous).toBe(true);
    const { data, error } = await admin!.auth.admin.getUserById(anonA.id);
    expect(error).toBeNull();
    expect(data.user?.is_anonymous).toBe(true);
    // GoTrue reports an anonymous user's email as an EMPTY STRING, not null — checked against the
    // running stack rather than assumed. Either way nobody was ever asked for an address.
    expect(data.user?.email ?? "").toBe("");
  });

  test("an anonymous visitor can create a project it owns", async () => {
    const { data } = await admin!.from("project").select("owner_user_id").eq("id", projectA).single();
    expect(data!.owner_user_id).toBe(anonA.id);
  });

  test("anonymous A sees only its own project", async () => {
    const sb = clientAs(anonA.accessToken);
    const { data } = await sb.from("project").select("id");
    expect((data ?? []).map((p) => p.id)).toEqual([projectA]);
  });

  test("anonymous A cannot read anonymous B's project by id", async () => {
    const sb = clientAs(anonA.accessToken);
    const { data } = await sb.from("project").select("*").eq("id", projectB).maybeSingle();
    expect(data).toBeNull();
  });

  test("anonymous A cannot create a project stamped with anonymous B's id", async () => {
    const sb = clientAs(anonA.accessToken);
    const { error } = await sb.from("project").insert({ title: "forged", owner_user_id: anonB.id });
    expect(error).toBeTruthy();
  });

  test("anonymous A cannot insert an asset into anonymous B's project", async () => {
    const sb = clientAs(anonA.accessToken);
    const { error } = await sb.from("asset").insert({
      project_id: projectB,
      kind: "video",
      blob_url: `local://anon-cross-${Date.now()}`,
      filename: "x.mp4",
    });
    expect(error).toBeTruthy();
  });

  test("anonymous A cannot re-own anonymous B's project by updating owner_user_id", async () => {
    const sb = clientAs(anonA.accessToken);
    await sb.from("project").update({ owner_user_id: anonA.id }).eq("id", projectB);
    const { data } = await admin!.from("project").select("owner_user_id").eq("id", projectB).single();
    expect(data!.owner_user_id).toBe(anonB.id);
  });

  test("anonymous A cannot delete anonymous B's project", async () => {
    const sb = clientAs(anonA.accessToken);
    await sb.from("project").delete().eq("id", projectB);
    const { data } = await admin!.from("project").select("id").eq("id", projectB).maybeSingle();
    expect(data?.id).toBe(projectB);
  });
});

function clientAs(accessToken: string) {
  return createClient(URL!, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Mint an anonymous session the way `middleware.ts` does: the ANON key, `signInAnonymously()`, no
 * service-role involvement. Fails loud on the one error worth naming — GoTrue rejects this outright
 * when `enable_anonymous_sign_ins` is false, and "no session" would otherwise surface as a confusing
 * null-deref three lines later.
 */
async function createAnonymousUser() {
  const client = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `anonymous sign-in failed (${error.message}) — the local stack needs ` +
        "`enable_anonymous_sign_ins = true` in supabase/config.toml, then a restart",
    );
  }
  const session = data.session;
  if (!session) throw new Error("anonymous sign-in returned no session");
  return {
    id: session.user.id,
    accessToken: session.access_token,
    isAnonymous: session.user.is_anonymous === true,
  };
}

/**
 * Create a project through the caller's OWN session — the WITH CHECK side of `project_owner`.
 * `owner_user_id` is passed explicitly because the column has no default (migration 001); the policy
 * is what makes it un-forgeable, and the cross-owner attempt is covered by its own test below.
 */
async function createOwnProject(user: { id: string; accessToken: string }, title: string): Promise<string> {
  const { data, error } = await clientAs(user.accessToken)
    .from("project")
    .insert({ title, owner_user_id: user.id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createUser(admin: any, email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = data.user!.id;

  // Sign in on a SEPARATE anon client. Calling signInWithPassword on the admin client would
  // swap its service-role Authorization header for this user's access token — every later
  // "admin" write would then run as that user and be denied by the very policies under test,
  // which is exactly how this suite failed the first time it was ever executed.
  const signInClient = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signInErr } = await signInClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInErr) throw signInErr;
  return { id: userId, accessToken: session.session!.access_token };
}
