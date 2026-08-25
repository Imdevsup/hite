import { BranchUnavailableError } from "./errors";
import { openAsBlob } from "node:fs";
import { mapGroqResponse, type TranscriptSegment } from "@/lib/ai/transcribe";
import { splitAudio, type AudioChunk } from "@/lib/ffmpeg/audio";

/**
 * Groq Whisper transport for the worker: chunked, and from a LOCAL extracted WAV.
 *
 * What this replaces (`transcribe-whole-video-no-chunking`): the old path fetched the whole source
 * video over the network into process memory and posted it as one multipart body, while uploads
 * were allowed up to 2 GiB and Groq refuses anything over 25 MB. Every clip past a few minutes
 * failed, and the failure had nowhere to be recorded.
 *
 * The response → storage mapping is NOT reimplemented here: `mapGroqResponse` in lib/ai/transcribe
 * already owns it (including the subtle part — word timestamps arrive as a TOP-LEVEL array in the
 * OpenAI-compatible verbose response, not nested in each segment) and has its own tests. This file
 * owns transport and reassembly only.
 */

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

/** Derived from the mapper rather than restated, so the two cannot drift. */
type GroqVerboseResponse = Parameters<typeof mapGroqResponse>[0];

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
}

/**
 * Transcribe a 16 kHz mono WAV, splitting it into chunks Groq will accept and stitching the
 * results back onto one timeline.
 */
export async function transcribeWav(
  wavPath: string,
  workDir: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Transcript> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  // Never return an empty transcript here: that would report "this video has no speech" for every
  // upload on a deployment that simply never set the key. But an absent key is a capability this
  // deployment does not have, not a video that could not be read, so it is raised as UNAVAILABLE
  // and the rest of the analysis still counts. See `BranchUnavailableError`.
  if (!apiKey) {
    throw new BranchUnavailableError(
      "transcribe",
      "GROQ_API_KEY is not set, so speech was not transcribed. Everything that depends on speech, including silence and filler-word detection, is unavailable until it is.",
    );
  }

  const chunks = await splitAudio(wavPath, workDir, { signal: opts.signal });
  const parts: Transcript[] = [];
  for (const chunk of chunks) {
    parts.push(await transcribeChunk(chunk, apiKey, opts.signal));
  }
  return stitch(parts, chunks);
}

async function transcribeChunk(chunk: AudioChunk, apiKey: string, signal?: AbortSignal): Promise<Transcript> {
  const form = new FormData();
  // `openAsBlob` streams from disk instead of reading the file into a Buffer first — the chunk is
  // already bounded, but there is no reason to hold 24 MB in the heap per concurrent analyze job.
  form.append("file", await openAsBlob(chunk.path, { type: "audio/wav" }), "audio.wav");
  form.append("model", GROQ_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch(GROQ_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  if (!res.ok) {
    // Groq's body names the actual problem (rate limit, file too large, bad model); an unadorned
    // status code is what made this branch undebuggable before.
    throw new Error(`Groq transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
  }
  return mapGroqResponse((await res.json()) as GroqVerboseResponse);
}

/**
 * Reassemble chunk transcripts onto the full recording's timeline.
 *
 * Each chunk's timestamps start at 0, so its offset — exactly `index * chunkSeconds`, because
 * `splitAudio` cuts with explicit `-ss`/`-t` rather than the drift-prone segment muxer — is added
 * back to every segment and word. Segment ids are renumbered so they stay unique and ordered
 * across the join; the stored `segments` jsonb is read by index elsewhere.
 *
 * Exported for tests: this arithmetic is the difference between captions that line up and captions
 * that are ten minutes early.
 */
export function stitch(parts: Transcript[], chunks: Pick<AudioChunk, "offsetMs">[]): Transcript {
  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const offset = chunks[i]?.offsetMs ?? 0;
    for (const segment of parts[i].segments) {
      segments.push({
        id: segments.length,
        startMs: segment.startMs + offset,
        endMs: segment.endMs + offset,
        text: segment.text,
        words: segment.words.map((w) => ({ t0Ms: w.t0Ms + offset, t1Ms: w.t1Ms + offset, word: w.word })),
      });
    }
  }
  // The language of the recording is the language of its first chunk that reported one; an empty
  // chunk (silence at the head) reports nothing useful.
  const language = parts.find((p) => p.language)?.language ?? "";
  return { language, segments };
}
