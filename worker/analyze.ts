import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { probeMedia, type ProbeResult } from "@/lib/ffmpeg/probe";
import { extractAudioWav } from "@/lib/ffmpeg/audio";
import { analyzeBeatsFromWav } from "@/lib/ffmpeg/beats";
import { analyzeScenes } from "@/lib/ffmpeg/scenes";
import {
  MAX_ASSET_DIMENSION,
  MAX_ASSET_DURATION_MS,
  MAX_ASSET_FPS,
  type AssetKind,
} from "@/lib/storage/media";
import { analysisBranchesForKind, type AnalysisBranch } from "@/lib/jobs/types";
import { BranchUnavailableError, branchFailureText } from "./errors";
import { downloadToFile, makeJobWorkDir, removeWorkDir, signAssetUrl } from "./source";
import { transcribeWav } from "./transcribe";
import type { JobContext } from "./types";

/**
 * The analyze job: probe → speech → beats → shots, all ffmpeg + JS, in this process.
 *
 * What it replaces: three Vercel Sandbox microVMs, each `apt-get`-installing Python and pip-
 * installing librosa / PySceneDetect / MediaPipe at request time, on an image that uses dnf. The
 * first command failed every time, so no transcript, beats or scenes row could ever exist.
 *
 * FACES ARE CUT. MediaPipe was Python-only and there is no JS replacement in this build, so the
 * branch is deleted rather than stubbed. Nothing downstream fabricates a face track to cover for
 * it — the resolver returns an empty track and the compiler degrades to a visible centered
 * placement (lib/render/compile.ts) and records a diagnostic.
 *
 * Branch isolation is deliberate: each branch persists its own row as soon as it succeeds, and the
 * job only reports failure at the end, naming the branches that failed. A missing GROQ_API_KEY
 * must not cost the user their beats and shot list, and it must not be reported as success either.
 */

interface AssetRow {
  id: string;
  kind: AssetKind;
  filename: string;
  storage_path: string | null;
  blob_url: string | null;
}

