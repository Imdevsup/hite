/**
 * components/site/HeroSetpiece.tsx — beats A–I of `docs/overhaul/HERO-SETPIECE.md`.
 *
 * THE OBJECT. One ribbon — twice the stage wide, so the frame crops it rather than containing it —
 * cut into plates by `lib/landing/hero-geometry.ts`'s solver. It arrives from the bottom right in
 * perspective, curls through a 270° twist so the viewer sees its face, its edge, its back, its edge
 * and its face again, settles right of centre, and then unwinds into the flat strip the rest of the
 * page works in. The same `<div>`s carry all of it: the curl is `transform`, the cut is `translate`
 * + `scale`, and CSS composes them in that order, so nothing is ever created, destroyed, swapped or
 * crossfaded. Beat D is continuous because there is no second object to be continuous WITH.
 *
 * ZERO JAVASCRIPT IN THE SCENE. Every motion is a CSS scroll-driven animation on a `view-timeline`
 * declared by the section itself; `SetpieceRuntime` sets `will-change` while the section is on
 * screen and hands the ~15% of browsers without scroll timelines a timed playthrough of the same
 * `@keyframes`. §16's "zero JS scroll consumers" holds for every visitor.
 *
 * WHAT THE SERVER PAINTS, AND WHY IT IS THE FINISHED STATE. §15 rule 1: the resting DOM must BE the
 * final state. It is — every animation in this file is authored inside
 * `@media (prefers-reduced-motion: no-preference)` and `@supports (animation-timeline: view())`, and
 * the values the markup itself carries are beat I: the strip already cut to `0:39`, six clips, five
 * cuts, the sentence sent, the three tool rows resolved, the lanes open, the numeral rolled. A
 * crawler, a JS-blocked visitor and a reduced-motion visitor read a complete, honest page; a
 * scroll-timeline browser watches it get there. There is no flash in either direction because there
 * is no second pass in either direction.
 *
 * WHERE THE NUMBERS COME FROM. `lib/landing/hero-scene.ts` — the geometry solver plus the generated
 * fixture. This file contains no measurement of its own; it lays the scene out and names things.
 */
import type { CSSProperties, ReactElement } from "react";

import { KiteMark } from "@/components/editor/KiteMark";
import { PRIMARY_CTA } from "@/lib/site/primaryCta";
import { HeroRibbonGL } from "./HeroRibbonGL";
import { CTA_MICROLINE, SOURCE_URL } from "./SiteChrome";
import { SetpieceRuntime } from "./SetpieceRuntime";
import { MECHANISM_HEADLINE, MECHANISM_SOURCE } from "@/lib/landing/fixture";
import {
  BODY_FRAMES,
  CAPTION_LANE_RENDERS,
  CUT_STEPS,
  FLAT_SCALE_MAX,
  FLAT_SCALE_STEPS,
  FLATTEN_KEYS,
  LANES,
  LOOK_GRADE,
  MOBILE_BREAKPOINT,
  MOBILE_FLAT_SCALE,
  MOBILE_FLAT_SCALE_Y,
  MOBILE_IGNITE,
  MOBILE_LANES,
  MOBILE_RIBBON_POSE,
  MOBILE_RIBBON_SPLIT,
  MOBILE_ROLL,
  MOBILE_SEND,
  MOBILE_TRACE,
  PERSPECTIVE_PX,
  RAIL_FLAT,
  RAKE_GRADIENT,
  RAKE_HOT,
  RAKE_WINDOWS,
  RESULT_CUTS_PX,
  RESULT_LENGTH_PX,
  RESULT_RECENTRE_PX,
  RIBBON,
  RIBBON_HEIGHT_PX,
  RIBBON_SPINE,
  RIBBON_RUNS_FLAT,
  SILENCE_BANDS_FLAT,
  BODY_KEYS_FLAT,
  FLAT_SCALE_STEPS_FLAT,
  LANES_FLAT,
  CLIP_LABELS,
  RIBBON_LENGTH_PX,
  RIBBON_RUNS,
  SECOND_PX,
  SEND_WINDOW,
  CLIP_GRADIENT,
  SILENCE_GRADIENT,
  SILENCE_IGNITE,
  TRACE_ROWS,
  TYPED_CHARS,
  beat,
  ownCollapse,
  railAlpha,
  restingCut,
  stepsBefore,
} from "@/lib/landing/hero-scene";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   COPY — 22 visible words above the scene, against §12's cap of 24
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The shipped H1, unchanged. `ART-DIRECTION.md` §3.1: "*cuts it* is a claim about the artifact,
 * verifiable on the same screen, and it does not promise obedience from a planner that proposes.
 * Do not change it."
 */
const HEADLINE = "Describe the edit. A real timeline cuts it.";

/**
 * The conversion — now `PRIMARY_CTA`'s, not this file's.
 *
 * ⚠ THE DEVIATION THIS FILE ONCE CLOSED HAS BEEN REOPENED, AND SETTLED THE OTHER WAY. The comment
 * that stood here argued the launcher contract "holds" on the strength of `app/app/page.tsx` being a
 * route in this build. That is a fact about the REPO; the CTA is a promise about a DEPLOYMENT, and the
 * two came apart when the owner settled the hosting model: www.tryhite.xyz serves the landing only,
 * and the editor runs on the visitor's machine after they clone. Both readings were half right, which
 * is why the argument kept reversing — on a laptop `/app` is genuinely one click away, and on the
 * public landing it is genuinely not there.
 *
 * So the answer is not a copy choice, it is a build-time fact: `lib/site/primaryCta.ts` derives which
 * deployment this bundle is for and hands back the label and href that are TRUE there. The hero, the
 * header, the closing band and the footer all read that one value, so the contradiction the old
 * comment describes — the hero saying one thing while the rest of the page says another — is now
 * unrepresentable rather than merely fixed.
 *
 * `ART-DIRECTION.md` §3.1's literal "**CTA** — `Open the editor`" survives wherever that is true.
 * The secondary link is unchanged and still goes to the source.
 */
const SECONDARY_LABEL = "Read the code";

/** The one line that says a picture is missing before anyone has to notice. §11's T0 state. */
const PROVENANCE_LINE = "No take committed. The timeline is real; the picture is not shipped.";

const COMMANDS_CAPTION = "The commands the reducer ran.";

const SKIP_TARGET = "after-setpiece";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   CSS
   ───────────────────────────────────────────────────────────────────────────────────────── */

const n = (v: number): string => (Math.round(v * 1000) / 1000).toString();
const px = (v: number): string => `${n(v)}px`;
const deg = (v: number): string => `${n(v)}deg`;
const pct = (v: number): string => `${n(v)}%`;

/**
 * Five decimals, for the one value three of them destroy.
 *
 * `n()` is right for a length in px, a degree and a percentage of travel: at 2880px and 144 plates,
 * a thousandth is far below a device pixel. It is wrong for `--sc`, which is a RATIO. `plate.sx` is
 * the chord length over the plate's flat width — under 1 by a fraction of a percent, which is
 * exactly what keeps a faceted curve from stretching the strip — and rounding it to three decimals
 * quantised every one of the 144 plates to `1`. The `scaleX(calc(1 + (var(--sc) - 1) * r))` term in
 * `sp-curl` was therefore a no-op in every transform and every keyframe stop: the geometry solver
 * computed a correction the DOM never received. Five decimals keep it, and cost 144 × 2 characters.
 */
const ratio = (v: number): string => (Math.round(v * 100000) / 100000).toString();

/**
 * The rigid body's transform at one frame of beats A–D.
 *
 * The settle scale is a viewport-dependent token (`--flat`, §"the settle scale" in `hero-scene.ts`),
 * so a keyframe cannot state it as a number and cannot state its INTERMEDIATE values as numbers
 * either. It states them as a fraction of the way there — `1 → var(--flat)` — which is exactly what
 * the interpolation between them would be, and stays correct at every breakpoint.
 */
function bodyTransform(f: (typeof BODY_FRAMES)[number], recentre = 0): string {
  const toFlat = (1 - f.scale) / (1 - FLAT_SCALE_MAX);
  const scale =
    toFlat === 0 ? "1" : toFlat === 1 ? "var(--flat)" : `calc(1 + (var(--flat) - 1) * ${n(toFlat)})`;
  // The recentre is in RIBBON px, so it has to ride the settle scale to land in stage px.
  const x =
    recentre === 0
      ? px(f.x)
      : `calc(${px(f.x)} + ${px(RESULT_RECENTRE_PX * recentre)} * var(--flat))`;
  return (
    `translate3d(${x}, ${px(f.y)}, ${px(f.z)}) ` +
    `rotateY(${deg(f.yaw)}) rotateX(${deg(f.pitch)}) scale(${scale})`
  );
}

/**
 * The unwind, as ONE shared keyframe block for every plate.
 *
 * `remaining` is how much of the curled pose is still applied at that stop, sampled off
 * `--ease-flatten`. Because a transform list interpolates function by function, multiplying every
 * term by the same scalar IS the partially-unwound pose — so one block, eleven stops, every plate
 * unwinding from its own curl, and no per-plate keyframes anywhere.
 */
