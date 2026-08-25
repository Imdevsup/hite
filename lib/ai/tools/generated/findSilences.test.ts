import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ToolSpec } from "../registry";
import type { StoredTranscript } from "../db";

/**
 * "Cut the dead air" is a flagship prompt, and the dead air people mean is almost always the
 * fumbling intro before the first word or the hanging tail after the last. This tool only looked at
 * gaps BETWEEN segments, so both edges were invisible and a clip with a 6s silent opening came back
 * as "trimmed" with the opening intact. These tests pin all three kinds.
 */

let transcript: StoredTranscript | null = null;
let durationMs: number | null = null;

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  readTranscript: async () => transcript,
  readAssetDurationMs: async () => durationMs,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdmin: () => ({}) }));

const { spec } = await import("./findSilences");

interface Silence {
  startTick: number;
  endTick: number;
  kind: "leading" | "between" | "trailing";
}
interface Result {
  silences: Silence[];
  transcribed: boolean;
  note?: string;
}

/**
 * Invoke the REGISTERED tool the way the planner does — including the asset scope it passes in
 * `experimental_context`, without which the IDOR guard (../_guard.ts) refuses the call. The cast is
 * the tool's untyped I/O boundary.
 */
async function run(toolSpec: ToolSpec, input: unknown): Promise<Result> {
  const execute = toolSpec.tool.execute;
  if (!execute) throw new Error(`${toolSpec.name} has no execute`);
  const experimental_context = { allowedAssetIds: [String((input as { assetId?: string }).assetId)] };
  return (await execute(input, { toolCallId: "t", messages: [], experimental_context })) as Result;
}

const speech = (startMs: number, endMs: number) => ({ startMs, endMs, text: "words", words: [] });

beforeEach(() => {
  transcript = null;
  durationMs = null;
});

describe("the dead air at the edges — the whole point of the fix", () => {
  test("silence before the first word is reported", async () => {
    transcript = { language: "en", segments: [speech(6_000, 9_000)] };
    durationMs = 10_000;
    const { silences } = await run(spec, { assetId: "a1" });
    expect(silences).toContainEqual({ startTick: 0, endTick: 180_000, kind: "leading" });
  });

  test("silence after the last word is reported, measured against the asset duration", async () => {
    transcript = { language: "en", segments: [speech(0, 4_000)] };
    durationMs = 10_000;
    const { silences } = await run(spec, { assetId: "a1" });
    expect(silences).toContainEqual({ startTick: 120_000, endTick: 300_000, kind: "trailing" });
  });

  test("a SINGLE segment in the middle of a long clip yields both edges (used to yield nothing)", async () => {
    transcript = { language: "en", segments: [speech(6_000, 9_000)] };
    durationMs = 15_000;
    const { silences } = await run(spec, { assetId: "a1" });
    expect(silences.map((s) => s.kind)).toEqual(["leading", "trailing"]);
  });

  test("no dead air at the edges ⇒ nothing invented there", async () => {
    transcript = { language: "en", segments: [speech(0, 10_000)] };
    durationMs = 10_000;
    expect((await run(spec, { assetId: "a1" })).silences).toEqual([]);
  });
});

describe("gaps between segments still work, in order", () => {
  test("a mid-clip pause is reported as `between`", async () => {
    transcript = { language: "en", segments: [speech(0, 2_000), speech(4_000, 6_000)] };
    durationMs = 6_000;
    const { silences } = await run(spec, { assetId: "a1" });
    expect(silences).toEqual([{ startTick: 60_000, endTick: 120_000, kind: "between" }]);
  });

  test("all three kinds come back chronologically", async () => {
    transcript = { language: "en", segments: [speech(1_000, 2_000), speech(4_000, 5_000)] };
    durationMs = 8_000;
    const { silences } = await run(spec, { assetId: "a1" });
    expect(silences.map((s) => s.kind)).toEqual(["leading", "between", "trailing"]);
    expect(silences.map((s) => s.startTick)).toEqual([0, 60_000, 150_000]);
  });

  test("gaps at or under the threshold are not silences", async () => {
    transcript = { language: "en", segments: [speech(0, 2_000), speech(2_500, 4_000)] };
    durationMs = 4_000;
    expect((await run(spec, { assetId: "a1" })).silences).toEqual([]);
    const custom = await run(spec, { assetId: "a1", minMs: 300 });
    expect(custom.silences).toEqual([{ startTick: 60_000, endTick: 75_000, kind: "between" }]);
  });
});

describe("what it cannot measure, it says", () => {
  test("no transcript → empty list, transcribed:false, and a note forbidding the false negative", async () => {
    transcript = null;
    const result = await run(spec, { assetId: "a1" });
    expect(result.silences).toEqual([]);
    expect(result.transcribed).toBe(false);
    expect(result.note).toMatch(/Do not claim the clip has none/);
  });

  test("an unprobed duration drops only the trailing edge, and says so", async () => {
    transcript = { language: "en", segments: [speech(5_000, 9_000)] };
    durationMs = null;
    const result = await run(spec, { assetId: "a1" });
    expect(result.silences.map((s) => s.kind)).toEqual(["leading"]);
    expect(result.note).toMatch(/no probed duration/);
  });

  test("a DB failure propagates instead of reading as a clip with no pauses", async () => {
    const db = await import("../db");
    const spy = vi.spyOn(db, "readTranscript").mockRejectedValueOnce(new Error("db down"));
    await expect(run(spec, { assetId: "a1" })).rejects.toThrow("db down");
    spy.mockRestore();
  });
});
