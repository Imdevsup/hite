/**
 * choreography/master.ts — one GSAP timeline, duration 1, scrubbed by scroll.
 *
 * Nothing here touches a uniform. Every act tweens plain numbers on `SceneState`, and `Scene.tsx`
 * pushes that state into the renderer once per frame. That is what makes the whole page reversible:
 * GSAP owns the numbers, the scene is a pure function of them, and scrolling up replays everything
 * backward for free. `tl.set()` is used where a value must flip (it records the prior value, so it
 * rewinds too). No `once`, no flags, no `onComplete` side effects.
 *
 * Beat positions are spec §6 verbatim. Adjacent beats overlap by ≥15% of their duration.
 */
import gsap from "gsap";
import type { TimelineState } from "../objects/TimelineState";
import { CARD_COUNT } from "../objects/ClipCards";
import { WIDTH_FLAT_MULTIPLIER } from "../objects/Ribbon";
import { CAPTION_PHRASES } from "../objects/CaptionTicks";
import { FLAT, HERO_CAM } from "../objects/paths";
import { TOOL_CALLS, deriveDemoStats, toolCallWindow } from "./script";

export interface CameraPose {
  theta: number;
  phi: number;
  r: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  roll: number;
}

export interface SceneState {
  cam: CameraPose;
  ribbon: {
    head: number;
    morph: number;
    faceCamera: number;
    widthFlat: number;
    furniture: number;
    labelOpacity: number;
    analyzed: number;
    scanT: number;
    gradeT: number;
    grade: number;
    playheadT: number;
    playheadOn: number;
    beatGrid: number;
    beatSnap: number;
    beatPulse: number;
    compress: number;
    exportFill: number;
    emissive: number;
    trailOpacity: number;
    silencePulse: number;
  };
  lanes: { ruler: number; v2: number; fx: number; captions: number; a1: number; a2: number };
  world: { grade: number; fogDensity: number; dustStreak: number; dustWake: number; midGlow: number };
  post: { bloom: number; aberration: number };
  focus: { blend: number; range: number };
  chips: Float32Array;
  captions: Float32Array;
  cards: { fan: number; opacity: number; reject: number; dock: Float32Array };
  panel: {
    opacity: number;
    arriveZ: number;
    arriveScale: number;
    unpack: number;
    sweep: number;
    typed: number;
    sent: number;
    thinking: number;
    streamed: number;
    closing: number;
    stat: number;
    chipState: Float32Array;
    commentary: Float32Array;
  };
  dom: {
    heroLift: number;
    scrollHint: number;
    eyebrow: number;
    finalCta: number;
    canvasOpacity: number;
    flash: number;
    hudDuration: number;
    hudSilences: number;
    retimeBadge: number;
    hudOn: number;
  };
}

export function createSceneState(): SceneState {
  const stats = deriveDemoStats();
  return {
    cam: { theta: 0.98, phi: 1.22, r: 352, tx: HERO_CAM.target.x, ty: HERO_CAM.target.y, tz: HERO_CAM.target.z, fov: 38, roll: 0 },
    ribbon: {
      head: 0,
      morph: 0,
      faceCamera: 0.62,
      widthFlat: 1,
      furniture: 0,
      labelOpacity: 0.15,
      analyzed: -1,
      scanT: -1,
      gradeT: -1,
      grade: 0,
      playheadT: 0,
      playheadOn: 0,
      beatGrid: 0,
      beatSnap: 0,
      beatPulse: 0,
      compress: 0,
      exportFill: 0,
      emissive: 0.34,
      trailOpacity: 0.22,
      silencePulse: 1,
    },
    lanes: { ruler: 0, v2: 0, fx: 0, captions: 0, a1: 0, a2: 0 },
    world: { grade: 0, fogDensity: 0.0024, dustStreak: 0, dustWake: 0, midGlow: 0 },
    post: { bloom: 0.85, aberration: 0.0006 },
    focus: { blend: 0, range: 0.42 },
    chips: new Float32Array(TOOL_CALLS.length),
    captions: new Float32Array(CAPTION_PHRASES.length),
    cards: { fan: 0, opacity: 0, reject: 0, dock: new Float32Array(CARD_COUNT) },
    panel: {
      opacity: 0,
      arriveZ: 0,
      arriveScale: 0,
      unpack: 0,
      sweep: 0,
      typed: 0,
      sent: 0,
      thinking: 0,
      streamed: 0,
      closing: 0,
      stat: 0,
      chipState: new Float32Array(TOOL_CALLS.length),
      commentary: new Float32Array(TOOL_CALLS.length),
    },
    dom: {
      heroLift: 0,
      scrollHint: 1,
      eyebrow: 0,
      finalCta: 0,
      canvasOpacity: 1,
      flash: 0,
      hudDuration: stats.sourceSeconds,
      hudSilences: 0,
      retimeBadge: 0,
      hudOn: 0,
    },
  };
}

