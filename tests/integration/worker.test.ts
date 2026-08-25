import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { emptyEdl2 } from "@/lib/edl/schema";
import { reduceBatch } from "@/lib/edl/reducer";
import type { EditCommand } from "@/lib/edl/commands";
import { probeMedia } from "@/lib/ffmpeg/probe";
import { concatClips, fixtureDir, makeClickTrack, makeSolidColorClip } from "@/lib/ffmpeg/fixtures";
import type { JobStatus } from "@/lib/jobs/types";
import { acquireQueueLock, type ReleaseQueue } from "./queue-lock";

/**
 * END-TO-END verification of the job queue + worker against a real Postgres, real Supabase
 * Storage, a real ffmpeg and a real Chromium.
 *
 * This is the first time this project has ever verified an actual render. The architecture it
 * replaces could not be verified even in principle — it assembled a Python/Chromium toolchain
 * inside a microVM at request time, and its very first command (`apt-get` on an Amazon Linux
 * image) failed every time.
 *
 * Every case has a KNOWN CORRECT ANSWER:
 *   • render      — two 2-second clips ⇒ a 4-second 1920×1080 MP4 that ffprobe can decode
 *   • analyze     — a 120 BPM click track ⇒ a beats row reporting ~120 bpm
 *   • failure     — a corrupt file ⇒ the job ends `failed` with ffmpeg's own reason, not a hang
 *   • reaper      — the worker killed mid-job ⇒ the job is requeued and completes on restart
 *
 * Setup: see tests/integration/README.md. Skipped unless the local Supabase env vars are set, so
 * plain `pnpm test` is unaffected.
 */

const URL = process.env.SUPABASE_LOCAL_URL;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && SERVICE);

/** A render needs a Chromium. CI images that ship one point this at it; otherwise Remotion fetches one. */
const BROWSER = process.env.REMOTION_BROWSER_EXECUTABLE ?? "";

const MEDIA_BUCKET = "media";
const EXPORTS_BUCKET = "exports";

