import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ToolSpec } from "../registry";
import type { AnalysisKind } from "../db";

/**
 * planCutDown's rationale is shown to the user, so it has to describe what the code actually did.
 * The beats branch used to claim it "used 128 bpm to pace" the windows while calling the same
 * bpm-blind helper as the no-analysis fallback — byte-identical output under an invented mechanism.
 * It now genuinely snaps each keep window onto a detected beat, and when it cannot, it says so.
 */

let analysis: Partial<Record<AnalysisKind, Record<string, unknown> | null>> = {};
let durationMs: number | null = null;

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  readAnalysisData: async (_assetId: string, kind: AnalysisKind) => analysis[kind] ?? null,
  readAssetDurationMs: async () => durationMs,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdmin: () => ({}) }));

const { spec } = await import("./planCutDown");

interface Result {
  keepRanges: Array<{ startTick: number; endTick: number }>;
  rationale: string;
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

beforeEach(() => {
  analysis = {};
  durationMs = null;
});

describe("the beats branch does what its rationale says", () => {
  test("every keep window STARTS on a detected beat", async () => {
    durationMs = 60_000;
    analysis.beats = { bpm: 120, beats_ms: Array.from({ length: 120 }, (_, i) => i * 500) };
    const result = await run(spec, { assetId: "a1", targetSeconds: 20 });

    expect(result.keepRanges.length).toBeGreaterThan(0);
    for (const range of result.keepRanges) {
      // startTick must be a beat: beats are every 500ms = 15000 ticks.
      expect(range.startTick % 15_000, `${range.startTick} is not on a beat`).toBe(0);
      expect(range.endTick).toBeGreaterThan(range.startTick);
    }
    expect(result.rationale).toMatch(/started each of the \d+ keep windows on a detected beat \(120 bpm\)/);
  });

  test("windows stay in order and never overlap", async () => {
    durationMs = 60_000;
    analysis.beats = { bpm: 120, beats_ms: Array.from({ length: 120 }, (_, i) => i * 500) };
    const { keepRanges } = await run(spec, { assetId: "a1", targetSeconds: 20 });
    for (let i = 1; i < keepRanges.length; i++) {
      expect(keepRanges[i].startTick).toBeGreaterThanOrEqual(keepRanges[i - 1].endTick);
    }
  });

  test("no window runs past the end of the clip", async () => {
    durationMs = 10_000;
    analysis.beats = { bpm: 120, beats_ms: [0, 500, 9_800] };
    const { keepRanges } = await run(spec, { assetId: "a1", targetSeconds: 4 });
    for (const range of keepRanges) expect(range.endTick).toBeLessThanOrEqual(30 * 10_000);
  });

  test("a bpm with NO beat times admits the pacing was even — it no longer claims otherwise", async () => {
    durationMs = 60_000;
    analysis.beats = { bpm: 128 };
    const result = await run(spec, { assetId: "a1", targetSeconds: 20 });
    expect(result.keepRanges.length).toBeGreaterThan(0);
    expect(result.rationale).toMatch(/128 bpm was detected but no usable beat times are stored/);
    expect(result.rationale).toMatch(/even keep windows/);
    expect(result.rationale).not.toMatch(/used 128 bpm to pace/);
  });
});

describe("the branches above and below it are unchanged", () => {
  test("real shot boundaries win, and the rationale counts them", async () => {
    durationMs = 60_000;
    analysis.scenes = { cuts_ms: [10_000, 25_000, 40_000] };
    analysis.beats = { bpm: 128, beats_ms: [0, 500] };
    const result = await run(spec, { assetId: "a1", targetSeconds: 30 });
    expect(result.rationale).toMatch(/on real shot boundaries/);
    expect(result.keepRanges.length).toBeGreaterThan(0);
  });

  test("no analysis at all → even windows, stated plainly", async () => {
    durationMs = 60_000;
    const result = await run(spec, { assetId: "a1", targetSeconds: 20 });
    expect(result.rationale).toMatch(/No scene or beat analysis is available/);
  });
});

describe("degenerate inputs", () => {
  test("an unprobed duration plans nothing rather than guessing a length", async () => {
    durationMs = null;
    const result = await run(spec, { assetId: "a1", targetSeconds: 20 });
    expect(result.keepRanges).toEqual([]);
    expect(result.rationale).toMatch(/no probed duration/);
  });

  test("a target at or above the clip length keeps the whole clip, in ticks", async () => {
    durationMs = 10_000;
    const result = await run(spec, { assetId: "a1", targetSeconds: 30 });
    expect(result.keepRanges).toEqual([{ startTick: 0, endTick: 300_000 }]);
  });

  test("a zero/negative target keeps nothing", async () => {
    durationMs = 10_000;
    expect((await run(spec, { assetId: "a1", targetSeconds: 0 })).keepRanges).toEqual([]);
    expect((await run(spec, { assetId: "a1", targetSeconds: -5 })).keepRanges).toEqual([]);
  });
});
