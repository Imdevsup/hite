/**
 * objects/ClipLabels.ts — every raster the ribbon samples, drawn ONCE at boot.
 *
 *  · The name-tag strip (spec §5): one 4096×64 canvas, one slot per clip, the filename in the top
 *    row and its middle-ellipsis form in the bottom row. The fragment shader picks the row by the
 *    clip's on-screen width, so tags re-truncate for free while the ripple delete changes widths.
 *    Zero text meshes, zero draw calls.
 *  · The poster atlas: one abstract frame per clip. These are PROCEDURAL — gradients, a horizon
 *    line, grain — and the page says so. There is no footage in this repo and nothing here may
 *    look like a real recording.
 *  · The waveform: 2048 amplitude samples shaped by the project's silences, as a 1-row texture.
 *  · The digit strip: `0123456789:` for the ruler's timecodes, composed in the shader.
 */
import { CanvasTexture, DataTexture, LinearFilter, RedFormat, SRGBColorSpace, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType } from "three";

/** 0..1 floats → bytes. Every texture the ribbon samples is 8-bit: float textures are not trusted. */
function toBytes(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, values[i])) * 255);
  return out;
}
import type { ClipSlots } from "./TimelineState";
import { SLOTS } from "./TimelineState";
import { DEMO_PROJECT } from "../choreography/script";

export const LABEL_ATLAS_WIDTH = 4096;
export const LABEL_ATLAS_HEIGHT = 64;
export const LABEL_ROW_HEIGHT = 32;
export const LABEL_SLOT_WIDTH = Math.floor(LABEL_ATLAS_WIDTH / DEMO_PROJECT.length);
export const LABEL_FONT_PX = 20; // drawn at 2× and sampled down to ~10px on screen
/** Width in atlas pixels the fragment shader should treat as the label's ink extent. */
export const LABEL_INK_WIDTH = LABEL_SLOT_WIDTH - 8;

const SOURCE_DOT = ["#6E56F8", "#22D3EE", "#F2F4F8", "#34D399", "#F5A524"];

export function middleEllipsis(name: string, keepHead = 9, keepTail = 4): string {
  if (name.length <= keepHead + keepTail + 1) return name;
  return `${name.slice(0, keepHead)}…${name.slice(-keepTail)}`;
}

function makeCanvas(w: number, h: number, readback = false): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", readback ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("landing3d: 2D canvas context unavailable");
  return { canvas, ctx };
}

export function buildLabelAtlas(clips: readonly ClipSlots[], fontFamily: string): CanvasTexture {
  const { canvas, ctx } = makeCanvas(LABEL_ATLAS_WIDTH, LABEL_ATLAS_HEIGHT);
  ctx.clearRect(0, 0, LABEL_ATLAS_WIDTH, LABEL_ATLAS_HEIGHT);
  ctx.font = `500 ${LABEL_FONT_PX}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  for (const c of clips) {
    const x0 = c.index * LABEL_SLOT_WIDTH;
    for (const [row, text] of [[0, c.clip.name], [1, middleEllipsis(c.clip.name)]] as const) {
      const y = row * LABEL_ROW_HEIGHT + LABEL_ROW_HEIGHT / 2;
      ctx.fillStyle = SOURCE_DOT[c.clip.source];
      ctx.beginPath();
      ctx.arc(x0 + 8, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(242,244,248,1)";
      ctx.fillText(text, x0 + 18, y, LABEL_INK_WIDTH - 18);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  // The shaders address these atlases from the canvas's top-left; keep the rows where they were drawn.
  tex.flipY = false;
  return tex;
}

export const POSTER_W = 128;
export const POSTER_H = 72;

/** Deterministic hash → [0,1). Keeps the atlas identical on every boot. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Abstract, obviously synthetic posters: a horizon, a gradient sky, a blocky foreground, grain. */
export function buildPosterAtlas(clips: readonly ClipSlots[]): CanvasTexture {
  const n = clips.length;
  const { canvas, ctx } = makeCanvas(POSTER_W * n, POSTER_H, true);
  clips.forEach((c) => {
    const x0 = c.index * POSTER_W;
    const h1 = hash(c.index + 1);
    const h2 = hash(c.index + 40);
    const hue = c.clip.source === 3 ? 205 + h1 * 30 : c.clip.source === 2 ? 230 : 255 + h1 * 40;
    const sky = ctx.createLinearGradient(0, 0, 0, POSTER_H);
    sky.addColorStop(0, `hsl(${hue} 45% ${14 + h2 * 10}%)`);
    sky.addColorStop(1, `hsl(${hue + 20} 50% ${6 + h1 * 5}%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(x0, 0, POSTER_W, POSTER_H);
    const horizon = POSTER_H * (0.45 + h2 * 0.25);
    ctx.fillStyle = `hsl(${hue + 10} 30% ${4 + h1 * 3}%)`;
    ctx.fillRect(x0, horizon, POSTER_W, POSTER_H - horizon);
    // A soft light source.
    const glow = ctx.createRadialGradient(x0 + POSTER_W * h1, horizon * 0.6, 2, x0 + POSTER_W * h1, horizon * 0.6, 40);
    glow.addColorStop(0, `hsla(${hue - 30} 80% 70% / 0.5)`);
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(x0, 0, POSTER_W, POSTER_H);
    // Blocky foreground shapes.
    for (let k = 0; k < 4; k++) {
      const w = 10 + hash(c.index * 7 + k) * 30;
      const hh = 8 + hash(c.index * 11 + k) * 26;
      ctx.fillStyle = `hsla(${hue + 30} 20% ${10 + hash(k + c.index) * 12}% / 0.9)`;
      ctx.fillRect(x0 + hash(c.index * 3 + k) * (POSTER_W - w), POSTER_H - hh, w, hh);
    }
    // Grain.
    const img = ctx.getImageData(x0, 0, POSTER_W, POSTER_H);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = (hash(i + c.index * 9973) - 0.5) * 18;
      img.data[i] += g; img.data[i + 1] += g; img.data[i + 2] += g;
    }
    ctx.putImageData(img, x0, 0);
  });
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  return tex;
}

