import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { probeMedia, normalizeProbe, parseFps } from "./probe";
import { MAX_BEATS_ANALYSIS_MS, extractAudioWav, readWavPcm, splitAudio, wavDurationMs } from "./audio";
import { analyzeBeatsFromWav, analyzeBeats } from "./beats";
import { analyzeScenes, parseSceneTimes, buildScenes } from "./scenes";
import { concatClips, fixtureDir, makeClickTrack, makeSolidColorClip, makeTestClip } from "./fixtures";
import { FfmpegError, runBinary, describeArgs, tail } from "./run";
import { ffmpegPath } from "./bin";

/**
 * The analyzer's falsifiable oracles.
 *
 * Every case below synthesizes an input whose correct answer is arithmetic, so a detector that
 * returns garbage FAILS rather than passing on "it returned an array". This is the discipline the
 * pipeline it replaces never had: the Python analyzers were never executed once, in any
 * environment, before they shipped.
 *
 * These shell out to a real ffmpeg (the `ffmpeg-static` binary) and take a few seconds. Fixtures
 * are written to the OS temp directory and removed afterwards; nothing lands in the repo.
 */

let dir: string;

beforeAll(async () => {
  dir = await fixtureDir("hite-analysis-");
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("probe", () => {
  test("a synthesized 7.0s 640x360 30fps clip measures exactly that", async () => {
    const clip = await makeTestClip(dir, { name: "seven.mp4", seconds: 7, width: 640, height: 360, fps: 30, withAudio: true });
    const probe = await probeMedia(clip);
    expect(probe.durationMs).toBeGreaterThanOrEqual(6_950);
    expect(probe.durationMs).toBeLessThanOrEqual(7_050);
    expect(probe.width).toBe(640);
    expect(probe.height).toBe(360);
    expect(probe.fps).toBe(30);
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true);
  }, 60_000);

  test("an audio-only file reports no video and no fps", async () => {
    const wav = await makeClickTrack(dir, 120, 4);
    const probe = await probeMedia(wav);
    expect(probe.hasVideo).toBe(false);
    expect(probe.hasAudio).toBe(true);
    expect(probe.fps).toBeNull();
    expect(probe.width).toBeNull();
    expect(probe.durationMs).toBeGreaterThan(3_900);
  }, 60_000);

  test("an unreadable duration is null, never a plausible default", () => {
    // The whole reason `asset_probe_sane` exists: a fabricated 10s duration silently truncated
    // real footage. Absent measurements must stay absent.
    expect(normalizeProbe({ streams: [], format: {} }).durationMs).toBeNull();
    expect(normalizeProbe({ streams: [{ codec_type: "video", width: 0, height: 0 }] }).width).toBeNull();
  });

  test("fps of 0/0 (unknown) is null, not zero", () => {
    expect(parseFps("0/0")).toBeNull();
    expect(parseFps("30000/1001")).toBe(29.97);
    expect(parseFps(undefined)).toBeNull();
  });
});

describe("beats", () => {
  test("a click track at exactly 120 BPM reports 120 bpm and ~500ms spacing", async () => {
    const click = await makeClickTrack(dir, 120, 20);
    const wav = await extractAudioWav(click, join(dir, "click120-16k.wav"));
    const beats = await analyzeBeatsFromWav(wav);

    expect(beats.bpm).toBeGreaterThan(118);
    expect(beats.bpm).toBeLessThan(122);
    // 20s at 2 beats/s ⇒ ~40 beats. Allow slack at the head and tail of the envelope.
    expect(beats.beats_ms.length).toBeGreaterThanOrEqual(35);
    const spacings = beats.beats_ms.slice(1).map((b, i) => b - beats.beats_ms[i]);
    const median = [...spacings].sort((a, b) => a - b)[Math.floor(spacings.length / 2)];
    expect(median).toBeGreaterThan(480);
    expect(median).toBeLessThan(520);
    // Every beat lands on a real onset, not on a grid drawn over silence.
    expect(beats.onsets_ms.length).toBeGreaterThanOrEqual(beats.beats_ms.length - 2);
  }, 120_000);

  test("a click track at 90 BPM is not snapped to the 120 BPM prior", async () => {
    const click = await makeClickTrack(dir, 90, 20);
    const wav = await extractAudioWav(click, join(dir, "click90-16k.wav"));
    const beats = await analyzeBeatsFromWav(wav);
    expect(beats.bpm).toBeGreaterThan(88);
    expect(beats.bpm).toBeLessThan(92);
    const spacings = beats.beats_ms.slice(1).map((b, i) => b - beats.beats_ms[i]);
    const median = [...spacings].sort((a, b) => a - b)[Math.floor(spacings.length / 2)];
    expect(median).toBeGreaterThan(645);
    expect(median).toBeLessThan(690);
  }, 120_000);

  test("silence reports no tempo rather than a plausible one", () => {
    const beats = analyzeBeats({ sampleRate: 16_000, samples: new Float32Array(16_000 * 5) });
    expect(beats.bpm).toBe(0);
    expect(beats.beats_ms).toEqual([]);
    expect(beats.onsets_ms).toEqual([]);
  });

  test("an input too short to analyze reports nothing rather than throwing", () => {
    expect(analyzeBeats({ sampleRate: 16_000, samples: new Float32Array(16) }).bpm).toBe(0);
  });

  test("band energies are a real measurement of the signal", () => {
    // A 1 kHz tone is mid-band by definition (250 Hz–4 kHz).
    const sampleRate = 16_000;
    const samples = new Float32Array(sampleRate * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    const { bands } = analyzeBeats({ sampleRate, samples });
    expect(bands.mid).toBeGreaterThan(0.9);
    expect(bands.low + bands.mid + bands.high).toBeCloseTo(1, 2);
  });
});

describe("audio extraction", () => {
  test("extracts 16 kHz mono PCM regardless of the source rate", async () => {
    const click = await makeClickTrack(dir, 120, 4); // written at 44.1 kHz
    const wav = await extractAudioWav(click, join(dir, "rate-check.wav"));
    const pcm = await readWavPcm(wav);
    expect(pcm.sampleRate).toBe(16_000);
    expect(pcm.samples.length).toBeGreaterThan(16_000 * 3.5);
    expect(pcm.samples.length).toBeLessThan(16_000 * 4.5);
  }, 60_000);

  test("splits into chunks at exact offsets when the recording is over the limit", async () => {
    const click = await makeClickTrack(dir, 120, 6);
    const wav = await extractAudioWav(click, join(dir, "split-src.wav"));
    const chunks = await splitAudio(wav, dir, { chunkSeconds: 2 });
    expect(chunks.map((c) => c.offsetMs)).toEqual([0, 2_000, 4_000]);
    for (const chunk of chunks) {
      const pcm = await readWavPcm(chunk.path);
      expect(pcm.sampleRate).toBe(16_000);
      expect(pcm.samples.length).toBeGreaterThan(0);
    }
  }, 120_000);

  test("a recording under the limit is passed through as one chunk, not re-encoded", async () => {
    const click = await makeClickTrack(dir, 120, 3);
    const wav = await extractAudioWav(click, join(dir, "single-chunk.wav"));
    const chunks = await splitAudio(wav, dir, { chunkSeconds: 600 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].path).toBe(wav);
    expect(chunks[0].offsetMs).toBe(0);
  }, 60_000);

  test("a chunk that would exceed the byte cap fails loud instead of being sent", async () => {
    const click = await makeClickTrack(dir, 120, 4);
    const wav = await extractAudioWav(click, join(dir, "cap-check.wav"));
    await expect(splitAudio(wav, dir, { chunkSeconds: 2, maxChunkBytes: 1_000 })).rejects.toThrow(
      /over the 1000-byte transcription limit/,
    );
  }, 60_000);

  test("the chunk count comes from the WAV itself, so an unreadable probe cannot empty it", async () => {
    // The hole this closes: taking the length from the caller's probe meant a container ffprobe
    // could not measure (`durationMs: null` → 0) produced ZERO chunks, an empty transcript, and a
    // job reporting "no speech" for a file nothing ever read.
    const click = await makeClickTrack(dir, 120, 6);
    const wav = await extractAudioWav(click, join(dir, "derived-length.wav"));
    expect(await wavDurationMs(wav)).toBeGreaterThan(5_500);
    // Forced past the single-chunk path by the byte cap; the count must still come out right.
    const chunks = await splitAudio(wav, dir, { chunkSeconds: 3, maxChunkBytes: 10_000_000 });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.offsetMs)).toEqual([0, 3_000]);
  }, 120_000);

  test("beat detection refuses a recording too long to hold in memory", async () => {
    // Decoding holds the whole signal in RAM. A 24-hour upload — which `asset_probe_sane` permits —
    // is ~2.7 GB of 16 kHz PCM and would OOM-KILL THE WORKER rather than fail one job. The bound is
    // exercised here against a real file by lowering it, not by synthesizing an hour of audio.
    const click = await makeClickTrack(dir, 120, 4);
    const wav = await extractAudioWav(click, join(dir, "too-long.wav"));

    await expect(readWavPcm(wav, { maxDurationMs: 1_000 })).rejects.toThrow(
      /beat detection reads at most 1 seconds of audio; this recording is 4 seconds/,
    );
    // The same file under the real cap reads fine — the refusal is the length, not the file.
    expect(MAX_BEATS_ANALYSIS_MS).toBe(60 * 60 * 1000);
    await expect(readWavPcm(wav)).resolves.toMatchObject({ sampleRate: 16_000 });
  }, 60_000);
});

