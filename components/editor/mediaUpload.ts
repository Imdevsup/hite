"use client";
import { create } from "zustand";
import { useEditor, type Asset } from "@/lib/editor/store";
import { probeMediaClientSide } from "@/lib/editor/probe";
import { createClient, supabaseBrowserConfig } from "@/lib/supabase/client";
import {
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  assetKindForMime,
  describeUnsupportedFile,
  formatBytes,
  mediaObjectPath,
  type AssetKind,
} from "@/lib/storage/media";
import { uploadToStorage } from "@/lib/storage/upload";
import { analysisBranchesForKind } from "@/lib/jobs/types";

/**
 * MEDIA UPLOAD — the one owner of "a file became an asset".
 *
 * This is the old `MediaWindow`'s upload pipeline, moved out of that (since-deleted) component
 * unchanged (probe the local
 * File → upload to Storage → register with the measured duration → kick off analysis). The move is
 * the point: the window-level `drop` listener lived INSIDE that window, so the app's "drop a clip
 * anywhere" promise was only true while the Media panel happened to be open. `GlobalDropZone`
 * painted a full-screen drop target over the whole editor and handled nothing — it was a picture of
 * a feature. With the pipeline here, `GlobalDropZone` owns the one real listener, and the empty
 * prompt-first screen can accept a drop before any panel exists at all.
 *
 * The store is progress + failure only. Assets themselves still land in the editor store via
 * `addAsset`, so there is exactly one place that holds them.
 */

export interface MediaUploadState {
  /** Filename currently going up, or null when idle. */
  uploadingName: string | null;
  /** "2/4" while a multi-file drop is in flight; null for a single file. */
  queueLabel: string | null;
  /** 0–1, real bytes-sent progress from the storage upload. Never synthesised. */
  progress: number;
  /** Every file that was refused or failed in the last batch, in the user's words. */
  error: string | null;
  /**
   * The name of the file that most recently finished uploading, or null before the first one.
   *
   * It exists because a drop onto the WORKING screen produced no visible result of any kind: the
   * progress and error lines live in `EmptyState`, which unmounts the moment there is a timeline,
   * and a new asset does not join the timeline by itself (nothing mutates the EDL except an
   * `EditCommand`). The file uploaded, registered and became addressable by the model, and the
   * screen said nothing — indistinguishable from the drop being ignored.
   *
   * Only set when a timeline ALREADY existed when the drop began. The upload that CREATES the
   * timeline needs no sentence — the timeline appearing is the feedback, and saying it as well put a
   * line on screen telling the user to name a file they can already see on the strip.
   *
   * Cleared when the next batch starts and when a prompt is sent, so it names the newest file or
   * nothing, and does not outlive the instruction it carries.
   */
  lastLoadedName: string | null;
  /** A file is being dragged over the window right now. */
  dragActive: boolean;

  setDragActive: (active: boolean) => void;
  clearError: () => void;
  /** Drop the "loaded" line once its instruction has been acted on. */
  clearLastLoaded: () => void;
  /** Upload every accepted file, in order. Resolves once the whole batch is done. */
  uploadFiles: (projectId: string, files: FileList | readonly File[]) => Promise<void>;
}

export const useMediaUpload = create<MediaUploadState>((set, get) => ({
  uploadingName: null,
  queueLabel: null,
  progress: 0,
  error: null,
  lastLoadedName: null,
  dragActive: false,

  setDragActive: (dragActive) => set({ dragActive }),
  clearError: () => set({ error: null }),
  clearLastLoaded: () => set({ lastLoadedName: null }),

  uploadFiles: (projectId, files) => {
    // SNAPSHOT AT THE BOUNDARY. A `FileList` from an <input> is LIVE: the picker's own onChange
    // resets `input.value` so the same file can be chosen twice, and that empties the list in
    // place. Because this function defers the work onto `batchChain`, `runBatch` used to read the
    // list AFTER it had been emptied — so picking a file through "browse" uploaded nothing and,
    // since an empty batch is a legitimate no-op, reported nothing either. Copying here means no
    // caller can reintroduce it by passing the live list.
    const snapshot = Array.from(files);
    batchChain = batchChain.then(() => runBatch(projectId, snapshot, set, get));
    return batchChain;
  },
}));

/** Tail of the upload queue. Module scope so concurrent `uploadFiles` calls line up behind it. */
let batchChain: Promise<void> = Promise.resolve();

type SetState = (partial: Partial<MediaUploadState>) => void;
type GetState = () => MediaUploadState;

/**
 * Every dropped/picked file, not just `files[0]`. Anything refused (unsupported type, over the size
 * cap) or failed is named in the error line — dropping four files and quietly keeping one was
 * indistinguishable from the other three failing.
 */
