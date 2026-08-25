/**
 * lib/landing/hero-scene.ts — every number the hero set-piece renders, derived here.
 *
 * BINDING: `docs/overhaul/HERO-SETPIECE.md` (the owner's brief, beats A–I) and
 * `docs/overhaul/ART-DIRECTION.md` §4 colour · §5 type · §11 the asset ledger · §12 the word budget ·
 * §15 SEO/GEO · §16 performance and accessibility · §17 the designed reduced states.
 *
 * THE RULE THIS FILE EXISTS FOR. §15 rule 5 bans numeric literals in landing components; a hero made
 * of geometry would break that rule 900 times over unless the geometry is generated. So it is: the
 * ribbon's scale, its 13 content runs, its plates, its lighting, its rake windows, the seven cut
 * events, the typing cadence and the tool trace are all computed at module scope from
 * `public/landing/mechanism.display.json` — real `EditCommand[]` through the real `reduceBatch` — and
 * from `lib/landing/hero-geometry.ts`'s solver. The component reads; it does not decide.
 *
 * WHAT IS SPECTACLE AND WHAT IS MECHANISM, said plainly because the brief's first prohibition is
 * "every visual event maps to something the product actually does":
 *
 *   · Beats A–C — arrival, curl, settle — are SPECTACLE. A timeline does not curl. They are here
 *     because the owner asked for an object that stops a stranger scrolling, and they are earned by
 *     looking expensive, not by meaning something. Nothing in them claims a capability.
 *   · Beats D–I are MECHANISM, and every one of them is checkable. The flatten is the same DOM
 *     plates losing their rotations. The sentence is `FIXTURE_VARIANTS[0].prompt`. The tools are the
 *     ones `selectToolSpecs` really exposes for it (asserted in `hero-scene.test.ts`). The seven
 *     collapses are `variant.removed`. The numeral is `reduceBatch`'s own output. The lanes carry
 *     registry keys that are real `case`s in the renderer.
 *
 * THE SCALE, DERIVED. The ribbon is the source take. `MECHANISM.source.durationTicks` is 1,440,000
 * ticks = 48.000s at `lib/edl/time.ts`'s 30000/sec. Its flat length is `2 × --maxw-wide` = 2880px,
 * which is the one length that makes the object EXCEED the 1440 stage rather than sit inside it —
 * the brief's "elaborate and long" is a compositional claim, not a word. That fixes
 *
 *      1 px = 500 ticks = HALF A FRAME = 16.667 ms, exactly,
 *
 * and every derived position lands on a whole pixel: the seven removed spans are 72/66/78/54/84/54/132
 * px, the six clips are 312/384/414/336/408/486, and the five interior cuts are 312/696/1110/1446/1854.
 * The camera then settles the object to the page's measure at beat D (`FLAT_SCALE_MAX` = 0.5, less on
 * a narrow viewport), so the strip the visitor works with is the ribbon at half size and nothing was
 * swapped to get there.
 */
import { EXAMPLE_PROMPTS } from "./prompts";
import { MECHANISM, MECHANISM_HEADLINE, MECHANISM_SOURCE } from "./fixture";
import { catalogEntry } from "./catalog";
import { gradeFor, type Grade } from "@/lib/remotion/fx/ColorGrade";
import {
  projectedBounds,
  rakePeaks,
  sampleSpine,
  solveRibbon,
  type BodyPose,
  type ControlNet,
  type RibbonPlate,
  type RibbonRun,
} from "./hero-geometry";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE STAGE
   ───────────────────────────────────────────────────────────────────────────────────────── */

/** `--maxw-wide`, the design's own stage width. The ribbon is two of them, so the frame crops it. */
const STAGE_W = 1440;
const STAGE_H = 900;

/** Ribbon length, in ribbon-local px. Fixes the tick scale; see the header. */
export const RIBBON_LENGTH_PX = STAGE_W * 2;
/** Ribbon height: `--space-8` × 2, so the flat strip lands on `--space-8` = 64px at the settle. */
export const RIBBON_HEIGHT_PX = 128;
export const TICKS_PER_PX = MECHANISM_SOURCE.durationTicks / RIBBON_LENGTH_PX;

/**
 * `--persp`, re-pointed for this section only.
 *
 * The token block derives 1200px from `--maxw` so "the content measure, the frame ruler and the
 * camera's focal length are one number". That story does not survive contact with this ribbon: the
 * page's ruler is `--sec` = 120px/second (8.33 ms/px) and the ribbon is 16.667 ms/px, two scales
 * exactly 2× apart, so the coincidence it was built on is not available. `--persp` is therefore what
 * it always physically was — a focal length — and it is chosen for the picture:
 *
 *     840px on a 1440 stage  ⇒  horizontal field of view 2·atan(1440/1680) = 81.2°,
 *
 * a 24mm-equivalent. The widest lens that still holds a subject without distorting it, and the one
 * that makes a receding ribbon actually recede. 1200px is a 63° normal lens and reads flat.
 * `--z-mid` and `--z-far` are `calc()`ed off `--persp`, so their documented scale factors (0.667 and
 * exactly half) follow the re-point unchanged. THE TOKEN NAME SURVIVES; only its value is scoped.
 */
export const PERSPECTIVE_PX = 840;

/** Beat D's settle: the ribbon resolves to half size, or to whatever the viewport allows. */
export const FLAT_SCALE_MAX = 0.5;

/** `--gutter` is `clamp(--space-6, 5vw, --space-8)` — 32px → 64px, both frame-exact. */
function gutterAt(width: number): number {
  return Math.min(64, Math.max(32, width * 0.05));
}

/**
 * The settle scale, as a breakpoint ladder.
 *
 * `scale()` needs a unitless number and CSS cannot divide a length by a length, so "fit the strip
 * between the gutters" cannot be written as one `calc()`. Four steps is what it takes to keep the
 * whole 2880px object inside every desktop width the property targets — each step is the exact fit
 * at the NARROWEST viewport in its range, so the strip is never cropped and never has to be
 * measured by JavaScript.
 */
function fitScale(width: number): number {
  return Math.min(
    FLAT_SCALE_MAX,
    Math.round(((width - 2 * gutterAt(width)) / RIBBON_LENGTH_PX) * 1000) / 1000,
  );
}

/** Below this the set-piece is re-composed rather than shrunk — §8: there is no pin on mobile. */
export const MOBILE_BREAKPOINT = 900;

export const FLAT_SCALE_STEPS: readonly { maxWidth: number | null; scale: number }[] = (() => {
  const edges = [1728, 1536, 1400, 1280, 1152, 1024, MOBILE_BREAKPOINT];
  return [
    { maxWidth: null, scale: FLAT_SCALE_MAX },
    ...edges.map((edge, i) => ({ maxWidth: edge - 1, scale: fitScale(edges[i + 1] ?? edge) })),
  ];
})();

/**
 * The phone composition's scale — and the one place the object is scaled non-uniformly.
 *
 * The whole 2880px ribbon between a 390px screen's gutters is 0.113, which puts the strip at 14px
 * tall: a hairline, not a timeline. Height is therefore scaled on its own, to `ART-DIRECTION.md`
 * §8's mobile strip height of 40px. A non-uniform scale would be a lie about a curled object — but
 * there is no curl on mobile (§8: no pin, so no scrubbed set-piece), the strip is flat and
 * screen-parallel, and a flat timeline's lane height is a layout choice, not a measurement. The
 * horizontal scale — the one that carries every duration on screen — stays exact.
 */