/** A tween from p `from` to p `to`. */
function span(tl: gsap.core.Timeline, target: object, vars: gsap.TweenVars, from: number, to: number): void {
  tl.to(target, { ...vars, duration: Math.max(0.0005, to - from) }, from);
}

/** Stagger tweens across an indexed Float32Array, ordered by `order` (0..1 per index). */
function staggerArray(
  tl: gsap.core.Timeline,
  arr: Float32Array,
  value: number,
  from: number,
  to: number,
  order: (i: number) => number,
  ease: string,
  each = 0.55,
): void {
  const n = arr.length;
  if (n === 0) return;
  const total = to - from;
  const dur = total * (1 - each) || 0.001;
  for (let i = 0; i < n; i++) {
    const start = from + order(i) * total * each;
    tl.to(arr, { [i]: value, duration: dur, ease }, start);
  }
}

export interface MasterOptions {
  readonly state: TimelineState;
  readonly mobile: boolean;
}

export function buildMaster(S: SceneState, { state, mobile }: MasterOptions): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut" } });
  const stats = deriveDemoStats();
  const c = state.controls;
  const silenceOrder = (i: number): number => state.silences[i].start / 512;
  const transitionOrder = (i: number): number => state.transitions[i].slot / 512;

  /* ── ACT 1 · the hero curl (0 → 0.22) ──────────────────────────────────────────────────── */
  // Non-uniform pacing: approach 30% of the act's scroll, curl 50%, exit 20%.
  // The overlap (t ≈ 0.62) must already be on screen at p 0.13, the money frame.
  // The overlap is where the exit passes in front of the approach (t ≈ 0.74–0.78), so the head is
  // just past the curl at the money frame.
  span(tl, S.ribbon, { head: 0.3, ease: "power1.in" }, 0.0, 0.045);
  span(tl, S.ribbon, { head: 0.78, ease: "power1.inOut" }, 0.045, 0.13);
  span(tl, S.ribbon, { head: 1, ease: "power1.out" }, 0.13, 0.19);
  // Camera: ~28° of orbit, dollying in, ending on the lab's hero camera.
  // The orbit lands on the hero camera BY the money frame, then holds (the wobble keeps it alive).
  span(tl, S.cam, { theta: HERO_CAM.theta, phi: HERO_CAM.phi, r: mobile ? HERO_CAM.r * 1.3 : HERO_CAM.r, ease: "power2.out" }, 0.0, 0.125);
  span(tl, S.world, { dustWake: 1, ease: "power2.out" }, 0.015, 0.03);
  span(tl, S.world, { dustWake: 0 }, 0.17, 0.2);
  // The overlap at 0.13: bloom peaks, a soft flare, aberration spikes at the apex.
  span(tl, S.post, { bloom: 1.25, ease: "power2.in" }, 0.1, 0.13);
  span(tl, S.post, { bloom: 0.85, ease: "power2.out" }, 0.13, 0.165);
  span(tl, S.post, { aberration: 0.0028, ease: "power2.in" }, 0.11, 0.13);
  span(tl, S.post, { aberration: 0.0006, ease: "power2.out" }, 0.13, 0.16);
  span(tl, S.ribbon, { trailOpacity: 0, ease: "power2.out" }, 0.19, 0.22);
  span(tl, S.dom, { scrollHint: 0, ease: "power2.out" }, 0.02, 0.03);

  /* ── ACT 2 · the descent (0.22 → 0.33) ─────────────────────────────────────────────────── */
  span(tl, S.dom, { heroLift: 1, ease: "power2.in" }, 0.22, 0.27);
  // The head has run off the right edge; the camera ZOOMS IN on the ribbon (long lens, dead-on) as
  // it irons flat, and the flat section is where that zoom lands.
  span(tl, S.cam, { ty: FLAT.y, tx: 0, tz: 0, theta: 0, phi: Math.PI / 2, r: mobile ? 540 : 300, fov: 26, ease: "power2.inOut" }, 0.24, 0.31);
  span(tl, S.world, { dustStreak: 1, ease: "power2.in" }, 0.24, 0.275);
  span(tl, S.world, { dustStreak: 0, ease: "power2.out" }, 0.275, 0.315);
  // The unfurl travels right to left; the shockwave leads it by a few percent of t.
  span(tl, S.ribbon, { morph: 1, ease: "power2.inOut" }, 0.25, 0.305);
  tl.set(S.ribbon, { scanT: 1.06 }, 0.252);
  span(tl, S.ribbon, { scanT: -0.06, ease: "power2.inOut" }, 0.253, 0.298);
  tl.set(S.ribbon, { scanT: -1 }, 0.3);
  span(tl, S.post, { aberration: 0.004, ease: "power2.in" }, 0.26, 0.275);
  span(tl, S.post, { aberration: 0.0006, ease: "power2.out" }, 0.275, 0.3);
  span(tl, S.ribbon, { faceCamera: 1 }, 0.25, 0.31);
  // Flat: the width overshoots and settles elastically; the camera rolls level.
  span(tl, S.ribbon, { widthFlat: WIDTH_FLAT_MULTIPLIER, ease: "elastic.out(1, 0.6)" }, 0.29, 0.335);
  span(tl, S.world, { fogDensity: 0.0015 }, 0.3, 0.32);
  span(tl, S.dom, { eyebrow: 1, ease: "power3.out" }, 0.31, 0.325);
  // Furniture materialises: ruler draws in, headers fade up, playhead at 00:00, tags to full.
  span(tl, S.ribbon, { furniture: 1, labelOpacity: 1, ease: "power2.out" }, 0.315, 0.335);
  span(tl, S.lanes, { ruler: 1, ease: "power3.out" }, 0.318, 0.335);
  span(tl, S.ribbon, { playheadOn: 1, ease: "power2.out" }, 0.325, 0.335);
  span(tl, S.dom, { hudOn: 1 }, 0.325, 0.335);

  /* ── ACT 3 · the depth reveal (0.33 → 0.42) ───────────────────────────────────────────── */
  span(tl, S.world, { midGlow: 1, ease: "power2.in" }, 0.33, 0.34);
  span(tl, S.world, { midGlow: 0, ease: "power2.out" }, 0.34, 0.36);
  tl.set(S.panel, { opacity: 1 }, 0.335);
  // Scale and Z on different easings so the perspective change reads.
  span(tl, S.panel, { arriveZ: 1, ease: "power3.out" }, 0.34, 0.362);
  span(tl, S.panel, { arriveScale: 1, ease: "power2.inOut" }, 0.345, 0.366);
  // Unpack into six planes, back to front.
  span(tl, S.panel, { unpack: 1, ease: "power3.out" }, 0.36, 0.388);
  // Rack focus to the panel and back. The ribbon is always the sharpest thing on screen after.
  span(tl, S.focus, { blend: 1, ease: "power2.inOut" }, 0.378, 0.39);
  span(tl, S.panel, { sweep: 1, ease: "power1.inOut" }, 0.386, 0.402);
  // Settle the lens BETWEEN the ribbon and the panel with a range wide enough that both are sharp:
  // the thread has to be readable through the ribbon for the whole conversation. Only the far field
  // (backdrop, dust) stays soft.
  span(tl, S.focus, { blend: 0.45, ease: "power2.inOut" }, 0.4, 0.412);
  span(tl, S.focus, { range: 2.2 }, 0.4, 0.42);

  /* ── ACT 4 · the conversation (0.42 → 0.89) ───────────────────────────────────────────── */
  span(tl, S.panel, { typed: 1, ease: "none" }, 0.425, 0.462);
  span(tl, S.panel, { sent: 1, ease: "power3.out" }, 0.462, 0.471);
  span(tl, S.panel, { thinking: 1, ease: "none" }, 0.47, 0.482);
  // Focus on the reply as it streams, then back to the work.
  span(tl, S.focus, { blend: 0.92, ease: "power2.inOut" }, 0.474, 0.482);
  span(tl, S.panel, { streamed: 1, ease: "none" }, 0.478, 0.492);
  span(tl, S.focus, { blend: 0.45, ease: "power2.inOut" }, 0.495, 0.505);

  TOOL_CALLS.forEach((call, i) => {
    const { start, end } = toolCallWindow(i);
    const w = end - start;
    const at = (f: number): number => start + w * f;
    // The chip appears on the rail, then ejects and lands. Selection shows before the mutation.
    span(tl, S.panel.chipState, { [i]: 0.5, ease: "power2.out" }, at(0), at(0.05));
    span(tl, S.chips, { [i]: 1, ease: "power2.inOut" }, at(0.05), at(0.62));
    span(tl, S.panel.chipState, { [i]: 1 }, at(0.6), at(0.65));
    span(tl, S.post, { aberration: 0.0032, ease: "power2.in" }, at(0.08), at(0.22));
    span(tl, S.post, { aberration: 0.0006, ease: "power2.out" }, at(0.22), at(0.4));
    if (call.commentary) {
      // The words explain the edit in real time: the lens racks to the panel while they stream,
      // then returns to the timeline.
      span(tl, S.panel.commentary, { [i]: 1, ease: "none" }, at(0.82), at(1));
      span(tl, S.focus, { blend: 0.92, ease: "power2.inOut" }, at(0.78), at(0.86));
      span(tl, S.focus, { blend: 0.45, ease: "power2.inOut" }, at(1.02), at(1.12));
    }

    const m0 = at(0.33); // touchdown: the mutation begins here
    switch (call.effect) {
      case "analyze":
        tl.set(S.ribbon, { scanT: 0, analyzed: 0 }, m0);
        span(tl, S.ribbon, { scanT: 1.05, analyzed: 1.05, ease: "power2.inOut" }, m0, at(0.95));
        span(tl, S.lanes, { a1: 1, ease: "power3.out" }, at(0.45), at(0.85));
        tl.set(S.ribbon, { scanT: -1 }, at(0.96));
        break;
      case "silences":
        span(tl, c.scalar, { selectSilences: 1 }, at(0.3), at(0.33));
        staggerArray(tl, c.silenceReveal, 1, m0, at(0.9), silenceOrder, "power3.out");
        span(tl, S.dom, { hudSilences: stats.silenceCount, ease: "power2.out" }, m0, at(0.9));
        break;
      case "ripple":
        span(tl, c.scalar, { selectSilences: 0 }, at(0.3), at(0.34));
        // The collapse, staggered by position so the wave travels and arrives late at the far end.
        staggerArray(tl, c.crush, 1, m0, at(1), silenceOrder, "power4.inOut", 0.5);
        span(tl, S.dom, { hudDuration: stats.afterSilenceSeconds, ease: "power2.inOut" }, m0, at(1));
        break;
      case "retime":
        span(tl, c.scalar, { selectIntro: 1 }, at(0.28), at(0.33));
        span(tl, c.scalar, { retime: 1, ease: "power3.inOut" }, m0, at(0.8));
        span(tl, c.scalar, { selectIntro: 0 }, at(0.6), at(0.7));
        span(tl, S.lanes, { fx: 1, ease: "power3.out" }, at(0.4), at(0.7));
        span(tl, c.scalar, { keyframeDensity: 1, ease: "power2.out" }, at(0.5), at(0.85));
        span(tl, S.dom, { retimeBadge: 1, ease: "power3.out" }, at(0.4), at(0.6));
        span(tl, S.dom, { retimeBadge: 0, ease: "power2.in" }, at(0.8), at(1));
        span(tl, S.dom, { hudDuration: stats.afterRetimeSeconds, ease: "power2.inOut" }, m0, at(0.8));
        break;
      case "transitions":
        span(tl, c.scalar, { selectBoundaries: 1 }, at(0.28), at(0.33));
        staggerArray(tl, c.transitionDraw, 1, m0, at(0.95), transitionOrder, "power3.out", 0.6);
        span(tl, c.scalar, { selectBoundaries: 0 }, at(0.5), at(0.6));
        break;
      case "search":
        tl.set(S.cards, { opacity: 1 }, m0);
        span(tl, S.cards, { fan: 1, ease: "power3.out" }, m0, at(0.85));
        span(tl, S.cards, { reject: 1, ease: "power2.inOut" }, at(0.8), at(1));
        break;
      case "insert":
        span(tl, c.scalar, { selectMiddle: 1 }, at(0.28), at(0.33));
        span(tl, S.lanes, { v2: 1, ease: "power3.out" }, m0, at(0.7));
        span(tl, c.scalar, { selectMiddle: 0 }, at(0.55), at(0.65));
        staggerArray(tl, S.cards.dock, 1, at(0.45), at(0.95), (k) => k / CARD_COUNT, "power3.inOut", 0.5);
        staggerArray(tl, c.overlayDock, 1, at(0.7), at(1), (k) => k / 4, "power3.out", 0.5);
        span(tl, S.cards, { opacity: 0, ease: "power2.in" }, at(0.92), at(1));
        break;
      case "grade":
        tl.set(S.ribbon, { gradeT: -0.1, grade: 1 }, m0);
        span(tl, S.ribbon, { gradeT: 1.1, ease: "power2.inOut" }, m0, at(0.95));
        span(tl, S.world, { grade: 1, ease: "power2.inOut" }, at(0.4), at(0.95));
        break;
      case "captions":
        span(tl, S.lanes, { captions: 1, ease: "power3.out" }, m0, at(0.6));
        span(tl, c.scalar, { captions: 1, ease: "power2.out" }, at(0.4), at(0.8));
        staggerArray(tl, S.captions, 1, at(0.5), at(1), (k) => k / CAPTION_PHRASES.length, "power2.inOut", 0.55);
        break;
      case "score":
        span(tl, S.lanes, { a2: 1, ease: "power3.out" }, m0, at(0.75));
        span(tl, S.ribbon, { beatPulse: 1 }, at(0.5), at(0.9));
        break;
      case "beatsync":
        span(tl, S.ribbon, { beatGrid: 1, ease: "power2.out" }, m0, at(0.55));
        span(tl, S.ribbon, { beatSnap: 1, ease: "none" }, at(0.5), at(1));
        break;
      case "export":
        span(tl, c.scalar, { selectAll: 1 }, at(0.28), at(0.33));
        span(tl, c.scalar, { selectAll: 0 }, at(0.4), at(0.45));
        // No compression toward the centre (the owner wants the timeline edge to edge at all times):
        // the export is a tighten of the lanes, a progress fill racing across the full-width bar,
        // a flash, and an elastic settle back to size.
        span(tl, S.ribbon, { widthFlat: WIDTH_FLAT_MULTIPLIER * 0.82, ease: "power3.in" }, m0, at(0.5));
        span(tl, S.ribbon, { exportFill: 1, ease: "power1.inOut" }, at(0.5), at(0.82));
        span(tl, S.post, { bloom: 1.6, ease: "power3.in" }, at(0.8), at(0.84));
        span(tl, S.dom, { flash: 0.6, ease: "power3.in" }, at(0.81), at(0.84));
        span(tl, S.dom, { flash: 0, ease: "power2.out" }, at(0.84), at(0.95));
        span(tl, S.post, { bloom: 0.85, ease: "power2.out" }, at(0.84), at(1));
        span(tl, S.ribbon, { widthFlat: WIDTH_FLAT_MULTIPLIER, ease: "elastic.out(1, 0.65)" }, at(0.84), at(1.3));
        tl.set(S.ribbon, { exportFill: 0 }, at(0.86));
        break;
    }
  });

  // The resolve: the playhead sweeps the shorter cut, the stat lands, the closing line streams.
  span(tl, S.ribbon, { playheadT: 1, ease: "power1.inOut" }, 0.85, 0.885);
  span(tl, S.panel, { stat: 1, ease: "power3.out" }, 0.862, 0.872);
  span(tl, S.focus, { blend: 0.92, ease: "power2.inOut" }, 0.858, 0.868);
  span(tl, S.panel, { closing: 1, ease: "none" }, 0.87, 0.89);
  span(tl, S.focus, { blend: 0.45, ease: "power2.inOut" }, 0.9, 0.93);

  /* ── ACT 5 · the pull back (0.89 → 1.0) ───────────────────────────────────────────────── */
  span(tl, S.cam, { r: mobile ? 680 : 470, phi: 1.42, theta: 0.16, ty: FLAT.y + 22, fov: 32, ease: "power2.inOut" }, 0.89, 0.97);
  span(tl, S.focus, { range: 1.6 }, 0.9, 0.97);
  span(tl, S.dom, { finalCta: 1, ease: "power3.out" }, 0.93, 0.965);
  // Everything fixed leaves with the canvas, so nothing from the piece bleeds into the sections below.
  span(tl, S.dom, { finalCta: 0, ease: "power2.in" }, 0.982, 1.0);
  span(tl, S.dom, { canvasOpacity: 0, hudOn: 0, ease: "power2.in" }, 0.975, 1.0);

  // Pin the timeline's end at exactly 1 so scroll maps 0..1 regardless of the last tween.
  tl.to({ end: 0 }, { end: 1, duration: 0.0001, ease: "none" }, 1 - 0.0001);
  return tl;
}
