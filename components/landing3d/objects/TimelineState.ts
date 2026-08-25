/**
 * objects/TimelineState.ts — the DataTexture that drives everything (spec §4).
 *
 * 512 columns × 4 rows, RGBA float. Each column is one timeline slot; the staged project's clips
 * are laid across the slots in proportion to their duration. The ribbon's vertex shader reads row 1
 * to slide downstream clips left during the ripple delete; the fragment shader reads rows 0, 2 and 3
 * to paint clip blocks, states, silences, transitions, keyframes and captions.
 *
 *   Row 0  R clip index / 64   G state (0 normal · .25 silence · .5 selected · .75 deleted · 1 new)
 *          B local scale       A per-segment phase (draw-in / settle)
 *   Row 1  R prefix(start)     G prefix(end) — both normalised by the ORIGINAL slot count, so a
 *          crushed region genuinely shortens the ribbon instead of stretching what is left
 *          B live total        A unused
 *   Row 2  R transition type at this clip's head (0 none · .25 cut · .5 fade · .75 dip) × draw-in
 *          G keyframe density  B marker colour index  A V2 occupancy (overlay beats)
 *   Row 3  R clip start slot   G clip end slot   B silence flag   A caption density
 *
 * GSAP never touches the texture. It tweens the small control arrays on `controls`, and `update()`
 * bakes them into the texture once per frame. That keeps every tool call a plain reversible tween.
 */
import { DataTexture, NearestFilter, RGBAFormat, ClampToEdgeWrapping, UnsignedByteType } from "three";
import { DEMO_PROJECT, INTRO_END_SECONDS, RETIME_FACTOR, type DemoClip } from "../choreography/script";

export const SLOTS = 512;
export const ROWS = 4;

export interface ClipSlots {
  readonly index: number;
  readonly clip: DemoClip;
  readonly start: number;
  readonly end: number;
  readonly startSeconds: number;
}

export interface SilenceSlots {
  readonly index: number;
  readonly clipIndex: number;
  readonly start: number;
  readonly end: number;
}

export interface TransitionSlot {
  readonly index: number;
  /** Slot where the boundary sits (head of the clip that follows). */
  readonly slot: number;
}

export interface Controls {
  /** Per silence region: 0 untouched → 1 crushed to zero width. */
  readonly crush: Float32Array;
  /** Per silence region: 0 invisible → 1 amber. */
  readonly silenceReveal: Float32Array;
  /** Per talking-head boundary: 0 → 1 bowtie drawn in. */
  readonly transitionDraw: Float32Array;
  /** Per overlay beat on V2: 0 → 1 docked. */
  readonly overlayDock: Float32Array;
  /** Scalars. Tweened by name. */
  readonly scalar: {
    selectSilences: number;
    selectIntro: number;
    selectBoundaries: number;
    selectMiddle: number;
    selectAll: number;
    retime: number;
    keyframeDensity:number;
    captions: number;
    beatGrid: number;
  };
}

export class TimelineState {
  readonly texture: DataTexture;
  /** 8-bit on purpose: float textures misbehave on some GPU drivers; bytes never do. */
  readonly data: Uint8Array;
  readonly prefixStart = new Float32Array(SLOTS);
  readonly prefixEnd = new Float32Array(SLOTS);
  readonly clips: readonly ClipSlots[];
  readonly silences: readonly SilenceSlots[];
  readonly transitions: readonly TransitionSlot[];
  readonly overlayBeats: readonly { start: number; end: number }[];
  readonly totalSeconds: number;
  readonly introEndSlot: number;
  readonly controls: Controls;
  /** Live normalised length of the ribbon (1 = untouched). Read by the camera to recentre. */
  liveLength = 1;

  constructor(project: readonly DemoClip[] = DEMO_PROJECT) {
    this.data = new Uint8Array(SLOTS * ROWS * 4);
    this.texture = new DataTexture(this.data, SLOTS, ROWS, RGBAFormat, UnsignedByteType);
    // Nearest on purpose: the shaders interpolate between a slot's own start/end prefix values, and
    // a crisp clip boundary needs the exact slot, not a blend with its neighbour.
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;

    this.totalSeconds = project.reduce((s, c) => s + c.seconds, 0);
    const secondsPerSlot = this.totalSeconds / SLOTS;

    const clips: ClipSlots[] = [];
    const silences: SilenceSlots[] = [];
    let cursor = 0;
    let seconds = 0;
    project.forEach((clip, index) => {
      const start = cursor;
      const end = index === project.length - 1 ? SLOTS : Math.round((seconds + clip.seconds) / secondsPerSlot);
      clips.push({ index, clip, start, end, startSeconds: seconds });
      for (const [a, b] of clip.silences) {
        const sa = Math.max(start, Math.round((seconds + a) / secondsPerSlot));
        const sb = Math.min(end, Math.max(sa + 1, Math.round((seconds + b) / secondsPerSlot)));
        silences.push({ index: silences.length, clipIndex: index, start: sa, end: sb });
      }
      cursor = end;
      seconds += clip.seconds;
    });
    this.clips = clips;
    this.silences = silences;
    this.introEndSlot = Math.round(INTRO_END_SECONDS / secondsPerSlot);

    // Talking-head boundaries: the head of every A-cam clip after the first.
    const transitions: TransitionSlot[] = [];
    clips.filter((c) => c.clip.source === 0).slice(1).forEach((c, i) => transitions.push({ index: i, slot: c.start }));
    this.transitions = transitions;

    // Four overlay beats across the middle third, on V2.
    const third = SLOTS / 3;
    this.overlayBeats = [0, 1, 2, 3].map((i) => {
      const start = Math.round(third + (i * third) / 4 + 6);
      return { start, end: start + Math.round(third / 4) - 14 };
    });

    this.controls = {
      crush: new Float32Array(silences.length),
      silenceReveal: new Float32Array(silences.length),
      transitionDraw: new Float32Array(transitions.length),
      overlayDock: new Float32Array(this.overlayBeats.length),
      scalar: {
        selectSilences: 0,
        selectIntro: 0,
        selectBoundaries: 0,
        selectMiddle: 0,
        selectAll: 0,
        retime: 0,
        keyframeDensity:0,
        captions: 0,
        beatGrid: 0,
      },
    };

    this.writeStatic();
    this.update();
  }