export const MOBILE_FLAT_SCALE = fitScale(390);
export const MOBILE_LANE_HEIGHT_PX = 40;
export const MOBILE_FLAT_SCALE_Y = MOBILE_LANE_HEIGHT_PX / RIBBON_HEIGHT_PX;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE RUNS — the strip partitioned by the edit itself
   ───────────────────────────────────────────────────────────────────────────────────────── */

const toPx = (tick: number): number => tick / TICKS_PER_PX;

/** The 11 pauses the analysis found, in ribbon px. Seven exceed the threshold; four do not. */
export interface SilenceBand {
  readonly startPx: number;
  readonly endPx: number;
  readonly removed: boolean;
}

const REMOVED_KEYS = new Set(MECHANISM_HEADLINE.removed.map((s) => `${s.startTick}:${s.endTick}`));

export const SILENCE_BANDS: readonly SilenceBand[] = MECHANISM_SOURCE.silences.map((s) => ({
  startPx: toPx(s.startTick),
  endPx: toPx(s.endTick),
  removed: REMOVED_KEYS.has(`${s.startTick}:${s.endTick}`),
}));

/**
 * The partition every plate boundary must respect.
 *
 * This is the single decision that makes beat H expressible on the same nodes as beat B. A run is
 * either kept whole (it is one of the six clips) or deleted whole (it is one of the seven pauses),
 * so at the cut a plate either SLIDES or COLLAPSES — `translate` and `scale`, both compositor
 * properties, neither of them a width change and neither of them `clip-path`, which Blink does not
 * composite. No plate ever straddles a cut, so nothing has to be re-cut mid-object and there is
 * never a second strip to hand off to.
 */
function buildRuns(): RibbonRun[] {
  const edges: number[] = [0];
  for (const band of SILENCE_BANDS) {
    if (!band.removed) continue;
    if (band.startPx > edges[edges.length - 1]) edges.push(band.startPx);
    edges.push(band.endPx);
  }
  if (edges[edges.length - 1] < RIBBON_LENGTH_PX) edges.push(RIBBON_LENGTH_PX);

  const removedSpans = SILENCE_BANDS.filter((b) => b.removed);
  return edges.slice(0, -1).map((startPx, index) => {
    const endPx = edges[index + 1];
    return {
      index,
      startPx,
      endPx,
      removed: removedSpans.some((b) => b.startPx === startPx && b.endPx === endPx),
    };
  });
}

export const RIBBON_RUNS: readonly RibbonRun[] = buildRuns();