describe.skipIf(!ENABLED)("worker — job queue end to end", () => {
  const admin: SupabaseClient = ENABLED
    ? createClient(URL!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } })
    : (null as never);

  let dir: string;
  let userId: string;
  let projectId: string;
  let redAssetId: string;
  let blueAssetId: string;
  let clickAssetId: string;
  let corruptAssetId: string;
  let editId: string;
  let worker: ChildProcess | null = null;
  let releaseQueue: ReleaseQueue | null = null;

  beforeAll(async () => {
    if (!ENABLED) return;
    // `claim_job` hands out the oldest queued job of a kind, whoever asks. These tests spawn a real
    // worker against the real queue, so they need it to themselves — otherwise another test file
    // (or a `pnpm worker` on the same database) claims their render and they wait on a job somebody
    // else already finished.
    releaseQueue = await acquireQueueLock();
    dir = await fixtureDir("hite-worker-it-");

    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email: `worker-${Date.now()}@hite.test`,
      password: "not-a-password-xyz-1234",
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = user.user!.id;

    const { data: project } = await admin
      .from("project")
      .insert({ owner_user_id: userId, title: "worker integration" })
      .select("id")
      .single();
    projectId = project!.id;

    // Two 2-second clips: the render's known answer is their sum.
    const red = await makeSolidColorClip(dir, "red", { seconds: 2 });
    const blue = await makeSolidColorClip(dir, "blue", { seconds: 2 });
    redAssetId = await registerAsset(admin, { userId, projectId, path: red, kind: "video", mime: "video/mp4" });
    blueAssetId = await registerAsset(admin, { userId, projectId, path: blue, kind: "video", mime: "video/mp4" });

    // An AUDIO asset — the kind that used to be skipped entirely, so "cut to the beat of my song"
    // could never work. Its known answer is 120 BPM.
    const click = await makeClickTrack(dir, 120, 12);
    clickAssetId = await registerAsset(admin, { userId, projectId, path: click, kind: "audio", mime: "audio/wav" });

    // A real MP4 header with the rest hacked off — decodable-looking, actually broken.
    const corruptSource = await concatClips(dir, [red, blue], "to-corrupt.mp4");
    const corruptPath = join(dir, "corrupt.mp4");
    await writeFile(corruptPath, (await readFile(corruptSource)).subarray(0, 400));
    corruptAssetId = await registerAsset(admin, {
      userId,
      projectId,
      path: corruptPath,
      kind: "video",
      mime: "video/mp4",
    });

    // A 2-clip EDL: red then blue, 2s each.
    let edl = emptyEdl2(redAssetId, 60_000);
    edl = reduceBatch(edl, [
      { type: "ADD_CLIP", assetId: blueAssetId, trackId: "track_0", atTick: 60_000, inTick: 0, outTick: 60_000 },
    ] as EditCommand[]).edl;
    const { data: edit, error: editError } = await admin
      .from("edit")
      .insert({ project_id: projectId, version: 1, edl })
      .select("id")
      .single();
    if (editError) throw editError;
    editId = edit!.id;
  }, 180_000);

  afterAll(async () => {
    if (!ENABLED) return;
    await stopWorker(worker);
    worker = null;
    if (projectId) await admin.from("project").delete().eq("id", projectId);
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (dir) await rm(dir, { recursive: true, force: true });
    await releaseQueue?.();
  }, 60_000);

  test("renders a real 2-clip EDL to a decodable MP4", async () => {
    const { data: exportRow, error } = await admin
      .from("export")
      .insert({ edit_id: editId, aspect: "16:9", tier: "free", status: "queued" })
      .select("id")
      .single();
    if (error) throw error;
    const exportId = exportRow!.id;

    const { data: job } = await admin
      .from("job")
      .insert({ kind: "render", export_id: exportId })
      .select("id")
      .single();

    worker = startWorker();
    const finished = await waitForJob(admin, job!.id, 240_000);
    expect(finished.error).toBeNull();
    expect(finished.status).toBe("succeeded");

    const { data: done } = await admin
      .from("export")
      .select("status, error, output_storage_path, output_blob_url")
      .eq("id", exportId)
      .single();
    expect(done!.status).toBe("succeeded");
    expect(done!.error).toBeNull();
    // `{userId}/{exportId}.mp4` — under the owner's prefix, which is what the storage policies key
    // on. The old path wrote to the bucket ROOT, where no policy can ever match.
    expect(done!.output_storage_path).toBe(`${userId}/${exportId}.mp4`);
    expect(done!.output_blob_url).toContain("/storage/v1/object/sign/exports/");

    // The oracle: pull the rendered file back out and measure it.
    const { data: blob, error: downloadError } = await admin.storage
      .from(EXPORTS_BUCKET)
      .download(done!.output_storage_path!);
    if (downloadError) throw downloadError;
    const localCopy = join(dir, "rendered.mp4");
    await writeFile(localCopy, Buffer.from(await blob!.arrayBuffer()));

    const probe = await probeMedia(localCopy);
    // 2s + 2s at 30fps = 120 frames. MP4 reports slightly over 4.000s (last-frame duration).
    expect(probe.durationMs).toBeGreaterThan(3_900);
    expect(probe.durationMs).toBeLessThan(4_200);
    expect(probe.width).toBe(1920);
    expect(probe.height).toBe(1080);
    expect(probe.fps).toBe(30);
    expect(probe.hasVideo).toBe(true);
  }, 300_000);

  test("analyzes an AUDIO asset: 120 BPM click track reports ~120 bpm", async () => {
    const { data: job } = await admin
      .from("job")
      .insert({ kind: "analyze", asset_id: clickAssetId })
      .select("id")
      .single();

    worker = worker ?? startWorker();
    const finished = await waitForJob(admin, job!.id, 180_000);

    // The beats branch persists its own row the moment it succeeds, independently of the other
    // branches — that isolation is what stops a missing GROQ_API_KEY from costing the user their
    // beat grid.
    const { data: beats } = await admin
      .from("analysis")
      .select("data")
      .eq("asset_id", clickAssetId)
      .eq("kind", "beats")
      .single();
    const parsed = beats!.data as { bpm: number; beats_ms: number[] };
    expect(parsed.bpm).toBeGreaterThan(118);
    expect(parsed.bpm).toBeLessThan(122);
    expect(parsed.beats_ms.length).toBeGreaterThan(15);

    // An audio asset gets no scene detection — a sound file has no shots.
    const { data: scenes } = await admin
      .from("analysis")
      .select("kind")
      .eq("asset_id", clickAssetId)
      .eq("kind", "scenes")
      .maybeSingle();
    expect(scenes).toBeNull();

    // The probe is authoritative and lands on the asset row.
    const { data: asset } = await admin.from("asset").select("duration_ms").eq("id", clickAssetId).single();
    expect(asset!.duration_ms).toBeGreaterThan(11_500);

    // The job SUCCEEDS either way, and the difference is what it produced.
    //
    // This used to assert `failed` without a Groq key, which is what the worker did until
    // `BranchUnavailableError` separated "this deployment is not configured for that" from "this
    // file could not be read". Failing the whole job for a missing key meant the editor said "HITE
    // couldn't read this video" about a file it had just probed, timed and cut-detected perfectly.
    // No Groq key is exactly the state the README quickstart leaves a newcomer in, so the stale
    // assertion also meant their first run of the integration suite was red.
    expect(finished.status).toBe("succeeded");
    const { data: transcript } = await admin
      .from("transcript")
      .select("segments")
      .eq("asset_id", clickAssetId)
      .maybeSingle();
    if (process.env.GROQ_API_KEY) {
      expect(transcript).not.toBeNull();
    } else {
      // Unavailable, not failed: nothing was written, and nothing was invented either.
      expect(transcript).toBeNull();
    }
  }, 240_000);

  test("a corrupt file ends `failed` with a readable reason, not a hang", async () => {
    const { data: job } = await admin
      .from("job")
      .insert({ kind: "analyze", asset_id: corruptAssetId })
      .select("id")
      .single();

    worker = worker ?? startWorker();
    const finished = await waitForJob(admin, job!.id, 120_000);

    expect(finished.status).toBe("failed");
    expect(finished.error).toBeTruthy();
    // ffmpeg's OWN diagnosis, not a bare exit code — the sandbox path threw away stderr and left
    // every failure undebuggable.
    expect(finished.error).toMatch(/moov atom not found|Invalid data found|invalid/i);
    // A signed url is a bearer credential and this string is shown to the user.
    expect(finished.error).not.toContain("token=");
  }, 180_000);

  test("a worker killed mid-job is reaped and the job completes on restart", async () => {
    await stopWorker(worker);
    worker = null;

    // A RENDER is used deliberately: it takes ~10s, so SIGKILL lands with the job genuinely in
    // flight. An analyze of a 2-second clip finishes in ~130 ms and the kill would race it.
    const { data: exportRow } = await admin
      .from("export")
      .insert({ edit_id: editId, aspect: "16:9", tier: "free", status: "queued" })
      .select("id")
      .single();
    const { data: job } = await admin
      .from("job")
      .insert({ kind: "render", export_id: exportRow!.id })
      .select("id")
      .single();
    const jobId = job!.id;

    // Kill the process outright — no signal handler, no release, exactly what a crash or an OOM
    // kill looks like.
    const victim = startWorker();
    await waitForStatus(admin, jobId, "running", 60_000);
    await sleep(1_500);
    victim.kill("SIGKILL");
    await new Promise((resolve) => victim.once("exit", resolve));

    const stranded = await readJob(admin, jobId);
    // Nobody cleaned up: the row is stuck 'running' with nothing working on it. Before the reaper,
    // this is where a user's export stayed forever while the UI spun.
    expect(stranded.status).toBe("running");
    expect(stranded.attempts).toBe(1);

    // A fresh worker reaps it on boot and finishes the work.
    worker = startWorker();
    const finished = await waitForJob(admin, jobId, 240_000);
    expect(finished.status).toBe("succeeded");
    expect(finished.attempts).toBeGreaterThanOrEqual(2); // claimed once, requeued, claimed again

    const { data: done } = await admin
      .from("export")
      .select("status, output_storage_path")
      .eq("id", exportRow!.id)
      .single();
    expect(done!.status).toBe("succeeded");
    expect(done!.output_storage_path).toBeTruthy();
  }, 300_000);
});

