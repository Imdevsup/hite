/**
 * lib/landing/hero-geometry.ts — the solver behind the hero set-piece's 3D ribbon.
 *
 * WHAT THIS IS. `docs/overhaul/HERO-SETPIECE.md` beats A–D ask for a long timeline that arrives in
 * perspective, curls in space so the viewer sees its face, its edge and its face again, and then
 * unwinds — continuously, on the same object — into the flat strip the rest of the page works in.
 * This module solves that ribbon: one 3D cubic Bézier, arc-length re-parameterised, carrying a
 * rotation-minimising frame plus an authored roll, sampled into a run of rectangular plates whose
 * CSS transform each is emitted as six numbers.
 *
 * WHY IT IS A MODULE AND NOT A TABLE OF NUMBERS. `ART-DIRECTION.md` §15 rule 5 bans numeric literals
 * in landing components, and a published table of three-decimal transforms is the same defect with
 * more digits: nobody can re-derive it, and it silently rots the moment the fixture changes. Every
 * number the scene renders is produced here, at module scope, deterministically, from the control
 * net and the generated fixture — and `hero-scene.ts` asserts the properties that make the technique
 * legal (below) before the page can render.
 *
 * THE THREE PROPERTIES THAT MAKE CSS 3D LEGAL HERE, each verified rather than asserted:
 *
 *  1. SEAMS CLOSE EXACTLY. Plate i is built so its two ends sit ON the curve at the arc positions
 *     that bound it — centre = midpoint of the chord, length axis = the chord direction. Consecutive
 *     plates therefore share an endpoint identically, and the centre-line seam gap is 0 by
 *     construction, not by tolerance. A two-rotation frame (yaw + roll) cannot do this: it drops the
 *     tangent's Y component, and on a curve with real vertical travel that tears the ribbon open at
 *     every seam. Three rotations are the minimum a frame on a space curve needs.
 *
 *  2. DEPTH IS MONOTONIC. CSS has no depth buffer; browsers sort whole elements, and Chrome sorts
 *     intersecting planes arbitrarily while Safari splits them. Plate centroids run strictly away
 *     from the camera, so painter's order is exact and identical in every engine.
 *
 *  3. THE FACETING IS BOUNDED IN SCREEN SPACE, NOT IN DEGREES. A faceted ruled surface leaves a
 *     wedge at each seam whose size is (height/2)·Δroll and whose DIRECTION is the plate's own
 *     normal. A displacement along the normal projects to nothing when the plate faces the camera
 *     and to its full length when the plate is edge-on — so a uniform degree budget spends its
 *     resolution exactly where it is invisible. Subdivision is therefore driven by the PROJECTED
 *     wedge: split the worst seam, repeat, until every seam is under the budget. That is what stops
 *     the ribbon reading as a venetian blind at the edge-on crossings, which is the one place a
 *     faceted twist gives itself away.
 *
 * CO-ORDINATES are CSS's: +X right, +Y DOWN, +Z toward the viewer, lengths in ribbon-local px.
 * Rotations are extracted for the exact function list the component authors, in that order —
 * `rotateY(ry) rotateZ(rz) rotateX(rx)` — because CSS interpolates a transform list function by
 * function when the two ends share a structure, and that per-function interpolation is what makes
 * beat D an unwind rather than a matrix lerp.
 */

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   VECTORS
   ───────────────────────────────────────────────────────────────────────────────────────── */

export type Vec3 = readonly [number, number, number];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l < 1e-12) throw new Error("hero-geometry: cannot normalize a zero vector");
  return scale(a, 1 / l);
}

/** Remove `axis`'s component from `v` and re-normalize. Used to keep a frame orthonormal. */
function orthonormalize(v: Vec3, axis: Vec3): Vec3 {
  return normalize(sub(v, scale(axis, dot(v, axis))));
}

const DEG = 180 / Math.PI;
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const clamp01 = (n: number): number => clamp(n, 0, 1);

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE CURVE — one cubic Bézier, arc-length re-parameterised
   ───────────────────────────────────────────────────────────────────────────────────────── */

export type ControlNet = readonly [Vec3, Vec3, Vec3, Vec3];

