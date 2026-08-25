import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level contract tests for POST /api/assets — the hop that decides whether the rest
 * of the product can work at all.
 *
 * The bug this route now closes: the browser measured the clip, wrote the answer to the
 * Zustand store and nowhere else, so `asset.duration_ms` stayed NULL in the database
 * forever and /api/plan answered 400 "no usable asset" on EVERY project. The route
 * therefore has one job it must never get wrong — persist a duration that was actually
 * measured, and refuse anything that merely looks like one.
 *
 * Only the BOUNDARY is faked (auth + supabase). The zod contract, the kind derivation,
 * the storage-path ownership check and the row that reaches the database are real.
 */

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const UPLOAD = "33333333-3333-4333-8333-333333333333";
const PATH = `${USER}/${UPLOAD}/clip.mp4`;

type Row = Record<string, unknown>;

/** The payload the route handed the database on the last call — the request→row contract. */
let upsertedRow: Row | null = null;
let upsertOptions: Row | null = null;
let signedPaths: Array<{ bucket: string; path: string; ttl: number }> = [];

/**
 * `asset`, keyed by `storage_path`, with REAL upsert semantics.
 *
 * A fake that merely records the payload cannot observe the bug this route now closes: the failure
 * mode is a column that IS sent (as null) overwriting one the worker's probe already measured, and
 * that only exists once "insert or update" is modelled. `on conflict do update` touches exactly the
 * columns present in the payload — which is why omitting a column is what preserves it. The live
 * Postgres behaviour this mirrors is asserted directly in tests/integration/storage.test.ts.
 */
const table = new Map<string, Row>();
/** Every measurement column defaults to NULL on insert, exactly as the schema does. */
const MEASUREMENTS = ["duration_ms", "width", "height", "fps"] as const;

class FakeQuery {
  private row: Row | null = null;

  upsert(payload: Row, options: Row) {
    upsertedRow = payload;
    upsertOptions = options;
    const key = String(payload.storage_path);
    const existing = table.get(key);
    const blanks = Object.fromEntries(MEASUREMENTS.map((c) => [c, null]));
    const merged = existing ? { ...existing, ...payload } : { id: "asset-1", ...blanks, ...payload };
    table.set(key, merged);
    this.row = merged;
    return this;
  }
  select() { return this; }
  single() {
    return Promise.resolve({ data: this.row, error: null });
  }
}

/** Seed a row the way the worker's ffmpeg probe does — after the first registration. */
function seedProbedRow(path: string, probe: Row): void {
  table.set(path, { id: "asset-1", storage_path: path, kind: "video", filename: "clip.mp4", ...probe });
}

function storedRow(path: string): Row {
  const row = table.get(path);
  if (!row) throw new Error(`no asset row at ${path}`);
  return row;
}

const fakeSupabase = {
  from: () => new FakeQuery(),
  storage: {
    from: (bucket: string) => ({
      createSignedUrl: (path: string, ttl: number) => {
        signedPaths.push({ bucket, path, ttl });
        return Promise.resolve({ data: { signedUrl: `https://storage.test/sign/${bucket}/${path}?token=t` }, error: null });
      },
    }),
  },
};

// Mirrors the real withAuth: an HttpError (401/400/403) becomes its response; anything else throws.
vi.mock("@/lib/api/auth", async () => {
  const { HttpError } = await import("@/lib/api/errors");
  return {
    withAuth: async (handler: (ctx: { user: { id: string }; supabase: unknown }) => unknown) => {
      try {
        return await handler({ user: { id: USER }, supabase: fakeSupabase });
      } catch (e) {
        if (e instanceof HttpError) return e.response;
        throw e;
      }
    },
  };
});

const { POST } = await import("./route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  ) as Promise<Response>;
}

const valid = {
  projectId: PROJECT,
  storagePath: PATH,
  filename: "clip.mp4",
  contentType: "video/mp4",
  durationMs: 30_000,
  width: 1920,
  height: 1080,
};

beforeEach(() => {
  upsertedRow = null;
  upsertOptions = null;
  signedPaths = [];
  table.clear();
});