// ───────────────────────── helpers ─────────────────────────

async function registerAsset(
  admin: SupabaseClient,
  args: { userId: string; projectId: string; path: string; kind: "video" | "audio"; mime: string },
): Promise<string> {
  const filename = args.path.split(/[\\/]/).pop()!;
  const storagePath = `${args.userId}/${randomUUID()}/${filename}`;
  const bytes = await readFile(args.path);
  const { error: uploadError } = await admin.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, bytes, { contentType: args.mime, upsert: true });
  if (uploadError) throw uploadError;

  const { data, error } = await admin
    .from("asset")
    .insert({
      project_id: args.projectId,
      kind: args.kind,
      filename,
      storage_path: storagePath,
      // `asset_blob_url_key` (migration 002) still requires this to be unique. It is dead weight
      // now that `storage_path` is the identity and the worker signs from it, but a test must
      // satisfy the schema as it actually is.
      blob_url: `local://${storagePath}`,
      fps: args.kind === "video" ? 30 : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id;
}

/**
 * Run the real `pnpm worker` entrypoint as its own process — the thing that ships, not a
 * hand-rolled in-test loop. The intervals are compressed so a test does not wait out production
 * timings.
 */
function startWorker(): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      REMOTION_BROWSER_EXECUTABLE: BROWSER,
      WORKER_POLL_INTERVAL_MS: "500",
      WORKER_HEARTBEAT_INTERVAL_MS: "1000",
      WORKER_STALE_AFTER_MS: "10000",
      WORKER_REAP_INTERVAL_MS: "5000",
      WORKER_SHUTDOWN_GRACE_MS: "2000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c: Buffer) => process.stdout.write(c));
  child.stderr?.on("data", (c: Buffer) => process.stderr.write(c));
  return child;
}

async function stopWorker(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL"); // tests do not depend on graceful shutdown; the reaper test proves recovery
  await new Promise((resolve) => child.once("exit", resolve));
}

interface JobSnapshot {
  status: JobStatus;
  error: string | null;
  attempts: number;
}

async function readJob(admin: SupabaseClient, jobId: string): Promise<JobSnapshot> {
  const { data, error } = await admin.from("job").select("status, error, attempts").eq("id", jobId).single();
  if (error) throw error;
  return data as JobSnapshot;
}

/** Poll until the job reaches a terminal state. Times out loudly rather than hanging the suite. */
async function waitForJob(admin: SupabaseClient, jobId: string, timeoutMs: number): Promise<JobSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last: JobSnapshot | null = null;
  while (Date.now() < deadline) {
    last = await readJob(admin, jobId);
    if (last.status === "succeeded" || last.status === "failed") return last;
    await sleep(500);
  }
  throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}

async function waitForStatus(
  admin: SupabaseClient,
  jobId: string,
  status: JobStatus,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readJob(admin, jobId)).status === status) return;
    await sleep(200);
  }
  throw new Error(`job ${jobId} never reached '${status}' within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
