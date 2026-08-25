import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MEDIA_BUCKET,
  RENDER_URL_TTL_SECONDS,
  createSignedStorageUrl,
  storageObjectName,
} from "@/lib/storage/media";

/**
 * Getting at the bytes an asset points to.
 *
 * Assets live in the private `media` bucket and are reached through signed urls
 * (lib/storage/media.ts). `storage_path` is the durable key; `blob_url` holds a rendered signed url
 * and is the fallback for rows created before migration 005.
 */

export interface AssetSource {
  id: string;
  filename: string;
  storage_path: string | null;
  blob_url: string | null;
}

/**
 * A readable url for an asset, minted fresh.
 *
 * TTL is `RENDER_URL_TTL_SECONDS` (12 h) rather than something tight: Chromium fetches source
 * media DURING the render, so a url that expires mid-job fails the render at minute 40 with a 403
 * that looks like a codec problem. The url must outlive the whole job budget, not the request.
 */
export async function signAssetUrl(admin: SupabaseClient, asset: AssetSource): Promise<string> {
  if (asset.storage_path) {
    return createSignedStorageUrl(admin, MEDIA_BUCKET, asset.storage_path, RENDER_URL_TTL_SECONDS);
  }
  if (asset.blob_url) return asset.blob_url;
  // No path and no url is a broken row, not an empty video. An empty string here would compile
  // into the IR as a clip source and render as silent black.
  throw new Error(`asset ${asset.id} (${asset.filename}) has neither a storage path nor a url`);
}

/** A per-job scratch directory in the OS temp dir. Never inside the repo. */
export async function makeJobWorkDir(jobId: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `hite-job-${jobId.slice(0, 8)}-`));
}

export async function removeWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch((e: unknown) => {
    // A leaked temp directory is a disk-space problem, not a failed job — say so and carry on.
    console.warn(`[worker] could not remove work dir ${dir}: ${e instanceof Error ? e.message : String(e)}`);
  });
}

/**
 * Stream a url to a local file.
 *
 * Streamed rather than buffered: the previous transcription path pulled the entire video into
 * process memory as one Buffer before posting it, whatever its size. Analysis makes
 * several ffmpeg passes over the same input, so one download beats re-fetching over the network per
 * pass.
 */
export async function downloadToFile(
  url: string,
  dir: string,
  filename: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const target = join(dir, storageObjectName(filename));
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok || !res.body) {
    throw new Error(`could not download source media: HTTP ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(target));
  return target;
}
