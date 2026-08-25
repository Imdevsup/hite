/**
 * Groq Whisper Large v3 Turbo — fast transcription with word-level timestamps. For clips over
 * 15 minutes, chunk by ffmpeg segmenting first (handled by the calling workflow step).
 *
 * Returns segments compatible with the `transcript.segments jsonb` column:
 *   [{ startMs, endMs, text, words: [{t0Ms, t1Ms, word}] }]
 *
 * RESPONSE SHAPE — the thing this file gets wrong if you guess. Groq's endpoint is the
 * OpenAI-compatible `/openai/v1/audio/transcriptions`, and in that contract `verbose_json` returns
 * word timestamps as a TOP-LEVEL `words` array; segment objects carry id/seek/start/end/text/tokens
 * and NO nested words (verified against the current OpenAI API reference for the transcription
 * verbose response). Reading `segment.words` therefore found nothing, every stored segment got
 * `words: []`, and every word-level feature — "cut the ums", word-timed captions — silently
 * returned nothing to cut. We now read the top-level array and bucket it back into the segments,
 * while still honouring a nested `words` if a provider supplies one.
 */

interface GroqWord {
  word: string;
  start: number; // seconds
  end: number;
}

interface GroqSegment {
  id: number;
  start: number; // seconds
  end: number;
  text: string;
  /** Not part of the OpenAI-compatible contract; honoured if a provider ever nests them. */
  words?: GroqWord[];
}

interface GroqVerboseResponse {
  language: string;
  text?: string;
  duration?: number;
  segments?: GroqSegment[];
  /** Where word timestamps actually live in the OpenAI-compatible verbose_json response. */
  words?: GroqWord[];
}

export interface TranscriptSegment {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
  words: { t0Ms: number; t1Ms: number; word: string }[];
}

const toMs = (seconds: number): number => Math.round(seconds * 1000);

const mapWords = (words: GroqWord[]): TranscriptSegment["words"] =>
  words.map((w) => ({ t0Ms: toMs(w.start), t1Ms: toMs(w.end), word: w.word }));

/**
 * Assign each top-level word to the segment it was spoken in: the last segment that starts at or
 * before the word. Words ahead of the first segment fall into it, so no word is ever dropped.
 * Exported for tests — this mapping is the whole point of the file.
 */
export function bucketWordsBySegment(segments: GroqSegment[], words: GroqWord[]): GroqWord[][] {
  const buckets: GroqWord[][] = segments.map(() => []);
  if (segments.length === 0) return buckets;
  let index = 0;
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    while (index + 1 < segments.length && segments[index + 1].start <= word.start) index += 1;
    buckets[index].push(word);
  }
  return buckets;
}

/*
 * `transcribeGroq` used to live here: it fetched the whole media file, buffered it into memory and
 * posted it to Groq as a single multipart body — with sign-time allowing 2 GiB uploads, that was an
 * OOM waiting for a long clip, and it never chunked despite this file's own header claiming it did.
 * Its only caller was the deleted analyze workflow. The worker replaced it (worker/transcribe.ts):
 * ffmpeg extracts 16 kHz mono audio and chunks it under Groq's limit before any upload happens.
 * What survives here is the pure part — the response mapping — which the worker still uses.
 */

/** Pure — the response → storage mapping, exported so it can be tested against a real fixture. */
export function mapGroqResponse(json: GroqVerboseResponse): { language: string; segments: TranscriptSegment[] } {
  const segments = [...(json.segments ?? [])].sort((a, b) => a.start - b.start);
  const topLevelWords = json.words ?? [];

  // Word-only granularity can come back with no segments at all; keep the words rather than
  // reporting an empty transcript for audio that clearly had speech.
  if (segments.length === 0 && topLevelWords.length > 0) {
    const sorted = [...topLevelWords].sort((a, b) => a.start - b.start);
    return {
      language: json.language,
      segments: [
        {
          id: 0,
          startMs: toMs(sorted[0].start),
          endMs: toMs(sorted[sorted.length - 1].end),
          text: (json.text ?? sorted.map((w) => w.word).join(" ")).trim(),
          words: mapWords(sorted),
        },
      ],
    };
  }

  const buckets = bucketWordsBySegment(segments, topLevelWords);
  return {
    language: json.language,
    segments: segments.map((s, i) => ({
      id: s.id,
      startMs: toMs(s.start),
      endMs: toMs(s.end),
      text: s.text.trim(),
      // A nested `words` wins when present; otherwise use this segment's share of the top-level array.
      words: mapWords(s.words ?? buckets[i]),
    })),
  };
}