function curlKeyframes(): string {
  const pose = (r: number): string =>
    `translate3d(calc(var(--cx) * ${n(r)}), calc(var(--cy) * ${n(r)}), calc(var(--cz) * ${n(r)})) ` +
    `rotateY(calc(var(--ry) * ${n(r)})) rotateZ(calc(var(--rz) * ${n(r)})) rotateX(calc(var(--rx) * ${n(r)})) ` +
    `scaleX(calc(1 + (var(--sc) - 1) * ${n(r)}))`;
  const stops = [
    `0%, ${pct(beat("D").from)} { transform: ${pose(1)}; }`,
    ...FLATTEN_KEYS.slice(1, -1).map((k) => `${pct(k.at)} { transform: ${pose(k.remaining)}; }`),
    `${pct(beat("D").to)}, 100% { transform: ${pose(0)}; }`,
  ];
  return `@keyframes sp-curl {\n  ${stops.join("\n  ")}\n}`;
}

/**
 * A window, as the four things every edition needs from it.
 *
 * `from`/`to` are fractions of whatever timeline the element rides — the scene's 180vh of travel on
 * desktop, the element's own card on a phone. `range()` writes the scroll-driven form and `delay()`
 * / `dur()` write the timed one, so a window is authored once and both editions read it. The
 * `calc(var(--x) * 100%)` construction in `animation-range` was verified to compute in Chrome
 * (`animation-range-start` resolves to a plain percentage), which is what lets the DOM carry one
 * unitless number per endpoint instead of a percentage AND a number.
 */
interface Window {
  readonly from: number;
  readonly to: number;
}

/** The timed edition's full length. §2.9.2 budgets the whole sequence at "≈ 8.5 s, played once". */
const PLAY_S = 9;

const secs = (fraction: number): string => `${n(PLAY_S * fraction)}s`;
/** `animation-delay` + `animation-duration` for a window, as a declaration pair. */
const timed = (w: Window): string =>
  `animation-delay: ${secs(w.from)}; animation-duration: ${secs(w.to - w.from)};`;
/** The same window as a scroll `animation-range`, inside whichever timeline phase the caller names. */
const phased = (phase: "contain" | "entry", w: Window): string =>
  `animation-range: ${phase} ${pct(w.from * 100)} ${phase} ${pct(w.to * 100)};`;
/** A window read from custom properties the element carries, in whatever phase the caller names. */
const ranged = (phase: string, k0: string, k1: string): string =>
  `animation-range: ${phase} calc(var(${k0}) * 100%) ${phase} calc(var(${k1}) * 100%);`;
const timedVar = (k0: string, k1: string): string =>
  `animation-delay: calc(${PLAY_S}s * var(${k0})); animation-duration: calc(${PLAY_S}s * (var(${k1}) - var(${k0})));`;

/**
 * The four declarations a scroll-driven rule needs — SPELLED OUT, because a pseudo-element cannot
 * carry a class and therefore cannot be reached by `.sp-anim`.
 *
 * THE DEFECT THIS EXISTS TO FIX. `.sp-anim` supplies `animation-timeline`, `animation-range`,
 * `animation-fill-mode` and `animation-duration` to every element in the scene. Animation properties
 * are NOT inherited, so `.sp-face::before`, `.sp-face::after`, `.sp-plate::before/::after` and
 * `.sp-msg::before` were each given an `animation-name` and nothing else: computed
 * `animation-timeline: auto`, `animation-duration: 0s`, `animation-fill-mode: none`. Measured in
 * Chrome — a 0s time-based animation that finishes before the first frame and leaves the element at
 * its resting value.
 *
 * So four of the scene's own animations have never once rendered, on any edition: the ground-colour
 * shade that models the twist, the two machined rails, the bubble surface, and — the expensive one —
 * `sp-rake`, the sixteen ranged opacity windows that ARE `HERO-SPEC.md` §2.3 Beat B's "light must
 * rake across it as it turns", the beat the whole CSS-3D technique was chosen to carry. The
 * `animation-range` computed correctly (`contain 39.267% contain 44.267%`), the gradient painted,
 * `--spec` resolved, and the light never moved because there was no timeline to move it along.
 */
const SCRUB = `animation-timeline: --scene; animation-timing-function: var(--ease-scroll); animation-fill-mode: both; animation-duration: auto;`;
/** The same, for a phone's per-card timeline. */
const SCRUB_M = (timeline: string): string =>
  `animation-timeline: ${timeline}; animation-timing-function: var(--ease-scroll); animation-fill-mode: both; animation-duration: auto;`;
/** The timed edition's shared declarations, for a pseudo that cannot be reached by `.sp-anim`. */
const PLAY = `animation-timing-function: var(--ease-scroll); animation-fill-mode: both; animation-iteration-count: 1;`;

/** A beat, as a fraction of the scene's travel. */
const scene = (from: number, to: number): Window => ({ from: from / 100, to: to / 100 });
/** A sub-window of a card, mapped through the card-local window `w`. */
const within = (w: Window, from: number, to: number): Window => ({
  from: w.from + (w.to - w.from) * from,
  to: w.from + (w.to - w.from) * to,
});

/**
 * The phone's timed playthrough, as three staggered cards.
 *
 * The scrubbed phone edition gives each card its own `view()` timeline, so the cards are ordered by
 * the thumb and need no schedule. The timed edition has no thumb, so the cards get one — overlapping
 * slightly, because a hard boundary between "the message landed" and "the strip cut" reads as three
 * clips rather than one sequence.
 */
const MOBILE_CARD_CHAT: Window = { from: 0, to: 0.44 };
const MOBILE_CARD_RIBBON: Window = { from: 0.36, to: 0.82 };
const MOBILE_CARD_READOUT: Window = { from: 0.74, to: 1 };

/** A per-element `--m0`/`--m1` window, mapped into a card's slot in the timed playthrough. */
const timedCardVar = (card: Window): string => {
  const span = card.to - card.from;
  return (
    `animation-delay: calc(${secs(card.from)} + ${secs(span)} * var(--m0)); ` +
    `animation-duration: calc(${secs(span)} * (var(--m1) - var(--m0)));`
  );
};

/** Progress of cut event `k` at travel `t`, 0 → 1 over its own 140ms-equivalent window. */
function cutProgress(k: number, t: number): number {
  const step = CUT_STEPS[k];
  if (t <= step.from) return 0;
  if (t >= step.to) return 1;
  return (t - step.from) / (step.to - step.from);
}

/** How far a plate downstream of `count` cut events has slid at travel `t`. */
function slideAt(count: number, t: number): number {
  let total = 0;
  for (let k = 0; k < count; k++) total += CUT_STEPS[k].widthPx * cutProgress(k, t);
  return total;
}

/** Sample points across beat H — fine enough that seven overlapping ramps read as seven events. */
function cutSamples(): number[] {
  const h = beat("H");
  const steps = 16;
  return Array.from({ length: steps + 1 }, (_, i) => h.from + ((h.to - h.from) * i) / steps);
}

/**
 * Beat H, as `translate` and `scale` — never `clip-path`.
 *
 * Blink does not composite `clip-path`, so seven simultaneous scroll-driven clip animations at the
 * payoff beat would tick on the main thread on every scroll frame — coupling scroll to the main
 * thread at exactly the moment the technique was chosen to avoid it. A run either survives whole and
 * slides (`translate`) or is deleted whole and collapses (`scale`), which is possible only because
 * no plate straddles a cut. Both are compositor properties, and `translate`/`scale` are the
 * INDIVIDUAL transform properties, so they compose with the curl's `transform` on the same element
 * rather than fighting it for the same declaration.
 */
function cutKeyframes(prefix: string, at: (t: number) => number): string {
  const blocks: string[] = [];
  const samples = cutSamples();
  const h = beat("H");
  const start = at(h.from);
  /* On a timeline that IS beat H, the hold before the first cut is the 0% stop itself, and emitting
     `0%, 0%` alongside it is a duplicate selector for no gain. */
  const hold = (declaration: string): string =>
    start <= 0 ? `0% { ${declaration} }` : `0%, ${pct(start)} { ${declaration} }`;

  for (let count = 1; count <= CUT_STEPS.length; count++) {
    const stops = samples.map((t) => `${pct(at(t))} { translate: ${px(-slideAt(count, t))}; }`);
    blocks.push(
      `@keyframes ${prefix}c${count} {\n  ${hold("translate: 0px;")}\n  ${stops.join("\n  ")}\n  100% { translate: ${px(-slideAt(count, h.to))}; }\n}`,
    );
  }

  CUT_STEPS.forEach((step, k) => {
    const stops = samples.map((t) => {
      const p = cutProgress(k, t);
      return `${pct(at(t))} { translate: calc(${px(-slideAt(k, t))} + var(--own) * ${n(p)}); scale: ${n(1 - p)} 1; }`;
    });
    blocks.push(
      `@keyframes ${prefix}x${k} {\n  ${hold("translate: 0px; scale: 1 1;")}\n  ${stops.join("\n  ")}\n  100% { translate: calc(${px(-slideAt(k, h.to))} + var(--own)); scale: 0 1; }\n}`,
    );
  });

  return blocks.join("\n");
}

