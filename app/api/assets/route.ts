import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { parseJsonBody } from "@/lib/api/body";
import { dbErrorResponse, HttpError } from "@/lib/api/errors";
import {
  ASSET_URL_TTL_SECONDS,
  MAX_ASSET_DIMENSION,
  MAX_ASSET_DURATION_MS,
  MAX_ASSET_FPS,
  MEDIA_BUCKET,
  MEDIA_MIME_KINDS,
  MEDIA_MIME_TYPES,
  createSignedStorageUrl,
  storagePathOwner,
} from "@/lib/storage/media";
import { z } from "zod";

const Body = z.object({
  projectId: z.string().uuid(),
  /** Object key inside the `media` bucket — `{userId}/{uploadId}/{filename}`. */
  storagePath: z.string().min(3).max(1024),
  filename: z.string().min(1).max(512),
  // The server derives `kind` from the content type (M1). A free-form client `kind` let a
  // caller mislabel an audio/image as "video", which poisons the EDL seed and the analyze
  // pipeline. Same allowlist the picker and the bucket enforce (lib/storage/media.ts).
  contentType: z.enum(MEDIA_MIME_TYPES),
  /**
   * REQUIRED, and nullable — the client must say which it is.
   *
   * This is the fix for the bug that killed the whole product: the browser probed the file
   * and wrote the result to the Zustand store only, so `asset.duration_ms` stayed NULL in
   * the database forever and /api/plan answered "no usable asset" on every project. It is
   * `.nullable()` rather than `.optional()` on purpose: `null` is an explicit "the browser
   * could not read this file", which the U3 worker's ffmpeg probe corrects later. Omitting
   * the field is a client bug and gets a 400 — silence must not read as "unknown".
   */
  durationMs: z.number().int().positive().max(MAX_ASSET_DURATION_MS).nullable(),
  width: z.number().int().positive().max(MAX_ASSET_DIMENSION).nullable().optional(),
  height: z.number().int().positive().max(MAX_ASSET_DIMENSION).nullable().optional(),
  fps: z.number().positive().max(MAX_ASSET_FPS).nullable().optional(),
});

/**
 * Records an asset after a client-direct upload to Supabase Storage completes.
 *
 * Authorization is enforced by RLS under the user's session, so no forged `userId` can
 * land a row in someone else's project, and the storage path's owner segment is checked
 * against the caller so a row can never point at another tenant's object. The
 * UNIQUE(storage_path) index (migration 005) makes the upsert idempotent across retries
 * and multiple tabs — it replaces the old UNIQUE(blob_url), which no longer identifies an
 * object now that `blob_url` is a signed url that differs on every signing.
 */
export function POST(req: Request) {
  return withAuth(async ({ user, supabase }) => {
    const body = await parseJsonBody(req, Body);
    const kind = MEDIA_MIME_KINDS[body.contentType]; // server-derived; never trusts a client `kind`

    if (storagePathOwner(body.storagePath) !== user.id) {
      throw new HttpError(403, "that storage path is not yours");
    }
    if (kind === "image" && body.durationMs !== null) {
      throw new HttpError(400, "durationMs: an image has no duration");
    }

    // Sign BEFORE inserting: `blob_url` is NOT NULL, and a row carrying an unusable url is
    // worse than no row — it renders as a black frame with nothing to trace it back to.
    const blobUrl = await createSignedStorageUrl(
      supabase,
      MEDIA_BUCKET,
      body.storagePath,
      ASSET_URL_TTL_SECONDS,
    );

    // RLS on `asset` requires the caller to own the referenced project.
    // We don't need an explicit ownership check here — RLS does it.
    const { data, error } = await supabase
      .from("asset")
      .upsert(
        {
          project_id: body.projectId,
          kind,
          storage_path: body.storagePath,
          blob_url: blobUrl,
          filename: body.filename,
          ...measuredColumns(body),
        },
        { onConflict: "storage_path" },
      )
      .select("id, kind, blob_url, filename, duration_ms, width, height, fps")
      .single();

    if (error) return dbErrorResponse(error);

    return NextResponse.json({ asset: data });
  });
}

/**
 * The measurement columns, carrying ONLY what this request actually measured.
 *
 * A column left out of an upsert payload is left out of `on conflict do update`, so the value
 * already on the row survives. That is the whole point here: this route runs BEFORE the worker's
 * ffmpeg probe (worker/analyze.ts `persistProbe`), which is the authoritative measurement, and the
 * browser sends `durationMs: null` — plus no `fps` at all — whenever it could not decode the file.
 * Writing those blanks unconditionally meant any RE-registration of the same object (a retried
 * POST, a second tab, the same file dropped twice) erased the probe's numbers and put the project
 * straight back into "no usable asset" on /api/plan — the exact bug this route exists to kill.
 *
 * A `null` here is therefore "I did not measure it", never "set it to unknown". On a first
 * registration the omitted columns default to NULL anyway, which is the same honest record.
 * Verified against a real Postgres in tests/integration/storage.test.ts.
 */
function measuredColumns(body: z.infer<typeof Body>): Record<string, number> {
  const columns: Record<string, number> = {};
  if (body.durationMs !== null) columns.duration_ms = body.durationMs;
  if (body.width != null) columns.width = body.width;
  if (body.height != null) columns.height = body.height;
  if (body.fps != null) columns.fps = body.fps;
  return columns;
}
