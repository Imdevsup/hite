/**
 * Browser → Supabase Storage upload, with REAL byte progress.
 *
 * `supabase.storage.from(b).upload()` would be one line, but it is built on `fetch` and
 * therefore cannot report progress. The editor shows a determinate bar wired to actual
 * bytes; replacing that with a spinner would be a regression, and animating a bar that
 * isn't measuring anything would be the exact class of lie this overhaul is removing. So
 * this speaks the same wire protocol over XHR: `POST /storage/v1/object/{bucket}/{path}`
 * with a multipart body whose file part is the only unnamed field — byte-for-byte what
 * `@supabase/storage-js` sends (see uploadOrUpdate in that package).
 *
 * Authorization is the user's own access token, so the storage RLS policies from
 * migration 005 decide what may be written. Nothing here is trusted server-side: the
 * path's owner segment is re-checked by /api/assets before a row is created.
 */

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0..1, for a determinate bar. */
  fraction: number;
}

export interface StorageUploadArgs {
  /** Project url, e.g. https://xyz.supabase.co — no trailing `/storage/v1`. */
  supabaseUrl: string;
  /** Publishable anon key; storage wants it alongside the bearer token. */
  apiKey: string;
  bucket: string;
  /** Object key inside the bucket, already sanitized (see mediaObjectPath). */
  path: string;
  file: File;
  accessToken: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export class StorageUploadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "StorageUploadError";
  }
}

export function storageObjectEndpoint(supabaseUrl: string, bucket: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${path}`;
}

/**
 * Storage errors come back as `{ statusCode, error, message }`. Surface `message` — it is
 * the only part written for a human ("The resource already exists", "mime type not
 * supported") — and fall back to the status when the body is not the shape we expect.
 */
export function storageErrorMessage(status: number, rawBody: string): string {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object") {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) return message;
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === "string" && error.length > 0) return error;
    }
  } catch {
    // Not JSON (a proxy's HTML error page, an empty body) — fall through to the status.
  }
  return `storage rejected the upload (HTTP ${status})`;
}

/**
 * The headers the storage object route expects. Deliberately no `content-type`: the
 * transport must set it, because only the transport knows the multipart boundary.
 *
 * `x-upsert: false` — the object key carries a fresh uuid per upload, so a collision is a
 * bug, never a retry, and must not silently replace someone's footage.
 */
export function storageUploadHeaders(args: { accessToken: string; apiKey: string }): Record<string, string> {
  return {
    authorization: `Bearer ${args.accessToken}`,
    apikey: args.apiKey,
    "x-upsert": "false",
  };
}

/**
 * The multipart body: an UNNAMED file part plus `cacheControl` — byte-for-byte what
 * `@supabase/storage-js` sends from a browser (uploadOrUpdate, Blob branch). The part's
 * own Content-Type comes from `File.type`, and that is what the bucket's MIME allowlist
 * is checked against.
 *
 * Exported so the integration suite can fire this exact body at a real storage server:
 * hand-rolling the request is only defensible if the wire format is verified, not assumed.
 */
export function buildStorageUploadBody(file: File): FormData {
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  return body;
}

export function uploadToStorage(args: StorageUploadArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    if (args.signal?.aborted) {
      reject(new StorageUploadError("upload cancelled"));
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();

    const settle = (finish: () => void) => {
      args.signal?.removeEventListener("abort", onAbort);
      finish();
    };

    xhr.open("POST", storageObjectEndpoint(args.supabaseUrl, args.bucket, args.path));
    for (const [name, value] of Object.entries(storageUploadHeaders(args))) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (!event.lengthComputable || event.total <= 0) return;
      args.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        fraction: Math.min(1, event.loaded / event.total),
      });
    };

    xhr.onload = () =>
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new StorageUploadError(storageErrorMessage(xhr.status, xhr.responseText), xhr.status));
      });
    xhr.onerror = () =>
      settle(() => reject(new StorageUploadError("upload failed — check your connection and try again")));
    xhr.ontimeout = () => settle(() => reject(new StorageUploadError("upload timed out")));
    xhr.onabort = () => settle(() => reject(new StorageUploadError("upload cancelled")));

    args.signal?.addEventListener("abort", onAbort, { once: true });

    xhr.send(buildStorageUploadBody(args.file));
  });
}
