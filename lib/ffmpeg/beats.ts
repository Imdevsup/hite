import { magnitudeSpectrum } from "./fft";
import { readWavPcm, type Pcm } from "./audio";

/**
 * Beat / onset / drop detection, in JS, over mono PCM.
 *
 * Replaces `lib/analysis/beats.py` (librosa in a Python sandbox that never booted). Same OUTPUT
 * contract, because the planner's tools already read it: `{ bpm, beats_ms, onsets_ms, drops_ms,
 * bands }` — see lib/ai/tools/generated/planBeatCuts.ts (`beats_ms`, `bpm`), findHighlights.ts
 * (`drops_ms`), analyzeBeats.ts (`onsets_ms`, `drops_ms`).
 *
 * Method (the standard onset-strength → tempo → phase pipeline):
 *   1. STFT → spectral flux (positive spectral difference), local-mean subtracted.
 *   2. Autocorrelation of that envelope over the 60–200 BPM lag range, with a log-normal prior
 *      around 120 BPM to break the octave ambiguity (a half/double-tempo answer is the classic
 *      failure and it is the one that makes "cut to the beat" cut twice as often as the music).
 *   3. Parabolic interpolation around the ACF peak — the period is generally NOT an integer number
 *      of envelope frames, and rounding it costs ~1 BPM at 120, which compounds across a 3-minute
 *      track into beats that land visibly off the music.
 *   4. Best phase for that period, then each predicted beat snapped to the nearest real onset peak.
 *
 * Everything here reports what it measured or reports nothing. Silence yields `bpm: 0` and empty
 * arrays, never a plausible 120.
 */

/** 32 ms analysis window at 16 kHz — long enough to resolve a kick, short enough to localise it. */
const FRAME_SIZE = 512;
/** 8 ms hop ⇒ a 125 Hz onset envelope. Beat positions are therefore accurate to ±4 ms. */
const HOP_SIZE = 128;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Tempo prior: octave errors are resolved toward the tempo humans actually perceive. */
const PREFERRED_BPM = 120;
const PRIOR_WIDTH_OCTAVES = 1.1;
/** Two onsets closer than this are one event (a kick's attack has several flux frames). */
const MIN_ONSET_GAP_MS = 50;
/** Drops are structural, so they are reported sparsely and never closer together than this. */
const MIN_DROP_GAP_MS = 4_000;
const MAX_DROPS = 6;

export interface BeatsAnalysis {
  /** Estimated tempo, 0 when the signal carries no periodic pulse. */
  bpm: number;
  /** Beat grid in ms. */
  beats_ms: number[];
  /** Every detected onset in ms (denser than the beat grid). */
  onsets_ms: number[];
  /** Low-band energy surges — where a track "drops". */
  drops_ms: number[];
  /** Fraction of total spectral energy in each band. Sums to 1 for any signal with energy. */
  bands: { low: number; mid: number; high: number };
  method: string;
}

const EMPTY: BeatsAnalysis = {
  bpm: 0,
  beats_ms: [],
  onsets_ms: [],
  drops_ms: [],
  bands: { low: 0, mid: 0, high: 0 },
  method: "spectral-flux/acf",
};

/** Read a 16 kHz mono WAV and analyze it. */
export async function analyzeBeatsFromWav(wavPath: string): Promise<BeatsAnalysis> {
  return analyzeBeats(await readWavPcm(wavPath));
}

export function analyzeBeats(pcm: Pcm): BeatsAnalysis {
  const { samples, sampleRate } = pcm;
  if (samples.length < FRAME_SIZE * 4 || sampleRate <= 0) return EMPTY;

  const spectral = spectralFeatures(samples, sampleRate);
  if (spectral.envelope.length < 8) return EMPTY;

  const envelopeRate = sampleRate / HOP_SIZE; // envelope frames per second
  const frameToMs = (frame: number) => Math.round((frame * HOP_SIZE * 1000) / sampleRate);

  const onsetFrames = pickPeaks(spectral.envelope, (MIN_ONSET_GAP_MS / 1000) * envelopeRate);
  const tempo = estimateTempo(spectral.envelope, envelopeRate);

  let beats_ms: number[] = [];
  if (tempo) {
    const phase = bestPhase(spectral.envelope, tempo.periodFrames);
    beats_ms = beatGrid(spectral.envelope, tempo.periodFrames, phase, onsetFrames).map(frameToMs);
  }

  return {
    bpm: tempo ? Math.round((60 / (tempo.periodFrames / envelopeRate)) * 10) / 10 : 0,
    beats_ms,
    onsets_ms: onsetFrames.map(frameToMs),
    drops_ms: pickDrops(spectral.lowEnergy, envelopeRate).map(frameToMs),
    bands: spectral.bands,
    method: EMPTY.method,
  };
}

// ───────────────────────── STFT features ─────────────────────────

interface SpectralFeatures {
  /** Half-wave-rectified, local-mean-subtracted spectral flux, one value per hop. */
  envelope: Float64Array;
  /** Per-frame energy below 250 Hz — what a "drop" is a surge in. */
  lowEnergy: Float64Array;
  bands: { low: number; mid: number; high: number };
}