describe("scenes", () => {
  test("3s red concatenated with 3s blue is exactly one cut at ~3000ms", async () => {
    const red = await makeSolidColorClip(dir, "red", { seconds: 3 });
    const blue = await makeSolidColorClip(dir, "blue", { seconds: 3 });
    const spliced = await concatClips(dir, [red, blue], "red-blue.mp4");

    const probe = await probeMedia(spliced);
    const scenes = await analyzeScenes(spliced, probe.durationMs ?? 0);

    expect(scenes.cuts_ms).toHaveLength(1);
    expect(scenes.cuts_ms[0]).toBeGreaterThan(2_900);
    expect(scenes.cuts_ms[0]).toBeLessThan(3_100);
    expect(scenes.scenes_ms).toHaveLength(2);
    expect(scenes.scenes_ms[0][0]).toBe(0);
    expect(scenes.scenes_ms[1][1]).toBe(scenes.duration_ms);
  }, 120_000);

  test("a single unbroken shot reports no cuts", async () => {
    const green = await makeSolidColorClip(dir, "green", { seconds: 4 });
    const probe = await probeMedia(green);
    const scenes = await analyzeScenes(green, probe.durationMs ?? 0);
    expect(scenes.cuts_ms).toEqual([]);
    expect(scenes.scenes_ms).toEqual([[0, scenes.duration_ms]]);
  }, 120_000);

  test("continuous motion within one shot is not reported as cuts", async () => {
    // The threshold's other failure mode: a detector sensitive enough to catch a real cut must not
    // fire on every camera move, or "cut on the shot changes" shreds the timeline.
    const moving = await makeTestClip(dir, { name: "moving.mp4", seconds: 6, width: 640, height: 360, fps: 30 });
    const probe = await probeMedia(moving);
    const scenes = await analyzeScenes(moving, probe.durationMs ?? 0);
    expect(scenes.cuts_ms).toEqual([]);
  }, 120_000);

  test("parses ffmpeg's scdet metadata lines", () => {
    const stderr = [
      "[Parsed_metadata_1 @ 0x1] frame:90 pts:90 pts_time:3",
      "[Parsed_metadata_1 @ 0x1] lavfi.scd.time=3.000",
      "[Parsed_metadata_1 @ 0x1] frame:180 pts:180 pts_time:6",
      "[Parsed_metadata_1 @ 0x1] lavfi.scd.time=6.033",
    ].join("\n");
    expect(parseSceneTimes(stderr)).toEqual([3_000, 6_033]);
  });

  test("a cut at 0 is dropped — the first frame is not a boundary", () => {
    expect(buildScenes([0, 2_000], 5_000, 27).cuts_ms).toEqual([2_000]);
  });

  test("cuts past the clip end are dropped and shots always cover the whole clip", () => {
    const scenes = buildScenes([1_000, 9_000], 5_000, 27);
    expect(scenes.cuts_ms).toEqual([1_000]);
    expect(scenes.scenes_ms).toEqual([[0, 1_000], [1_000, 5_000]]);
  });
});