function bezier(net: ControlNet, t: number): Vec3 {
  const u = 1 - t;
  return add(
    add(scale(net[0], u * u * u), scale(net[1], 3 * u * u * t)),
    add(scale(net[2], 3 * u * t * t), scale(net[3], t * t * t)),
  );
}

function bezierTangent(net: ControlNet, t: number): Vec3 {
  const u = 1 - t;
  return add(
    add(scale(sub(net[1], net[0]), 3 * u * u), scale(sub(net[2], net[1]), 6 * u * t)),
    scale(sub(net[3], net[2]), 3 * t * t),
  );
}

/** Resolution of the arc-length table. 2^14 chords over a ~3000px curve ≈ 0.2px per chord. */
const ARC_STEPS = 16384;

/**
 * An arc-length table plus a rotation-minimising frame, both sampled once and shared.
 *
 * The frame is built by the double-reflection method: it is the frame with zero torsion about the
 * tangent, which is the only sane basis for an authored roll — a Frenet frame flips through
 * inflections and would spin the ribbon where the curve happens to straighten.
 */
class Curve {
  readonly net: ControlNet;
  readonly totalArc: number;
  private readonly points: Vec3[] = [];
  private readonly cumulative: number[] = [0];
  private readonly frameTangent: Vec3[] = [];
  private readonly frameUp: Vec3[] = [];

  constructor(net: ControlNet) {
    this.net = net;
    for (let i = 0; i <= ARC_STEPS; i++) this.points.push(bezier(net, i / ARC_STEPS));
    for (let i = 1; i <= ARC_STEPS; i++) {
      this.cumulative.push(this.cumulative[i - 1] + length(sub(this.points[i], this.points[i - 1])));
    }
    this.totalArc = this.cumulative[ARC_STEPS];

    let tangent = normalize(bezierTangent(net, 0));
    // The head leaves flat and face-on, so the frame starts with the page's own down and out axes.
    let up = orthonormalize([0, 1, 0], tangent);
    this.frameTangent.push(tangent);
    this.frameUp.push(up);
    let t = 0;
    for (let i = 1; i <= ARC_STEPS; i++) {
      const tNext = this.tAtArc((i / ARC_STEPS) * this.totalArc);
      const x0 = bezier(net, t);
      const x1 = bezier(net, tNext);
      const tangentNext = normalize(bezierTangent(net, tNext));
      const r1 = sub(x1, x0);
      const c1 = dot(r1, r1) || 1e-12;
      const upL = sub(up, scale(r1, (2 / c1) * dot(r1, up)));
      const tanL = sub(tangent, scale(r1, (2 / c1) * dot(r1, tangent)));
      const r2 = sub(tangentNext, tanL);
      const c2 = dot(r2, r2) || 1e-12;
      up = normalize(sub(upL, scale(r2, (2 / c2) * dot(r2, upL))));
      tangent = tangentNext;
      t = tNext;
      this.frameTangent.push(tangent);
      this.frameUp.push(up);
    }
  }

  /** Bézier parameter at an arc distance, by binary search plus one linear step. */
  private tAtArc(arc: number): number {
    let lo = 0;
    let hi = ARC_STEPS;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] < arc) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const span = this.cumulative[i] - this.cumulative[i - 1] || 1e-12;
    return (i - 1 + (arc - this.cumulative[i - 1]) / span) / ARC_STEPS;
  }

  pointAtArc(arc: number): Vec3 {
    return bezier(this.net, this.tAtArc(clamp(arc, 0, this.totalArc)));
  }

  zAtArc(arc: number): number {
    return this.pointAtArc(arc)[2];
  }

  /** The rotation-minimising up-vector at an arc distance, linearly blended then re-orthonormalised. */
  upAtArc(arc: number, tangent: Vec3): Vec3 {
    const f = (clamp(arc, 0, this.totalArc) / this.totalArc) * ARC_STEPS;
    const i = Math.min(ARC_STEPS - 1, Math.max(0, Math.floor(f)));
    const a = f - i;
    const blended = add(scale(this.frameUp[i], 1 - a), scale(this.frameUp[i + 1], a));
    return orthonormalize(blended, tangent);
  }
}

/**
 * Scale a control net so the curve's arc length is exactly `target`.
 *
 * Load-bearing, not cosmetic: the flatten is a rigid unrolling. If the curve were longer or shorter
 * than the flat strip, every plate would have to stretch or squash on the way down and beat D would
 * read as elastic — which is exactly the "two different objects" the brief bans.
 */