function spectralFeatures(samples: Float32Array, sampleRate: number): SpectralFeatures {
  const bins = (FRAME_SIZE >> 1) + 1;
  const frameCount = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  if (frameCount < 2) {
    return { envelope: new Float64Array(0), lowEnergy: new Float64Array(0), bands: { low: 0, mid: 0, high: 0 } };
  }

  // Hann window — a rectangular window smears each click across the whole spectrum and turns the
  // flux envelope into a plateau, which the autocorrelation then reads as "no periodicity".
  const window = new Float64Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));

  const binHz = sampleRate / FRAME_SIZE;
  const lowMax = Math.min(bins - 1, Math.floor(250 / binHz));
  const midMax = Math.min(bins - 1, Math.floor(4000 / binHz));

  const flux = new Float64Array(frameCount);
  const lowEnergy = new Float64Array(frameCount);
  let lowTotal = 0;
  let midTotal = 0;
  let highTotal = 0;

  const frame = new Float64Array(FRAME_SIZE);
  let prev = new Float64Array(bins);
  let curr = new Float64Array(bins);

  for (let f = 0; f < frameCount; f++) {
    const base = f * HOP_SIZE;
    for (let i = 0; i < FRAME_SIZE; i++) frame[i] = samples[base + i] * window[i];
    magnitudeSpectrum(frame, curr);

    let sum = 0;
    let low = 0;
    let mid = 0;
    let high = 0;
    for (let k = 0; k < bins; k++) {
      const diff = curr[k] - prev[k];
      if (diff > 0) sum += diff; // positive difference only: onsets, not offsets
      const e = curr[k] * curr[k];
      if (k <= lowMax) low += e;
      else if (k <= midMax) mid += e;
      else high += e;
    }
    // Frame 0 has no predecessor; its "flux" would be the whole spectrum and would read as the
    // loudest onset in the file, dragging the adaptive threshold up for everything after it.
    flux[f] = f === 0 ? 0 : sum;
    lowEnergy[f] = low;
    lowTotal += low;
    midTotal += mid;
    highTotal += high;

    const swap = prev;
    prev = curr;
    curr = swap;
  }

  const energyTotal = lowTotal + midTotal + highTotal;
  const bands = energyTotal > 0
    ? {
        low: round3(lowTotal / energyTotal),
        mid: round3(midTotal / energyTotal),
        high: round3(highTotal / energyTotal),
      }
    : { low: 0, mid: 0, high: 0 };

  return { envelope: subtractLocalMean(flux, Math.round(0.1 * (sampleRate / HOP_SIZE))), lowEnergy, bands };
}

/**
 * Subtract a moving average and half-wave rectify. Without this a track that gets louder reads as
 * one long onset, and a quiet intro's real onsets fall under a global threshold.
 */
function subtractLocalMean(values: Float64Array, radius: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const w = Math.max(1, radius);
  // Prefix sums make this O(n) rather than O(n·w); at 125 fps over a 10-minute track the naive
  // version is 75M operations for a smoothing pass.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w);
    const hi = Math.min(n, i + w + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    out[i] = Math.max(0, values[i] - mean);
  }
  return out;
}

// ───────────────────────── tempo ─────────────────────────

interface Tempo {
  /** Beat period in envelope frames — fractional, from parabolic interpolation. */
  periodFrames: number;
  strength: number;
}

/**
 * Autocorrelate the onset envelope and pick the strongest lag in the plausible tempo range.
 * Returns null when nothing periodic is there.
 */
function estimateTempo(envelope: Float64Array, envelopeRate: number): Tempo | null {
  const n = envelope.length;
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * envelopeRate));
  const maxLag = Math.min(n - 2, Math.ceil((60 / MIN_BPM) * envelopeRate));
  if (maxLag <= minLag) return null;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= n;
  const centered = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    centered[i] = envelope[i] - mean;
    energy += centered[i] * centered[i];
  }
  if (energy <= 0) return null;

  const scores = new Float64Array(maxLag + 1);
  let best = -Infinity;
  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += centered[i] * centered[i + lag];
    // Normalise by the overlap so long lags are not penalised for having fewer terms, then weight
    // by the tempo prior. Without the prior a clean 120 BPM track scores identically at 60 and 240.
    const normalized = acc / (n - lag);
    const bpm = (60 * envelopeRate) / lag;
    scores[lag] = normalized * tempoPrior(bpm);
    if (scores[lag] > best) {
      best = scores[lag];
      bestLag = lag;
    }
  }
  if (bestLag < 0 || best <= 0) return null;

  return { periodFrames: parabolicPeak(scores, bestLag, minLag, maxLag), strength: best / energy };
}

/** Log-normal weight around 120 BPM (Parncutt's resonance curve, in log2 space). */
function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / PREFERRED_BPM);
  return Math.exp(-0.5 * (octaves / PRIOR_WIDTH_OCTAVES) ** 2);
}

