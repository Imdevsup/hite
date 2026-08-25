import { describe, expect, test } from "vitest";
import { stitch } from "./transcribe";
import type { TranscriptSegment } from "@/lib/ai/transcribe";

/**
 * Chunk reassembly. This is the arithmetic that decides whether a caption lands on the word or ten
 * minutes early, and it only exists because transcription now chunks at all — the path this
 * replaces posted the entire source video as one body and simply failed for anything long.
 */

function segment(id: number, startMs: number, endMs: number, text: string): TranscriptSegment {
  return {
    id,
    startMs,
    endMs,
    text,
    words: [{ t0Ms: startMs, t1Ms: endMs, word: text }],
  };
}

describe("stitch", () => {
  test("adds each chunk's offset to every segment AND every word", () => {
    const result = stitch(
      [
        { language: "en", segments: [segment(0, 0, 1_000, "first")] },
        { language: "en", segments: [segment(0, 500, 1_500, "second")] },
      ],
      [{ offsetMs: 0 }, { offsetMs: 600_000 }],
    );

    expect(result.segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 1_000],
      [600_500, 601_500],
    ]);
    // The word timings are what the caption renderer reads; leaving them chunk-relative would put
    // every word of chunk 2 at the start of the video.
    expect(result.segments[1].words).toEqual([{ t0Ms: 600_500, t1Ms: 601_500, word: "second" }]);
  });

  test("renumbers segment ids so they stay unique and ordered across the join", () => {
    const result = stitch(
      [
        { language: "en", segments: [segment(0, 0, 100, "a"), segment(1, 100, 200, "b")] },
        { language: "en", segments: [segment(0, 0, 100, "c")] },
      ],
      [{ offsetMs: 0 }, { offsetMs: 1_000 }],
    );
    expect(result.segments.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(result.segments.map((s) => s.text)).toEqual(["a", "b", "c"]);
  });

  test("a single chunk is passed through unchanged", () => {
    const result = stitch([{ language: "fr", segments: [segment(0, 250, 900, "bonjour")] }], [{ offsetMs: 0 }]);
    expect(result.language).toBe("fr");
    expect(result.segments).toEqual([
      { id: 0, startMs: 250, endMs: 900, text: "bonjour", words: [{ t0Ms: 250, t1Ms: 900, word: "bonjour" }] },
    ]);
  });

  test("takes the language from the first chunk that reported one", () => {
    // A recording that opens with silence gets an empty first chunk; the language is still known.
    const result = stitch(
      [
        { language: "", segments: [] },
        { language: "de", segments: [segment(0, 0, 500, "hallo")] },
      ],
      [{ offsetMs: 0 }, { offsetMs: 600_000 }],
    );
    expect(result.language).toBe("de");
  });

  test("a recording with no speech at all yields no segments, not a fabricated one", () => {
    expect(stitch([{ language: "", segments: [] }], [{ offsetMs: 0 }])).toEqual({ language: "", segments: [] });
    expect(stitch([], [])).toEqual({ language: "", segments: [] });
  });

  test("a missing offset entry falls back to 0 rather than producing NaN timings", () => {
    // Defensive: a NaN timestamp poisons the whole transcript silently, where a 0 is merely wrong
    // in a way the next assertion catches.
    const result = stitch([{ language: "en", segments: [segment(0, 10, 20, "x")] }], []);
    expect(result.segments[0].startMs).toBe(10);
  });
});
