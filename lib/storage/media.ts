import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Storage: the buckets, the upload allowlist, the path convention and the
 * signed-url minting. ONE owner for all four, because every one of them used to have two.
 *
 * The MIME allowlist in particular was duplicated three ways: the file picker offered
 * `video/*,audio/*,image/*`, the Blob sign route allowed nine specific types, and
 * /api/assets carried its own copy of those nine. So `.mkv`, `.avi`, `.m4a` and `.gif`
 * passed the picker and then failed mid-upload with a raw storage error. Everything now
 * reads `MEDIA_MIME_KINDS`; the SQL copy in migration 005 is asserted equal to it by
 * tests/integration/storage.test.ts.
 */

export const MEDIA_BUCKET = "media";
export const EXPORTS_BUCKET = "exports";
export const PREVIEWS_BUCKET = "previews";

export type AssetKind = "video" | "audio" | "image";

/**
 * Every media type HITE accepts, and the asset `kind` it becomes.
 *
 * The membership rule is "a browser can decode it", because the browser is what measures
 * the clip's length (probeMediaClientSide) and what paints the preview (Remotion in
 * Chromium). Container formats browsers cannot decode — `.mkv` (video/x-matroska),
 * `.avi` (video/x-msvideo) — are deliberately absent: accepting one would mean an asset
 * with no readable duration and a black preview, which is worse than a clear refusal at
 * the picker.
 */
export const MEDIA_MIME_KINDS = {
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/aac": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/ogg": "audio",
  "audio/webm": "audio",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
} as const satisfies Record<string, AssetKind>;

export type MediaMimeType = keyof typeof MEDIA_MIME_KINDS;

/** Tuple form for `z.enum(...)` and for the SQL/bucket cross-check. Sorted for a stable diff. */
export const MEDIA_MIME_TYPES = Object.keys(MEDIA_MIME_KINDS) as [MediaMimeType, ...MediaMimeType[]];

/**
 * The `accept` attribute for the file picker — DERIVED, never hand-written. This is the
 * whole point of the constant above: the picker can no longer offer something the server
 * rejects.
 */
export const MEDIA_FILE_ACCEPT = MEDIA_MIME_TYPES.join(",");

/**
 * The upload cap, mirrored by `storage.buckets.file_size_limit` (migrations 005 + 009).
 * A file over this is rejected before a single byte is sent rather than after a long upload.
 *
 * IT IS 50 MiB BECAUSE THAT IS WHAT STORAGE ACCEPTS, not because a bigger file is unwelcome.
 * It advertised 2 GiB while the project's GLOBAL storage limit — `[storage] file_size_limit`
 * in supabase/config.toml, and 50 MiB on Supabase's free tier — silently overrode it: the
 * picker waved a 400 MB clip through and the platform rejected it 350 MB into the transfer,
 * with a raw storage error instead of the sentence the picker could have said instantly.
 * Raising this means raising the project's global limit FIRST (a paid plan setting) and the
 * bucket's with it; the two must move together or the larger number is a promise nothing keeps.
 */
export const MAX_UPLOAD_BYTES = 52_428_800; // 50 MiB

/** Sanity bounds shared by the /api/assets validator and the `asset_probe_sane` DB constraint. */
export const MAX_ASSET_DURATION_MS = 86_400_000; // 24h
export const MAX_ASSET_DIMENSION = 16_384;
export const MAX_ASSET_FPS = 1_000;

/**
 * TTL for the signed url stored on `asset.blob_url`.
 *
 * Tradeoff, stated plainly: a long-lived signed url is a bearer credential, so anyone it
 * leaks to can read that object until it expires. It is still a large improvement on what
 * it replaces — a permanent PUBLIC url whose path was the user's filename, guessable by
 * any other tenant. It is long because the url is stored on the row and is read back by
 * page loads, the analyze workflow and the render worker, none of which re-sign today.
 * `asset.storage_path` exists so they can: the migration path is to sign on read with a
 * short TTL and stop persisting a url at all.
 */
export const ASSET_URL_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/** TTL for a url handed to a render/analyze worker — must outlive the whole job budget. */
export const RENDER_URL_TTL_SECONDS = 60 * 60 * 12; // 12h

/** The asset `kind` for an upload's content type, or null when we do not accept it. */
export function assetKindForMime(mime: string): AssetKind | null {
  const key = mime.toLowerCase().split(";")[0].trim();
  return (MEDIA_MIME_KINDS as Record<string, AssetKind>)[key] ?? null;
}

/**
 * Why a file was refused, in the user's terms. The old path let the picker accept the
 * file and then surfaced the storage driver's own error, which named neither the file nor
 * the reason.
 */