/**
 * Sub-sample peak location by fitting a parabola through the peak and its neighbours. A 120 BPM
 * pulse at 125 fps has a period of exactly 62.5 frames; the nearest integer lag reports 119.0 or
 * 121.0 BPM, so without this the detector cannot answer the 120 ± 2 oracle by construction.
 */
function parabolicPeak(scores: Float64Array, peak: number, minLag: number, maxLag: number): number {
  if (peak <= minLag || peak >= maxLag) return peak;
  const a = scores[peak - 1];
  const b = scores[peak];
  const c = scores[peak + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return peak;
  const shift = (0.5 * (a - c)) / denom;
  return Number.isFinite(shift) && Math.abs(shift) <= 1 ? peak + shift : peak;
}

// ───────────────────────── phase + grid ─────────────────────────

/** The offset within one period at which a beat grid best lines up with the onset envelope. */
function bestPhase(envelope: Float64Array, periodFrames: number): number {
  const n = envelope.length;
  let bestScore = -Infinity;
  let bestPhase = 0;
  for (let phase = 0; phase < Math.ceil(periodFrames); phase++) {
    let score = 0;
    for (let t = phase; t < n; t += periodFrames) score += envelope[Math.round(t)] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

/**
 * Predicted beats, each pulled onto the nearest real onset within ±period/8. The grid keeps the
 * tempo honest through passages with no percussion; the snap keeps individual beats on the actual
 * transient, which is what a cut has to land on to feel right.
 */
function beatGrid(
  envelope: Float64Array,
  periodFrames: number,
  phase: number,
  onsetFrames: number[],
): number[] {
  const tolerance = periodFrames / 8;
  const beats: number[] = [];
  // Both lists are ascending, so one cursor walks them together: O(beats + onsets) rather than a
  // rescan from zero per beat. Onsets are DENSER than the beat grid (every hi-hat is an onset), so
  // the rescan is the expensive direction — on an hour of music it is tens of millions of
  // comparisons for an answer this finds in one pass.
  let cursor = 0;
  for (let t = phase; t < envelope.length; t += periodFrames) {
    const predicted = Math.round(t);
    while (cursor < onsetFrames.length && onsetFrames[cursor] < predicted - tolerance) cursor += 1;

    let snapped: number | null = null;
    let bestDistance = tolerance;
    for (let i = cursor; i < onsetFrames.length && onsetFrames[i] <= predicted + tolerance; i++) {
      const distance = Math.abs(onsetFrames[i] - predicted);
      if (distance <= bestDistance) {
        bestDistance = distance;
        snapped = onsetFrames[i];
      }
    }

    const frame = snapped ?? predicted;
    if (beats.length === 0 || frame > beats[beats.length - 1]) beats.push(frame);
  }
  return beats;
}

// ───────────────────────── peaks + drops ─────────────────────────

/**
 * Local maxima above an adaptive threshold (mean + 1σ of the envelope), thinned to `minGap`
 * frames. Exported for tests.
 */
function pickPeaks(envelope: Float64Array, minGap: number): number[] {
  const n = envelope.length;
  if (n < 3) return [];
  let mean = 0;
  for (let i = 0; i < n; i++) mean += envelope[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (envelope[i] - mean) ** 2;
  const threshold = mean + Math.sqrt(variance / n);
  if (!(threshold > 0)) return [];

  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (envelope[i] < threshold) continue;
    if (envelope[i] < envelope[i - 1] || envelope[i] < envelope[i + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < minGap) {
      // Same event: keep whichever frame is actually the stronger transient.
      if (envelope[i] > envelope[last]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks;
}

/**
 * Low-band energy surges. Compares each frame's low energy against the preceding second and keeps
 * the biggest ratios, spaced out so one drop is not reported six times. This is a MEASUREMENT of
 * the low band, not a musical judgement — `drops_ms` is documented to the planner as exactly that.
 */
function pickDrops(lowEnergy: Float64Array, envelopeRate: number): number[] {
  const n = lowEnergy.length;
  const lookback = Math.round(envelopeRate); // one second
  if (n < lookback * 2) return [];

  const candidates: { frame: number; ratio: number }[] = [];
  let running = 0;
  for (let i = 0; i < lookback; i++) running += lowEnergy[i];
  for (let i = lookback; i < n; i++) {
    const before = running / lookback;
    running += lowEnergy[i] - lowEnergy[i - lookback];
    if (before <= 0) continue;
    const ratio = lowEnergy[i] / before;
    if (ratio > 2) candidates.push({ frame: i, ratio });
  }

  candidates.sort((a, b) => b.ratio - a.ratio);
  const minGap = (MIN_DROP_GAP_MS / 1000) * envelopeRate;
  const chosen: number[] = [];
  for (const c of candidates) {
    if (chosen.length >= MAX_DROPS) break;
    if (chosen.some((f) => Math.abs(f - c.frame) < minGap)) continue;
    chosen.push(c.frame);
  }
  return chosen.sort((a, b) => a - b);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