describe("POST /api/assets — the measured duration reaches the database", () => {
  it("persists the probed duration and dimensions on the row", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(upsertedRow).toMatchObject({
      project_id: PROJECT,
      kind: "video",
      storage_path: PATH,
      filename: "clip.mp4",
      duration_ms: 30_000,
      width: 1920,
      height: 1080,
    });
  });

  it("returns the row the editor store seeds its timeline from", async () => {
    const res = await post(valid);
    const body = await res.json() as { asset: { duration_ms: number; blob_url: string } };
    expect(body.asset.duration_ms).toBe(30_000);
    expect(body.asset.blob_url).toContain("token=");
  });

  it("null duration means 'the browser could not read it' — never a fabricated number", async () => {
    const res = await post({ ...valid, durationMs: null, width: null, height: null });
    expect(res.status).toBe(200);
    expect(storedRow(PATH).duration_ms).toBeNull();
    // The 10_000ms placeholder this replaces must not reappear from any default.
    expect(storedRow(PATH).duration_ms).not.toBe(10_000);
    // …and an unmeasured column is not SENT at all, which is what leaves it alone on a re-register.
    expect(upsertedRow).not.toHaveProperty("duration_ms");
    expect(upsertedRow).not.toHaveProperty("width");
  });

  it("OMITTING durationMs is a 400 — silence must not read as 'unknown'", async () => {
    const withoutDuration: Record<string, unknown> = { ...valid };
    delete withoutDuration.durationMs;
    const res = await post(withoutDuration);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("durationMs") });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1234.5],
    ["absurd (over 24h)", 86_400_001],
  ])("refuses a %s duration rather than storing it", async (_label, durationMs) => {
    const res = await post({ ...valid, durationMs });
    expect(res.status).toBe(400);
    expect(upsertedRow).toBeNull();
  });

  it("refuses a duration on an image — a still has no length", async () => {
    const res = await post({ ...valid, contentType: "image/png", filename: "a.png", durationMs: 5000 });
    expect(res.status).toBe(400);
    expect(upsertedRow).toBeNull();
  });
});

/**
 * The second registration of the SAME object — a retried POST, a second tab, the same file dropped
 * twice. It reaches the route long after the worker's ffmpeg probe has written the authoritative
 * measurement onto the row, and it carries whatever the BROWSER could read, which for an
 * undecodable file is nothing at all. Overwriting the probe with those blanks put /api/plan back to
 * "no usable asset" — the core loop broken by a double-click.
 */
describe("POST /api/assets — a re-registration never downgrades the row", () => {
  const PROBED = { duration_ms: 187_233, width: 1920, height: 1080, fps: 29.97 };

  it("keeps the worker's probe when the browser could not read the file", async () => {
    seedProbedRow(PATH, PROBED);

    const res = await post({ ...valid, durationMs: null, width: null, height: null });
    expect(res.status).toBe(200);
    expect(storedRow(PATH)).toMatchObject(PROBED);
  });

  it("keeps the probed fps, which the client never sends at all", async () => {
    seedProbedRow(PATH, PROBED);

    await post(valid); // carries durationMs/width/height, never fps
    expect(storedRow(PATH).fps).toBe(29.97);
  });

  it("still refreshes the signed url and the project the row belongs to", async () => {
    seedProbedRow(PATH, PROBED);

    await post(valid);
    const row = storedRow(PATH);
    expect(row.blob_url).toContain("token=");
    expect(row.project_id).toBe(PROJECT);
  });

  it("a first registration of an undecodable file still records NULL, not a placeholder", async () => {
    const res = await post({ ...valid, durationMs: null, width: null, height: null });
    expect(res.status).toBe(200);
    const body = await res.json() as { asset: { duration_ms: number | null } };
    expect(body.asset.duration_ms).toBeNull();
  });
});

describe("POST /api/assets — authorization and derivation", () => {
  it("refuses a storage path under another user's prefix", async () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const res = await post({ ...valid, storagePath: `${other}/${UPLOAD}/clip.mp4` });
    expect(res.status).toBe(403);
    expect(upsertedRow).toBeNull();
    // Nothing was signed either — a rejected caller learns nothing about the object.
    expect(signedPaths).toHaveLength(0);
  });

  it("refuses a path with no owner segment", async () => {
    const res = await post({ ...valid, storagePath: "clip.mp4" });
    expect(res.status).toBe(403);
  });

  it("derives `kind` from the content type instead of trusting the client", async () => {
    // A client-asserted kind used to let audio be labelled video, which poisons the EDL seed.
    await post({ ...valid, contentType: "audio/mpeg", filename: "track.mp3", kind: "video" });
    expect(upsertedRow?.kind).toBe("audio");
  });

  it("refuses a content type outside the shared allowlist", async () => {
    const res = await post({ ...valid, contentType: "video/x-matroska" });
    expect(res.status).toBe(400);
    expect(upsertedRow).toBeNull();
  });

  it("signs the media bucket object with a long TTL before inserting", async () => {
    await post(valid);
    expect(signedPaths).toEqual([{ bucket: "media", path: PATH, ttl: 60 * 60 * 24 * 365 }]);
  });

  it("keys idempotency on storage_path, not on the (re-signable) url", async () => {
    await post(valid);
    expect(upsertOptions).toEqual({ onConflict: "storage_path" });
  });

  it("a malformed body is a 400, not a 500", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
  });
});
