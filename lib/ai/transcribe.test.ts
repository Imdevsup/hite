import { describe, expect, test } from "vitest";
import { mapGroqResponse, bucketWordsBySegment } from "./transcribe";

/**
 * The response-shape bug that silently disabled every word-level speech feature.
 *
 * Groq's endpoint is the OpenAI-compatible `/openai/v1/audio/transcriptions`, and in that contract
 * `verbose_json` returns word timestamps in a TOP-LEVEL `words` array — segment objects carry
 * id/seek/start/end/text/tokens and no nested words (checked against the current OpenAI API
 * reference for the verbose transcription response). The mapper read `segment.words`, so every
 * stored segment got `words: []`, and "cut the ums" found nothing to cut on any video ever
 * transcribed. The fixture below is that documented shape.
 */

const verboseJson = {
  task: "transcribe",
  language: "english",
  duration: 3.2,
  text: "Um so this is the thing",
  segments: [
    { id: 0, seek: 0, start: 0, end: 1.5, text: " Um so this", tokens: [1, 2] },
    { id: 1, seek: 0, start: 1.5, end: 3.2, text: " is the thing", tokens: [3, 4] },
  ],
  words: [
    { word: "Um", start: 0.0, end: 0.4 },
    { word: "so", start: 0.4, end: 0.7 },
    { word: "this", start: 0.9, end: 1.4 },
    { word: "is", start: 1.6, end: 1.8 },
    { word: "the", start: 1.8, end: 2.0 },
    { word: "thing", start: 2.0, end: 3.2 },
  ],
};

describe("top-level `words` are bucketed back into the segments", () => {
  const mapped = mapGroqResponse(verboseJson);

  test("word timings survive the mapping (they used to be dropped entirely)", () => {
    expect(mapped.segments.flatMap((s) => s.words)).toHaveLength(6);
  });

  test("each word lands in the segment it was spoken in", () => {
    expect(mapped.segments[0].words.map((w) => w.word)).toEqual(["Um", "so", "this"]);
    expect(mapped.segments[1].words.map((w) => w.word)).toEqual(["is", "the", "thing"]);
  });

  test("seconds become milliseconds, and text is trimmed", () => {
    expect(mapped.segments[0]).toMatchObject({ id: 0, startMs: 0, endMs: 1500, text: "Um so this" });
    expect(mapped.segments[0].words[0]).toEqual({ t0Ms: 0, t1Ms: 400, word: "Um" });
    expect(mapped.language).toBe("english");
  });
});

describe("defensive against the shapes we did not verify live", () => {
  test("a provider that DOES nest words per segment still works", () => {
    const nested = {
      language: "english",
      segments: [{ id: 0, start: 0, end: 1, text: "hi", words: [{ word: "hi", start: 0, end: 1 }] }],
    };
    expect(mapGroqResponse(nested).segments[0].words).toEqual([{ t0Ms: 0, t1Ms: 1000, word: "hi" }]);
  });

  test("nested words win over the top-level array for that segment", () => {
    const both = {
      language: "english",
      segments: [{ id: 0, start: 0, end: 1, text: "hi", words: [{ word: "nested", start: 0, end: 1 }] }],
      words: [{ word: "toplevel", start: 0, end: 1 }],
    };
    expect(mapGroqResponse(both).segments[0].words[0].word).toBe("nested");
  });

  test("words with no segments at all are kept as one segment, not thrown away", () => {
    // Reported against word-only granularity: segments can come back empty. Losing the words here
    // would report "no speech" for audio that clearly had some.
    const wordsOnly = {
      language: "english",
      text: "hello there",
      words: [
        { word: "hello", start: 0.2, end: 0.6 },
        { word: "there", start: 0.6, end: 1.1 },
      ],
    };
    const mapped = mapGroqResponse(wordsOnly);
    expect(mapped.segments).toHaveLength(1);
    expect(mapped.segments[0]).toMatchObject({ startMs: 200, endMs: 1100, text: "hello there" });
    expect(mapped.segments[0].words).toHaveLength(2);
  });

  test("an empty response maps to an empty transcript rather than throwing", () => {
    expect(mapGroqResponse({ language: "english" })).toEqual({ language: "english", segments: [] });
  });

  test("segments with no words at all map to empty word lists", () => {
    const noWords = { language: "english", segments: [{ id: 0, start: 0, end: 1, text: "hi" }] };
    expect(mapGroqResponse(noWords).segments[0].words).toEqual([]);
  });
});

describe("bucketWordsBySegment", () => {
  const segments = [
    { id: 0, start: 1, end: 2, text: "a" },
    { id: 1, start: 2, end: 3, text: "b" },
  ];

  test("no word is ever dropped — one starting before the first segment falls into it", () => {
    const buckets = bucketWordsBySegment(segments, [{ word: "early", start: 0.1, end: 0.5 }]);
    expect(buckets[0].map((w) => w.word)).toEqual(["early"]);
    expect(buckets[1]).toEqual([]);
  });

  test("a word starting exactly on a segment boundary belongs to the later segment", () => {
    const buckets = bucketWordsBySegment(segments, [{ word: "edge", start: 2, end: 2.4 }]);
    expect(buckets[1].map((w) => w.word)).toEqual(["edge"]);
  });

  test("out-of-order input is sorted before bucketing", () => {
    const buckets = bucketWordsBySegment(segments, [
      { word: "late", start: 2.5, end: 2.9 },
      { word: "first", start: 1.1, end: 1.4 },
    ]);
    expect(buckets[0].map((w) => w.word)).toEqual(["first"]);
    expect(buckets[1].map((w) => w.word)).toEqual(["late"]);
  });

  test("no segments ⇒ no buckets (the caller handles that case separately)", () => {
    expect(bucketWordsBySegment([], [{ word: "x", start: 0, end: 1 }])).toEqual([]);
  });
});
