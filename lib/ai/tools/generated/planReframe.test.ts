import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ToolSpec } from "../registry";

/**
 * The tool answered "No faces detected. Center-crop to 9:16" for an analysis that has never run in
 * this build — a measurement nothing performed, handed to the planner as a finding, which is the one
 * thing this repo forbids. What it says now has to distinguish the two cases the way `detectFaces`
 * and `findSilences` do: NOTHING LOOKED, versus something looked and found nobody.
 */

let facesRow: Record<string, unknown> | null = null;

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  readAnalysisData: async () => facesRow,
}));

const { spec } = await import("./planReframe");

interface Result {
  aspect: string;
  analyzed: boolean;
  strategy: string;
  note?: string;
  anchorFaceId?: string;
}

/** Invoke the REGISTERED tool the way the planner does, including the scope the IDOR guard needs. */
async function run(toolSpec: ToolSpec, input: unknown): Promise<Result> {
  const execute = toolSpec.tool.execute;
  if (!execute) throw new Error(`${toolSpec.name} has no execute`);
  const experimental_context = { allowedAssetIds: [String((input as { assetId?: string }).assetId)] };
  return (await execute(input, { toolCallId: "t", messages: [], experimental_context })) as Result;
}

const track = (faceId: string, fromMs: number, toMs: number, conf: number) => ({
  faceId,
  frames: [
    { t_ms: fromMs, conf },
    { t_ms: toMs, conf },
  ],
});

beforeEach(() => {
  facesRow = null;
});

describe("planReframe reports what was measured, not what would be convenient", () => {
  test("with NO face analysis row it says nothing looked, and never claims the clip has no faces", async () => {
    // This is every clip in this build: `worker/analyze.ts` has no face branch at all.
    const result = await run(spec, { assetId: "a1", aspect: "9:16" });
    expect(result.analyzed).toBe(false);
    expect(result.note).toMatch(/no face analysis exists/i);
    // The old sentence, and the reason this test exists.
    expect(result.strategy.toLowerCase()).not.toContain("no faces detected");
    // The plan is still useful — it is just labelled as the default it is.
    expect(result.strategy).toMatch(/center-crop/i);
    expect(result.anchorFaceId).toBeUndefined();
  });

  test("an analysis that RAN and found nobody is a different answer, and says so plainly", async () => {
    facesRow = { tracks: [] };
    const result = await run(spec, { assetId: "a1", aspect: "1:1" });
    expect(result.analyzed).toBe(true);
    expect(result.strategy).toMatch(/no face track was detected/i);
    expect(result.note).toBeUndefined();
  });

  test("a malformed row is not a face — it falls back rather than anchoring on garbage", async () => {
    facesRow = { tracks: [{ faceId: 7, frames: "soon" }] };
    const result = await run(spec, { assetId: "a1", aspect: "9:16" });
    expect(result.analyzed).toBe(true);
    expect(result.anchorFaceId).toBeUndefined();
  });

  test("real tracks anchor on the longest-lived one, and return its id", async () => {
    facesRow = { tracks: [track("face-brief", 0, 500, 0.99), track("face-main", 0, 9_000, 0.8)] };
    const result = await run(spec, { assetId: "a1", aspect: "9:16" });
    expect(result.analyzed).toBe(true);
    expect(result.anchorFaceId).toBe("face-main");
    expect(result.strategy).toContain("face-main");
  });
});