/** Beat H's travel, remapped onto its own 0–100 — the phone's strip rides only this. */
function withinCut(t: number): number {
  const h = beat("H");
  return ((t - h.from) / (h.to - h.from)) * 100;
}

function flatScaleLadder(): string {
  return FLAT_SCALE_STEPS.map((step) =>
    step.maxWidth === null
      ? `.sp { --flat: ${n(step.scale)}; }`
      : `@media (max-width: ${step.maxWidth}px) { .sp { --flat: ${n(step.scale)}; } }`,
  ).join("\n");
}

const D = beat("D");
const E = beat("E");
const G = beat("G");
const H = beat("H");

const SETPIECE_CSS = `
/* ══════════════════════════════════════════════════════════════════════════════
   THE STAGE. 280vh of section, 100vh of pin, 180vh of travel — and \`contain 0%
   → contain 100%\` resolves to exactly that interval for a subject taller than
   the scrollport, so the timeline and the pin are the same thing by construction
   rather than by tuning. \`view-timeline-name\` on the section is enough: every
   animated element is a descendant, so no \`timeline-scope\` (not Baseline).
   ══════════════════════════════════════════════════════════════════════════ */
.sp {
  position: relative;
  height: 280vh;
  --persp: ${px(PERSPECTIVE_PX)};
  --ribbon-w: ${px(RIBBON_LENGTH_PX)};
  --ribbon-h: ${px(RIBBON_HEIGHT_PX)};
  --result-w: ${px(RESULT_LENGTH_PX)};
  --lane-h: var(--space-5);
  --chat-w: 520px;
}
${flatScaleLadder()}
@supports (animation-timeline: view()) {
  .sp { view-timeline-name: --scene; view-timeline-axis: block; }
}

/* \`overflow: clip\` sits on the STAGE, never on .scene-3d / .sp-ribbon / .sp-plate:
   paint containment on any of those three flattens the whole 3D context. Here it
   only does what a camera does — crop the object at the frame. */
.sp-stage {
  position: sticky; top: 0;
  height: 100vh;
  overflow: clip;
}
.sp-scene { position: absolute; inset: 0; }

/* THE GPU STRIP, AND THE HANDOFF.

   The canvas fills the stage and sits at the ribbon's own depth, so the chat panel (\`--z-stage-mid\`
   and above) still layers over it exactly as beat H requires. It is INERT until \`HeroRibbonGL\`
   sets \`data-gl="on"\`: no WebGL2, a shader that will not compile, a lost context, or a visitor who
   asked for less motion all take the same exit, which is to leave the flag unset. That is why the
   default here is \`opacity: 0\` rather than \`display: none\` — the element must already be laid out
   and sized when the first frame draws, or the canvas would report a zero client box and the scene
   would come up with a degenerate projection.

   The DOM ribbon is NOT removed when the canvas takes over, only made invisible. It carries the
   scene's accessible name (\`role="img"\` with the clip count and both timecodes) and it is what a
   crawler, a JS-blocked visitor and the reduced-motion edition read. Hiding it with
   \`visibility: hidden\` would take that name out of the tree along with the pixels. */
.sp-gl {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  z-index: var(--z-stage-mid);
  opacity: 0;
  pointer-events: none;
}
.sp[data-gl="on"] .sp-gl { opacity: 1; }
.sp[data-gl="on"] .sp-ribbon { opacity: 0; }
/* The lane BARS move onto the GPU with the strip — they are part of the same object and curl with
   it — but the lane ROWS and their LABELS stay in the DOM. That split is deliberate: the label is
   the human phrase for a registry key ("Whip Pan · Left", never \`trans-whip-pan-l\`), it is real
   text that can be read, selected and translated, and rasterising it into a canvas would throw all
   of that away to redraw something the DOM already does better. \`HeroRibbonGL\` places each bar
   inside its own row, so the two halves line up. */
.sp[data-gl="on"] .sp-lane-mark { opacity: 0; }
.sp-mid { position: absolute; top: 50%; left: 0; width: 1px; height: 1px; scroll-margin-top: var(--nav-h); }

/* ── THE COPY. Server-painted, full opacity, never animated: this is the LCP. ── */
/* The measure is set on the H1 itself, in its OWN em, because \`ch\` on the column
   resolves against the body face and lands three times too narrow at 96px. 8.4em
   fits "Describe the edit." and refuses "…edit. A", which is the break §3.3 asks
   for; \`text-wrap: balance\` (already on .t-hero) evens what is left. */
.sp-copy {
  position: absolute; left: var(--gutter); top: 10vh;
  z-index: var(--z-stage-front);
  display: flex; flex-direction: column; gap: var(--space-5);
  pointer-events: none;
}
.sp-copy > h1 { max-width: 8.4em; }
/* §3.3's microline is 13px --t-3 in the text face. .t-label is the mono rung and
   §5 keeps uppercase mono off this page by name, so it is not the class for this. */
.sp-micro { font-size: 13px; color: var(--t-3); letter-spacing: -0.005em; }
.sp-copy > * { pointer-events: auto; }
.sp-actions { display: flex; align-items: center; gap: var(--space-5); flex-wrap: wrap; }
.sp-secondary { font-size: 15px; color: var(--t-2); text-decoration: none; white-space: nowrap; }
@media (any-hover: hover) { .sp-secondary:hover { color: var(--t-1); text-decoration: underline; } }
.sp-secondary:focus-visible { box-shadow: var(--focus-ring); border-radius: var(--r-xs); outline: none; }

/* ══════════════════════════════════════════════════════════════════════════════
   THE RIBBON
   ══════════════════════════════════════════════════════════════════════════ */
.sp-ribbon {
  position: absolute; left: 50%; top: 50%;
  width: var(--ribbon-w); height: var(--ribbon-h);
  margin-left: calc(var(--ribbon-w) / -2);
  margin-top: calc(var(--ribbon-h) / -2);
  z-index: var(--z-stage-mid);
  /* THE RESTING POSE IS BEAT I, recentre included: the cut has already happened, so the object's
     middle is the RESULT's middle, not the source's. This is the transform a crawler, a JS-blocked
     visitor and a reduced-motion visitor get, and it has to line up with the lanes under it. */
  transform: translate3d(calc(${px(RESULT_RECENTRE_PX)} * var(--flat)), 0px, 0px)
             rotateY(0deg) rotateX(0deg) scale(var(--flat));
}
.sp-plate { position: absolute; top: 0; height: 100%; }
.sp-face, .sp-back { position: absolute; inset: 0; }

/* The face: one continuous 2880px drawing of the take, windowed by \`--l\`. Every
   stop is a real measurement — the eleven pauses at their own pixel positions,
   the six surviving clips at their own boundaries, one hairline per second of
   the take, a longer mark every five.

   THE STACK IS ORDERED, AND THE ORDER IS THE MEANING. Reading bottom-up it is:
   the strip's own material, then the FOOTAGE (\`CLIP_GRADIENT\`, warm — the six
   clips and the edge at every cut), then the MACHINE over it (\`SILENCE_GRADIENT\`,
   cyan on the seven pauses the planner takes), then the ruler. That is the page's
   whole colour argument in one element: warm is the take, cyan is what the AI did
   to it, and the AI's marks sit ON the footage because that is the direction the
   product works. Every layer above the material is transparent except where it has
   a measurement to draw, so nothing here is decoration filling space.

   The base gradient is UNCHANGED and still runs \`--color-bg-4 → --color-bg-1\`.
   It is the right material — \`--color-bg-2\` is annotated "strip fill, clip
   blocks" in the palette — and it was never the problem on its own. The problem
   was that it was the ONLY thing on the face, so the strip was pure background
   and disappeared into \`--ground\`. The lift comes from the layer above it
   carrying chroma, not from making the substrate lighter, which would have
   flattened the shading the curl depends on to read as a solid. */
.sp-face {
  overflow: hidden;
  box-shadow: var(--specular);
  background-image:
    linear-gradient(to top, var(--line-4) 0 1px, transparent 1px),
    repeating-linear-gradient(90deg, var(--line-4) 0 1px, transparent 1px ${px(SECOND_PX * 5)}),
    repeating-linear-gradient(90deg, var(--line-3) 0 1px, transparent 1px ${px(SECOND_PX)}),
    ${SILENCE_GRADIENT},
    ${CLIP_GRADIENT},
    linear-gradient(180deg, var(--color-bg-4) 0%, var(--color-bg-3) 34%, var(--color-bg-2) 78%, var(--color-bg-1) 100%);
  background-size:
    100% 100%,
    var(--ribbon-w) 26px,
    var(--ribbon-w) 14px,
    var(--ribbon-w) 100%,
    var(--ribbon-w) 100%,
    100% 100%;
  background-position:
    0 0,
    var(--l) 100%,
    var(--l) 100%,
    var(--l) 0,
    var(--l) 0,
    0 0;
  background-repeat: no-repeat;
}
/* The underside. A film strip's back carries no picture, so neither does this —
   the panel rung and one cross rule per second, and nothing else. */
.sp-back {
  transform: rotateY(180deg);
  box-shadow: var(--specular);
  background-image:
    repeating-linear-gradient(90deg, var(--line-3) 0 1px, transparent 1px ${px(SECOND_PX)}),
    linear-gradient(180deg, var(--color-bg-2) 0%, var(--color-bg-1) 62%, var(--color-panel) 100%);
  background-size: var(--ribbon-w) 100%, 100% 100%;
  background-repeat: repeat-x, no-repeat;
}
/* LAW 2 — every shadow on the property is the ground colour, never pure black.

   THE RESTING OPACITY IS BEAT I's, NOT BEAT A's, and that is a correction. These
   rules rested at \`var(--shade)\` / \`var(--bshade)\` — the CURLED lighting the
   solver computed for a plate mid-twist. Under a scroll timeline that never
   showed, because \`animation-fill-mode: both\` puts the 0% keyframe on screen at
   travel 0 and \`sp-shade\` resolves it to 0 by beat D. Everywhere else it did:
   reduced motion, the ~15% with no scroll timelines, and every phone rendered the
   FLAT strip with a twist's light and shade baked across it, banding a timeline
   that is supposed to be screen-parallel. The header of this file says the resting
   markup is beat I — "the strip already cut to 0:39, the lanes open" — so the
   resting light has to be beat I's too. The curl still starts lit: \`sp-shade\`'s
   own 0% stop reads \`var(--shade)\`, which the plate still carries. */
.sp-face::before, .sp-back::before {
  content: ""; position: absolute; inset: 0;
  background: rgb(var(--ground) / 1);
  opacity: 0;
}
/* The specular. A separate, hotter material than \`--rake\`; the bloom is BAKED
   into the gradient stops, because blur is banned in the LCP viewport (§16). */
.sp-face::after {
  content: ""; position: absolute; inset: 0;
  background-image: ${RAKE_GRADIENT};
  opacity: 0;
}
/* The two rails — the strip's machined edges, at LAW 1's alpha, on BOTH long
   edges. A wedge opens at every seam of a faceted twist; one rail closes half of
   it and leaks ground through the other. */
.sp-plate::before, .sp-plate::after {
  content: ""; position: absolute;
  left: 0; right: 0; height: var(--space-3);
  background: rgb(255 255 255 / ${n(RAKE_HOT)});
  /* Beat I, for the same reason as the shade above: a flat, face-on rail resolves
     to LAW 1's top-edge sheen, not to the curled per-plate alpha. */
  opacity: ${n(RAIL_FLAT)};
  transform-origin: 50% 0%;
  transform: rotateX(90deg);
}
.sp-plate::before { top: 0; }
.sp-plate::after { top: 100%; }

/* ── The seven pauses, lit when findSilences returns, collapsing when it lands ── */
.sp-ignite {
  position: absolute; top: 0; height: 100%;
  background: var(--color-accent-dim);
  opacity: 0;
}
/* The editor's own change-diff treatment, on the five new clip boundaries. */
.sp-diff {
  position: absolute; top: 0; height: 100%; width: 1px;
  background: var(--color-accent);
  opacity: 0;
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE CHAT
   ══════════════════════════════════════════════════════════════════════════ */
.sp-chat {
  position: absolute; right: var(--gutter);
  bottom: calc(50% + var(--space-7));
  width: min(var(--chat-w), calc(100% - var(--gutter) * 2));
  z-index: var(--z-stage-back);
  padding: var(--space-5);
  background: var(--color-panel);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-md);
  box-shadow: var(--specular), 0 32px 72px -28px rgb(var(--ground) / 0.88);
  transform: translate3d(0, ${px(40)}, ${px(40)});
}
.sp-log { position: relative; display: flex; flex-direction: column; gap: var(--space-3); }

/* THE PLANNER-RUNNING STATE — §2.3: "The kite sways (.kitemark-sway) while the
   run is open … This is the editor's own planner-running state, reused verbatim,
   which is why the landing and the product cannot drift."

   It is also what keeps beat F from being a void. The five trace rows reveal on
   OPACITY, which is the only way a five-row burst costs no layout — so they hold
   their ~190px from the first frame, and between the sentence landing (beat F) and
   the first tool returning (beat G) the panel was a large empty rectangle with a
   chip in one corner. This sits over that reserved space, says the one true thing
   about the moment, and fades out as the first row resolves. Absolutely
   positioned, so it adds nothing to the panel's height and moves nothing when it
   goes. Never a spinner: §10 is explicit that the kite sways and does not spin. */
.sp-working {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; gap: var(--space-3);
  font-size: var(--fs-label); color: var(--t-3);
  letter-spacing: var(--tk-mono);
  font-family: var(--font-mono), ui-monospace, monospace;
  opacity: 0;
}
.sp-msg {
  align-self: flex-end; position: relative;
  max-width: 88%; padding: 8px 12px;
  font-size: var(--fs-body); color: var(--t-1);
}
.sp-msg::before {
  content: ""; position: absolute; inset: 0;
  background: var(--color-bg-2); border-radius: var(--radius-sm);
  z-index: -1;
}
.sp-row {
  display: grid; grid-template-columns: auto 1fr; align-items: baseline;
  column-gap: var(--space-3); padding-block: 2px;
}
.sp-tool { font-family: var(--font-mono), ui-monospace, monospace; font-size: var(--fs-label); color: var(--t-2); letter-spacing: var(--tk-mono); }
.sp-res  { font-family: var(--font-mono), ui-monospace, monospace; font-size: var(--fs-label); color: var(--t-3); letter-spacing: var(--tk-mono); font-variant-numeric: tabular-nums slashed-zero; }
.sp-note {
  grid-column: 2; font-size: var(--fs-label); color: var(--t-3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sp-composer {
  margin-top: var(--space-4); height: 44px;
  display: flex; align-items: center; padding-inline: 12px;
  background: var(--color-bg-2);
  border: 1px solid var(--line-5);
  border-radius: var(--radius-sm);
}
.sp-caret { width: 2px; height: 18px; background: var(--color-accent); }

/* ══════════════════════════════════════════════════════════════════════════════
   THE READOUT — the lanes, the numeral, the provenance
   ══════════════════════════════════════════════════════════════════════════ */
.sp-readout {
  position: absolute; left: 50%; top: calc(50% + var(--ribbon-h) * var(--flat) / 2 + var(--space-4));
  width: calc(var(--result-w) * var(--flat));
  margin-left: calc(var(--result-w) * var(--flat) / -2);
  z-index: var(--z-stage-mid);
}
.sp-lane {
  position: relative; height: var(--lane-h);
  margin-top: 2px;
  border-bottom: 1px solid var(--line-1);
  transform-origin: 50% 0%;
  transform: scaleY(1);
}
.sp-lane-mark {
  position: absolute; top: 0; bottom: 0;
  border-radius: var(--r-xs);
  background: var(--color-bg-2);
  box-shadow: inset 0 0 0 1px var(--line-3);
  overflow: hidden;
}
.sp-lane-tint { position: absolute; inset: 0; }
.sp-lane-label {
  position: absolute; left: calc(var(--mark-x) + 6px); top: 50%; translate: 0 -50%;
  font-size: var(--fs-label); color: var(--t-2); white-space: nowrap;
}
.sp-numeral-row {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: var(--space-5); margin-top: var(--space-6);
}
/* The roll is a two-line column inside a one-line window. Without the explicit
   height the window is two lines tall, the row's baseline lands 128px low, and
   the caption beside it drifts off the numeral it belongs to. */
.sp-numeral { display: block; height: 1em; line-height: 1; color: var(--t-1); }
.sp-roll-col { display: flex; flex-direction: column; transform: translateY(-50%); }
.sp-roll-col > span { display: block; height: 1em; line-height: 1; }
.sp-sub { font-size: 13px; color: var(--t-3); font-variant-numeric: tabular-nums slashed-zero; }

/* ══════════════════════════════════════════════════════════════════════════════
   BELOW THE PIN
   ══════════════════════════════════════════════════════════════════════════ */
.sp-foot { padding-block: var(--section-y-tight); }
.sp-pre {
  max-width: 640px; max-height: 220px; overflow: auto;
  font-size: 13px; line-height: 1.7;
  color: var(--t-3);
  border-inline-start: 1px solid var(--line-2);
  padding-inline-start: var(--space-5);
}

/* ══════════════════════════════════════════════════════════════════════════════
   MOTION. Everything below is opt-in twice over: the browser must support scroll
   timelines AND the visitor must not have asked for less. The resting values
   above are beat I — the finished edit — so the reduced edition is not a stripped
   one, it is the page.
   ══════════════════════════════════════════════════════════════════════════ */
${curlKeyframes()}
@keyframes sp-body {
${BODY_FRAMES.map((f) => `  ${pct(f.at)} { transform: ${bodyTransform(f)}; }`).join("\n")}
  ${pct(H.from)} { transform: ${bodyTransform(BODY_FRAMES[BODY_FRAMES.length - 1])}; }
${CUT_STEPS.map(
  (s) =>
    `  ${pct(s.to)} { transform: ${bodyTransform(BODY_FRAMES[BODY_FRAMES.length - 1], s.cumulativePx / (RIBBON_LENGTH_PX - RESULT_LENGTH_PX))}; }`,
).join("\n")}
  100% { transform: ${bodyTransform(BODY_FRAMES[BODY_FRAMES.length - 1], 1)}; }
}
@keyframes sp-shade {
  0%, ${pct(D.from)} { opacity: var(--shade); }
  ${pct(D.to)}, 100% { opacity: 0; }
}
@keyframes sp-bshade {
  0%, ${pct(D.from)} { opacity: var(--bshade); }
  ${pct(D.to)}, 100% { opacity: 0; }
}
@keyframes sp-rail {
  0%, ${pct(D.from)} { opacity: var(--rail); }
  ${pct(D.to)}, 100% { opacity: ${n(RAIL_FLAT)}; }
}
@keyframes sp-rake {
  0%   { opacity: 0; transform: translate3d(-28%, 0, 0); }
  46%  { opacity: var(--spec); }
  100% { opacity: 0; transform: translate3d(28%, 0, 0); }
}
${cutKeyframes("sp-", (t) => t)}
${cutKeyframes("sp-m", withinCut)}
@keyframes sp-chat {
  0%, ${pct(E.from)} { transform: translate3d(0, ${px(56)}, ${px(-180)}); opacity: 0; }
  ${pct(E.to)}       { transform: translate3d(0, 0, ${px(-120)}); opacity: 1; }
  ${pct(H.from)}     { transform: translate3d(0, 0, ${px(-120)}); opacity: 1; }
  ${pct(H.to)}, 100% { transform: translate3d(0, ${px(40)}, ${px(40)}); opacity: 1; }
}
@keyframes sp-type { from { opacity: 0; } to { opacity: 1; } }
@keyframes sp-send {
  0%, ${pct(SEND_WINDOW.from)} { transform: translate3d(0, ${px(52)}, 0); }
  ${pct(SEND_WINDOW.to)}, 100% { transform: translate3d(0, 0, 0); }
}
@keyframes sp-surface { from { opacity: 0; } to { opacity: 1; } }
@keyframes sp-fade { from { opacity: 0; } to { opacity: 1; } }
/* The run is open from the moment the sentence is sent to the moment the first
   tool returns, and closed after — so this holds, then goes. */
@keyframes sp-working {
  0%, ${pct(SEND_WINDOW.from)} { opacity: 0; }
  ${pct(SEND_WINDOW.to)}, ${pct(SILENCE_IGNITE.from)} { opacity: 1; }
  ${pct(TRACE_ROWS[0].to)}, 100% { opacity: 0; }
}
@keyframes sp-m-working {
  0%, ${pct(MOBILE_SEND.from * 100)} { opacity: 0; }
  ${pct(MOBILE_SEND.to * 100)}, ${pct(MOBILE_TRACE.from * 100)} { opacity: 1; }
  ${pct(MOBILE_TRACE.from * 100 + (MOBILE_TRACE.to - MOBILE_TRACE.from) * 100 * TRACE_ROWS[0].mTo)}, 100% { opacity: 0; }
}
@keyframes sp-diff-flash { 0% { opacity: 0; } 24% { opacity: 1; } 100% { opacity: 0; } }
@keyframes sp-lane-open {
  from { transform: scaleY(0); opacity: 0; }
  to   { transform: scaleY(1); opacity: 1; }
}
@keyframes sp-roll {
  0%, ${pct(H.from + (H.to - H.from) * 0.55)} { transform: translateY(0); }
  ${pct(H.to)}, 100% { transform: translateY(-50%); }
}
@keyframes sp-blink { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } }

/* ── THE PHONE'S OWN KEYFRAMES ────────────────────────────────────────────────
   Not the desktop set shrunk: the strip is already flat and screen-parallel at
   390, so what a phone gets is the object's ANGLE resolving, the message landing,
   the trace resolving, the cut firing and the lanes opening. Each is a plain
   from→to pair driven inside a sub-range of its own card, which is what lets one
   window definition serve both the scrubbed and the timed edition. */
@keyframes sp-m-object {
  from { transform: translate3d(0, 0, ${px(MOBILE_RIBBON_POSE.zPx)}) rotateY(${deg(MOBILE_RIBBON_POSE.yawDeg)}) rotateX(4deg) scale(var(--flat), var(--flat-y)); }
  to   { transform: translate3d(0, 0, 0) rotateY(0deg) rotateX(4deg) scale(var(--flat), var(--flat-y)); }
}
@keyframes sp-m-rise {
  from { opacity: 0; transform: translate3d(0, ${px(32)}, 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes sp-m-send {
  from { transform: translate3d(0, ${px(52)}, 0); }
  to   { transform: translate3d(0, 0, 0); }
}
@keyframes sp-m-roll {
  from { transform: translateY(0); }
  to   { transform: translateY(-50%); }
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE SCRUBBED EDITION — desktop, ≥900px, one named timeline over 180vh of pin.
   Opt-in twice over: the browser must support scroll timelines AND the visitor
   must not have asked for less. The resting values above are beat I — the
   finished edit — so the reduced edition is not a stripped one, it is the page.
   ══════════════════════════════════════════════════════════════════════════ */
/* SCRUBBED-DESKTOP-BEGIN */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) and (min-width: ${MOBILE_BREAKPOINT}px) {
    .sp-anim {
      animation-timeline: --scene;
      animation-range: contain 0% contain 100%;
      animation-timing-function: var(--ease-scroll);
      animation-fill-mode: both;
      animation-duration: auto;
    }
    .sp-ribbon { animation-name: sp-body; }
    .sp-plate  { animation-name: sp-curl; }
    .sp-plate.sp-cut { animation-name: sp-curl, var(--cut-anim); }
    /* The five pseudo rules carry SCRUB themselves — see the note on it. */
    .sp-face::before { animation-name: sp-shade; ${SCRUB} animation-range: contain 0% contain 100%; }
    .sp-back::before { animation-name: sp-bshade; ${SCRUB} animation-range: contain 0% contain 100%; }
    .sp-plate::before, .sp-plate::after { animation-name: sp-rail; ${SCRUB} animation-range: contain 0% contain 100%; }
    .sp-lit .sp-face::after { animation-name: sp-rake; ${SCRUB} ${ranged("contain", "--k0", "--k1")} }
    .sp-ignite {
      animation-name: sp-fade, var(--cut-anim);
      animation-range: contain ${pct(SILENCE_IGNITE.from)} contain ${pct(SILENCE_IGNITE.to)}, contain 0% contain 100%;
    }
    .sp-diff { animation-name: sp-diff-flash; animation-range: contain ${pct(H.to)} contain 100%; }
    .sp-chat { animation-name: sp-chat; }
    .sp-msg  { animation-name: sp-send; }
    .sp-msg::before { animation-name: sp-surface; ${SCRUB} ${phased("contain", scene(SEND_WINDOW.from, SEND_WINDOW.to))} }
    .sp-char { animation-name: sp-type; ${ranged("contain", "--k0", "--k1")} }
    .sp-row  { animation-name: sp-fade; ${ranged("contain", "--k0", "--k1")} }
    .sp-working { animation-name: sp-working; }
    .sp-lane { animation-name: sp-lane-open; ${ranged("contain", "--k0", "--k1")} }
    .sp-roll-col { animation-name: sp-roll; }
    /* The readout arrives WHILE the agent works, so the numeral is solid before it rolls.
       Fading it across beat H instead would wash the payoff out at the exact frame it lands. */
    .sp-readout { animation-name: sp-fade; ${phased("contain", scene(G.from, H.from))} }
  }
}

/* SCRUBBED-DESKTOP-END */
/* ══════════════════════════════════════════════════════════════════════════════
   THE SCRUBBED EDITION — phone, <900px. §2.6.3: no pin, and "each card is its own
   view() subject". Three cards, three named timelines declared on the blocks
   themselves so their own descendants resolve without \`timeline-scope\` (not
   Baseline, and §2.0.1 avoids it by name for the same reason). The column is
   re-ordered so the sentence causes the cut rather than following it — see
   MOBILE_RIBBON_SPLIT in hero-scene.ts for why the cut rides the strip's own pass.
   ══════════════════════════════════════════════════════════════════════════ */
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) and (max-width: ${MOBILE_BREAKPOINT - 1}px) {
    .sp-chat    { view-timeline-name: --m-chat;    view-timeline-axis: block; }
    .sp-ribbon  { view-timeline-name: --m-ribbon;  view-timeline-axis: block; }
    .sp-readout { view-timeline-name: --m-readout; view-timeline-axis: block; }

    .sp-anim {
      animation-timing-function: var(--ease-scroll);
      animation-fill-mode: both;
      animation-duration: auto;
      animation-range: entry 0% entry 100%;
    }

    /* CARD 2 — the sentence and the five tool calls. The typing itself is NOT
       scrubbed: §2.6.3 is explicit that "a 16-character scroll-scrubbed reveal is
       unreadable on a phone in motion", so the sentence rests typed and only the
       send and the trace move. */
    .sp-chat { animation-timeline: --m-chat; animation-name: sp-m-rise; }
    .sp-msg  { animation-timeline: --m-chat; animation-name: sp-m-send; ${phased("entry", MOBILE_SEND)} }
    .sp-msg::before { animation-name: sp-surface; ${SCRUB_M("--m-chat")} ${phased("entry", MOBILE_SEND)} }
    .sp-row  { animation-timeline: --m-chat; animation-name: sp-fade; ${ranged("entry", "--m0", "--m1")} }
    .sp-working { animation-timeline: --m-chat; animation-name: sp-m-working; }

    /* CARD 1+3 — the object squares up, then THE CUT fires on the same strip. */
    .sp-ribbon { animation-timeline: --m-ribbon; animation-name: sp-m-object; ${phased("entry", { from: 0, to: MOBILE_RIBBON_SPLIT.poseTo })} }
    .sp-plate.sp-cut {
      animation-timeline: --m-ribbon;
      animation-name: var(--cut-anim-m);
      ${phased("entry", { from: MOBILE_RIBBON_SPLIT.cutFrom, to: 1 })}
    }
    .sp-ignite {
      animation-timeline: --m-ribbon;
      animation-name: sp-fade, var(--cut-anim-m);
      animation-range:
        entry ${pct(MOBILE_IGNITE.from * 100)} entry ${pct(MOBILE_IGNITE.to * 100)},
        entry ${pct(MOBILE_RIBBON_SPLIT.cutFrom * 100)} entry 100%;
    }
    .sp-diff {
      animation-timeline: --m-ribbon;
      animation-name: sp-diff-flash;
      animation-range: entry ${pct(MOBILE_RIBBON_SPLIT.cutFrom * 100)} entry 100%;
    }

    /* CARD 3 — the lanes open and the numeral rolls, under the strip that just cut. */
    .sp-readout  { animation-timeline: --m-readout; animation-name: sp-fade; animation-range: entry 0% entry ${pct(MOBILE_LANES.from * 100)}; }
    .sp-lane     { animation-timeline: --m-readout; animation-name: sp-lane-open; ${ranged("entry", "--m0", "--m1")} }
    .sp-roll-col { animation-timeline: --m-readout; animation-name: sp-m-roll; animation-range: entry ${pct(MOBILE_ROLL.from * 100)} entry ${pct(MOBILE_ROLL.to * 100)}; }
  }
}

/* The caret is the one thing that keeps moving after 100%, and it is time-based
   because a blink is not a position. */
@media (prefers-reduced-motion: no-preference) {
  .sp-caret { animation: sp-blink var(--dur-caret) steps(1, end) infinite; }
}

/* ── THE TIMED EDITION (~15%: iOS ≤ 18.7, Firefox ≤ 156) ──────────────────────
   The identical @keyframes on a duration instead of a timeline, played once. It
   IS a degradation and it is stated as one: the viewer does not control the rate.
   The section un-pins, because a 180vh pin with nothing scroll-linked in it is
   180vh of dead scroll. Never under reduced motion — SetpieceRuntime checks. */
@supports not (animation-timeline: view()) {
  .sp { height: auto; }
  .sp-stage { position: static; height: 100vh; }
}
/* §17 — the reduced edition is a DESIGNED STATE, not a freeze. Nothing is frozen mid-animation and
   nothing is blanked: the resting DOM above IS the finished edit, so this only has to stop the
   section reserving 180vh of pin for a scene that is not going to play. */
@media (prefers-reduced-motion: reduce) {
  .sp { height: auto; }
  .sp-stage { position: static; height: 100vh; }
}
/* THE WHOLE TABLE, NOT THE OBJECT HALF OF IT.
   §2.9.2 tables every beat of this edition — A→C, D, E, F's typing, G, H, I — and
   this block used to name six selectors: the ribbon, the plates, the two shade
   sheets, the chat and the numeral column. The object moved and the narrative did
   not: no typing, no rake, no probe rows, no ignition, no change-diff, no lanes.
   The elements rest at their final state, so nothing LOOKED broken — which is why
   it survived — but ~15% of visitors (iOS ≤ 18.7, Firefox ≤ 156) watched a strip
   fold itself with no sentence and no tool calls anywhere near it, which is the
   one thing the scene exists to show.

   The ranged elements read the same 0–1 window the scrubbed edition reads and turn
   it into a delay and a duration, so the two editions cannot drift: there is one
   window per element, in one place, and timedVar() is the only translation. */
/* TIMED-DESKTOP-BEGIN */
@media (min-width: ${MOBILE_BREAKPOINT}px) {
  .sp[data-play="true"] .sp-anim {
    animation-duration: ${PLAY_S}s;
    animation-timing-function: var(--ease-scroll);
    animation-fill-mode: both;
    animation-iteration-count: 1;
  }
  .sp[data-play="true"] .sp-ribbon { animation-name: sp-body; }
  .sp[data-play="true"] .sp-plate  { animation-name: sp-curl; }
  .sp[data-play="true"] .sp-plate.sp-cut { animation-name: sp-curl, var(--cut-anim); }
  .sp[data-play="true"] .sp-face::before { animation-name: sp-shade; ${PLAY} animation-duration: ${PLAY_S}s; }
  .sp[data-play="true"] .sp-back::before { animation-name: sp-bshade; ${PLAY} animation-duration: ${PLAY_S}s; }
  .sp[data-play="true"] .sp-plate::before,
  .sp[data-play="true"] .sp-plate::after { animation-name: sp-rail; ${PLAY} animation-duration: ${PLAY_S}s; }
  .sp[data-play="true"] .sp-lit .sp-face::after { animation-name: sp-rake; ${PLAY} ${timedVar("--k0", "--k1")} }
  .sp[data-play="true"] .sp-chat { animation-name: sp-chat; }
  .sp[data-play="true"] .sp-msg  { animation-name: sp-send; }
  .sp[data-play="true"] .sp-msg::before { animation-name: sp-surface; ${PLAY} ${timed(scene(SEND_WINDOW.from, SEND_WINDOW.to))} }
  .sp[data-play="true"] .sp-char { animation-name: sp-type; ${timedVar("--k0", "--k1")} }
  .sp[data-play="true"] .sp-row  { animation-name: sp-fade; ${timedVar("--k0", "--k1")} }
  .sp[data-play="true"] .sp-working { animation-name: sp-working; animation-duration: ${PLAY_S}s; }
  .sp[data-play="true"] .sp-ignite {
    animation-name: sp-fade, var(--cut-anim);
    animation-delay: ${secs(SILENCE_IGNITE.from / 100)}, 0s;
    animation-duration: ${secs((SILENCE_IGNITE.to - SILENCE_IGNITE.from) / 100)}, ${PLAY_S}s;
  }
  .sp[data-play="true"] .sp-diff { animation-name: sp-diff-flash; ${timed(scene(H.to, 100))} }
  .sp[data-play="true"] .sp-readout { animation-name: sp-fade; ${timed(scene(G.from, H.from))} }
  .sp[data-play="true"] .sp-lane { animation-name: sp-lane-open; ${timedVar("--k0", "--k1")} }
  .sp[data-play="true"] .sp-roll-col { animation-name: sp-roll; }
}

/* TIMED-DESKTOP-END */
/* The phone's timed edition. The three cards are staggered rather than fired at
   once, because on a phone they are three screens and simultaneous playback would
   spend the whole sequence on whichever one happens to be in front of the thumb. */
@media (max-width: ${MOBILE_BREAKPOINT - 1}px) {
  .sp[data-play="true"] .sp-anim {
    animation-timing-function: var(--ease-scroll);
    animation-fill-mode: both;
    animation-iteration-count: 1;
  }
  .sp[data-play="true"] .sp-chat { animation-name: sp-m-rise; ${timed(within(MOBILE_CARD_CHAT, 0, 1))} }
  .sp[data-play="true"] .sp-msg  { animation-name: sp-m-send; ${timed(within(MOBILE_CARD_CHAT, MOBILE_SEND.from, MOBILE_SEND.to))} }
  .sp[data-play="true"] .sp-msg::before { animation-name: sp-surface; ${PLAY} ${timed(within(MOBILE_CARD_CHAT, MOBILE_SEND.from, MOBILE_SEND.to))} }
  .sp[data-play="true"] .sp-row  { animation-name: sp-fade; ${timedCardVar(MOBILE_CARD_CHAT)} }
  .sp[data-play="true"] .sp-working { animation-name: sp-m-working; ${timed(MOBILE_CARD_CHAT)} }
  .sp[data-play="true"] .sp-ribbon { animation-name: sp-m-object; ${timed(within(MOBILE_CARD_RIBBON, 0, MOBILE_RIBBON_SPLIT.poseTo))} }
  .sp[data-play="true"] .sp-plate.sp-cut {
    animation-name: var(--cut-anim-m);
    ${timed(within(MOBILE_CARD_RIBBON, MOBILE_RIBBON_SPLIT.cutFrom, 1))}
  }
  .sp[data-play="true"] .sp-ignite {
    animation-name: sp-fade, var(--cut-anim-m);
    animation-delay: ${secs(within(MOBILE_CARD_RIBBON, MOBILE_IGNITE.from, MOBILE_IGNITE.to).from)}, ${secs(within(MOBILE_CARD_RIBBON, MOBILE_RIBBON_SPLIT.cutFrom, 1).from)};
    animation-duration: ${secs(within(MOBILE_CARD_RIBBON, MOBILE_IGNITE.from, MOBILE_IGNITE.to).to - within(MOBILE_CARD_RIBBON, MOBILE_IGNITE.from, MOBILE_IGNITE.to).from)}, ${secs(within(MOBILE_CARD_RIBBON, MOBILE_RIBBON_SPLIT.cutFrom, 1).to - within(MOBILE_CARD_RIBBON, MOBILE_RIBBON_SPLIT.cutFrom, 1).from)};
  }
  .sp[data-play="true"] .sp-diff { animation-name: sp-diff-flash; ${timed(within(MOBILE_CARD_RIBBON, MOBILE_RIBBON_SPLIT.cutFrom, 1))} }
  .sp[data-play="true"] .sp-readout { animation-name: sp-fade; ${timed(within(MOBILE_CARD_READOUT, 0, MOBILE_LANES.from))} }
  .sp[data-play="true"] .sp-lane { animation-name: sp-lane-open; ${timedCardVar(MOBILE_CARD_READOUT)} }
  .sp[data-play="true"] .sp-roll-col { animation-name: sp-m-roll; ${timed(within(MOBILE_CARD_READOUT, MOBILE_ROLL.from, MOBILE_ROLL.to))} }
}

/* ── MOBILE, AND WHY IT IS NOT THE SAME SCENE SHRUNK ──────────────────────────
   §8 is categorical: there is no pin on mobile ("pinning at 844px tall traps a
   thumb"), so the 180vh scrubbed scene is not available at all. What survives is
   the half that carries the meaning — the sentence, the trace, the strip, the cut,
   the lanes — plus the ribbon's POSE, because perspective is geometry, not motion.
   The 270° curl is a desktop set-piece and it is honest to say so rather than to
   run 144 twisting planes on a phone; the object still arrives at an angle and
   squares up, which is §2.6.3's Card 1 gesture.

   THE COLUMN IS RE-ORDERED, AND THAT IS THE ONE STRUCTURAL DEPARTURE. §2.6.3
   composes three cards each carrying their own copy of the picture. There is one
   ribbon in this DOM, and a strip that has scrolled past cannot be seen to cut —
   so the cut has to ride the strip's own pass, and the sentence has to come first
   or the payoff precedes its cause. Chat, then the strip, then the lanes and the
   numeral: cause, effect, result, on one object instead of three. */
@media (max-width: ${MOBILE_BREAKPOINT - 1}px) {
  .sp { height: auto; --flat: ${n(MOBILE_FLAT_SCALE)}; --flat-y: ${n(MOBILE_FLAT_SCALE_Y)}; --chat-w: 100%; }
  /* §2.6.1: --persp is the ribbon's own flat length, so the perspective is
     self-similar at every width. The NAME survives; only the value is scoped. */
  .sp-stage {
    position: static; height: auto; overflow-x: clip;
    padding-block: var(--section-y-tight); padding-inline: var(--gutter);
    display: flex; flex-direction: column; gap: var(--space-7);
  }
  .sp-scene {
    position: relative; inset: auto;
    display: flex; flex-direction: column; gap: var(--space-6);
    perspective: calc(var(--ribbon-w) * var(--flat));
  }
  .sp-copy { position: static; max-width: none; }
  /* transform-origin at the TOP-left, so the negative margin that reclaims the
     unscaled layout height leaves the object exactly where the flow put it. */
  .sp-ribbon {
    order: 2;
    position: relative; left: auto; top: auto;
    margin: 0 0 calc(var(--ribbon-h) * (var(--flat-y) - 1)) 0;
    transform: translate3d(0, 0, 0) rotateY(0deg) rotateX(4deg) scale(var(--flat), var(--flat-y));
    transform-origin: 0 0;
  }
  .sp-chat { order: 1; position: relative; right: auto; bottom: auto; width: 100%; transform: translate3d(0, 0, 0); }
  .sp-readout {
    order: 3;
    position: relative; left: auto; top: auto; margin-left: 0;
    width: calc(var(--result-w) * var(--flat));
  }
  /* §8: "Numeral — --fs-numeral floor = 72px, LEFT-ALIGNED under the strip."
     The desktop row is space-between, which puts a 72px four-glyph numeral
     (~220px of Martian Mono at wdth 112.5) opposite a caption inside a 264px
     readout — so the numeral was clipped by the stage's own overflow clip and
     shipped as "0:3". The two stack instead, both flush left, which is what §8
     asked for and what leaves the numeral its full measure. */
  .sp-numeral-row {
    flex-direction: column; align-items: flex-start;
    gap: var(--space-3); margin-top: var(--space-5);
  }
  .sp-foot .sp-pre { max-height: 180px; }
}

@media (prefers-contrast: more) {
  .sp-face::before, .sp-back::before { opacity: calc(var(--shade) * 0.7); }
}
`;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE COMPONENT
   ───────────────────────────────────────────────────────────────────────────────────────── */

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const RAKE_BY_PLATE = new Map(RAKE_WINDOWS.map((w) => [w.plate, w]));

