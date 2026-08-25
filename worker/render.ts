import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { Edl, type Edl as EdlType } from "@/lib/edl/schema";
import { upgradeEdlV1toV2 } from "@/lib/edl/migrate";
import { allClipPositions } from "@/lib/edl/query";
import { edlToRenderIR } from "@/lib/render/compile";
import { makeMediaResolver } from "@/lib/render/resolver";
import type { MediaKind } from "@/lib/render/ir";
import { loadCatalog } from "@/lib/registry/catalog";
import { resolveRenderFps } from "@/lib/jobs/fps";
import { resolveExportTier } from "@/lib/jobs/tier";
import {
  EXPORTS_BUCKET,
  createSignedStorageUrl,
  uploadToBucket,
  type AssetKind,
} from "@/lib/storage/media";
import { makeJobWorkDir, removeWorkDir, signAssetUrl, type AssetSource } from "./source";
import { holdsClaim } from "./db";
import { errorText } from "./errors";
import { cancelOnAbort } from "./cancel";
import type { WorkerConfig } from "./config";
import type { JobContext } from "./types";

/**
 * The render job: EDL → Render IR → Remotion → MP4 → the `exports` bucket.
 *
 * The one architectural rule: `edlToRenderIR` is IMPORTED, never reimplemented. It is the same
 * compiler the preview `<Player>` runs against the same `HiteRoot` composition, so what the user
 * watched and what they download are one render path by construction. A forked export compiler is
 * the fastest way to lose that, and it is the product's central claim.
 *
 * What this replaces: a microVM that `apt-get`-installed Chromium's shared libraries onto an
 * Amazon Linux image, uploaded a webpack bundle file by file, `npm install`ed @remotion/renderer,
 * downloaded a headless shell and ran the whole render — inside one step function's timeout.
 * `@remotion/renderer` manages Chrome Headless Shell itself (`ensureBrowser`), so none of that
 * exists here.
 */

const ENGINE_FINGERPRINT = "remotion@4.0.450/worker";
/** Signed url handed to the user for the finished MP4. Long enough to download, not a permanent key. */
const EXPORT_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

interface ExportRow {
  id: string;
  aspect: "16:9" | "9:16" | "1:1";
  edit_id: string;
}

interface EditRow {
  id: string;
  project_id: string;
  edl: unknown;
}

interface RenderAssetRow extends AssetSource {
  kind: AssetKind;
  fps: number | null;
}

/**
 * Get Chrome in place BEFORE the poll loop starts, not on the first export.
 *
 * `ensureBrowser` downloads ~110 MB of Chrome Headless Shell the first time it runs on a machine
 * with no Chrome and no `REMOTION_BROWSER_EXECUTABLE`. Called from inside the render handler — which
 * is where it used to be, and still is as a safety net — that download runs INSIDE the job's
 * deadline while holding the only render slot, so a first export on a fresh box could sit at "0%"
 * for as long as the connection took and then be given up on for timing out. The user's first
 * impression of export was an hour of nothing.
 *
 * It is deliberately NOT fatal. A worker that cannot render can still analyse, and refusing to boot
 * would take beats and shot detection down with it. It warns and carries on; the render itself will
 * fail with the real reason if it comes to that.
 */
export async function prepareRenderer(config: WorkerConfig, log: (message: string) => void): Promise<void> {
  const browserExecutable = config.browserExecutable;
  if (browserExecutable) {
    log(`renderer: using the Chrome at REMOTION_BROWSER_EXECUTABLE (${browserExecutable})`);
  } else {
    log("renderer: checking for Chrome Headless Shell — first run downloads ~110 MB, before any job is claimed");
  }
  try {
    await ensureBrowser({ browserExecutable });
    log("renderer: Chrome is ready");
  } catch (e) {
    log(
      `renderer: Chrome is NOT available, so exports will fail until it is — ${e instanceof Error ? e.message : String(e)}. ` +
        "Point REMOTION_BROWSER_EXECUTABLE at an installed Chrome, or allow the download. Analysis jobs are unaffected.",
    );
  }
}

export async function runRenderJob(ctx: JobContext): Promise<void> {
  const exportId = ctx.job.export_id;
  if (!exportId) throw new Error(`render job ${ctx.job.id} has no export_id`);

  await setExportStatus(ctx.admin, exportId, { status: "running", error: null });

  try {
    await render(ctx, exportId);
  } catch (e) {
    // The export row is what the UI polls, so the reason has to land there as well as on the job —
    // but ONLY from the worker that still holds the claim. `export` carries no claim of its own, so
    // without this check a worker that was reaped mid-render (or given up on by its deadline) would
    // write "failed" over an export the worker that took the job over is about to succeed at. That
    // is the failure the user actually sees: told the render died while a good MP4 lands.
    if (await holdsClaim(ctx.admin, ctx.job)) {
      await setExportStatus(ctx.admin, exportId, { status: "failed", error: errorText(e) });
    } else {
      ctx.log("claim lost — leaving the export status to the worker that holds the job now");
    }
    throw e;
  }
}

