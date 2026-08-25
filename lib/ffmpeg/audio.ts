import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ffmpegPath } from "./bin";
import { runBinary } from "./run";

/**
 * Audio extraction + chunking, shared by transcription and beat detection.
 *
 * Both branches need the same thing — the soundtrack as plain mono PCM — so it is decoded ONCE per
 * analyze job and both read the same file.
 *
 * Why 16 kHz mono, and why before transcription: the previous path fetched the whole SOURCE VIDEO
 * into function memory and posted it as a single multipart body while the upload path allowed 5 GB
 * (`transcribe-whole-video-no-chunking`). A 2 GB MP4 is ~4 MB of 16 kHz mono PCM per two minutes,
 * and Whisper resamples to 16 kHz internally anyway, so extracting first is both smaller and
 * lossless with respect to the model's input.
 */

/** Whisper's own input rate. Anything higher is discarded by the model and costs upload bytes. */
export const ANALYSIS_SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2; // pcm_s16le, mono

/**
 * Groq's transcription endpoint refuses bodies over 25 MB on the free tier. At 32 kB/s (16 kHz
 * mono s16) that is ~13 minutes, so chunks are cut at 10 minutes for headroom and each one is
 * size-checked before it is sent — a cap that is only "probably" respected is not a cap.
 */
export const TRANSCRIBE_CHUNK_SECONDS = 600;
export const TRANSCRIBE_MAX_CHUNK_BYTES = 24 * 1024 * 1024;

export interface AudioChunk {
  path: string;
  /** Offset of this chunk within the full recording, in ms. Added back to every timestamp. */
  offsetMs: number;
  bytes: number;
}

/**
 * Decode any input's audio to a 16 kHz mono 16-bit WAV. Throws (via `runBinary`) with ffmpeg's own
 * stderr when the input has no audio stream or cannot be decoded — callers check `hasAudio` from
 * the probe first, so reaching that throw means the file lied about its own streams.
 */
export async function extractAudioWav(
  input: string,
  outPath: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  await runBinary(
    ffmpegPath(),
    [
      "-nostdin", "-y", "-v", "error",
      "-i", input,
      "-vn", "-map", "0:a:0",
      "-ac", "1",
      "-ar", String(ANALYSIS_SAMPLE_RATE),
      "-c:a", "pcm_s16le",
      "-f", "wav",
      outPath,
    ],
    opts,
  );
  return outPath;
}

/**
 * Split a WAV into chunks no longer than `chunkSeconds`.
 *
 * Cut with an explicit `-ss`/`-t` per chunk rather than the segment muxer: the segment muxer splits
 * on packet boundaries, so the real chunk start drifts from the requested one and every timestamp
 * in that chunk is then offset by an unknown amount. Here the offset is exactly `index *
 * chunkSeconds`, which is what makes the reassembled transcript's timings correct.
 *
 * A file already under the limit is returned as-is (one chunk, offset 0) — no needless re-encode.
 *
 * The length is read from the WAV ITSELF rather than taken from the caller's probe. A container
 * whose duration ffprobe could not read yields `durationMs: null` by design, and a 0 there would
 * make the chunk count 0 — producing an empty chunk list, an empty transcript, and a job that
 * reports "this recording has no speech" for a file nobody ever looked at.
 */
export async function splitAudio(
  wavPath: string,
  outDir: string,
  opts: { chunkSeconds?: number; maxChunkBytes?: number; signal?: AbortSignal } = {},
): Promise<AudioChunk[]> {
  const chunkSeconds = opts.chunkSeconds ?? TRANSCRIBE_CHUNK_SECONDS;
  const maxChunkBytes = opts.maxChunkBytes ?? TRANSCRIBE_MAX_CHUNK_BYTES;

  const wholeBytes = (await stat(wavPath)).size;
  const durationMs = await wavDurationMs(wavPath);
  if (durationMs <= chunkSeconds * 1000 && wholeBytes <= maxChunkBytes) {
    return [{ path: wavPath, offsetMs: 0, bytes: wholeBytes }];
  }

  const chunks: AudioChunk[] = [];
  const count = Math.ceil(durationMs / (chunkSeconds * 1000));
  for (let i = 0; i < count; i++) {
    const path = join(outDir, `chunk-${String(i).padStart(3, "0")}.wav`);
    await runBinary(
      ffmpegPath(),
      [
        "-nostdin", "-y", "-v", "error",
        "-ss", String(i * chunkSeconds),
        "-t", String(chunkSeconds),
        "-i", wavPath,
        "-c:a", "pcm_s16le", "-f", "wav",
        path,
      ],
      { signal: opts.signal },
    );
    const bytes = (await stat(path)).size;
    // A chunk over the cap cannot be sent, and silently sending it anyway is how a 413 becomes
    // "this video has no speech". Fail loud and name the number.
    if (bytes > maxChunkBytes) {
      throw new Error(
        `audio chunk ${i} is ${bytes} bytes, over the ${maxChunkBytes}-byte transcription limit — ` +
          `lower TRANSCRIBE_CHUNK_SECONDS (currently ${chunkSeconds}s)`,
      );
    }
    chunks.push({ path, offsetMs: i * chunkSeconds * 1000, bytes });
  }
  return chunks;
}