function fitArcLength(net: ControlNet, target: number): { net: ControlNet; scale: number } {
  const unit = new Curve(net);
  const s = target / unit.totalArc;
  const fitted: ControlNet = [scale(net[0], s), scale(net[1], s), scale(net[2], s), scale(net[3], s)];
  return { net: fitted, scale: s };
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE CSS TRANSFORM — rotateY · rotateZ · rotateX, extracted from an orthonormal frame
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The rotation matrix CSS builds for `rotateY(ry) rotateZ(rz) rotateX(rx)`, as its three columns —
 * i.e. where the plate's own +X (length), +Y (down the face) and +Z (outward normal) end up.
 *
 * Exported because the assertions are worth more when they go through the browser's own algebra
 * rather than through the frame the extraction came from: `hero-scene.ts` rebuilds every plate from
 * its six emitted numbers and measures the seams that result.
 */
export function transformAxes(ry: number, rz: number, rx: number): readonly [Vec3, Vec3, Vec3] {
  const a = ry / DEG;
  const b = rz / DEG;
  const c = rx / DEG;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cc = Math.cos(c);
  const sc = Math.sin(c);
  return [
    [ca * cb, sb, -sa * cb],
    [-ca * sb * cc + sa * sc, cb * cc, sa * sb * cc + ca * sc],
    [ca * sb * sc + sa * cc, -cb * sc, -sa * sb * sc + ca * cc],
  ];
}

/**
 * The inverse: the three angles that put a plate's length axis on `tangent` and its down axis on
 * `up`. Derived from the column forms above — `rz` from the tangent's Y, `ry` from its X and Z, and
 * `rx` from the down and normal axes' Y components.
 *
 * `rz` is bounded by ±90° because it is read back through `asin`, which is not a limitation here:
 * the ribbon's tangent never points straight up or straight down.
 */
function eulerFromFrame(tangent: Vec3, up: Vec3): { ry: number; rz: number; rx: number } {
  const normal = cross(tangent, up);
  return {
    ry: Math.atan2(-tangent[2], tangent[0]) * DEG,
    rz: Math.asin(clamp(tangent[1], -1, 1)) * DEG,
    rx: Math.atan2(-normal[1], up[1]) * DEG,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   LIGHTING — three lights on ONE object, solved once per plate
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The rig. `ART-DIRECTION.md` §3.2 deletes the light rig from the PAGE — no key light on the ground,
 * no radial pair, no glow — and that stays deleted. This is lighting on an object, and an object
 * with one Lambert key has no form on its own underside: an unclamped single key puts the back run
 * at black and a clamped one puts it at a single flat value for a third of the ribbon's length,
 * which is worse — a real strip's underside has gradient.
 *
 * So: the key is the take's own rig (§1, "one soft key at ~45° camera-left"), a bounce answers it
 * from camera-right at a third of its weight, and a rim sits behind and above and is gated on
 * grazing incidence so it only ever draws the silhouette. Wrapped (half-Lambert) diffuse rather than
 * clamped Lambert, so the terminator never hits a wall and the underside keeps its falloff.
 */
const KEY: Vec3 = normalize([-0.42, -0.62, 0.66]);
const FILL: Vec3 = normalize([0.58, 0.2, 0.79]);
const RIM: Vec3 = normalize([-0.1, -0.88, -0.46]);
const VIEW: Vec3 = [0, 0, 1];
const HALF_VECTOR: Vec3 = normalize(add(KEY, VIEW));

const AMBIENT = 0.26;
const KEY_WEIGHT = 0.56;
const FILL_WEIGHT = 0.2;
const RIM_WEIGHT = 0.24;
const SHININESS = 28;
/**
 * Ceiling on the shade sheet.
 *
 * Measured against a real render rather than assumed: the ribbon's face is `--color-bg-2` (#0e1320)
 * on `--color-bg` (#06080d), which is a 6-value spread to begin with. A shade sheet allowed near 1.0
 * turns a third of the object into a hole; at 0.60 the underside is still clearly the darker side
 * and its own falloff is still visible. Wrapped diffuse (below) means this ceiling is almost never
 * reached anyway — it exists so a future control net cannot produce one.
 */
const SHADE_CEILING = 0.72;

/** Wrapped diffuse: 0 at (n·l) = -1, 0.25 at 0, 1 at 1. Never a hard terminator. */
const wrapped = (n: Vec3, l: Vec3): number => clamp01(dot(n, l) * 0.5 + 0.5);

/** Schlick's Fresnel against the view axis — this is what makes the edge-on pass actually flash. */
const fresnel = (n: Vec3): number => 0.04 + 0.96 * Math.pow(1 - clamp01(Math.abs(dot(n, VIEW))), 5);

/** How side-on the plate is, 0 (face-on) → 1 (edge-on). Also the visibility weight of the wedge. */
export const edgeOn = (n: Vec3): number => 1 - clamp01(Math.abs(dot(n, VIEW)));

export interface Shading {
  /** Opacity of the ground-tinted shade sheet over the face. LAW 2: shadows are ground, not black. */
  shade: number;
  /** Opacity of the specular sheet over the face. Free to blow out; this is a material, not a hairline. */
  spec: number;
}

export function shadeFor(normal: Vec3): Shading {
  const lit = clamp01((dot(normal, KEY) + 0.25) / 0.45);
  const rim = Math.max(0, dot(normal, RIM)) * Math.pow(edgeOn(normal), 3);
  // Ambient FLOORS the range rather than adding to it, so neither end of the model saturates: an
  // additive ambient clips the lit run to a single value the moment it is large enough to keep the
  // unlit run readable, which is the same flat-run defect as a hard shade clamp, at the other end.
  const light = clamp01(
    KEY_WEIGHT * wrapped(normal, KEY) + FILL_WEIGHT * wrapped(normal, FILL) + RIM_WEIGHT * rim,
  );
  const brightness = AMBIENT + (1 - AMBIENT) * light;
  const blinn = Math.pow(Math.max(0, dot(normal, HALF_VECTOR)), SHININESS);
  return {
    shade: clamp(1 - brightness, 0, SHADE_CEILING),
    spec: clamp01(blinn * 0.95 + fresnel(normal) * 0.8 * lit),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE RIBBON
   ───────────────────────────────────────────────────────────────────────────────────────── */

/** A stretch of the flat strip whose content is uniform under the edit — a clip, or a cut pause. */
export interface RibbonRun {
  readonly index: number;
  readonly startPx: number;
  readonly endPx: number;
  /** True when the whole run is deleted by the headline edit, so every plate in it collapses. */
  readonly removed: boolean;
}

export interface RibbonPlate {
  readonly index: number;
  readonly run: number;
  readonly removed: boolean;
  /** Flat layout, in ribbon-local px: the plate's own slot in the 2880px strip. */
  readonly leftPx: number;
  readonly widthPx: number;
  /** The curled pose, relative to the plate's flat slot. Six numbers, one transform list. */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly ry: number;
  readonly rz: number;
  readonly rx: number;
  /** Chord ÷ arc. Under 1 by a fraction of a percent; it is what keeps the unroll rigid. */
  readonly sx: number;
  readonly shade: number;
  readonly spec: number;
  readonly backShade: number;
  /** Which side of the plate the camera sees at rest in the curl. */
  readonly face: "front" | "back";
  readonly roll: number;
  readonly normal: Vec3;
}

export interface RibbonSolution {
  readonly net: ControlNet;
  readonly netScale: number;
  readonly arcLength: number;
  readonly plates: readonly RibbonPlate[];
  readonly runs: readonly RibbonRun[];
  /** Worst centre-line seam gap, measured through the emitted transforms. Must be ~0. */
  readonly maxSeamGapPx: number;
  /** Worst PROJECTED corner wedge across intra-run seams, at the read pose. */
  readonly maxFacetGapPx: number;
  /** Worst roll step across any seam, in degrees. Published so the faceting is a number, not a hope. */
  readonly maxFacetDeg: number;
  readonly zRange: readonly [number, number];
  readonly faceRuns: readonly { face: "front" | "back"; from: number; to: number }[];
}

export interface RibbonConfig {
  readonly net: ControlNet;
  readonly lengthPx: number;
  readonly heightPx: number;
  /** Total twist along the ribbon, in degrees. Two 90° crossings ⇒ face → edge → back → edge → face. */
  readonly twistDeg: number;
  readonly runs: readonly RibbonRun[];
  /** Camera focal length in px — the same value the scene sets on `--persp`. */
  readonly perspective: number;
  /** Uniform body scale at the pose the faceting budget is measured against (beat C, the settle). */
  readonly readScale: number;
  /** Screen-space wedge budget at that pose, in px. */
  readonly facetBudgetPx: number;
  /**
   * Ceiling on a single plate's flat width.
   *
   * The screen-space budget alone is not enough, and the failure it misses is the one that shows:
   * the far end of the ribbon is small on screen, so its wedges measure tiny and a greedy refiner
   * never splits it — leaving 120px slabs at the tail beside 15px plates at the crossings. That
   * reads as debris, not as a strip. A uniform seed fixes it before refinement starts.
   */
  readonly maxPlateWidthPx: number;
  /** Ceiling on the roll step across any seam, in degrees. The silhouette's own resolution. */
  readonly maxRollStepDeg: number;
  /** Hard ceiling on plate count, so a bad budget cannot mint a thousand DOM nodes. */
  readonly maxPlates: number;
}

/**
 * The roll profile: `dφ/ds ∝ (persp − z)/persp`, i.e. inversely proportional to the plate's own
 * projected scale.
 *
 * A uniform 270°/length twist spends the same number of degrees per pixel at the head — which is
 * nearest the camera and largest on screen, where a facet step is most visible — as at the tail,
 * which is half size. Weighting by depth makes the twist LOOK uniform, which is the only kind of
 * uniform a viewer can see, and it buys the head a long readable run before the turn begins.
 *
 * The exponent softens it. Full inverse-scale weighting is correct for the FACET but wrong for the
 * silhouette: it dumps most of the remaining twist onto the last few plates, which are also the most
 * foreshortened, and the tail fans out like a brush. 0.6 keeps the head slow and the tail readable.
 */
const ROLL_WEIGHT_EXPONENT = 0.6;

function rollProfile(curve: Curve, perspective: number): (arc: number) => number {
  const STEPS = 4096;
  const cumulative = [0];
  for (let i = 1; i <= STEPS; i++) {
    const mid = ((i - 0.5) / STEPS) * curve.totalArc;
    cumulative.push(
      cumulative[i - 1] +
        Math.pow((perspective - curve.zAtArc(mid)) / perspective, ROLL_WEIGHT_EXPONENT),
    );
  }
  const total = cumulative[STEPS];
  return (arc: number): number => {
    const f = (clamp(arc, 0, curve.totalArc) / curve.totalArc) * STEPS;
    const i = Math.min(STEPS - 1, Math.max(0, Math.floor(f)));
    const a = f - i;
    return (cumulative[i] * (1 - a) + cumulative[i + 1] * a) / total;
  };
}

interface Cut {
  readonly startPx: number;
  readonly endPx: number;
  readonly run: number;
  readonly removed: boolean;
}

/** Build one plate from an arc interval. Ends sit ON the curve, so seams close identically. */
function plateFrom(
  curve: Curve,
  cut: Cut,
  index: number,
  twistDeg: number,
  roll01: (arc: number) => number,
): RibbonPlate {
  const p0 = curve.pointAtArc(cut.startPx);
  const p1 = curve.pointAtArc(cut.endPx);
  const chord = sub(p1, p0);
  const chordLength = length(chord);
  const tangent = normalize(chord);
  const centre = scale(add(p0, p1), 0.5);
  const midArc = (cut.startPx + cut.endPx) / 2;

  const transported = curve.upAtArc(midArc, tangent);
  const transportedNormal = cross(tangent, transported);
  const roll = twistDeg * roll01(midArc);
  const phi = roll / DEG;
  const up = normalize(
    add(scale(transported, Math.cos(phi)), scale(transportedNormal, Math.sin(phi))),
  );
  const normal = cross(tangent, up);

  const { ry, rz, rx } = eulerFromFrame(tangent, up);
  const widthPx = cut.endPx - cut.startPx;
  const flatCentreX = (cut.startPx + cut.endPx) / 2;
  const front = shadeFor(normal);
  const back = shadeFor(scale(normal, -1));

  return {
    index,
    run: cut.run,
    removed: cut.removed,
    leftPx: cut.startPx,
    widthPx,
    cx: centre[0] - flatCentreX,
    cy: centre[1],
    cz: centre[2],
    ry,
    rz,
    rx,
    sx: chordLength / widthPx,
    shade: front.shade,
    spec: front.spec,
    backShade: back.shade,
    face: normal[2] > 0 ? "front" : "back",
    roll,
    normal,
  };
}

/** World position of a point on a plate, rebuilt from the SIX EMITTED NUMBERS rather than the frame. */
function platePoint(plate: RibbonPlate, localX: number, localY: number): Vec3 {
  const [axisX, axisY] = transformAxes(plate.ry, plate.rz, plate.rx);
  const slotCentre: Vec3 = [plate.leftPx + plate.widthPx / 2, 0, 0];
  return add(
    add(slotCentre, [plate.cx, plate.cy, plate.cz]),
    add(scale(axisX, localX * plate.sx), scale(axisY, localY)),
  );
}

/** Screen position of a ribbon-local point under a uniform body scale and this perspective. */
function project(p: Vec3, perspective: number, bodyScale: number): readonly [number, number] {
  const q: Vec3 = scale(p, bodyScale);
  const s = perspective / (perspective - q[2]);
  return [q[0] * s, q[1] * s];
}

/** The projected corner wedge at the seam between two plates, in screen px at the read pose. */
function seamWedge(a: RibbonPlate, b: RibbonPlate, config: RibbonConfig): number {
  const h = config.heightPx / 2;
  let worst = 0;
  for (const y of [-h, h]) {
    const pa = project(platePoint(a, a.widthPx / 2, y), config.perspective, config.readScale);
    const pb = project(platePoint(b, -b.widthPx / 2, y), config.perspective, config.readScale);
    worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]));
  }
  return worst;
}

/**
 * Solve the ribbon.
 *
 * Subdivision starts from the runs — every plate belongs to exactly one clip or one cut pause, and
 * no plate ever straddles a boundary. That is what makes beat H expressible as `translateX` and
 * `scaleX` on the SAME plates that carried the curl: a run either survives whole and slides, or is
 * deleted whole and collapses. Nothing has to change width, so nothing touches layout, and there is
 * never a second object to hand off to.
 *
 * From there it splits the worst PROJECTED seam repeatedly until the wedge budget is met or the
 * node ceiling is reached. Resolution therefore follows the surface, not a round number.
 */
export function solveRibbon(config: RibbonConfig): RibbonSolution {
  const fitted = fitArcLength(config.net, config.lengthPx);
  const curve = new Curve(fitted.net);
  const roll01 = rollProfile(curve, config.perspective);

  // Seed: every run split into equal plates no wider than the ceiling. Uniform by construction, so
  // the refinement below only ever has to ADD resolution where the surface asks for it.
  let cuts: Cut[] = config.runs.flatMap((r) => {
    const parts = Math.max(1, Math.ceil((r.endPx - r.startPx) / config.maxPlateWidthPx));
    const step = (r.endPx - r.startPx) / parts;
    return Array.from({ length: parts }, (_, i) => ({
      startPx: r.startPx + step * i,
      endPx: r.startPx + step * (i + 1),
      run: r.index,
      removed: r.removed,
    }));
  });
  const rebuild = (): RibbonPlate[] =>
    cuts.map((c, i) => plateFrom(curve, c, i, config.twistDeg, roll01));

  const split = (index: number): void => {
    const target = cuts[index];
    const mid = (target.startPx + target.endPx) / 2;
    cuts = [
      ...cuts.slice(0, index),
      { ...target, endPx: mid },
      { ...target, startPx: mid },
      ...cuts.slice(index + 1),
    ];
  };

  let plates = rebuild();
  for (let guard = 0; guard < config.maxPlates * 2; guard++) {
    if (plates.length >= config.maxPlates) break;
    let worstIndex = -1;
    let worstScore = 1;
    for (let i = 0; i + 1 < plates.length; i++) {
      // Both budgets, normalised, so one refinement loop serves the screen and the silhouette.
      const score = Math.max(
        seamWedge(plates[i], plates[i + 1], config) / config.facetBudgetPx,
        Math.abs(plates[i + 1].roll - plates[i].roll) / config.maxRollStepDeg,
      );
      if (score <= worstScore) continue;
      worstScore = score;
      // Split whichever of the two is wider — the seam's error is shared between them.
      worstIndex = plates[i].widthPx >= plates[i + 1].widthPx ? i : i + 1;
    }
    if (worstIndex < 0) break;
    split(worstIndex);
    plates = rebuild();
  }

  let maxSeamGapPx = 0;
  let maxFacetGapPx = 0;
  let maxFacetDeg = 0;
  for (let i = 0; i + 1 < plates.length; i++) {
    const a = plates[i];
    const b = plates[i + 1];
    maxSeamGapPx = Math.max(
      maxSeamGapPx,
      length(sub(platePoint(a, a.widthPx / 2, 0), platePoint(b, -b.widthPx / 2, 0))),
    );
    maxFacetDeg = Math.max(maxFacetDeg, Math.abs(b.roll - a.roll));
    if (a.run === b.run) maxFacetGapPx = Math.max(maxFacetGapPx, seamWedge(a, b, config));
  }

  const faceRuns: { face: "front" | "back"; from: number; to: number }[] = [];
  for (const plate of plates) {
    const last = faceRuns[faceRuns.length - 1];
    if (last && last.face === plate.face) last.to = plate.index;
    else faceRuns.push({ face: plate.face, from: plate.index, to: plate.index });
  }

  return {
    net: fitted.net,
    netScale: fitted.scale,
    arcLength: curve.totalArc,
    plates,
    runs: config.runs,
    maxSeamGapPx,
    maxFacetGapPx,
    maxFacetDeg,
    zRange: [plates[0].cz, plates[plates.length - 1].cz],
    faceRuns,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE BODY — the rigid pose the whole ribbon rides on through beats A–D
   ───────────────────────────────────────────────────────────────────────────────────────── */

export interface BodyPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly scale: number;
}

/** `translate3d(x,y,z) rotateY(yaw) rotateX(pitch) scale(s)`, as the browser composes it. */
function bodyAxes(pose: BodyPose): readonly [Vec3, Vec3, Vec3] {
  const a = pose.yaw / DEG;
  const b = pose.pitch / DEG;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  return [
    [ca, 0, -sa],
    [sa * sb, cb, ca * sb],
    [sa * cb, -sb, ca * cb],
  ];
}

/**
 * The screen-space bounding box of the whole ribbon under a body pose, in px, relative to the
 * perspective origin. This is how "does the object fill the frame" stops being an opinion.
 */
export function projectedBounds(
  plates: readonly RibbonPlate[],
  heightPx: number,
  pose: BodyPose,
  perspective: number,
  ribbonCentre: Vec3,
): { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number } {
  const axes = bodyAxes(pose);
  const h = heightPx / 2;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const plate of plates) {
    for (const lx of [-plate.widthPx / 2, plate.widthPx / 2]) {
      for (const ly of [-h, h]) {
        const local = sub(platePoint(plate, lx, ly), ribbonCentre);
        const rotated = add(
          add(scale(axes[0], local[0] * pose.scale), scale(axes[1], local[1] * pose.scale)),
          scale(axes[2], local[2] * pose.scale),
        );
        const world: Vec3 = [rotated[0] + pose.x, rotated[1] + pose.y, rotated[2] + pose.z];
        const s = perspective / (perspective - world[2]);
        const sx = world[0] * s;
        const sy = world[1] * s;
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
      }
    }
  }
  return { x0, x1, y0, y1 };
}

/**
 * The specular peak, per plate, as the body yaws.
 *
 * Beat B's brief line is "light must rake across it as it turns". This is where that stops being a
 * wish: sweep the rigid body across the yaw range beats A→D actually travel, and record the yaw at
 * which each plate's own Blinn–Phong term peaks. The pass that results is not timed by anyone — it
 * is what the geometry does under a fixed key, which is why it lands inside beat B on its own.
 *
 * Returns `null` for a plate that never lights (the back run under a camera-left key), because a
 * highlight there would be a lie about where the light is.
 */
export function rakePeaks(
  plates: readonly RibbonPlate[],
  yawFrom: number,
  yawTo: number,
  samples: number,
): readonly (number | null)[] {
  return plates.map((plate) => {
    let bestYaw: number | null = null;
    let best = 0;
    for (let i = 0; i <= samples; i++) {
      const yaw = yawFrom + ((yawTo - yawFrom) * i) / samples;
      const a = yaw / DEG;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // rotateY only: the pitch range is small enough that it never moves a peak by a sample.
      const n: Vec3 = [
        ca * plate.normal[0] + sa * plate.normal[2],
        plate.normal[1],
        -sa * plate.normal[0] + ca * plate.normal[2],
      ];
      if (n[2] <= 0) continue;
      const value = Math.pow(Math.max(0, dot(n, HALF_VECTOR)), SHININESS) + 0.35 * fresnel(n) * clamp01((dot(n, KEY) + 0.25) / 0.45);
      if (value > best) {
        best = value;
        bestYaw = yaw;
      }
    }
    return best > 0.08 ? bestYaw : null;
  });
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE SPINE — the same curve, sampled for a GPU
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * One station on the ribbon's centre line: where it is, and the orthonormal frame it carries there.
 *
 * WHY THIS EXISTS ALONGSIDE `solveRibbon`. The two consumers want the same curve at opposite
 * resolutions and in opposite forms. CSS can only be handed rigid boxes, so `solveRibbon` spends its
 * effort deciding WHERE TO BREAK the ribbon — an adaptive subdivision that keeps every seam's wedge
 * under `facetBudgetPx` and every roll step under `maxRollStepDeg`, then emits ≤144 plates as Euler
 * triples because that is the only thing a `transform` list can say. A GPU has no such limit: it
 * wants many cheap stations and the true frame at each, and it interpolates between them itself.
 *
 * So this is not a second geometry. It is the SAME `Curve` — the same arc-length table, the same
 * rotation-minimising frame, the same depth-weighted `rollProfile` — read continuously instead of in
 * boxes. `hero-geometry.test.ts` pins them together: a spine sample taken at a plate's mid-arc must
 * reproduce that plate's own frame. If someone re-tunes the curl, both surfaces move at once, and
 * the WebGL strip cannot quietly drift into being a different object from the fallback under it.
 */
export interface SpineSample {
  /** Arc distance from the head, in ribbon-local px — i.e. the position along the flat strip. */
  readonly arc: number;
  /** The centre-line point in the ribbon's own space, before any body pose. */
  readonly p: Vec3;
  readonly tangent: Vec3;
  /** Across the face (the strip's own +Y, down), after the roll. */
  readonly up: Vec3;
  /** Out of the face. `cross(tangent, up)`, so the three are right-handed and orthonormal. */
  readonly normal: Vec3;
}

export interface SpineConfig {
  readonly net: ControlNet;
  readonly lengthPx: number;
  readonly twistDeg: number;
  readonly perspective: number;
}

/**
 * Sample the curl at `count + 1` evenly arc-spaced stations.
 *
 * The tangent is taken as a central difference rather than from `bezierTangent`, deliberately: it is
 * the CHORD direction, which is what `plateFrom` uses, so the frames agree at the seams instead of
 * differing by the curvature over half a station. `h` is one station, clamped at the ends.
 */
export function sampleSpine(config: SpineConfig, count: number): readonly SpineSample[] {
  const { net } = fitArcLength(config.net, config.lengthPx);
  const curve = new Curve(net);
  const roll01 = rollProfile(curve, config.perspective);
  const total = curve.totalArc;
  const h = total / count;

  const out: SpineSample[] = [];
  for (let i = 0; i <= count; i++) {
    const arc = (i / count) * total;
    const a0 = Math.max(0, arc - h / 2);
    const a1 = Math.min(total, arc + h / 2);
    const tangent = normalize(sub(curve.pointAtArc(a1), curve.pointAtArc(a0)));
    const transported = curve.upAtArc(arc, tangent);
    const phi = (config.twistDeg * roll01(arc)) / DEG;
    const up = normalize(
      add(scale(transported, Math.cos(phi)), scale(cross(tangent, transported), Math.sin(phi))),
    );
    out.push({ arc, p: curve.pointAtArc(arc), tangent, up, normal: cross(tangent, up) });
  }
  return out;
}
