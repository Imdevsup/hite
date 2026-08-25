import { describe, test, expect, afterEach } from "vitest";
import {
  StorageUploadError,
  storageErrorMessage,
  storageObjectEndpoint,
  uploadToStorage,
} from "@/lib/storage/upload";

/**
 * The uploader speaks the storage REST protocol directly so it can report real byte
 * progress (supabase-js is fetch-based and reports none). That is only acceptable if the
 * request it builds is pinned: endpoint, auth headers, no-overwrite, and the unnamed
 * multipart file part that `@supabase/storage-js` uses in the browser.
 *
 * XMLHttpRequest does not exist under vitest's node environment, so it is stubbed and the
 * recorded request inspected.
 */

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: FormData | null;
}

let recorded: RecordedRequest | null = null;

class FakeXhr {
  static nextStatus = 200;
  static nextResponseText = "";
  /** Set to 'error' | 'abort' to exercise the transport failure paths. */
  static nextTransport: "load" | "error" | "abort" = "load";

  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  private request: RecordedRequest = { method: "", url: "", headers: {}, body: null };

  open(method: string, url: string) {
    this.request.method = method;
    this.request.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.request.headers[name.toLowerCase()] = value;
  }

  send(body: FormData) {
    this.request.body = body;
    recorded = this.request;
    // Report one progress tick so the determinate bar has something real to show.
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    if (FakeXhr.nextTransport === "error") {
      this.onerror?.();
      return;
    }
    if (FakeXhr.nextTransport === "abort") {
      this.onabort?.();
      return;
    }
    this.status = FakeXhr.nextStatus;
    this.responseText = FakeXhr.nextResponseText;
    this.onload?.();
  }

  abort() {
    this.onabort?.();
  }
}

function installFakeXhr() {
  recorded = null;
  FakeXhr.nextStatus = 200;
  FakeXhr.nextResponseText = "";
  FakeXhr.nextTransport = "load";
  (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
}

afterEach(() => {
  delete (globalThis as unknown as { XMLHttpRequest?: unknown }).XMLHttpRequest;
});

function args(overrides: Partial<Parameters<typeof uploadToStorage>[0]> = {}) {
  return {
    supabaseUrl: "https://ref.supabase.co",
    apiKey: "anon-key",
    bucket: "media",
    path: "user-1/upload-1/clip.mp4",
    file: new File([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" }),
    accessToken: "user-token",
    ...overrides,
  };
}

describe("storageObjectEndpoint", () => {
  test("targets the storage object route for the bucket + key", () => {
    expect(storageObjectEndpoint("https://ref.supabase.co", "media", "u/x/clip.mp4")).toBe(
      "https://ref.supabase.co/storage/v1/object/media/u/x/clip.mp4",
    );
  });

  test("a trailing slash on the project url does not produce a double slash", () => {
    expect(storageObjectEndpoint("http://127.0.0.1:54421/", "media", "a/b.mp4")).toBe(
      "http://127.0.0.1:54421/storage/v1/object/media/a/b.mp4",
    );
  });
});

describe("uploadToStorage", () => {
  test("sends the user's token, the api key, and refuses to overwrite", async () => {
    installFakeXhr();
    await uploadToStorage(args());
    expect(recorded?.method).toBe("POST");
    expect(recorded?.url).toBe("https://ref.supabase.co/storage/v1/object/media/user-1/upload-1/clip.mp4");
    expect(recorded?.headers.authorization).toBe("Bearer user-token");
    expect(recorded?.headers.apikey).toBe("anon-key");
    // The path carries a fresh uuid, so a collision is a bug — never a silent replace.
    expect(recorded?.headers["x-upsert"]).toBe("false");
  });

  test("does NOT set content-type — the browser owns the multipart boundary", async () => {
    installFakeXhr();
    await uploadToStorage(args());
    expect(recorded?.headers["content-type"]).toBeUndefined();
  });

  test("the file is the unnamed multipart part, matching what storage-js sends", async () => {
    installFakeXhr();
    await uploadToStorage(args());
    const part = recorded?.body?.get("");
    expect(part).toBeInstanceOf(File);
    expect((part as File).type).toBe("video/mp4");
    expect(recorded?.body?.get("cacheControl")).toBe("3600");
  });

  test("progress reports measured bytes, never a synthetic ramp", async () => {
    installFakeXhr();
    const seen: number[] = [];
    await uploadToStorage(args({ onProgress: (p) => seen.push(p.fraction) }));
    expect(seen).toEqual([0.5]);
  });

  test("a storage rejection surfaces storage's own human message", async () => {
    installFakeXhr();
    FakeXhr.nextStatus = 400;
    FakeXhr.nextResponseText = JSON.stringify({ statusCode: "400", error: "InvalidMimeType", message: "mime type video/x-matroska is not supported" });
    await expect(uploadToStorage(args())).rejects.toThrow("mime type video/x-matroska is not supported");
  });

  test("a rejection carries the status for the caller to branch on", async () => {
    installFakeXhr();
    FakeXhr.nextStatus = 403;
    FakeXhr.nextResponseText = JSON.stringify({ message: "new row violates row-level security policy" });
    await expect(uploadToStorage(args())).rejects.toMatchObject({
      name: "StorageUploadError",
      status: 403,
    });
  });

  test("a transport failure is reported, not swallowed", async () => {
    installFakeXhr();
    FakeXhr.nextTransport = "error";
    await expect(uploadToStorage(args())).rejects.toBeInstanceOf(StorageUploadError);
  });

  test("an already-aborted signal never opens a request", async () => {
    installFakeXhr();
    const controller = new AbortController();
    controller.abort();
    await expect(uploadToStorage(args({ signal: controller.signal }))).rejects.toThrow("cancelled");
    expect(recorded).toBeNull();
  });
});

describe("storageErrorMessage", () => {
  test("prefers `message`, then `error`, then the status", () => {
    expect(storageErrorMessage(400, JSON.stringify({ message: "too big" }))).toBe("too big");
    expect(storageErrorMessage(400, JSON.stringify({ error: "Payload too large" }))).toBe("Payload too large");
    expect(storageErrorMessage(502, "<html>bad gateway</html>")).toContain("502");
    expect(storageErrorMessage(500, "")).toContain("500");
  });
});