export interface Pcm {
  sampleRate: number;
  /** Mono samples in [-1, 1). */
  samples: Float32Array;
}

interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataStart: number;
  dataLength: number;
}

/**
 * Parse the RIFF chunk list. Walks the chunks rather than assuming the canonical 44-byte header —
 * ffmpeg emits a `LIST`/`INFO` chunk before `data` for some inputs, and a fixed offset would then
 * read metadata bytes as audio and hand the beat detector noise.
 */
function parseWavHeader(buf: Buffer, path: string): WavFormat {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  let cursor = 12;
  while (cursor + 8 <= buf.length) {
    const id = buf.toString("ascii", cursor, cursor + 4);
    const size = buf.readUInt32LE(cursor + 4);
    const body = cursor + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataStart = body;
      // A streamed WAV can carry size 0 / 0xFFFFFFFF; trust the file length in that case.
      dataLength = size > 0 && body + size <= buf.length ? size : buf.length - body;
      break;
    }
    cursor = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataStart < 0) throw new Error(`${path} has no RIFF data chunk`);
  if (bitsPerSample !== 16) throw new Error(`${path} is ${bitsPerSample}-bit; the analyzer decodes 16-bit PCM`);
  if (channels < 1) throw new Error(`${path} reports ${channels} channels`);
  if (sampleRate < 1) throw new Error(`${path} reports a ${sampleRate} Hz sample rate`);
  return { sampleRate, channels, bitsPerSample, dataStart, dataLength };
}

/**
 * Duration of a PCM WAV, computed from its own header and byte length. Reads only the first 4 KB,
 * so it costs nothing on a multi-hour recording.
 */
export async function wavDurationMs(path: string): Promise<number> {
  const size = (await stat(path)).size;
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(4096, size));
    await handle.read(head, 0, head.length, 0);
    const fmt = parseWavHeader(head, path);
    // The header's own data length is capped by the head buffer, so derive it from the file size.
    const bytes = size - fmt.dataStart;
    return Math.round((bytes / (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8))) * 1000);
  } finally {
    await handle.close();
  }
}

/**
 * The longest recording beat detection will load.
 *
 * Decoding holds the whole signal in memory (a Buffer plus a Float32Array), and the 50 MiB upload
 * cap bounds the FILE, not the running time: low-bitrate speech reaches many hours inside it, and a
 * 24-hour recording — which `asset_probe_sane` permits — is ~2.7 GB of 16 kHz PCM and would
 * OOM-kill the WORKER rather than fail the job. A stated cap fails one branch with a
 * sentence the user can act on; branch isolation means transcription (which chunks, and has no such
 * limit) still runs on the same file.
 */
export const MAX_BEATS_ANALYSIS_MS = 60 * 60 * 1000; // 1 hour ≈ 115 MB of 16 kHz mono PCM

/**
 * Read a 16-bit PCM WAV into normalised mono floats.
 *
 * `maxDurationMs` is a parameter rather than a constant so the refusal can be exercised against a
 * real file: a test that had to synthesize an hour of audio to reach the bound would not be run.
 */
export async function readWavPcm(path: string, opts: { maxDurationMs?: number } = {}): Promise<Pcm> {
  const maxDurationMs = opts.maxDurationMs ?? MAX_BEATS_ANALYSIS_MS;
  const durationMs = await wavDurationMs(path);
  if (durationMs > maxDurationMs) {
    throw new Error(
      `beat detection reads at most ${formatMinutes(maxDurationMs)} of audio; ` +
        `this recording is ${formatMinutes(durationMs)}`,
    );
  }

  const buf = await readFile(path);
  const { sampleRate, channels, dataStart, dataLength } = parseWavHeader(buf, path);

  const frames = Math.floor(dataLength / (BYTES_PER_SAMPLE * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    // Downmix defensively: extractAudioWav always writes mono, but averaging is correct for any
    // channel count, and a stereo file read as mono would be interpreted as double-rate noise.
    let sum = 0;
    const base = dataStart + i * BYTES_PER_SAMPLE * channels;
    for (let c = 0; c < channels; c++) sum += buf.readInt16LE(base + c * BYTES_PER_SAMPLE);
    samples[i] = sum / channels / 32768;
  }
  return { sampleRate, samples };
}

/** "90 minutes" / "45 seconds" — a bound stated in the units the user thinks in. */
function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.round(ms / 1000)} seconds`;
}