const RIBBON_ID = "sp-ribbon";

export interface HeroSetpieceProps {
  /** The hero anchor — the top of the section. */
  readonly id?: string;
  /** The "How it works" anchor, dropped at the beat where the mechanism starts. */
  readonly mechanismId?: string;
  readonly repoHref?: string;
}

export function HeroSetpiece({
  id = "hero",
  mechanismId = "how-it-works",
  repoHref = SOURCE_URL,
}: HeroSetpieceProps): ReactElement {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SETPIECE_CSS }} />

      <section id={id} className="sp" aria-labelledby="sp-h1">
        {/* §16: a 180vh pin is a keyboard trap without an escape, and the escape has to be first. */}
        <a href={`#${SKIP_TARGET}`} className="skip-inline">
          Skip the set-piece
        </a>

        <div className="sp-stage">
          {/* FIRST in the DOM, absolutely placed on desktop: the H1 is the LCP element and it must
              not be behind anything, in markup or in paint. */}
          <div className="sp-copy">
            <h1 id="sp-h1" className="t-hero">
              {HEADLINE}
            </h1>
            <p className="sp-micro arrive" style={{ "--arrive-delay": "var(--stagger-arrive)" } as Vars}>
              {CTA_MICROLINE}
            </p>
            <div
              className="sp-actions arrive"
              style={{ "--arrive-delay": "calc(var(--stagger-arrive) * 2)" } as Vars}
            >
              <a className="cta" href={PRIMARY_CTA.href}>
                {PRIMARY_CTA.label}
              </a>
              <a className="sp-secondary" href={repoHref} rel="noreferrer">
                {SECONDARY_LABEL} ↗
              </a>
            </div>
          </div>

          {/* The GPU strip, and the DOM strip it replaces once it is live. Order matters: the DOM
              ribbon inside `.sp-scene` is what server-renders and paints for the LCP, and the canvas
              only takes over after `HeroRibbonGL` sets `data-gl="on"` on the section. Everything that
              can go wrong there — no WebGL2, a failed compile, a lost context, reduced motion — takes
              the same exit, which is simply never setting the flag. */}
          <HeroRibbonGL
            sectionId={id}
            spine={RIBBON_SPINE}
            runs={RIBBON_RUNS_FLAT}
            silences={SILENCE_BANDS_FLAT}
            lengthPx={RIBBON_LENGTH_PX}
            heightPx={RIBBON_HEIGHT_PX}
            perspectivePx={PERSPECTIVE_PX}
            secondPx={SECOND_PX}
            bodyKeys={BODY_KEYS_FLAT}
            flatSteps={FLAT_SCALE_STEPS_FLAT}
            lanes={LANES_FLAT}
            clipLabels={CLIP_LABELS}
            recentrePx={RESULT_RECENTRE_PX}
            cutFrom={H.from}
            cutTo={H.to}
          />

          <div className="sp-scene scene-3d">
            <Ribbon />
            <Chat />
            <Readout />
          </div>
        </div>

        <div id={mechanismId} className="sp-mid" aria-hidden="true" />
      </section>

      <section id={SKIP_TARGET} className="sp-foot" aria-label="The commands behind the edit">
        <div className="container">
          <p className="t-caption" style={{ marginBottom: "var(--space-4)" }}>
            {PROVENANCE_LINE}
          </p>
          <p className="italic-serif" style={{ marginBottom: "var(--space-3)" }}>
            {COMMANDS_CAPTION}
          </p>
          <pre className="sp-pre t-code">{MECHANISM_HEADLINE.commandsJson}</pre>
        </div>
      </section>

      <SetpieceRuntime sectionId={id} ribbonId={RIBBON_ID} />
    </>
  );
}