async function render(ctx: JobContext, exportId: string): Promise<void> {
  const exportRow = await loadExport(ctx.admin, exportId);
  const edit = await loadEdit(ctx.admin, exportRow.edit_id);
  const ownerUserId = await loadProjectOwner(ctx.admin, edit.project_id);
  const edl = asEdl2(edit.edl);

  // SCOPED TO THE PROJECT, not just to the ids. This runs on the service-role client, which is
  // exempt from RLS, and the ids come out of an EDL the client supplied — `/api/edits` validates the
  // timeline's SHAPE but never checks that the assets it names belong to the project it is saved
  // against. Without the project filter, an EDL naming another tenant's asset uuid rendered that
  // tenant's footage into this export. The filter turns that into the "no longer exists" throw below.
  const assets = await loadAssets(ctx.admin, edit.project_id, referencedAssetIds(edl));
  const assetUrls = new Map<string, string>();
  for (const asset of assets) assetUrls.set(asset.id, await signAssetUrl(ctx.admin, asset));
  const assetKinds = new Map<string, MediaKind>(assets.map((a) => [a.id, a.kind]));
  const assetFps = new Map<string, number | null>(assets.map((a) => [a.id, a.fps]));

  const resolver = makeMediaResolver({ assetUrls, assetKinds, catalog: await loadCatalog() });
  const ir = edlToRenderIR(
    edl,
    {
      aspect: exportRow.aspect,
      quality: "full",
      // Server-derived, never read from the export row or a request body — see lib/jobs/tier.ts.
      tier: resolveExportTier(),
      fps: resolveRenderFps(edl, assetFps),
      engineFingerprint: ENGINE_FINGERPRINT,
    },
    resolver,
  );
  ctx.log(`compiled IR: ${ir.durationInFrames} frames @ ${ir.fps}fps, ${ir.resolution.width}x${ir.resolution.height}`);
  for (const diagnostic of ir.diagnostics) ctx.log(`diagnostic ${diagnostic.code}: ${diagnostic.detail}`);

  const workDir = await makeJobWorkDir(ctx.job.id);
  try {
    const outputPath = join(workDir, `${exportId}.mp4`);
    const serveUrl = await getBundle();
    const browserExecutable = ctx.config.browserExecutable;
    // No `apt-get`, no `dnf`, no runtime OS assembly: the renderer installs and manages its own
    // Chrome Headless Shell, or uses the one the image already ships (REMOTION_BROWSER_EXECUTABLE).
    await ensureBrowser({ browserExecutable });

    // THE DEADLINE HAS TO REACH CHROME, or "given up on" is only true of the bookkeeping — see
    // worker/cancel.ts for what abandoning a render without this cost. ctx.signal is aborted by the
    // deadline AND by SIGINT/SIGTERM, so a graceful shutdown now stops the render too.
    const { cancelSignal, cancel } = makeCancelSignal();
    const stopCancelling = cancelOnAbort(ctx.signal, cancel);
    try {
      // selectComposition takes no cancelSignal in @remotion/renderer 4.0.450 — checked, not assumed.
      // It is a metadata probe of a single composition, so it is not where a render wedges.
      const composition = await selectComposition({ serveUrl, id: "hite", inputProps: { ir }, browserExecutable });
      await renderMedia({
        serveUrl,
        composition,
        codec: "h264",
        outputLocation: outputPath,
        inputProps: { ir },
        browserExecutable,
        chromiumOptions: { gl: ctx.config.remotionGl },
        onProgress: throttledProgress(ctx),
        cancelSignal,
      });
    } finally {
      stopCancelling();
    }

    const mp4 = await readFile(outputPath);
    if (mp4.byteLength === 0) throw new Error("the renderer produced an empty file");

    // `{userId}/{exportId}.mp4` — the leading segment is what the storage policies key on, so the
    // owner can read their own export through their own session. The previous path wrote to the
    // bucket ROOT, which no policy can ever match.
    const objectPath = `${ownerUserId}/${exportId}.mp4`;
    await uploadToBucket(ctx.admin, EXPORTS_BUCKET, objectPath, mp4, "video/mp4");
    const signedUrl = await createSignedStorageUrl(ctx.admin, EXPORTS_BUCKET, objectPath, EXPORT_URL_TTL_SECONDS);

    await setExportStatus(ctx.admin, exportId, {
      status: "succeeded",
      error: null,
      output_blob_url: signedUrl,
      output_storage_path: objectPath,
    });
    ctx.log(`rendered ${(mp4.byteLength / 1_000_000).toFixed(1)} MB → ${objectPath}`);
  } finally {
    await removeWorkDir(workDir);
  }
}

