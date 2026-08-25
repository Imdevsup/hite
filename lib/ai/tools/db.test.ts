import { describe, expect, test, beforeEach, vi } from "vitest";

/**
 * The one rule this layer exists for: a FAILED query must never reach the model as "no data".
 * Before this, every tool destructured `{ data }` and dropped `error`, so a rotated service key or
 * a Supabase blip was reported as "this clip has no beats/transcript" — an authoritative negative
 * the planner then asserted to the user and edited against.
 */

interface StubResult {
  data: unknown;
  error: { message: string } | null;
}

interface QueryStub {
  select: () => QueryStub;
  eq: () => QueryStub;
  order: () => QueryStub;
  limit: () => Promise<StubResult>;
  maybeSingle: () => Promise<StubResult>;
}

let result: StubResult = { data: null, error: null };

function queryStub(): QueryStub {
  const stub: QueryStub = {
    select: () => stub,
    eq: () => stub,
    order: () => stub,
    limit: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  };
  return stub;
}

const lastOrder: { column: string | null; ascending: boolean | null } = { column: null, ascending: null };

vi.mock("@/lib/supabase/admin", () => ({
  createAdmin: () => ({
    from: () => {
      const stub = queryStub();
      return {
        ...stub,
        select: () => ({
          ...stub,
          eq: () => ({
            ...stub,
            eq: () => stub,
            order: (column: string, opts: { ascending: boolean }) => {
              lastOrder.column = column;
              lastOrder.ascending = opts.ascending;
              return stub;
            },
          }),
        }),
      };
    },
  }),
}));

import { readAnalysisData, readAssetDurationMs, readTranscript, msNumbers, msArrayToTicks } from "./db";
import { ToolError, ToolErrorKinds } from "./errors";

beforeEach(() => {
  result = { data: null, error: null };
  lastOrder.column = null;
  lastOrder.ascending = null;
});

describe("readAnalysisData", () => {
  test("a query FAILURE throws a ToolError — never an empty analysis", async () => {
    result = { data: null, error: { message: "JWT expired" } };
    await expect(readAnalysisData("a1", "beats")).rejects.toThrow(ToolError);
    await expect(readAnalysisData("a1", "beats")).rejects.toThrow(/LOOKUP FAILURE/);
  });

  test("the thrown error carries the db_error kind and forbids the false negative", async () => {
    result = { data: null, error: { message: "connection reset" } };
    const err = await readAnalysisData("a1", "beats").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).kind).toBe(ToolErrorKinds.DB_ERROR);
    expect((err as ToolError).message).toMatch(/do NOT tell the user this clip has no/i);
  });

  test("a genuinely missing row is still a graceful null (the pipeline may not have run)", async () => {
    result = { data: null, error: null };
    await expect(readAnalysisData("a1", "beats")).resolves.toBeNull();
  });

  test("a present row returns its payload", async () => {
    result = { data: { data: { bpm: 128, beats_ms: [0, 469] } }, error: null };
    await expect(readAnalysisData("a1", "beats")).resolves.toEqual({ bpm: 128, beats_ms: [0, 469] });
  });

  test("a non-object payload is treated as absent rather than passed through", async () => {
    result = { data: { data: "corrupt" }, error: null };
    await expect(readAnalysisData("a1", "beats")).resolves.toBeNull();
  });
});

describe("readTranscript", () => {
  test("a query FAILURE throws instead of reporting no speech", async () => {
    result = { data: null, error: { message: "rate limited" } };
    await expect(readTranscript("a1")).rejects.toThrow(/LOOKUP FAILURE/);
  });

  test("reads newest-first — the table has no unique constraint, so the read must be deterministic", async () => {
    result = { data: [{ language: "en", segments: [] }], error: null };
    await readTranscript("a1");
    expect(lastOrder.column).toBe("created_at");
    expect(lastOrder.ascending).toBe(false);
  });

  test("no row → null; the tools turn that into an honest 'not transcribed'", async () => {
    result = { data: [], error: null };
    await expect(readTranscript("a1")).resolves.toBeNull();
  });

  test("segments come back chronological and typed, with defaults filled in", async () => {
    result = {
      data: [
        {
          language: "en",
          segments: [
            { startMs: 900, endMs: 1200, text: "second" },
            { startMs: 100, endMs: 400, text: "first", words: [{ t0Ms: 100, t1Ms: 400, word: "first" }] },
          ],
        },
      ],
      error: null,
    };
    const transcript = await readTranscript("a1");
    expect(transcript?.segments.map((s) => s.text)).toEqual(["first", "second"]);
    expect(transcript?.segments[1].words).toEqual([]); // default, not undefined
  });

  test("a stored payload in an unrecognisable shape throws — a schema change is not silence", async () => {
    result = { data: [{ language: "en", segments: [{ nope: true }] }], error: null };
    await expect(readTranscript("a1")).rejects.toThrow(/Do NOT tell the user the clip has no speech/);
  });

  test("a non-array segments payload throws", async () => {
    result = { data: [{ language: "en", segments: "oops" }], error: null };
    await expect(readTranscript("a1")).rejects.toThrow(/not a segment array/);
  });
});

describe("readAssetDurationMs", () => {
  test("a query FAILURE throws", async () => {
    result = { data: null, error: { message: "boom" } };
    await expect(readAssetDurationMs("a1")).rejects.toThrow(/LOOKUP FAILURE/);
  });

  test("a missing asset row is NOT_FOUND — the IDOR guard already vouched for the id", async () => {
    result = { data: null, error: null };
    const err = await readAssetDurationMs("a1").catch((e: unknown) => e);
    expect((err as ToolError).kind).toBe(ToolErrorKinds.NOT_FOUND);
  });

  test("an unprobed duration is null, not zero", async () => {
    result = { data: { duration_ms: null }, error: null };
    await expect(readAssetDurationMs("a1")).resolves.toBeNull();
    result = { data: { duration_ms: 0 }, error: null };
    await expect(readAssetDurationMs("a1")).resolves.toBeNull();
  });

  test("a probed duration comes back as milliseconds", async () => {
    result = { data: { duration_ms: 42_000 }, error: null };
    await expect(readAssetDurationMs("a1")).resolves.toBe(42_000);
  });
});

describe("msNumbers", () => {
  test("keeps finite non-negative numbers and drops everything else", () => {
    expect(msNumbers([0, 100, -1, "200", null, NaN, Infinity, 300])).toEqual([0, 100, 300]);
    expect(msNumbers(undefined)).toEqual([]);
    expect(msNumbers({ nope: 1 })).toEqual([]);
  });
});

describe("msArrayToTicks", () => {
  test("EVERY element converts at 30 ticks per ms, not just the first", () => {
    // The trap this helper exists to close: `.map(msToTicks)` passes the array index as msToTicks's
    // `tps` argument, so element 1 converts at 1 tick/second and 5000ms becomes 5 — still an
    // integer, still a legal tick, and the cut lands in the wrong place.
    expect(msArrayToTicks([1_000, 5_000, 12_500])).toEqual([30_000, 150_000, 375_000]);
  });

  test("filters the same junk msNumbers does", () => {
    expect(msArrayToTicks([100, null, "200", -5, 300])).toEqual([3_000, 9_000]);
    expect(msArrayToTicks(undefined)).toEqual([]);
  });
});
