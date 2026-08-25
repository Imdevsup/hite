/**
 * In-place radix-2 Cooley–Tukey FFT.
 *
 * Written out rather than pulled in as a dependency: it is 40 lines, it is the only DSP primitive
 * the analyzer needs, and the alternative on offer (a Python sandbox running librosa) is exactly
 * the architecture this unit deletes.
 *
 * Twiddle factors are precomputed per transform size instead of accumulated recurrently — the
 * recurrence drifts, and a drifting twiddle shows up as a smeared spectrum, which reads downstream
 * as "this music has no beat" rather than as a numerical bug.
 */

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function twiddles(n: number): { cos: Float64Array; sin: Float64Array } {
  const cached = twiddleCache.get(n);
  if (cached) return cached;
  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    const angle = (-2 * Math.PI * i) / n;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }
  const table = { cos, sin };
  twiddleCache.set(n, table);
  return table;
}

/** `re`/`im` must be the same power-of-two length. Transformed in place. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new Error(`fft: re/im length mismatch (${n} vs ${im.length})`);
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const stride = n / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride];
        const wi = sin[k * stride];
        const a = start + k;
        const b = a + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
      }
    }
  }
}

/**
 * Magnitude spectrum of one real frame, bins `0..n/2` inclusive.
 * `out` must be `n / 2 + 1` long and is overwritten.
 */
export function magnitudeSpectrum(frame: Float64Array, out: Float64Array): void {
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  fftInPlace(re, im);
  for (let k = 0; k <= n >> 1; k++) out[k] = Math.hypot(re[k], im[k]);
}
