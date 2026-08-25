import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ToolSpec } from "../registry";
import type { AnalysisKind } from "../db";

/**
 * A highlight window is a fixed 4s from its anchor, and nothing used to bound it against the media.
 * A drop 500ms before the end therefore produced a range ~3.5s past the source — and a clip whose
 * outTick exceeds its asset fails the WHOLE batch in the reducer, with no repair loop. One late
 * drop turned "make a montage of the best moments" into a hard error.
 */

let analysis: Partial<Record<AnalysisKind, Record<string, unknown> | null>> = {};
let durationMs: number | null = null;

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  readAnalysisData: async (_assetId: string, kind: AnalysisKind) => analysis[kind] ?? null,
  readAssetDurationMs: async () => durationMs,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdmin: () => ({}) }));

const { spec } = await import("./findHighlights");

interface Result {
  highlights: Array<{ startTick: number; endTick: number; reason: string }>;
  analyzed: boolean;
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

const ticks = (ms: number) => ms * 30;

beforeEach(() => {
  analysis = {};
  durationMs = null;
});

describe("windows are bounded by the media", () => {
  test("a drop near the end is clamped to the clip length, not 4s past it", async () => {
    durationMs = 10_000;
    analysis.beats = { drops_ms: [9_000] };
    const { highlights } = await run(spec, { assetId: "a1", count: 1 });
    expect(highlights).toEqual([
      { startTick: ticks(9_000), endTick: ticks(10_000), reason: "beat drop (peak energy)" },
    ]);
  });

  test("an anchor at or past the end is skipped entirely", async () => {
    durationMs = 10_000;
    analysis.beats = { drops_ms: [10_000, 15_000] };
    expect((await run(spec, { assetId: "a1", count: 3 })).highlights).toEqual([]);
  });

  test("a window clamped down to almost nothing is dropped, not returned as a frame", async () => {
    durationMs = 10_000;
    analysis.beats = { drops_ms: [9_900] }; // only 100ms of room
    expect((await run(spec, { assetId: "a1", count: 1 })).highlights).toEqual([]);
  });

  test("every returned range stays inside the clip", async () => {
    durationMs = 30_000;
    analysis.beats = { drops_ms: [1_000, 12_000, 28_500], beats_ms: [500, 29_000] };
    analysis.scenes = { cuts_ms: [0, 11_000, 27_000] };
    const { highlights } = await run(spec, { assetId: "a1", count: 12 });
    expect(highlights.length).toBeGreaterThan(0);
    for (const h of highlights) {
      expect(h.startTick).toBeGreaterThanOrEqual(0);
      expect(h.endTick).toBeLessThanOrEqual(ticks(durationMs));
      expect(h.endTick).toBeGreaterThan(h.startTick);
    }
  });
});

describe("the ranking behaviour it already had", () => {
  test("drops outrank scene starts, and starts snap back to a preceding cut", async () => {
    durationMs = 60_000;
    analysis.beats = { drops_ms: [20_000] };
    analysis.scenes = { cuts_ms: [18_000] };
    const { highlights } = await run(spec, { assetId: "a1", count: 1 });
    expect(highlights[0].startTick).toBe(ticks(18_000));
    expect(highlights[0].reason).toMatch(/snapped to scene start/);
  });

  test("overlapping windows are de-duplicated and results are chronological", async () => {
    durationMs = 60_000;
    analysis.beats = { drops_ms: [30_000, 31_000, 5_000] };
    const { highlights } = await run(spec, { assetId: "a1", count: 5 });
    expect(highlights.map((h) => h.startTick)).toEqual([ticks(5_000), ticks(30_000)]);
  });

  test("no analysis → no highlights and analyzed:false, never invented moments", async () => {
    durationMs = 60_000;
    const result = await run(spec, { assetId: "a1", count: 3 });
    expect(result.highlights).toEqual([]);
    expect(result.analyzed).toBe(false);
  });
});

describe("an unprobed duration is admitted, not papered over", () => {
  test("windows still come back, with a note that they could not be bounded", async () => {
    durationMs = null;
    analysis.beats = { drops_ms: [9_000] };
    const result = await run(spec, { assetId: "a1", count: 1 });
    expect(result.highlights).toHaveLength(1);
    expect(result.note).toMatch(/could not be bounded/);
  });
});