  private idx(row: number, slot: number): number {
    return (row * SLOTS + slot) * 4;
  }

  /** Store a 0..1 value as a byte. */
  private put(row: number, slot: number, channel: number, value: number): void {
    this.data[this.idx(row, slot) + channel] = Math.round(Math.min(1, Math.max(0, value)) * 255);
  }

  /** Store a slot index (0..512) as a 16-bit pair in two channels. */
  private put16(row: number, slot: number, channel: number, value: number): void {
    const v = Math.round(Math.min(65535, Math.max(0, value)));
    this.data[this.idx(row, slot) + channel] = v >> 8;
    this.data[this.idx(row, slot) + channel + 1] = v & 255;
  }

  /** Everything that never animates: clip identity, spans, silence flags. */
  private writeStatic(): void {
    for (const c of this.clips) {
      for (let s = c.start; s < c.end; s++) {
        this.put(0, s, 0, c.index / 64);
        this.put(0, s, 1, 0);
        this.put(0, s, 2, 1);
        this.put(0, s, 3, 0);
        this.put16(1, s, 0, c.start);
        this.put16(1, s, 2, c.end);
        this.put(3, s, 0, 0);
        this.put(3, s, 1, 0);
        this.put(3, s, 2, 0);
        this.put(3, s, 3, 0);
      }
    }
    for (const sil of this.silences) {
      for (let s = sil.start; s < sil.end; s++) this.put(3, s, 2, 1);
    }
  }

  private silenceAt(slot: number): SilenceSlots | undefined {
    for (const s of this.silences) if (slot >= s.start && slot < s.end) return s;
    return undefined;
  }

  /** Bake controls → texture, recompute the prefix sum, upload. Call once per frame. */
  update(): void {
    const c = this.controls;
    const sc = c.scalar;
    const retimeScale = 1 - sc.retime * (1 - 1 / RETIME_FACTOR);
    const middleStart = SLOTS / 3;
    const middleEnd = (SLOTS * 2) / 3;

    let cum = 0;
    for (let s = 0; s < SLOTS; s++) {
      const sil = this.silenceAt(s);
      let scale = 1;
      let state = 0;
      if (sil) {
        const crush = c.crush[sil.index];
        scale = 1 - crush;
        const reveal = c.silenceReveal[sil.index];
        state = crush > 0.98 ? 0.75 : reveal > 0.5 ? 0.25 : 0;
        if (sc.selectSilences > 0.5 && crush < 0.02) state = 0.5;
      }
      if (s < this.introEndSlot) {
        scale *= retimeScale;
        if (sc.selectIntro > 0.5) state = Math.max(state, 0.5);
      }
      if (s >= middleStart && s < middleEnd && sc.selectMiddle > 0.5) state = Math.max(state, 0.5);
      if (sc.selectAll > 0.5) state = Math.max(state, 0.5);
      // A non-finite or out-of-range scale would poison every prefix sum after it and cut the ribbon
      // from that slot onward. Never let one through.
      if (!Number.isFinite(scale)) scale = 1;
      scale = Math.min(1, Math.max(0, scale));

      this.put(0, s, 1, state);
      this.put(0, s, 2, scale);

      // Prefix sums live on the CPU (the vertex attribute reads them); the texture never carries them.
      this.prefixStart[s] = cum / SLOTS;
      cum += scale;
      this.prefixEnd[s] = cum / SLOTS;

      this.put(2, s, 0, 0);
      this.put(2, s, 1, s < this.introEndSlot ? sc.keyframeDensity : 0);
      this.put(2, s, 2, 0);
      this.put(2, s, 3, 0);
      this.put(3, s, 3, sc.captions);
    }
    this.liveLength = cum / SLOTS;

    for (const t of this.transitions) {
      const draw = c.transitionDraw[t.index];
      const sel = sc.selectBoundaries > 0.5 && draw < 0.02 ? 1 : 0;
      this.put(2, t.slot, 0, 0.5 * draw);
      this.put(2, t.slot, 2, sel);
    }
    this.overlayBeats.forEach((b, i) => {
      const dock = c.overlayDock[i];
      for (let s = b.start; s < b.end; s++) this.put(2, s, 3, dock);
    });

    this.texture.needsUpdate = true;
  }

  /** Effective path parameter for a slot's left edge — where it sits after the ripple. */
  tEffAt(slot: number): number {
    const s = Math.min(SLOTS - 1, Math.max(0, Math.floor(slot)));
    const frac = Math.min(1, Math.max(0, slot - s));
    const a = this.prefixStart[s];
    const b = this.prefixEnd[s];
    return a + (b - a) * frac;
  }

  slotAtSeconds(seconds: number): number {
    return (seconds / this.totalSeconds) * SLOTS;
  }

  /** Slot range of the middle third — the overlay section. */
  get middle(): { start: number; end: number } {
    return { start: SLOTS / 3, end: (SLOTS * 2) / 3 };
  }

  dispose(): void {
    this.texture.dispose();
  }
}