// ───────────────────────── the Remotion bundle ─────────────────────────

/**
 * Webpack the composition once per worker lifetime — bundling is expensive and the composition
 * does not change while the process runs.
 *
 * A REJECTION is deliberately not cached: if the very first bundle fails (a transient webpack
 * error, an esbuild binary that was never installed) a permanently-cached rejected promise would
 * make every render for the rest of the process's life fail identically, with no way back but a
 * restart.
 */
let bundlePromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: join(process.cwd(), "lib", "remotion", "index.ts") }).catch((err: unknown) => {
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

/**
 * Remotion calls back per frame; logging each one would bury everything else. Report at most once
 * every 10% so a long render still shows progress in the log without drowning it.
 */
function throttledProgress(ctx: JobContext): (p: { progress: number }) => void {
  let lastReported = -1;
  return ({ progress }) => {
    const decile = Math.floor(progress * 10);
    if (decile > lastReported) {
      lastReported = decile;
      ctx.log(`rendering ${decile * 10}%`);
    }
  };
}

// ───────────────────────── row loading ─────────────────────────

async function loadExport(admin: SupabaseClient, exportId: string): Promise<ExportRow> {
  const { data, error } = await admin.from("export").select("id, aspect, edit_id").eq("id", exportId).maybeSingle();
  if (error) throw new Error(`could not load export ${exportId}: ${error.message}`);
  if (!data) throw new Error(`export ${exportId} no longer exists`);
  return data as ExportRow;
}

async function loadEdit(admin: SupabaseClient, editId: string): Promise<EditRow> {
  const { data, error } = await admin.from("edit").select("id, project_id, edl").eq("id", editId).maybeSingle();
  if (error) throw new Error(`could not load edit ${editId}: ${error.message}`);
  if (!data) throw new Error(`the edit this export was queued for no longer exists`);
  return data as EditRow;
}

async function loadProjectOwner(admin: SupabaseClient, projectId: string): Promise<string> {
  const { data, error } = await admin.from("project").select("owner_user_id").eq("id", projectId).maybeSingle();
  if (error) throw new Error(`could not load project ${projectId}: ${error.message}`);
  if (!data) throw new Error(`the project this export belongs to no longer exists`);
  return (data as { owner_user_id: string }).owner_user_id;
}

async function loadAssets(admin: SupabaseClient, projectId: string, ids: string[]): Promise<RenderAssetRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("asset")
    .select("id, kind, fps, filename, storage_path, blob_url")
    .eq("project_id", projectId)
    .in("id", ids);
  if (error) throw new Error(`could not load the export's assets: ${error.message}`);
  const rows = (data ?? []) as RenderAssetRow[];
  // An EDL referencing a deleted asset would otherwise compile to an empty url and render as
  // silent black — the hardest class of bug to trace back from "my export is blank".
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new Error(`this edit references ${missing.length} asset(s) that no longer exist`);
  return rows;
}

/**
 * Every asset the EDL needs a url for — clips AND audio beds.
 *
 * Audio beds were the bug (`audiobed-asset-url-empty-in-export`): the export resolver was built
 * from `allClipPositions` alone, which does not see `edl.audioBeds`, so the bed compiled with
 * `source.url = ""` while the preview — whose resolver was built from every asset in the project —
 * resolved it fine. "Add music" therefore played in the preview and was silent in the download:
 * a real preview ≠ export divergence, in the one direction users notice immediately.
 */
export function referencedAssetIds(edl: EdlType): string[] {
  const ids = new Set<string>();
  for (const position of allClipPositions(edl)) ids.add(position.clip.assetId);
  for (const bed of edl.audioBeds) ids.add(bed.assetId);
  return Array.from(ids);
}

/** Stored EDLs may still be v1; upgrade rather than refusing to render an old project. */
function asEdl2(raw: unknown): EdlType {
  if (raw && typeof raw === "object" && (raw as { schema?: string }).schema === "Edl.2") return Edl.parse(raw);
  return upgradeEdlV1toV2(raw);
}

async function setExportStatus(
  admin: SupabaseClient,
  exportId: string,
  patch: {
    status: "running" | "succeeded" | "failed";
    error: string | null;
    output_blob_url?: string;
    output_storage_path?: string;
  },
): Promise<void> {
  const { error } = await admin.from("export").update(patch).eq("id", exportId);
  if (error) throw new Error(`could not update export ${exportId}: ${error.message}`);
}