describe("failure paths", () => {
  test("a corrupt file fails with ffmpeg's own reason, not a bare exit code", async () => {
    const bogus = join(dir, "corrupt.mp4");
    await runBinary(ffmpegPath(), ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", bogus]);
    // Truncate to the first 200 bytes — a real file header with no usable stream data.
    const { writeFile, readFile } = await import("node:fs/promises");
    await writeFile(bogus, (await readFile(bogus)).subarray(0, 200));

    const error = await probeMedia(bogus).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FfmpegError);
    const message = (error as FfmpegError).message;
    expect(message).toMatch(/moov atom not found|Invalid data found|invalid/i);
    // The user-facing message names the tool and the reason, and nothing else — no absolute server
    // paths, no signed urls. The argv rides on the error object for the log.
    expect(message.startsWith("ffprobe exited")).toBe(true);
    expect(message).not.toContain("node_modules");
    expect((error as FfmpegError).args).toContain(bogus);
  }, 60_000);

  test("a missing file fails with the path, not silence", async () => {
    await expect(probeMedia(join(dir, "does-not-exist.mp4"))).rejects.toThrow(/No such file|does-not-exist/i);
  }, 60_000);

  test("signed-url query strings are stripped from error text", () => {
    expect(describeArgs(["-i", "https://s3/media/a.mp4?token=SECRET"])).toBe("-i https://s3/media/a.mp4");
    expect(tail("banner\nstream info\nreal error here")).toContain("real error here");
  });
});