export default HeroSetpiece;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE RIBBON — three elements per plate, all of it server-rendered
   ───────────────────────────────────────────────────────────────────────────────────────── */

function Ribbon(): ReactElement {
  const removedRuns = RIBBON_RUNS.filter((r) => r.removed);
  return (
    <div
      id={RIBBON_ID}
      className="sp-ribbon plane-3d sp-anim"
      role="img"
      aria-label={`The timeline: ${MECHANISM_HEADLINE.clipCount} clips, ${MECHANISM_HEADLINE.timecode}, cut from ${MECHANISM_SOURCE.timecode}.`}
    >
      {RIBBON.plates.map((plate) => {
        const rake = RAKE_BY_PLATE.get(plate.index);
        const cut = restingCut(plate);
        const steps = stepsBefore(plate);
        /* The bare suffix. `sp-` is the scene's set and `sp-m` the phone's, generated from the same
           data by `cutKeyframes`, so a plate names one animation and gets both editions. */
        const cutAnim = plate.removed
          ? `x${removedRuns.findIndex((r) => r.index === plate.run)}`
          : steps > 0
            ? `c${steps}`
            : null;
        const style: Vars = {
          left: px(plate.leftPx),
          width: px(plate.widthPx),
          "--l": px(-plate.leftPx),
          "--cx": px(plate.cx),
          "--cy": px(plate.cy),
          "--cz": px(plate.cz),
          "--ry": deg(plate.ry),
          "--rz": deg(plate.rz),
          "--rx": deg(plate.rx),
          "--sc": ratio(plate.sx),
          "--shade": n(plate.shade),
          "--bshade": n(plate.backShade),
          "--rail": n(railAlpha(plate)),
          translate: px(cut.tx),
          scale: `${cut.sx} 1`,
        };
        if (rake) {
          style["--spec"] = n(plate.spec);
          // A FRACTION, not a percentage: `animation-range` reads it as
          // `calc(var(--k0) * 100%)` and the timed edition multiplies the same number by the
          // playthrough's length. One window per element, two editions, no second source.
          style["--k0"] = ratio(rake.from / 100);
          style["--k1"] = ratio(rake.to / 100);
        }
        if (cutAnim) {
          style["--cut-anim"] = `sp-${cutAnim}`;
          style["--cut-anim-m"] = `sp-m${cutAnim}`;
          style["--own"] = px(ownCollapse(plate));
        }
        return (
          <div
            key={plate.index}
            className={`sp-plate plane-3d sp-anim${rake ? " sp-lit" : ""}${cutAnim ? " sp-cut" : ""}`}
            style={style}
            aria-hidden="true"
          >
            <i className="sp-face face-3d" />
            <i className="sp-back face-3d" />
          </div>
        );
      })}

      {/* The seven pauses findSilences reports, at their own pixel positions. They ignite when the
          row returns and collapse with the run they belong to — the same animation, the same step. */}
      {removedRuns.map((run, step) => (
        <i
          key={`ignite-${run.index}`}
          className="sp-ignite sp-anim"
          aria-hidden="true"
          style={
            {
              left: px(run.startPx),
              width: px(run.endPx - run.startPx),
              "--cut-anim": `sp-x${step}`,
              "--cut-anim-m": `sp-mx${step}`,
              "--own": px(-(run.endPx - run.startPx) / 2),
            } as Vars
          }
        />
      ))}

      {/* The editor's own change-diff, on the five boundaries the edit created. */}
      {RESULT_CUTS_PX.map((cutPx) => (
        <i
          key={`diff-${cutPx}`}
          className="sp-diff sp-anim"
          aria-hidden="true"
          style={{ left: px(cutPx) }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE CHAT
   ───────────────────────────────────────────────────────────────────────────────────────── */

function Chat(): ReactElement {
  return (
    <div className="sp-chat sp-anim">
      <div className="sp-log" role="log" aria-live="off">
        <p className="sp-msg sp-anim">
          {/* One string for a screen reader; sixteen ranged reveals for everyone else. */}
          <span className="sr-only">{MECHANISM_HEADLINE.prompt}</span>
          {TYPED_CHARS.map((c) => (
            <span
              key={c.index}
              className="sp-char sp-anim"
              aria-hidden="true"
              style={{ "--k0": ratio(c.from / 100), "--k1": ratio(c.to / 100) } as Vars}
            >
              {c.char === " " ? " " : c.char}
            </span>
          ))}
        </p>

        {/* §2.3's planner-running state, over the transcript's reserved space. `aria-hidden`
            because the rows beneath it are the accessible account of the same moment, and a screen
            reader that met both would hear the run announced twice. */}
        <span className="sp-working sp-anim" aria-hidden="true">
          <KiteMark size={18} spin muted />
          working
        </span>

        {TRACE_ROWS.map((row) => (
          <div
            key={row.toolName}
            className="sp-row sp-anim"
            style={
              {
                "--k0": ratio(row.from / 100),
                "--k1": ratio(row.to / 100),
                "--m0": ratio(row.mFrom),
                "--m1": ratio(row.mTo),
              } as Vars
            }
          >
            <span className="sp-tool">{row.toolName}</span>
            <span className="sp-res">{row.result}</span>
            {row.note ? (
              <span className="sp-note" title={row.note}>
                {row.note}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* A depiction, not an input: there is no editor on this deploy to send anything to, so it
          claims no role and takes no focus. */}
      <div className="sp-composer" aria-hidden="true">
        <span className="sp-caret" />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE READOUT — beat I's lanes, the numeral, the count
   ───────────────────────────────────────────────────────────────────────────────────────── */

function Readout(): ReactElement {
  return (
    <div className="sp-readout sp-anim">
      {LANES.map((lane) => (
        <div
          key={lane.key}
          className="sp-lane sp-anim"
          style={
            {
              "--k0": ratio(lane.from / 100),
              "--k1": ratio(lane.to / 100),
              "--m0": ratio(lane.mFrom),
              "--m1": ratio(lane.mTo),
              "--mark-x": `calc(${px(lane.startPx)} * var(--flat))`,
            } as Vars
          }
        >
          <div
            className="sp-lane-mark"
            style={{
              left: "var(--mark-x)",
              width: `max(2px, calc(${px(lane.endPx - lane.startPx)} * var(--flat)))`,
            }}
          >
            {lane.key === "look" ? <LookTint /> : null}
          </div>
          <span className="sp-lane-label">{lane.label}</span>
        </div>
      ))}

      {/* Designed, specified, and deliberately not rendered: ADD_CAPTION is real, but `text` has no
          honest source until there is a transcript, and every candidate string would be invented
          speech. One boolean unlocks the lane on the day the take lands. */}
      {CAPTION_LANE_RENDERS ? <div className="sp-lane" /> : null}

      <div className="sp-numeral-row">
        <p className="sp-sub">
          {MECHANISM_HEADLINE.removedTimecode} removed · {MECHANISM_HEADLINE.removed.length} pauses
        </p>
        <p className="sp-numeral t-numeral roll" aria-label={MECHANISM_HEADLINE.timecode}>
          <span className="sp-roll-col sp-anim" aria-hidden="true">
            <span>{MECHANISM_SOURCE.timecode}</span>
            <span>{MECHANISM_HEADLINE.timecode}</span>
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * The look lane's tint — all three layers the compositor paints, from `gradeFor()`.
 *
 * `look-a24` is a recipe; its first step, `lut-a24-moonlight`, is a real `case` in
 * `ColorGrade.tsx`'s switch. Importing only `g.filter` and dropping the `screen` lift and the
 * `soft-light` tint would discard most of the look and still claim to be the renderer's output.
 */
function LookTint(): ReactElement {
  return (
    <>
      <span
        className="sp-lane-tint"
        style={{
          filter: LOOK_GRADE.filter,
          background: "linear-gradient(90deg, var(--color-bg-3), var(--color-bg-2))",
        }}
      />
      {LOOK_GRADE.lift ? (
        <span
          className="sp-lane-tint"
          style={{ background: "rgba(180,185,195,1)", mixBlendMode: "screen", opacity: LOOK_GRADE.lift }}
        />
      ) : null}
      {LOOK_GRADE.tint ? (
        <span
          className="sp-lane-tint"
          style={{
            background: LOOK_GRADE.tint.color,
            mixBlendMode: LOOK_GRADE.tint.blend,
            opacity: LOOK_GRADE.tint.opacity,
          }}
        />
      ) : null}
    </>
  );
}