async function runBatch(
  projectId: string,
  list: FileList | readonly File[],
  set: SetState,
  get: GetState,
): Promise<void> {
  const files = Array.from(list);
  if (files.length === 0) return;
  set({ error: null, lastLoadedName: null });
  // Read BEFORE any upload starts: the first drop is what creates the timeline, so asking afterwards
  // would always answer "yes" and the redundant line would be back.
  const hadTimeline = useEditor.getState().edl !== null;

  const problems: string[] = [];
  const accepted: Array<{ file: File; kind: AssetKind }> = [];
  for (const file of files) {
    const kind = assetKindForMime(file.type);
    if (!kind) {
      problems.push(describeUnsupportedFile(file.name, file.type));
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      problems.push(`${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      continue;
    }
    accepted.push({ file, kind });
  }

  for (const [index, { file, kind }] of accepted.entries()) {
    set({
      uploadingName: file.name,
      queueLabel: accepted.length > 1 ? `${index + 1}/${accepted.length}` : null,
      progress: 0,
    });
    try {
      const warning = await uploadOne(projectId, file, kind, set);
      if (warning) problems.push(warning);
      // Set AFTER uploadOne resolves, which is after the asset row exists — so the name is only
      // claimed to be loaded once it genuinely is addressable.
      if (hadTimeline) set({ lastLoadedName: file.name });
    } catch (e) {
      // One bad file must not cancel the rest of the drop.
      problems.push(e instanceof Error ? e.message : `${file.name} failed to upload.`);
    } finally {
      set({ uploadingName: null, queueLabel: null, progress: 0 });
    }
  }

  if (problems.length > 0) set({ error: problems.join(" ") });
  else if (get().error) set({ error: null });
}

/**
 * Upload + register ONE file. Throws with a message written for the user; returns a non-fatal
 * warning string when the asset landed but something about it is worth saying out loud.
 *
 * Order matters. It used to be upload → register (no duration) → probe → write the result to the
 * Zustand store and nowhere else, so `asset.duration_ms` was NULL in the database forever and
 * /api/plan refused every project with "no usable asset". Probing the local File instead of the
 * uploaded url also removes the CORS/codec failure mode that made the old code reach for its
 * fabricated 10-second fallback.
 */
async function uploadOne(
  projectId: string,
  file: File,
  kind: AssetKind,
  set: SetState,
): Promise<string | null> {
  const { url: supabaseUrl, anonKey } = supabaseBrowserConfig();
  const supabase = createClient();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(`couldn't read your session — ${sessionError.message}`);
  // A reload re-enters through middleware.ts, which mints a session when there isn't one. There is
  // no sign-in screen to send anyone to, so "reload" is the complete instruction.
  if (!session) throw new Error("your session expired — reload the page");

  // Measure from the local File: no network, no CORS, and the answer is in hand BEFORE the asset
  // row exists, so the row is created with a real length or an honest NULL.
  const probe = kind === "image" ? null : await probeLocalFile(file, kind);

  const storagePath = mediaObjectPath({
    userId: session.user.id,
    uploadId: crypto.randomUUID(),
    filename: file.name,
  });
  await uploadToStorage({
    supabaseUrl,
    apiKey: anonKey,
    bucket: MEDIA_BUCKET,
    path: storagePath,
    file,
    accessToken: session.access_token,
    onProgress: (p) => set({ progress: p.fraction }),
  });

  const res = await fetch("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId,
      storagePath,
      filename: file.name,
      // Server derives `kind` from this (M1) — don't send a client-asserted kind.
      contentType: file.type,
      // null is a statement, not an omission: "the browser could not read this file".
      durationMs: probe?.durationMs ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") detail = body.error;
    } catch { /* ignore non-JSON body */ }
    throw new Error(`couldn't register ${file.name} — ${detail}`);
  }
  const { asset } = (await res.json()) as { asset: Asset };
  useEditor.getState().addAsset(asset);

  // AUDIO gets analyzed too (`audio-assets-never-analyzed`): only video used to trigger this, so
  // "cut to the beat of my song" asked for a beat grid on a file nothing had ever listened to, and
  // never would. The same function the worker and /api/analyze derive their branches from decides
  // here — a still has nothing to measure, so it is not asked for.
  if (analysisBranchesForKind(asset.kind).length > 0) {
    void fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: asset.id }),
    });
  }

  // No fabricated number, and no silence either: say what HITE does not know, because an asset
  // without a length cannot go on the timeline. Returned as a warning (the file IS in the reel and
  // its analysis has been queued) so it reads in the same place as every other upload problem.
  if (!probe && kind !== "image") {
    return `${file.name} is in your reel, but HITE couldn't read its length — it can't be cut until one is known.`;
  }
  return null;
}

/**
 * Measure a File the user just picked, before it is uploaded.
 *
 * `probeMediaClientSide` takes a url, so hand it an object url: the media element then decodes
 * bytes that are already on this machine. Returns null when the browser genuinely cannot decode the
 * file; the caller reports that, never invents it.
 */
async function probeLocalFile(file: File, kind: AssetKind) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await probeMediaClientSide(objectUrl, kind);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