export function describeUnsupportedFile(filename: string, mime: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot).toLowerCase() : "";
  const what = ext || mime || "that file type";
  return `${filename}: HITE can't read ${what} yet — convert it to MP4, MOV or WebM first.`;
}

/** Human-readable size for a refusal message ("2.4 GB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Object-key-safe form of a filename.
 *
 * Storage keys travel in a url path and are compared byte-for-byte by the policies, so
 * everything outside `[A-Za-z0-9._-]` collapses to `_`. The DISPLAY name is stored
 * separately in `asset.filename`, so nothing the user sees is mangled by this.
 */
export function storageObjectName(filename: string): string {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_");
  // Keep the TAIL: that is where the extension lives, and storage infers nothing from a
  // truncated name but a human reading the bucket does.
  const trimmed = cleaned.slice(-120).replace(/^[._-]+/, "");
  return trimmed.length > 0 ? trimmed : "upload";
}

/**
 * `{userId}/{uploadId}/{filename}` in the `media` bucket.
 *
 * The leading `{userId}` is load-bearing: it is exactly what the storage policies key on
 * (`storage.foldername(name)[1] = auth.uid()`). `{uploadId}` is a fresh uuid per file, so
 * two users — or one user twice — uploading `IMG_1234.MOV` never collide.
 */
export function mediaObjectPath(args: { userId: string; uploadId: string; filename: string }): string {
  return `${args.userId}/${args.uploadId}/${storageObjectName(args.filename)}`;
}

/**
 * The user id a storage path belongs to, or null when the path has no owner segment.
 *
 * The server calls this to refuse a registration whose path is not the caller's, instead
 * of trusting a client-supplied key. Storage RLS would already deny the read, but a row
 * pointing at someone else's object has no business existing either.
 */
export function storagePathOwner(path: string): string | null {
  const segments = path.split("/");
  if (segments.length < 2) return null;
  if (segments.some((s) => s.length === 0)) return null;
  return segments[0];
}

/** Raised when storage refuses to mint a url. Never downgraded to a null/empty url. */
export class StorageUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUrlError";
  }
}

/**
 * Mint a signed url for a private object, or throw.
 *
 * Fails loud on purpose: an unsigned/empty url flows straight into the EDL as a clip
 * source and renders as a silent black frame, which is the single hardest class of bug to
 * trace back to its cause.
 */
export async function createSignedStorageUrl(
  client: SupabaseClient,
  bucket: string,
  path: string,
  expiresInSeconds: number,
): Promise<string> {
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw new StorageUrlError(`couldn't sign ${bucket}/${path}: ${error.message}`);
  if (!data?.signedUrl) throw new StorageUrlError(`storage returned no signed url for ${bucket}/${path}`);
  return data.signedUrl;
}

/**
 * Upload bytes produced server-side (a rendered MP4, a generated preview) with a client
 * that is allowed to write the bucket — i.e. the service-role admin client. Throws on
 * failure rather than returning an error tuple nobody checks.
 */
export async function uploadToBucket(
  client: SupabaseClient,
  bucket: string,
  path: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).upload(path, body, { contentType, upsert: true });
  if (error) throw new StorageUrlError(`couldn't upload ${bucket}/${path}: ${error.message}`);
}

/**
 * Delete objects, reporting what failed instead of throwing.
 *
 * Storage has no `on delete cascade`. Deleting a project cascades its `asset` and `export` rows,
 * and those rows are the ONLY record of where the bytes live — so every uploaded clip and every
 * rendered MP4 stayed in the bucket forever, unreferenced and unfindable. `storage_path` /
 * `output_storage_path` exist precisely so this is possible; this is the function that uses them.
 *
 * It reports rather than throws because the caller runs it AFTER the rows are gone: the rows are
 * the authoritative record, and a storage hiccup must not turn a delete that happened into a 500.
 * The worst case is what this path produced unconditionally before — an orphaned object — and the
 * message is what makes it findable.
 */
export async function removeStorageObjects(
  client: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<{ removed: number; error: string | null }> {
  if (paths.length === 0) return { removed: 0, error: null };
  const { data, error } = await client.storage.from(bucket).remove(paths);
  if (error) return { removed: 0, error: `couldn't remove ${paths.length} object(s) from ${bucket}: ${error.message}` };
  // `remove` is not all-or-nothing: it answers with the objects it actually deleted.
  const removed = (data ?? []).length;
  return {
    removed,
    error: removed === paths.length ? null : `${paths.length - removed} object(s) in ${bucket} were not removed`,
  };
}

/** Permanent url for an object in the PUBLIC `previews` bucket. */
export function publicStorageUrl(client: SupabaseClient, bucket: string, path: string): string {
  const url = client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  if (!url) throw new StorageUrlError(`storage returned no public url for ${bucket}/${path}`);
  return url;
}
