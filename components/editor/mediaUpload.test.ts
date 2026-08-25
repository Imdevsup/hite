import { describe, test, expect, vi, beforeEach } from "vitest";
import { useMediaUpload } from "./mediaUpload";

/**
 * The picker regression.
 *
 * The file input resets `input.value` in its onChange so the same file can be picked twice in a row
 * after a failure. (There were two such inputs when this was found; `MediaWindow` has since been
 * deleted and `EmptyState` owns the only one.) `input.files` is LIVE, so that reset empties the
 * FileList in place — and `uploadFiles` queues its work on a promise chain rather than reading the
 * list synchronously. The batch therefore saw zero files, and a zero-file batch is a legitimate
 * no-op, so choosing a clip through "browse" uploaded nothing AND said nothing.
 *
 * It was invisible to every existing test because they all pass a plain array. This one reproduces
 * the live-list behaviour: a FileList-alike that the caller empties immediately after handing it
 * over, exactly as the DOM does.
 */
function liveFileList(files: File[]) {
  const list = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      yield* files;
    },
  } as unknown as FileList & { drain: () => void };
  // What `input.value = ""` does to the list the caller already handed on.
  list.drain = () => {
    files.length = 0;
    (list as unknown as { length: number }).length = 0;
  };
  return list;
}

describe("uploadFiles — the picker's live FileList", () => {
  beforeEach(() => {
    useMediaUpload.setState({ error: null, uploadingName: null, progress: 0 });
  });

  test("snapshots the list, so clearing the input after the call does not empty the batch", async () => {
    const files = [new File([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" })];
    const list = liveFileList(files);

    const promise = useMediaUpload.getState().uploadFiles("project-1", list);
    // The onChange handler resets input.value on the very next line — before the queued batch runs.
    list.drain();
    await promise;

    // The upload then fails for want of a session in this environment — which is the point: it got
    // as far as needing one, so the batch was NOT empty. Before the fix the list was already
    // drained by the time `runBatch` read it, `files.length === 0` returned early, and `error`
    // stayed null: no upload, no complaint, nothing on screen.
    expect(useMediaUpload.getState().error).toMatch(/session/i);
  });

  test("an genuinely empty pick stays a silent no-op", async () => {
    await useMediaUpload.getState().uploadFiles("project-1", liveFileList([]));
    expect(useMediaUpload.getState().error).toBeNull();
  });

  test("an unsupported type is named rather than dropped", async () => {
    const files = [new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" })];
    await useMediaUpload.getState().uploadFiles("project-1", liveFileList(files));
    expect(useMediaUpload.getState().error).toContain("notes.txt");
  });
});

// The store touches supabase-js at call time; stub it so the unit test stays offline.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  }),
  supabaseBrowserConfig: () => ({ url: "http://localhost:54421", anonKey: "anon" }),
}));
