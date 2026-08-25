import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ToolSpec } from "../registry";
import type { StoredTranscript, StoredTranscriptSegment } from "../db";

/**
 * The filler list used to include "like", "so", "actually", "literally" and "basically"
 * unconditionally, so "I like this camera so much" came back as two cut windows and the export
 * butchered the sentence. These tests pin the rule that replaced it: non-lexical fillers are always
 * reported, ordinary words only with a disfluency signal, and every hit says which rule fired.
 */

let transcript: StoredTranscript | null = null;

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  readTranscript: async () => transcript,
}));

const { spec } = await import("./findFillerWords");

interface Filler {
  startTick: number;
  endTick: number;
  word: string;
  rule: string;
  confident: boolean;
}
interface Result {
  fillers: Filler[];
  note?: string;
  confidentCount?: number;
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

/** Build a segment from words laid out at explicit ms positions. */
function segment(words: Array<[string, number, number]>): StoredTranscriptSegment {
  return {
    startMs: words[0][1],
    endMs: words[words.length - 1][2],
    text: words.map(([w]) => w).join(" "),
    words: words.map(([word, t0Ms, t1Ms]) => ({ word, t0Ms, t1Ms })),
  };
}

/** Continuous speech: every word butts against the next, so nothing has a pause signal. */
function fluentSpeech(sentence: string, startMs = 0, wordMs = 200): StoredTranscriptSegment {
  return segment(
    sentence.split(" ").map((word, i) => [word, startMs + i * wordMs, startMs + (i + 1) * wordMs] as [string, number, number]),
  );
}

beforeEach(() => {
  transcript = null;
});

describe("ordinary words are not cut just for existing", () => {
  test('"I like this camera so much" — spoken fluently — yields NO fillers', async () => {
    transcript = { language: "en", segments: [fluentSpeech("I like this camera so much")] };
    const result = await run(spec, { assetId: "a1" });
    expect(result.fillers).toEqual([]);
  });

  test('"so that means the whole thing basically works" is left alone too', async () => {
    transcript = { language: "en", segments: [fluentSpeech("so that means the whole thing basically works")] };
    expect((await run(spec, { assetId: "a1" })).fillers).toEqual([]);
  });
});

describe("non-lexical fillers are always reported", () => {
  test("um / uh are flagged as confident even mid-sentence with no pause", async () => {
    transcript = { language: "en", segments: [fluentSpeech("I um think uh yes")] };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers.map((f) => f.word)).toEqual(["um", "uh"]);
    expect(fillers.every((f) => f.confident)).toBe(true);
    expect(fillers[0].rule).toBe("non-lexical filler");
  });

  test('the fixed phrases "you know" / "i mean" are flagged as one window each', async () => {
    transcript = { language: "en", segments: [fluentSpeech("it is you know fine i mean fine")] };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers.map((f) => f.word)).toEqual(["you know", "i mean"]);
    expect(fillers.every((f) => f.confident)).toBe(true);
  });

  test("a phrase window spans both words and the inner word is not double-counted", async () => {
    // "you" at 0-200ms, "know" at 200-400ms → one window [0, 400ms) = [0, 12000) ticks.
    transcript = { language: "en", segments: [fluentSpeech("you know")] };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers).toHaveLength(1);
    expect(fillers[0]).toMatchObject({ startTick: 0, endTick: 12_000 });
  });
});

describe("discourse words need a supporting signal, and the signal is stated", () => {
  test('"so" after a 500ms pause is reported, but not as confident', async () => {
    transcript = {
      language: "en",
      segments: [segment([["and", 0, 400], ["so", 900, 1100], ["yeah", 1100, 1300]])],
    };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers).toHaveLength(1);
    expect(fillers[0].word).toBe("so");
    expect(fillers[0].confident).toBe(false);
    expect(fillers[0].rule).toMatch(/discourse word, preceded by a 500ms pause/);
  });

  test("an immediate repetition counts as a stutter", async () => {
    transcript = {
      language: "en",
      segments: [segment([["its", 0, 200], ["like", 200, 400], ["like", 400, 600], ["that", 600, 800]])],
    };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers).toHaveLength(1);
    expect(fillers[0].rule).toMatch(/immediately repeated/);
    expect(fillers[0].confident).toBe(false);
  });

  test("a pause AFTER the word also counts", async () => {
    transcript = {
      language: "en",
      segments: [segment([["its", 0, 200], ["actually", 200, 600], ["fine", 1200, 1400]])],
    };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers.map((f) => f.word)).toEqual(["actually"]);
    expect(fillers[0].rule).toMatch(/followed by a 600ms pause/);
  });

  test("confidentCount lets the planner tell the safe cuts from the judgement calls", async () => {
    transcript = {
      language: "en",
      segments: [segment([["um", 0, 200], ["so", 900, 1100], ["fine", 1100, 1300]])],
    };
    const result = await run(spec, { assetId: "a1" });
    expect(result.fillers).toHaveLength(2);
    expect(result.confidentCount).toBe(1);
  });
});

describe("time and shape", () => {
  test("windows are TICKS — the tool converts, the model never multiplies by 30", async () => {
    transcript = { language: "en", segments: [segment([["um", 1000, 1200]])] };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers[0]).toMatchObject({ startTick: 30_000, endTick: 36_000 });
  });

  test("words are read across segment boundaries, so a straddling pause is still seen", async () => {
    transcript = {
      language: "en",
      segments: [segment([["right", 0, 400]]), segment([["so", 1000, 1200], ["anyway", 1200, 1600]])],
    };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers.map((f) => f.word)).toEqual(["so"]);
  });

  test("results are sorted by start time", async () => {
    transcript = {
      language: "en",
      segments: [segment([["uh", 5000, 5200]]), segment([["um", 100, 300]])],
    };
    const { fillers } = await run(spec, { assetId: "a1" });
    expect(fillers.map((f) => f.startTick)).toEqual([3_000, 150_000]);
  });
});

describe("absence is reported as absence, never as 'there are none'", () => {
  test("no transcript → empty list WITH a note that says why", async () => {
    transcript = null;
    const result = await run(spec, { assetId: "a1" });
    expect(result.fillers).toEqual([]);
    expect(result.note).toMatch(/No transcript exists/);
    expect(result.note).toMatch(/Do not claim there are none/);
  });

  test("segments but no word timings → a DIFFERENT note (this is what the Groq bug looked like)", async () => {
    transcript = { language: "en", segments: [{ startMs: 0, endMs: 5000, text: "um so yeah", words: [] }] };
    const result = await run(spec, { assetId: "a1" });
    expect(result.fillers).toEqual([]);
    expect(result.note).toMatch(/no word-level timings/);
  });

  test("a DB failure propagates instead of looking like a clean transcript", async () => {
    const boom = new Error("db down");
    transcript = null;
    const original = await import("../db");
    const spy = vi.spyOn(original, "readTranscript").mockRejectedValueOnce(boom);
    await expect(run(spec, { assetId: "a1" })).rejects.toThrow("db down");
    spy.mockRestore();
  });
});