/** Removed px strictly before a position — how far everything downstream slides at the cut. */
function removedBefore(px: number): number {
  let total = 0;
  for (const run of RIBBON_RUNS) {
    if (!run.removed) continue;
    if (run.endPx <= px) total += run.endPx - run.startPx;
  }
  return total;
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE CURL
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The control net, in the ribbon's own frame before arc-length fitting.
 *
 * Two properties are load-bearing rather than aesthetic. `P1` is colinear with `P0` along +X, so the
 * ribbon leaves its head dead flat — the head is what becomes the left end of the strip, and it
 * starts life already unwound, which is why the last tenth of beat D has almost nothing left to
 * resolve and reads as an asymptote rather than a stop. And `P3.x < P2.x`: the tail swings BACK.
 * That hook is the difference between a ribbon that recedes and one that curls around, which is the
 * word the brief uses.
 */
const CONTROL_NET: ControlNet = [
  [0, 0, 0],
  [1700, 0, 0],
  [3180, -760, -500],
  [2540, 420, -960],
];

/**
 * 270°, and it is not a taste choice: the brief asks for face → edge → face. The face flips at every
 * 90° crossing, so 180° and 250° give one crossing (face → edge → back, no second face), 360° gives
 * three and lands upside down, and 270° is the only value in the family with exactly two.
 * `FACE_RUNS` below is the check, not the claim.
 */
const TWIST_DEG = 270;

/**
 * Screen-space wedge budget and node ceiling.
 *
 * 2.4px is a hairline at the read pose; the ceiling is the node budget the solver refines within on this
 * net. Both are published rather than assumed because a faceted twist gives itself away at exactly
 * one place — the edge-on crossings — and "it will be fine" is how a ribbon ends up reading as a
 * venetian blind.
 */
const FACET_BUDGET_PX = 2.4;
const MAX_ROLL_STEP_DEG = 5;
const MAX_PLATES = 144;
/** No plate spans more than half a second of the take. The subdivision's own unit, in the take's. */
const MAX_PLATE_WIDTH_PX = 30000 / TICKS_PER_PX / 2;

export const RIBBON = solveRibbon({
  net: CONTROL_NET,
  lengthPx: RIBBON_LENGTH_PX,
  heightPx: RIBBON_HEIGHT_PX,
  twistDeg: TWIST_DEG,
  runs: RIBBON_RUNS,
  perspective: PERSPECTIVE_PX,
  readScale: 1,
  facetBudgetPx: FACET_BUDGET_PX,
  maxPlateWidthPx: MAX_PLATE_WIDTH_PX,
  maxRollStepDeg: MAX_ROLL_STEP_DEG,
  maxPlates: MAX_PLATES,
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE BEATS
   ───────────────────────────────────────────────────────────────────────────────────────── */

export interface Beat {
  readonly key: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
  readonly from: number;
  readonly to: number;
}

/**
 * The scroll map, in percent of the pinned travel. 180vh of pin inside a 280vh section, which
 * `contain 0% → contain 100%` resolves to exactly — the timeline and the pin are the same interval
 * by construction rather than by tuning.
 */
export const BEATS: readonly Beat[] = [
  { key: "A", from: 0, to: 14 },
  { key: "B", from: 14, to: 34 },
  { key: "C", from: 34, to: 42 },
  { key: "D", from: 42, to: 54 },
  { key: "E", from: 54, to: 60 },
  { key: "F", from: 60, to: 70 },
  { key: "G", from: 70, to: 84 },
  { key: "H", from: 84, to: 92 },
  { key: "I", from: 92, to: 100 },
];

export const beat = (key: Beat["key"]): Beat => {
  const found = BEATS.find((b) => b.key === key);
  if (!found) throw new Error(`hero-scene: no beat ${key}`);
  return found;
};

/** Keyframes for the rigid body — the pose the whole ribbon rides on through beats A–D. */
export interface BodyKey extends BodyPose {
  readonly at: number;
}

/**
 * Where the object is, beat by beat. Scale stays at 1 until the flatten, so the ribbon is at its
 * authored size — 2880px against a 1440 stage — for the whole spectacle, and the frame crops it.
 * Beat D both squares it up and pulls the camera back to the page's measure.
 */
export const BODY_KEYS: readonly BodyKey[] = [
  { at: 0, x: 620, y: 330, z: -380, yaw: -56, pitch: 15, scale: 1 },
  { at: 14, x: 560, y: 268, z: -320, yaw: -45, pitch: 11, scale: 1 },
  { at: 34, x: 490, y: 150, z: -210, yaw: -26, pitch: 7, scale: 1 },
  { at: 42, x: 430, y: 78, z: -80, yaw: -14, pitch: 4, scale: 1 },
  { at: 54, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, scale: FLAT_SCALE_MAX },
];

/**
 * How far the body slides left once the cut lands.
 *
 * The strip shortens from 2880 to 2340 local px, so the RESULT's centre is no longer the element's
 * centre — it moves 270px toward the head. Without this the finished strip sits 108 screen px left
 * of the lanes and the numeral under it, which is the kind of misalignment that reads as a bug in a
 * scene whose whole claim is that the numbers line up.
 */
export const RESULT_RECENTRE_PX = (RIBBON_LENGTH_PX - toPx(MECHANISM_HEADLINE.durationTicks)) / 2;

/* ── SHAPING A SCROLL BEAT WITHOUT EASING IT ──────────────────────────────────────────────────
   `--ease-scroll` is `linear`, and that is the law: an easing function on a progress timeline makes
   the object lag the finger, which is the exact sensation the brief bans. A beat's shape therefore
   lives in its KEYFRAME OFFSETS, and the two authored curves are sampled here rather than applied.
   `--ease-curl` carries the turn (symmetric, zero velocity at both ends, so face → edge → face reads
   as one continuous move); `--ease-flatten` carries the unwind (front-loaded, long tail, no
   overshoot — the last tenth takes 40% of the beat, which is what makes the handoff asymptote into
   flat instead of arriving at it).                                                              */

/** y at x on a cubic-bezier(x1,y1,x2,y2), by bisection on x. Exact to 1e-7, which is 11 digits more
 *  than a keyframe offset needs. */
function bezierEase(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const bx = (t: number): number => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number): number => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

/** `--ease-curl: cubic-bezier(0.65, 0, 0.35, 1)` — globals.css. */
const easeCurl = (x: number): number => bezierEase(0.65, 0, 0.35, 1, x);
/** `--ease-flatten: cubic-bezier(0.33, 0, 0.10, 1)` — globals.css. */
const easeFlatten = (x: number): number => bezierEase(0.33, 0, 0.1, 1, x);

const RIBBON_CENTRE = [RIBBON_LENGTH_PX / 2, 0, 0] as const;

/**
 * The screen footprint of the CURLED ribbon at each body key, as a fraction of a 1440×900 stage.
 *
 * The last key is excluded on purpose: by then the plates have unwound, so the object's footprint is
 * simply `2880 × 128` at the settle scale — the strip, not the sculpture — and measuring it through
 * the curl's own geometry would report a shape that no longer exists.
 */
export const BODY_FOOTPRINT: readonly { at: number; width: number; height: number; coverage: number }[] =
  BODY_KEYS.filter((k) => k.scale === 1).map((pose) => {
    const b = projectedBounds(RIBBON.plates, RIBBON_HEIGHT_PX, pose, PERSPECTIVE_PX, RIBBON_CENTRE);
    const width = b.x1 - b.x0;
    const height = b.y1 - b.y0;
    return { at: pose.at, width, height, coverage: (width * height) / (STAGE_W * STAGE_H) };
  });

/** The pose at a travel percentage, along the piecewise-linear path through `BODY_KEYS`. */
function poseAlong(travel: number): BodyPose {
  const keys = BODY_KEYS;
  if (travel <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (travel > b.at) continue;
    const u = (travel - a.at) / (b.at - a.at);
    const mix = (p: number, q: number): number => p + (q - p) * u;
    return {
      x: mix(a.x, b.x),
      y: mix(a.y, b.y),
      z: mix(a.z, b.z),
      yaw: mix(a.yaw, b.yaw),
      pitch: mix(a.pitch, b.pitch),
      scale: mix(a.scale, b.scale),
    };
  }
  return keys[keys.length - 1];
}

export interface BodyFrame extends BodyPose {
  readonly at: number;
}

/**
 * The body's keyframe list, shaped rather than eased.
 *
 * One warp carries the whole arrival-through-settle (`--ease-curl` over 0 → 42%), so the entrance
 * has an entry ramp and the settle decelerates without a stop at every beat boundary; a second
 * (`--ease-flatten` over 42 → 54%) carries the unwind. Sampled every 3% of travel, which is finer
 * than a 180vh pin can resolve on any display.
 */
export const BODY_FRAMES: readonly BodyFrame[] = (() => {
  const settle = beat("C").to;
  const flat = beat("D").to;
  const frames: BodyFrame[] = [];
  for (let at = 0; at <= flat + 1e-9; at += 3) {
    const shaped =
      at <= settle
        ? easeCurl(at / settle) * settle
        : settle + easeFlatten((at - settle) / (flat - settle)) * (flat - settle);
    frames.push({ at: Math.min(at, flat), ...poseAlong(shaped) });
  }
  if (frames[frames.length - 1].at < flat) frames.push({ at: flat, ...poseAlong(flat) });
  return frames;
})();

/**
 * The unwind's progress at each stop of beat D.
 *
 * A CSS transform list interpolates function by function when both ends share a structure, so "72%
 * of the way from the curled pose to flat" is expressible as `calc(var(--cx) * 0.28)` on every term
 * at once. That is what lets ONE shared `@keyframes` carry every plate's own unwind, shaped by
 * `--ease-flatten`, with no per-plate keyframe block anywhere.
 */
export const FLATTEN_KEYS: readonly { at: number; remaining: number }[] = (() => {
  const d = beat("D");
  const steps = 10;
  const out: { at: number; remaining: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    out.push({ at: d.from + (d.to - d.from) * u, remaining: 1 - easeFlatten(u) });
  }
  return out;
})();

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE RAKE — beat B's travelling highlight
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The travel at which the body reaches a yaw — the inverse of the yaw ramp through `BODY_KEYS`.
 *
 * Monotone by construction (the body only ever squares up), so a linear scan is exact.
 */
function travelAtYaw(yaw: number): number {
  for (let i = 1; i < BODY_KEYS.length; i++) {
    const a = BODY_KEYS[i - 1];
    const b = BODY_KEYS[i];
    if (yaw <= b.yaw) return a.at + ((b.at - a.at) * (yaw - a.yaw)) / (b.yaw - a.yaw);
  }
  return BODY_KEYS[BODY_KEYS.length - 1].at;
}

/** Half-width of a plate's rake window, in travel percent. 4.3 plates lit at once ⇒ a band, not a blink. */
const RAKE_HALF_WINDOW = 2.5;

export interface RakeWindow {
  readonly plate: number;
  readonly from: number;
  readonly to: number;
}

/**
 * One shared `@keyframes` and a per-plate `animation-range`, so the highlight is N composited opacity
 * animations and zero paint per frame. The pass is not timed by anyone: it is where each plate's own
 * Blinn–Phong term peaks as the body yaws from beat A to beat D under a fixed key, which lands it
 * inside beat B on its own. Plates showing their back to a camera-left key get no window at all,
 * because a highlight there would be a lie about where the light is.
 */
export const RAKE_WINDOWS: readonly RakeWindow[] = rakePeaks(
  RIBBON.plates,
  BODY_KEYS[0].yaw,
  BODY_KEYS[BODY_KEYS.length - 1].yaw,
  480,
)
  .map((peakYaw, plate) => {
    if (peakYaw === null) return null;
    const centre = travelAtYaw(peakYaw);
    const from = Math.max(0, centre - RAKE_HALF_WINDOW);
    const to = Math.min(beat("D").to, centre + RAKE_HALF_WINDOW);
    return to - from > 0.5 ? { plate, from, to } : null;
  })
  .filter((w): w is RakeWindow => w !== null);

/**
 * The specular sheet, pre-baked.
 *
 * `--rake` is `rgb(255 255 255 / 0.14)` — LAW 1's hairline, the alpha every raised surface's top
 * edge carries. It is the right material for the ribbon's RAILS, and it is the wrong one for the
 * highlight: a specular capped at 14% white over `--color-bg-2` is a smudge, and the brief's most
 * explicit demand ("light must rake across it as it turns · this is the moment that has to look
 * expensive") cannot be paid in a smudge. So the moving highlight gets its own range, up to
 * `RAKE_HOT`, and the rails keep `--rake`. Two materials, stated, rather than one that satisfies a
 * consistency argument and no viewer.
 *
 * `filter: blur()` is banned in the LCP viewport (§16), so the bloom is BAKED: a Gaussian ramp
 * sampled into a multi-stop gradient, painted once, translated. No blur, no backdrop-filter, no
 * per-frame gradient repaint — the sheet's only animated properties are `opacity` and `transform`.
 */
export const RAKE_HOT = 0.92;
const RAKE_SIGMA = 0.17;
const RAKE_SAMPLES = 13;

export const RAKE_GRADIENT: string = (() => {
  const stops: string[] = [];
  for (let i = 0; i < RAKE_SAMPLES; i++) {
    const x = i / (RAKE_SAMPLES - 1);
    const alpha = RAKE_HOT * Math.exp(-(((x - 0.5) / RAKE_SIGMA) ** 2));
    stops.push(`rgb(255 255 255 / ${alpha.toFixed(4)}) ${(x * 100).toFixed(2)}%`);
  }
  return `linear-gradient(104deg, ${stops.join(", ")})`;
})();

/**
 * The face picture: one continuous 2880px drawing of the take, windowed 128 ways.
 *
 * Every stop is a real measurement. The eleven bands are `MECHANISM.source.silences` at their own
 * pixel positions; the seven that exceed the 600ms threshold are drawn at `--line-4` and the four
 * short breaths at half of it — and that difference IS the three variants, visible before the
 * visitor knows there are three. Thumbnails are the layer above this one and they do not render:
 * `MECHANISM.asset.hasMedia` is false, and `fixture.ts:15` requires the honest media-offline state
 * where a program frame would go — never a stock image, never a mock screenshot.
 */
export const SILENCE_GRADIENT: string = (() => {
  const stops: string[] = ["transparent 0"];
  for (const band of SILENCE_BANDS) {
    /* THE SEVEN THE PLANNER TAKES ARE DRAWN IN THE MACHINE'S COLOUR, the four it leaves in ink.
       ART-DIRECTION's palette assigns `--color-accent` exactly one meaning — "what the AI touched" —
       and these bands are the clearest instance of it on the page: `findSilences` returned them and
       beat H deletes them. They were both `--line-4`-family greys, which spent the page's one
       semantic colour signal on nothing and left the viewer no way to tell a pause that survives
       from a pause that does not until it had already collapsed. */
    const fill = band.removed ? "var(--color-accent-dim)" : "rgb(var(--ink) / 0.12)";
    stops.push(`transparent ${band.startPx}px`);
    stops.push(`${fill} ${band.startPx}px`);
    stops.push(`${fill} ${band.endPx}px`);
    stops.push(`transparent ${band.endPx}px`);
  }
  stops.push(`transparent ${RIBBON_LENGTH_PX}px`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
})();

/**
 * THE CLIP BLOCKS — the layer that makes the ribbon read as a strip of footage rather than as a
 * rotating rectangle.
 *
 * WHY THIS HAD TO EXIST. Every ink on the face was drawn from `--color-bg-*` and `--line-*`: the
 * strip was made, literally, out of background. Against `--ground` it therefore had a dark object on
 * a dark field with no chroma anywhere in it, and the set-piece spent a genuine 3D curl, a real axial
 * twist and a continuous flatten animating something the eye reads as a smudge. The brief's word was
 * "elaborate", and its explicit failure mode was "not a bare rectangle".
 *
 * WHAT IT IS NOT. It is NOT thumbnails, and it must not become them. `MECHANISM.asset.hasMedia` is
 * false — the owner has not committed a take yet — and `fixture.ts` requires the honest media-offline
 * state wherever a program frame would go. A stock image or a mock screenshot here would be a
 * fabricated claim about footage that does not exist, which is the one thing this page may never do.
 *
 * WHAT IT IS. The partition `buildRuns()` already computed, made visible: the six runs that survive
 * the cut, each painted in the footage warm at the same faint weight the editor's own `.clip` uses,
 * separated by a warm edge at every boundary the edit actually creates. Nothing here is invented —
 * the boundaries ARE `RIBBON_RUNS`, which are derived from the fixture's real silences, and the same
 * runs are what beat H slides and collapses. The viewer sees six clips because there are six clips.
 */
export const CLIP_GRADIENT: string = (() => {
  /* THE BODY IS NEUTRAL AND THE EDGE CARRIES THE WARM, and that split was arrived at by looking at
     the rendered strip rather than by reasoning from the palette.

     The obvious move is `.clip`'s own fill from `globals.css` — `linear-gradient(180deg,
     var(--color-warm-faint) …)` over `border-right: 2px solid var(--color-warm)` — on the argument
     that a hero clip and an editor clip should be one material. Rendered on this surface it is
     wrong twice. `--color-warm` is #ffb24a; laid at a low alpha over `--color-bg-2`'s desaturated
     blue it does not read as warm light, it composites to BROWN, and raising the weight to fight
     that (0.14 → 0.22 was tried) makes the strip browner rather than warmer, because the mud is the
     mix itself and not its strength. It is also the wrong claim: a warm-FILLED block says "this is
     lit footage" about an asset with `hasMedia: false`, where the honest statement is that the
     picture is not shipped yet.

     So the body is a neutral elevation off the strip's own material — the block reads as a block,
     and says nothing about a picture it does not have — while `--color-warm` goes where footage
     actually has an event to mark: the boundary the cut creates. That keeps the palette's meaning
     intact (warm IS the footage layer) and leaves the strip's only two chromatic signals as the ones
     that carry information — a warm edge per cut, a cyan band per pause the planner takes. */
  const BODY = "rgb(var(--ink) / 0.07)";
  const EDGE = "var(--color-warm)";
  const EDGE_PX = 2;

  const stops: string[] = ["transparent 0"];
  for (const run of RIBBON_RUNS) {
    if (run.removed) continue;
    const edgeFrom = Math.max(run.startPx, run.endPx - EDGE_PX);
    stops.push(`transparent ${run.startPx}px`);
    stops.push(`${BODY} ${run.startPx}px`);
    stops.push(`${BODY} ${edgeFrom}px`);
    stops.push(`${EDGE} ${edgeFrom}px`);
    stops.push(`${EDGE} ${run.endPx}px`);
    stops.push(`transparent ${run.endPx}px`);
  }
  stops.push(`transparent ${RIBBON_LENGTH_PX}px`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
})();

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   BEAT H — the cut, as seven staggered compositor events
   ───────────────────────────────────────────────────────────────────────────────────────── */

/** `--dur-fast` and `--stagger-cut`, in ms. The burst is 6 × 40 + 140 = 380ms; §6 animation 2. */
const CUT_EVENT_MS = 140;
const CUT_STAGGER_MS = 40;

export interface CutStep {
  /** Index within the seven removed runs, in strip order. */
  readonly step: number;
  readonly run: number;
  readonly widthPx: number;
  readonly from: number;
  readonly to: number;
  /** Total px removed once this step has landed — what everything downstream has slid by. */
  readonly cumulativePx: number;
}

export const CUT_STEPS: readonly CutStep[] = (() => {
  const removed = RIBBON_RUNS.filter((r) => r.removed);
  const burst = CUT_STAGGER_MS * (removed.length - 1) + CUT_EVENT_MS;
  const h = beat("H");
  let cumulative = 0;
  return removed.map((run, step) => {
    cumulative += run.endPx - run.startPx;
    return {
      step,
      run: run.index,
      widthPx: run.endPx - run.startPx,
      from: h.from + ((h.to - h.from) * (step * CUT_STAGGER_MS)) / burst,
      to: h.from + ((h.to - h.from) * (step * CUT_STAGGER_MS + CUT_EVENT_MS)) / burst,
      cumulativePx: cumulative,
    };
  });
})();

/** How many removed runs precede a plate — which of the seven steps it has to slide through. */
export function stepsBefore(plate: RibbonPlate): number {
  return CUT_STEPS.filter((s) => {
    const run = RIBBON_RUNS[s.run];
    return run.endPx <= plate.leftPx + 0.001;
  }).length;
}

/**
 * A removed plate's own collapse offset — how far its CENTRE moves to reach the seam its run leaves
 * behind, before the global slide is applied. Zero for a plate that survives.
 */
export function ownCollapse(plate: RibbonPlate): number {
  if (!plate.removed) return 0;
  return RIBBON_RUNS[plate.run].startPx - (plate.leftPx + plate.widthPx / 2);
}

/** The plate's resting (post-cut) X offset and X scale — the state the server paints. */
export function restingCut(plate: RibbonPlate): { tx: number; sx: number } {
  const slide = removedBefore(plate.leftPx + 0.001);
  return { tx: -slide + ownCollapse(plate), sx: plate.removed ? 0 : 1 };
}

/**
 * The rails' opacity ramp.
 *
 * The rails are the strip's machined edges and they are the ONLY thing on screen at the two edge-on
 * crossings — where the face and the back both project to zero height and the ribbon would otherwise
 * vanish, leaving the tail looking like a second object. So they are painted in the same hot white
 * as the specular, with an opacity floor chosen so that a face-on rail resolves to exactly `--rake`
 * (LAW 1's `0.14`, `RAKE_HOT × RAIL_FLOOR`) and a grazing one blows out. One material, two ends of
 * its range, and the flash is the truth about the object rather than a decoration on it.
 */
const RAIL_FLOOR = 0.152;
export const railAlpha = (plate: RibbonPlate): number =>
  RAIL_FLOOR + (1 - RAIL_FLOOR) * plate.spec;
/** What the rails settle to once the strip is flat and they are edge-on: LAW 1's top-edge sheen. */
export const RAIL_FLAT = RAIL_FLOOR;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   BEAT F — the sentence, and its cadence
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The one sentence this composer may show.
 *
 * It is `EXAMPLE_PROMPTS[0].text` AND `FIXTURE_VARIANTS[0].prompt` AND the variant
 * `MECHANISM.headlineVariantId` resolves to — the only string on the property that is simultaneously
 * in the allowlist, in the generated fixture, and the one whose 19 commands are byte-diffed by
 * `fixture.test.ts`. Read from the allowlist, cross-checked against the fixture, never retyped.
 */
export const TYPED_SENTENCE: string = (() => {
  const allow = EXAMPLE_PROMPTS[0].text;
  if (allow !== MECHANISM_HEADLINE.prompt) {
    throw new Error(
      `hero-scene: the composer sentence must be both allowlisted and the headline variant ` +
        `("${allow}" vs "${MECHANISM_HEADLINE.prompt}")`,
    );
  }
  return allow;
})();

/**
 * `--dur-type` is documented as a MEAN that must be jittered, with a 180–320ms hold at every space.
 * On a scroll timeline the jitter becomes non-uniform range offsets: a letter carries one unit of the
 * beat, a space carries 2.4 (the reading pause a human makes between words), and the send takes the
 * last seventh. Uniform intervals read as a machine, which is the one thing the token forbids.
 */
const SPACE_WEIGHT = 2.4;
const SEND_SHARE = 0.14;

export interface TypedChar {
  readonly index: number;
  readonly char: string;
  readonly from: number;
  readonly to: number;
}

export const TYPED_CHARS: readonly TypedChar[] = (() => {
  const f = beat("F");
  const span = (f.to - f.from) * (1 - SEND_SHARE);
  const weights = [...TYPED_SENTENCE].map((c) => (c === " " ? SPACE_WEIGHT : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return [...TYPED_SENTENCE].map((char, index) => {
    const from = f.from + (span * acc) / total;
    acc += weights[index];
    return { index, char, from, to: f.from + (span * acc) / total };
  });
})();

export const SEND_WINDOW = {
  from: beat("F").from + (beat("F").to - beat("F").from) * (1 - SEND_SHARE),
  to: beat("F").to,
} as const;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   BEAT G — the trace
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Five rows, and three of them come back empty. That is the point of the beat, not a shortfall.
 *
 * `MECHANISM.asset.hasMedia` is false and the fixture carries exactly one kind of analysis — the
 * eleven silence spans `fixture-source.ts` documents as standing in for one run of `findSilences`.
 * So the only values this trace may print are the ones derivable from the fixture, and every other
 * tool must show the honest empty its own source code returns.
 *
 * WHY FIVE AND NOT THREE. The owner's brief asks for "many elaborate tool calls" and `HERO-SPEC.md`
 * §2.3 tables exactly these five with these returns. This module shipped three for a while, on the
 * argument that "five rows of which three are empty would be a demo of a product that does not
 * work" — which is the opposite of the reasoning the spec gives for the same table: "**Three visible
 * refusals to fabricate are a stronger differentiator than any number of green ticks**, and no
 * competitor's marketing surface will show them." The spec is right and the shortfall was a
 * unilateral inversion of it. An empty here is not a failure state and is not drawn as one — the row
 * resolves to `--t-3` (6.99:1, fully legible, never greyed out), prints the tool's own note, and
 * `--color-hit` stays reserved for real provider errors.
 *
 * `analyzeTranscript` is still deliberately excluded although the router exposes it: its return
 * shape requires `text`, and there is no honest source for speech (§2.13 deviation 6).
 *
 * All five fill from real Whisper output with no re-layout on the day the take lands
 * (`ART-DIRECTION.md` §1) — that invariance is what the composition is designed for.
 *
 * `toolName` is a plain string here rather than an import because importing `lib/ai/tools/**` drags
 * the Supabase admin client and the whole `ai` SDK into the landing bundle — the same trade
 * `fixture-source.ts` already makes for `FIND_SILENCES_DEFAULT_MIN_MS`. The gate is in
 * `hero-scene.test.ts`, which runs the REAL router: a tool the router would not expose for this
 * prompt fails the build.
 */
export interface TraceRow {
  readonly toolName: string;
  /** Reads `key: value` in mono. Derived, never a sentence about the product. */
  readonly result: string;
  /** The tool's own note, verbatim, when it has one. Present in the DOM; ellipsised on screen. */
  readonly note: string | null;
  readonly measured: boolean;
  /** Where the row resolves, as a percentage of the SCENE's travel — the scrubbed desktop edition. */
  readonly from: number;
  readonly to: number;
  /**
   * The same slot as a 0–1 fraction of beat G alone.
   *
   * The two editions that are not scrubbed by the whole scene — the timed `[data-play]` playthrough
   * and the phone's per-card `view()` ranges — need the row's position within its own beat, not
   * within 180vh of pin. Deriving it here rather than in the component keeps §2.7's rule intact: the
   * component reads, it does not decide.
   */
  readonly mFrom: number;
  readonly mTo: number;
}

/** `findFillerWords.ts`, verbatim — the note the tool returns when a transcript has no word timings. */
const NO_WORD_TIMINGS_NOTE =
  "This transcript has segments but no word-level timings, so individual words cannot be cut " +
  "accurately. Do not claim there are no fillers — say word timings are unavailable.";

/** `findHighlights.ts`, verbatim — the note the tool returns when the asset has no probed duration. */
const NO_PROBED_DURATION_NOTE =
  "This asset has no probed duration, so these windows could not be bounded to the clip length — " +
  "verify each range against the asset before emitting a clip.";

export const TRACE_ROWS: readonly TraceRow[] = (() => {
  const g = beat("G");
  const rows: Omit<TraceRow, "from" | "to" | "mFrom" | "mTo">[] = [
    {
      toolName: "findSilences",
      result: `silences: ${MECHANISM_HEADLINE.removed.length} · ${MECHANISM_HEADLINE.removedTimecode}`,
      note: null,
      measured: true,
    },
    {
      toolName: "findFillerWords",
      result: "fillers: []",
      note: NO_WORD_TIMINGS_NOTE,
      measured: false,
    },
    // `planSceneCuts` returns `{ cutTicks: msArrayToTicks(scenes?.cuts_ms), analyzed: scenes !== null }`
    // and carries no note — the flag IS the sentence, and inventing one would be authoring for a tool
    // that deliberately says nothing.
    {
      toolName: "planSceneCuts",
      result: "cutTicks: [] · analyzed: false",
      note: null,
      measured: false,
    },
    {
      toolName: "findHighlights",
      result: "highlights: [] · analyzed: false",
      note: NO_PROBED_DURATION_NOTE,
      measured: false,
    },
    {
      toolName: "emitEditBatch",
      result: `commands: ${MECHANISM_HEADLINE.commandCount} · ${MECHANISM_SOURCE.timecode} → ${MECHANISM_HEADLINE.timecode}`,
      note: null,
      measured: true,
    },
  ];
  const slot = (g.to - g.from) / rows.length;
  return rows.map((row, i) => ({
    ...row,
    from: g.from + slot * i,
    to: g.from + slot * (i + 1),
    /** The same order over a 0–1 span, for the editions that are not scrubbed by the whole scene. */
    mFrom: i / rows.length,
    mTo: (i + 1) / rows.length,
  }));
})();

/** When the seven bands ignite along the ribbon — the moment `findSilences` returns. */
export const SILENCE_IGNITE = {
  from: TRACE_ROWS[0].to - (TRACE_ROWS[0].to - TRACE_ROWS[0].from) * 0.35,
  to: TRACE_ROWS[0].to,
} as const;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE PHONE'S OWN SCORE — §2.6.3, and why it is a different map rather than the same one shrunk
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `ART-DIRECTION.md` §8 is categorical: there is no pin on mobile ("pinning at 844px tall traps a
 * thumb"). So the 180vh scrubbed scene is unavailable and `HERO-SPEC.md` §2.6.3 re-composes it as
 * cards, "each its own `view()` subject with `animation-range: entry 0% entry 100%`".
 *
 * WHAT THE SCENE DID INSTEAD, AND WHY IT WAS WRONG. Every animation was authored inside
 * `@media (… no-preference) and (min-width: 900px)`, and the timed fallback inside
 * `@media (min-width: 900px)`. Under 900px there was no curl, no flatten, no typing, no trace, NO
 * CUT, no numeral roll and no lane opening — the strip simply rendered already-finished. Both
 * binding documents contradict that in the same words: §8 says "**The cut still fires at 2.4 s on
 * mobile**, because it is CSS and the video is one poster frame swap. It is the reason the page works
 * on a phone in daylight", and §2.6.3 repeats "**The cut still fires on mobile**, because it is CSS
 * on DOM geometry and costs zero bytes". On a page where §8 notes over half of traffic is mobile, the
 * majority of visitors never saw a sentence become an edit — which is the entire thesis.
 *
 * WHERE THIS DEPARTS FROM §2.6.3, STATED. The spec's three cards each carry their own copy of the
 * picture, so Card 1 shows the object, Card 2 the sentence and Card 3 the edit. There is one ribbon
 * in this DOM, and a strip that has scrolled off cannot be seen to cut — so the CUT has to fire while
 * the strip is on screen, which means it belongs to the ribbon's own pass. The cards are therefore
 * re-ordered rather than duplicated: the sentence and its five tool calls come FIRST, the strip
 * unwinds and then cuts SECOND, and the lanes and the numeral land THIRD. Cause, effect, result —
 * the brief's own payoff sentence — with one object instead of three, which is also the honest way to
 * keep §2.10's 96-node budget at 390.
 */
export const MOBILE_RIBBON_POSE = { yawDeg: -34, zPx: -240 } as const;

/**
 * Where the ribbon's own entry splits between the unwind and the cut.
 *
 * The pose resolves over the first 55% of the strip's pass and the seven-span collapse fires over
 * the last 40%, with a 5% hold between them so the object is legibly FLAT for a moment before it
 * shortens. Compressing the cut into the tail would put a 380ms burst inside a few pixels of scroll.
 */
export const MOBILE_RIBBON_SPLIT = { poseTo: 0.55, cutFrom: 0.6 } as const;

/** The message lands, and its bubble surface with it, inside the chat card's own pass. */
export const MOBILE_SEND = { from: 0.12, to: 0.46 } as const;

/**
 * The trace rows occupy the back half of the chat card, after the message has landed.
 * `TraceRow.mFrom`/`mTo` are 0–1 across the rows; this is the window they are mapped into.
 */
export const MOBILE_TRACE = { from: 0.46, to: 1 } as const;

/** The bands ignite as the strip arrives, just before the collapse they belong to. */
export const MOBILE_IGNITE = { from: 0.4, to: 0.6 } as const;

/** The numeral rolls once the collapse has finished, so the payoff is not read mid-cut. */
export const MOBILE_ROLL = { from: 0.5, to: 0.9 } as const;

/** The lanes open across the readout's pass; `Lane.mFrom`/`mTo` are mapped into this window. */
export const MOBILE_LANES = { from: 0.15, to: 0.95 } as const;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   BEAT I — the lanes
   ───────────────────────────────────────────────────────────────────────────────────────── */

/** A registry key's human phrase. A raw key never appears in the UI, ever (§13). */
function label(key: string): string {
  const entry = catalogEntry(key);
  if (!entry) throw new Error(`hero-scene: "${key}" is not a renderable catalog entry`);
  return entry.label;
}

export interface Lane {
  readonly key: "look" | "transition" | "effect";
  /** The human phrase. */
  readonly label: string;
  /** The registry key, for the `<pre>` and for the tests. Never rendered as UI text. */
  readonly registryKey: string;
  /** Where the lane's mark sits on the RESULT strip, in ribbon px. */
  readonly startPx: number;
  readonly endPx: number;
  readonly from: number;
  readonly to: number;
  /** The same slot as a 0–1 fraction of beat I alone — see `TraceRow.mFrom`. */
  readonly mFrom: number;
  readonly mTo: number;
}

/** The default transition length, in ticks — `trans-*` params' `duration` of 240ms. */
const TRANSITION_MS = 240;

export const LANES: readonly Lane[] = (() => {
  const i = beat("I");
  const clips = MECHANISM_HEADLINE.clips;
  const resultLength = toPx(MECHANISM_HEADLINE.durationTicks);
  const cutTick = MECHANISM_HEADLINE.cutTicks[1];
  const transitionPx = (TRANSITION_MS * 30) / TICKS_PER_PX;
  const effectClip = clips[2];
  const lanes = 3;
  const slot = (i.to - i.from) / lanes;
  const placed = [
    {
      key: "look" as const,
      label: label("look-a24"),
      registryKey: "look-a24",
      startPx: 0,
      endPx: resultLength,
    },
    {
      key: "transition" as const,
      label: label("trans-whip-pan-l"),
      registryKey: "trans-whip-pan-l",
      startPx: toPx(cutTick) - transitionPx / 2,
      endPx: toPx(cutTick) + transitionPx / 2,
    },
    {
      key: "effect" as const,
      label: label("zoom-punch"),
      registryKey: "zoom-punch",
      startPx: toPx(effectClip.startTick),
      endPx: toPx(effectClip.endTick),
    },
  ];
  return placed.map((lane, index) => ({
    ...lane,
    from: i.from + slot * index,
    to: i.from + slot * (index + 1),
    mFrom: index / lanes,
    mTo: (index + 1) / lanes,
  }));
})();

/**
 * The look lane's tint, from the renderer's own code.
 *
 * `look-a24` is a RECIPE, not an effect key, so it never reaches `gradeFor` as a single key. Its
 * first step is `lut-a24-moonlight`, which IS a real `case` in `ColorGrade.tsx`'s switch, and the
 * lane paints all three of the layers the compositor paints — filter, the `screen` lift, the
 * `soft-light` tint — not just the filter. A page that imports one third of the renderer and calls
 * itself the renderer's output is the same class of untruth as a fabricated metric.
 */
export const LOOK_GRADE: Grade = gradeFor("lut-a24-moonlight", {});
export const LOOK_RECIPE_STEP = "lut-a24-moonlight";

/**
 * The caption lane is designed and DELIBERATELY not rendered. `ADD_CAPTION` is a real command with a
 * real reducer case and a real `caption` track role — the capability exists. What does not exist is
 * an honest value for `text`: there is no transcript, and every candidate string would be fabricated
 * speech. One boolean unlocks the lane on the day the take lands.
 */
export const CAPTION_LANE_RENDERS = MECHANISM.asset.hasMedia;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE RESTING STATE — what the server paints, and what a crawler reads
   ───────────────────────────────────────────────────────────────────────────────────────── */

export interface ResultClip {
  readonly id: string;
  readonly startPx: number;
  readonly endPx: number;
}

/** The six clips of the finished edit, on the result strip, in ribbon px. */
export const RESULT_CLIPS: readonly ResultClip[] = MECHANISM_HEADLINE.clips.map((c) => ({
  id: c.id,
  startPx: toPx(c.startTick),
  endPx: toPx(c.endTick),
}));

export const RESULT_LENGTH_PX = toPx(MECHANISM_HEADLINE.durationTicks);
export const RESULT_CUTS_PX: readonly number[] = MECHANISM_HEADLINE.cutTicks.map(toPx);
export const SOURCE_SECONDS = MECHANISM_SOURCE.durationTicks / TICKS_PER_PX / (30000 / TICKS_PER_PX);
/** One tick mark per second of the take — the ribbon's own ruler, at the take's rate, not the page's. */
export const SECOND_PX = 30000 / TICKS_PER_PX;

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE GATES — every property the technique depends on, checked before the page can render
   ───────────────────────────────────────────────────────────────────────────────────────── */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`hero-scene: ${message}`);
}

/** Face runs, collapsed. Two crossings ⇒ front, back, front. */
export const FACE_RUNS = RIBBON.faceRuns;

(function gate(): void {
  // 1. Seams close. Measured through the emitted transforms, not through the frame they came from.
  assert(RIBBON.maxSeamGapPx < 0.5, `seam gap ${RIBBON.maxSeamGapPx.toFixed(3)}px exceeds 0.5px`);

  // 2. Depth is monotonic, so painter's order is exact in every engine.
  for (let i = 1; i < RIBBON.plates.length; i++) {
    assert(
      RIBBON.plates[i].cz < RIBBON.plates[i - 1].cz,
      `plate ${i} does not recede (z ${RIBBON.plates[i - 1].cz} → ${RIBBON.plates[i].cz})`,
    );
  }

  // 3. The faceting is bounded in screen space.
  assert(
    RIBBON.maxFacetGapPx <= FACET_BUDGET_PX + 0.6,
    `projected facet wedge ${RIBBON.maxFacetGapPx.toFixed(2)}px exceeds the budget`,
  );

  // 4. Face → edge → back → edge → face. The brief's sentence, verified.
  assert(
    FACE_RUNS.length === 3 && FACE_RUNS[0].face === "front" && FACE_RUNS[2].face === "front",
    `expected front/back/front, got ${FACE_RUNS.map((r) => r.face).join("/")}`,
  );
  assert(
    FACE_RUNS[2].to - FACE_RUNS[2].from >= 6,
    "the second face run is too short to read as a face",
  );

  // 5. No plate straddles a cut, so beat H is transform-only.
  for (const plate of RIBBON.plates) {
    const run = RIBBON_RUNS[plate.run];
    assert(
      plate.leftPx >= run.startPx - 1e-6 && plate.leftPx + plate.widthPx <= run.endPx + 1e-6,
      `plate ${plate.index} straddles run ${run.index}`,
    );
  }

  // 6. The edit is the one the reducer produced.
  const removedPx = RIBBON_RUNS.filter((r) => r.removed).reduce((n, r) => n + (r.endPx - r.startPx), 0);
  assert(
    Math.abs(removedPx - toPx(MECHANISM_HEADLINE.removedTicks)) < 1e-6,
    "the collapsing runs do not sum to the reducer's own removed duration",
  );
  assert(
    Math.abs(RIBBON_LENGTH_PX - removedPx - RESULT_LENGTH_PX) < 1e-6,
    "source − removed ≠ result",
  );
  assert(CUT_STEPS.length === MECHANISM_HEADLINE.removed.length, "cut steps ≠ removed spans");

  // 7. The object is on screen at every curled pose — never a sliver in a corner. The rejected
  //    version of this scene put the ribbon at 6% of the viewport for the first 42% of the scroll;
  //    these two numbers are the gate that stops that happening again.
  for (const f of BODY_FOOTPRINT) {
    assert(
      f.width >= STAGE_W * 0.85,
      `at ${f.at}% the ribbon spans only ${f.width.toFixed(0)}px of a ${STAGE_W}px stage`,
    );
    assert(
      f.height >= STAGE_H * 0.42,
      `at ${f.at}% the ribbon is only ${f.height.toFixed(0)}px tall`,
    );
  }

  // 8. The lighting has range and the underside has form.
  const shades = RIBBON.plates.map((p) => p.shade);
  assert(Math.max(...shades) - Math.min(...shades) > 0.4, "the shade model has no range");
  assert(Math.max(...RIBBON.plates.map((p) => p.spec)) > 0.5, "the specular never blows out");

  // 9. The typing covers its beat exactly.
  const last = TYPED_CHARS[TYPED_CHARS.length - 1];
  assert(Math.abs(last.to - SEND_WINDOW.from) < 1e-6, "the typing does not hand over to the send");

  // 10. Beats tile the travel with no gap and no overlap.
  assert(BEATS[0].from === 0 && BEATS[BEATS.length - 1].to === 100, "beats do not span the travel");
  for (let i = 1; i < BEATS.length; i++) assert(BEATS[i].from === BEATS[i - 1].to, "beats do not tile");
})();

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE GPU EDITION'S DATA
   ─────────────────────────────────────────────────────────────────────────────────────────

   `components/site/HeroRibbonGL.tsx` draws the strip as one lit mesh. It needs the same curve the
   plates ride, but continuously rather than in boxes — and it must NOT be the one to compute it.

   THIS FILE MUST NEVER REACH A BROWSER. `solveRibbon` builds a 16384-step arc-length table and a
   4096-step roll integral, then runs an adaptive subdivision to 144 plates; that is server work, and
   importing this module from a client component would drag all of it into the landing bundle the
   `check-bundle` gate guards. So the numbers below are computed here, on the server, and handed to
   the client component as plain props. `HeroSetpiece` is a server component and is the only importer.

   The arrays are flat on purpose: an array of objects costs its keys again at every element in the
   RSC payload, and this is the one piece of scene data whose size is worth counting. */

/**
 * Stations along the centre line. 160 over 2880px is one every 18px — well inside the curvature of
 * a net whose tightest bend is the tail hook, and the GPU interpolates position, frame and shading
 * between them. Raising it costs payload linearly and buys nothing the eye can find: measured
 * against the solver's 144 plates, the frames already agree to 0.6° against its own 5° seam budget.
 */
const SPINE_STATIONS = 160;

/** `[px, py, pz, upx, upy, upz]` per station. The tangent is a central difference on the client. */
export const RIBBON_SPINE: readonly number[] = (() => {
  const samples = sampleSpine(
    {
      net: CONTROL_NET,
      lengthPx: RIBBON_LENGTH_PX,
      twistDeg: TWIST_DEG,
      perspective: PERSPECTIVE_PX,
    },
    SPINE_STATIONS,
  );
  const out: number[] = [];
  for (const s of samples) {
    // Positions are px and land sub-pixel at 2dp; the frame is a unit vector and needs 4.
    out.push(
      Math.round(s.p[0] * 100) / 100,
      Math.round(s.p[1] * 100) / 100,
      Math.round(s.p[2] * 100) / 100,
      Math.round(s.up[0] * 10000) / 10000,
      Math.round(s.up[1] * 10000) / 10000,
      Math.round(s.up[2] * 10000) / 10000,
    );
  }
  return out;
})();

/** `[startPx, endPx, removed]` per run — the clip blocks, and which ones beat H deletes. */
export const RIBBON_RUNS_FLAT: readonly number[] = RIBBON_RUNS.flatMap((r) => [
  r.startPx,
  r.endPx,
  r.removed ? 1 : 0,
]);

/** `[startPx, endPx, removed]` per silence the transcript actually reports. */
export const SILENCE_BANDS_FLAT: readonly number[] = SILENCE_BANDS.flatMap((b) => [
  b.startPx,
  b.endPx,
  b.removed ? 1 : 0,
]);

/** `[at, x, y, z, yaw, pitch, scale]` per body key — the pose track, shared with the CSS edition. */
export const BODY_KEYS_FLAT: readonly number[] = BODY_KEYS.flatMap((k) => [
  k.at,
  k.x,
  k.y,
  k.z,
  k.yaw,
  k.pitch,
  k.scale,
]);

/** `FLAT_SCALE_STEPS` as `[maxWidth, scale, …]`, `-1` for the open-ended step the ladder starts at. */
export const FLAT_SCALE_STEPS_FLAT: readonly number[] = FLAT_SCALE_STEPS.flatMap((s) => [
  s.maxWidth ?? -1,
  s.scale,
]);

/**
 * `LANES` as `[startPx, endPx, from, to, kind]`, kind 0 look · 1 transition · 2 effect.
 *
 * Positions are in RESULT px — where the mark sits on the strip AFTER the cut — which is the space
 * `LANES` authors them in and the space they are true in. The GPU edition inverts the ripple to find
 * the source station each one hangs from, so a lane rides the cut instead of being pinned to a
 * finished layout it would drift out of if the viewer scrolled back through beat H.
 *
 * The caption lane is absent here for the same reason it is absent from the DOM: `ADD_CAPTION` is a
 * real command with a real reducer case, but there is no transcript, so every candidate string would
 * be fabricated speech. `CAPTION_LANE_RENDERS` unlocks it on the day a take lands.
 */
export const LANES_FLAT: readonly number[] = LANES.flatMap((l) => [
  l.startPx,
  l.endPx,
  l.from,
  l.to,
  l.key === "look" ? 0 : l.key === "transition" ? 1 : 2,
]);

/**
 * THE CLIP NAME TAGS — what an NLE writes across the top of every block.
 *
 * The name is `MECHANISM.asset.id` plus the clip's ordinal, and it is that rather than a filename
 * because there is no file. `asset.hasMedia` is `false`: no take has been committed, so any
 * "take-01.mp4" here would fabricate a container that does not exist — the same class of untruth as
 * a fabricated metric, printed six times across the object the whole page is about. The id is real
 * data from the fixture, the ordinal is the clip's real position in the reduced EDL, and the hero
 * already says the rest out loud one line below ("No take committed. The timeline is real; the
 * picture is not shipped.").
 *
 * When a take does land, `asset.id` becomes its name and these tags start reading like an editor's
 * without a line of this changing.
 *
 * Emitted per KEPT run, in source px, so a tag rides the clip it belongs to through the ripple.
 */
export const CLIP_LABELS: readonly { startPx: number; endPx: number; label: string }[] = (() => {
  let n = 0;
  return RIBBON_RUNS.filter((r) => !r.removed).map((r) => {
    n += 1;
    return { startPx: r.startPx, endPx: r.endPx, label: `${MECHANISM.asset.id} · ${n}` };
  });
})();