export async function runAnalyzeJob(ctx: JobContext): Promise<void> {
  const assetId = ctx.job.asset_id;
  if (!assetId) throw new Error(`analyze job ${ctx.job.id} has no asset_id`);

  const asset = await loadAsset(ctx.admin, assetId);
  const branches = analysisBranchesForKind(asset.kind);
  if (branches.length === 0) {
    throw new Error(`a ${asset.kind} asset has nothing to analyze — no soundtrack and no shot boundaries`);
  }

  const url = await signAssetUrl(ctx.admin, asset);
  const workDir = await makeJobWorkDir(ctx.job.id);
  const failures: { branch: string; error: unknown }[] = [];
  /** Branches this deployment is not configured for. Reported, but not a job failure. */
  const unavailable: string[] = [];

  try {
    const localPath = await downloadToFile(url, workDir, asset.filename, { signal: ctx.signal });

    // The probe is not a branch: without a duration nothing downstream is meaningful, so a probe
    // failure fails the whole job rather than being collected.
    const probe = await probeMedia(localPath, { signal: ctx.signal });
    await persistProbe(ctx.admin, assetId, probe);
    ctx.log(`probed ${asset.filename}: ${probe.durationMs ?? "?"}ms ${probe.width ?? "?"}x${probe.height ?? "?"}`);

    // The soundtrack is decoded ONCE and shared by transcription and beat detection — but LAZILY,
    // and inside the per-branch try. A file whose probe advertises an audio stream it cannot
    // actually decode should cost the two branches that need audio, not the shot detection that
    // does not.
    const audio = memoize(async () =>
      probe.hasAudio ? extractAudioWav(localPath, join(workDir, "audio-16k.wav"), { signal: ctx.signal }) : null,
    );

    for (const branch of branches) {
      try {
        await runBranch(branch, { ctx, assetId, workDir, localPath, audio, probe });
      } catch (e) {
        // A branch this deployment is not configured for is UNAVAILABLE, not failed. Marking the
        // job failed for it told the user "HITE couldn't read this video" about a file it had just
        // probed, timed and cut-detected successfully. It is still reported, never swallowed.
        if (e instanceof BranchUnavailableError) {
          unavailable.push(branch);
          ctx.log(`branch ${branch} unavailable: ${e.message}`);
          continue;
        }
        failures.push({ branch, error: e });
        ctx.log(`branch ${branch} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await removeWorkDir(workDir);
  }

  if (failures.length) throw new Error(branchFailureText(failures));
  if (unavailable.length) {
    ctx.log(`completed without ${unavailable.join(", ")} — not configured on this deployment`);
  }
}

interface BranchInput {
  ctx: JobContext;
  assetId: string;
  workDir: string;
  localPath: string;
  /** The extracted 16 kHz mono WAV, or null when the file carries no audio stream. */
  audio: () => Promise<string | null>;
  probe: ProbeResult;
}

async function runBranch(branch: AnalysisBranch, input: BranchInput): Promise<void> {
  const { ctx, assetId, workDir, localPath, audio, probe } = input;
  switch (branch) {
    case "transcribe": {
      // A file with no audio stream genuinely has no speech. Storing that as an empty transcript is
      // a measurement, not a fabrication — and it is what lets the UI stop polling.
      const wavPath = await audio();
      const transcript = wavPath
        ? await transcribeWav(wavPath, workDir, { signal: ctx.signal })
        : { language: "", segments: [] };
      await upsertTranscript(ctx.admin, assetId, transcript.language, transcript.segments);
      ctx.log(`transcript: ${transcript.segments.length} segments`);
      return;
    }
    case "beats": {
      const wavPath = await audio();
      const beats = wavPath
        ? await analyzeBeatsFromWav(wavPath)
        : { bpm: 0, beats_ms: [], onsets_ms: [], drops_ms: [], bands: { low: 0, mid: 0, high: 0 }, method: "no-audio-stream" };
      await upsertAnalysis(ctx.admin, assetId, "beats", beats);
      ctx.log(`beats: ${beats.bpm} bpm, ${beats.beats_ms.length} beats`);
      return;
    }
    case "scenes": {
      // A shot list is `[start, end)` pairs that have to cover the clip, so it cannot be built
      // without the clip's length. Passing 0 for "unknown" wrote `duration_ms: 0` into the stored
      // analysis and silently dropped the final shot — a number nobody measured, in the one unit
      // whose thesis is that those do not get written. If the probe could not read a duration, this
      // branch fails and says so; the other branches still stand on their own.
      if (probe.durationMs === null) {
        throw new Error("no duration could be read from this file, so its shot list cannot be closed");
      }
      const scenes = await analyzeScenes(localPath, probe.durationMs, { signal: ctx.signal });
      await upsertAnalysis(ctx.admin, assetId, "scenes", scenes);
      ctx.log(`scenes: ${scenes.cuts_ms.length} cuts`);
      return;
    }
  }
}

/**
 * Run `fn` at most once and replay its result — including its REJECTION, so a branch that fails to
 * decode the audio does not make the next branch re-attempt the same failing decode.
 */
function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= fn());
}

async function loadAsset(admin: SupabaseClient, assetId: string): Promise<AssetRow> {
  const { data, error } = await admin
    .from("asset")
    .select("id, kind, filename, storage_path, blob_url")
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw new Error(`could not load asset ${assetId}: ${error.message}`);
  if (!data) throw new Error(`asset ${assetId} no longer exists`);
  return data as AssetRow;
}

/**
 * Write the authoritative measurement onto the asset row.
 *
 * Each field is written only when it is within the bounds `asset_probe_sane` (migration 005)
 * accepts. Out-of-range means the probe read something nonsensical, and NULL — "we did not measure
 * it" — is the honest record of that; writing it anyway would fail the whole update and lose the
 * fields that WERE measured.
 */
async function persistProbe(admin: SupabaseClient, assetId: string, probe: ProbeResult): Promise<void> {
  const { error } = await admin
    .from("asset")
    .update({
      duration_ms: inRange(probe.durationMs, 1, MAX_ASSET_DURATION_MS),
      width: inRange(probe.width, 1, MAX_ASSET_DIMENSION),
      height: inRange(probe.height, 1, MAX_ASSET_DIMENSION),
      fps: inRange(probe.fps, 0.001, MAX_ASSET_FPS),
      probe: probe.raw,
    })
    .eq("id", assetId);
  if (error) throw new Error(`could not store the probe for asset ${assetId}: ${error.message}`);
}

function inRange(value: number | null, min: number, max: number): number | null {
  return value !== null && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/**
 * Upsert, not insert (`transcript-inserts-not-idempotent`). The transcript branch was the one
 * analysis that plain-INSERTed, so re-analyzing an asset left two rows for it — and the reader
 * uses `.maybeSingle()`, which ERRORS on a duplicate rather than returning either. Migration 006
 * adds the unique index this conflict target needs.
 */
async function upsertTranscript(
  admin: SupabaseClient,
  assetId: string,
  language: string,
  segments: unknown,
): Promise<void> {
  const { error } = await admin
    .from("transcript")
    .upsert({ asset_id: assetId, language, segments }, { onConflict: "asset_id" });
  if (error) throw new Error(`could not store the transcript: ${error.message}`);
}

async function upsertAnalysis(
  admin: SupabaseClient,
  assetId: string,
  kind: "beats" | "scenes",
  data: unknown,
): Promise<void> {
  const { error } = await admin
    .from("analysis")
    .upsert({ asset_id: assetId, kind, data }, { onConflict: "asset_id,kind" });
  if (error) throw new Error(`could not store the ${kind} analysis: ${error.message}`);
}