export const WAVE_SAMPLES = 2048;

/** Dialogue amplitude along the timeline, near-silent inside the project's dead-air regions. */
export function buildWaveform(clips: readonly ClipSlots[], silenceFlag: (slot: number) => boolean): DataTexture {
  const data = new Float32Array(WAVE_SAMPLES);
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const slot = (i / WAVE_SAMPLES) * SLOTS;
    const clip = clips.find((c) => slot >= c.start && slot < c.end);
    const isAudioOnly = clip?.clip.source === 4;
    const isBroll = clip ? clip.clip.source === 3 || clip.clip.silences.some(([a, b]) => a === 0 && b === clip.clip.seconds) : false;
    const base = 0.35 + 0.4 * hash(i * 0.37) * hash(i * 0.11 + 5) + 0.25 * Math.abs(Math.sin(i * 0.21) * Math.sin(i * 0.047));
    let amp = base;
    if (silenceFlag(Math.floor(slot)) || isBroll) amp = 0.03 + hash(i) * 0.04;
    if (isAudioOnly) amp = 0.08 + hash(i * 3) * 0.05;
    data[i] = Math.min(1, amp);
  }
  const tex = new DataTexture(toBytes(data), WAVE_SAMPLES, 1, RedFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Music bed amplitude: a steady pulse at the score's tempo, for the A2 lane. */
export function buildScoreWaveform(bpm: number, totalSeconds: number): DataTexture {
  const data = new Float32Array(WAVE_SAMPLES);
  const beats = (totalSeconds / 60) * bpm;
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const beatPhase = ((i / WAVE_SAMPLES) * beats) % 1;
    const hit = Math.pow(1 - beatPhase, 6);
    data[i] = 0.18 + 0.55 * hit + 0.12 * hash(i * 0.7);
  }
  const tex = new DataTexture(toBytes(data), WAVE_SAMPLES, 1, RedFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export const DIGIT_COUNT = 11; // 0-9 and ':'
export const DIGIT_W = 24;
export const DIGIT_H = 40;

/** `0123456789:` at 2×, for the ruler's `00:00:00:00` labels composed in the fragment shader. */
export function buildDigitStrip(fontFamily: string): CanvasTexture {
  const { canvas, ctx } = makeCanvas(DIGIT_W * DIGIT_COUNT, DIGIT_H);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `500 ${DIGIT_H * 0.72}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#F2F4F8";
  "0123456789:".split("").forEach((ch, i) => ctx.fillText(ch, i * DIGIT_W + DIGIT_W / 2, DIGIT_H / 2));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  return tex;
}

/** A 1×1 transparent texture so every sampler is bound before its atlas exists. */
export function blankTexture(): DataTexture {
  const tex = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}
