"use client";

/**
 * components/site/HeroRibbonGL.tsx — the timeline strip, as one smooth mesh on the GPU.
 *
 * ── WHY THIS REPLACED THE CSS STRIP ──────────────────────────────────────────────────────────────
 *
 * The set-piece's ribbon was 144 `<div>`s carrying `rotateY·rotateZ·rotateX`. That approach is a
 * genuine achievement of `hero-geometry.ts` — an adaptive subdivision that holds every seam's wedge
 * under 2.4px and every roll step under 5° — but it is fighting the medium, and the medium wins in
 * three ways a viewer can see. A CSS box is FLAT, so a curve can only ever be approximated by
 * faceting it, and at the two edge-on crossings the facets show. A CSS box is UNLIT, so "light rakes
 * across it as it turns" has to be faked with per-plate opacity that steps at every seam instead of
 * sweeping. And a CSS box cannot be shaded per pixel, so the strip could only ever be a stack of
 * flat background gradients — which is exactly why it read as a smudge.
 *
 * One mesh with a real normal per pixel fixes all three at once: the curl is smooth because the
 * surface is, the rake is a specular term that sweeps continuously because it is computed from the
 * light and the normal, and the face can carry material.
 *
 * ── WHY RAW WebGL2 AND NOT three.js / ogl ────────────────────────────────────────────────────────
 *
 * `scripts/check-bundle.mjs` budgets this page at its measured baseline + 12KB gz. `three` is ~150KB
 * gz for even a trivial scene — twelve times the entire allowance — which is why it was deleted from
 * `package.json` in the first place. `ogl` tree-shakes to roughly 12–15KB gz, i.e. it would consume
 * the whole budget on its own, and it would buy a scene graph, a material system, loaders and a
 * raycaster for a page that draws ONE mesh with ONE program and never picks, never loads an asset
 * and never has a second object to sort against. The parts of a 3D engine that are hard are the
 * parts this scene does not use.
 *
 * So: no dependency. The cost here is the shaders plus ~70 lines of matrix and buffer setup.
 *
 * ── WHAT IS NOT ALLOWED TO REGRESS ───────────────────────────────────────────────────────────────
 *
 *  · THE LCP IS NEVER A CANVAS. `HeroSetpiece` server-renders the full DOM strip and it is what
 *    paints first, every time. This component mounts after hydration and only then sets
 *    `data-gl="on"`, which is the single hook `globals.css` uses to hide the DOM strip. Nothing about
 *    the hero's MEANING depends on this file executing.
 *  · EVERY FAILURE FALLS BACK SILENTLY. No WebGL2, a lost context, a failed compile, a reduced-motion
 *    request — each one returns without setting the flag, so the CSS strip simply stays. There is no
 *    error state for the visitor because there is nothing broken to report: they get the other one.
 *  · IT IS THE SAME CURVE. The spine comes from `sampleSpine`, which reads the same `Curve`, the same
 *    rotation-minimising frame and the same depth-weighted roll profile that produced the 144 plates.
 *    Verified numerically, not asserted: a spine station at a plate's mid-arc reproduces that plate's
 *    normal to within 0.6°, against the solver's own 5° seam budget.
 *  · THE FACE IS THE FIXTURE, NOT DECORATION. Clip blocks are `RIBBON_RUNS`; the cyan bands are the
 *    silences `findSilences` actually returned. No thumbnails: `MECHANISM.asset.hasMedia` is false
 *    and inventing a picture is the one thing this page may never do.
 *  · IT READS SCROLL, AND THAT IS A DELIBERATE COST. `ART-DIRECTION.md` §16's "zero JS scroll
 *    consumers" cannot survive a GPU scene — a uniform has to be written per frame by someone. The
 *    concession is bounded: the rAF loop exists only while an IntersectionObserver says the section
 *    is on screen, it reads one `getBoundingClientRect`, and it never writes layout.
 */
import { useEffect, useRef } from "react";

export interface HeroRibbonGLProps {
  /** The `.sp` section id — the pinned travel this scene is a function of. */
  readonly sectionId: string;
  /**
   * `sampleSpine` output, flattened as `[px,py,pz, upx,upy,upz]` per station, head to tail.
   * Precomputed on the server so `hero-scene.ts` — which builds a 16384-step arc table — never
   * reaches a browser, and so there is exactly one implementation of the curve.
   */
  readonly spine: readonly number[];
  /** `[startPx, endPx, removed]` per run, in strip order. The clip blocks and the cut. */
  readonly runs: readonly number[];
  /** `[startPx, endPx, removed]` per silence the transcript actually reports. */
  readonly silences: readonly number[];
  readonly lengthPx: number;
  readonly heightPx: number;
  readonly perspectivePx: number;
  readonly secondPx: number;
  /** Body pose keys `[at, x, y, z, yaw, pitch, scale]`, the same ones the CSS body rides. */
  readonly bodyKeys: readonly number[];
  /**
   * `FLAT_SCALE_STEPS` as `[maxWidth, scale, …]` with `-1` for the open-ended step.
   *
   * The settled strip's width is NOT `BODY_KEYS`' last scale. That value is the ceiling; the CSS
   * edition then narrows it per breakpoint through a `--flat` ladder, because "fit 2880px between
   * the gutters" is not expressible as one `calc()`. Reading the same ladder here is what keeps the
   * GPU strip landing on the same pixels as the lanes and the numeral under it — the alignment the
   * scene's whole claim rests on.
   */
  readonly flatSteps: readonly number[];
  /** Where beat H's collapse runs, as percentages of the pinned travel. */
  readonly cutFrom: number;
  readonly cutTo: number;
  /**
   * `LANES` as `[startPx, endPx, from, to, kind]` — the look, the transition and the effect the edit
   * actually applied, each with the travel window it opens across.
   *
   * These are beat I, and beat I is the brief's "layers of transitions, effects, animation … way
   * more". They ride the SAME spine as the strip, offset along the ribbon's own down-axis, so the
   * whole stack curls as one object instead of the strip curling in 3D while its lanes sit flat in
   * the DOM underneath — which is what made the finished timeline look like one bare row.
   */
  readonly lanes: readonly number[];
  /**
   * `RESULT_RECENTRE_PX`. The strip shortens from 2880 to 2340 local px, so the RESULT's centre is
   * no longer the object's centre — it moves 270px toward the head. Without this the finished strip
   * lands left of the lanes and the numeral, which reads as a bug in a scene whose entire claim is
   * that the numbers line up.
   */
  readonly recentrePx: number;
  /**
   * `CLIP_LABELS` — the name tag an NLE writes across the top of every block, one per kept clip.
   *
   * Drawn into a texture at the strip's own resolution rather than as DOM: there are six of them,
   * they have to curl and foreshorten with the surface they are printed on, and a DOM label cannot
   * follow a mesh through a 3D twist. This is the one place the canvas rasterises text, and it earns
   * it — unlike the lane labels, which stay in the DOM because they sit on a flat settled row where
   * real selectable text is strictly better.
   */
  readonly clipLabels: readonly { startPx: number; endPx: number; label: string }[];
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
   SHADERS
   ──────────────────────────────────────────────────────────────────────────────────────────── */

const VERT = `#version 300 es
precision highp float;

in float aU;        // 0..1 along the strip
in float aV;        // -0.5..0.5 across the face
in vec3  aPos;      // curled centre-line point, ribbon-local px
in vec3  aUp;       // curled across-face axis (unit)
in vec3  aTan;      // curled along-strip axis (unit)
in float aShift;    // removed px strictly before this station
in float aDead;     // 1 inside a run the edit deletes
in float aBand;     // 0 the strip · 1..N a lane
in float aOpen;     // 0..1 how far this band's own reveal has run

uniform mat4  uProj;
uniform float uFlat;      // 0 curled … 1 flat
uniform float uCut;       // 0 … 1 the ripple delete
uniform float uLen;
uniform float uRecentre;
uniform vec3  uTranslate;
uniform float uScale;
uniform float uYaw;
uniform float uPitch;
// Per-band placement down the ribbon's own face: [centre offset, half-height], in ribbon px.
uniform vec2  uBand[8];

out vec3  vNormal;
out vec3  vTangent;
out vec3  vWorld;
out float vU;
out float vV;
out float vDead;
out float vBand;
out float vOpen;

mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }

void main() {
  // THE FLATTEN IS ONE OBJECT LOSING ITS PERSPECTIVE, not a crossfade between two. Both poses are
  // built from the same station and mixed; because sampleSpine is arc-length parameterised, the
  // curled and flat lengths are identical, so the unroll is rigid and nothing stretches.
  vec3 flatP  = vec3(aU * uLen - uLen * 0.5, 0.0, 0.0);
  vec3 curlP  = aPos - vec3(uLen * 0.5, 0.0, 0.0);
  vec3 centre = mix(curlP, flatP, uFlat);

  vec3 up  = normalize(mix(aUp,  vec3(0.0, 1.0, 0.0), uFlat));
  vec3 tan = normalize(mix(aTan, vec3(1.0, 0.0, 0.0), uFlat));
  vec3 nrm = normalize(cross(tan, up));

  // Beat H. Everything downstream of a deleted run slides back by exactly the removed length, and a
  // deleted run collapses onto its own centre — the same two compositor moves the CSS edition makes,
  // for the same reason: no width is animated, so nothing has to be re-cut mid-object.
  centre -= tan * (aShift * uCut);
  centre += tan * (uRecentre * uCut);
  float squeeze = 1.0 - uCut * aDead;

  // The band's slot down the face. A lane grows out of the strip's lower edge as it opens rather
  // than fading in on top of it, which is what "the corresponding changes made to the timeline"
  // has to look like — the object gains structure, it does not acquire a decal.
  int   band  = int(aBand + 0.5);
  float off   = uBand[band].x;
  float halfH = uBand[band].y * (aBand < 0.5 ? 1.0 : aOpen);
  float across = off + aV * 2.0 * halfH;

  vec3 local = centre + up * (across * squeeze);
  vec3 world = rotY(uYaw) * (rotX(uPitch) * local) * uScale + uTranslate;

  vNormal  = normalize(rotY(uYaw) * (rotX(uPitch) * nrm));
  vTangent = normalize(rotY(uYaw) * (rotX(uPitch) * tan));
  vWorld   = world;
  vU = aU; vV = aV; vDead = aDead; vBand = aBand; vOpen = aOpen;

  gl_Position = uProj * vec4(world, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec3  vNormal;
in vec3  vTangent;
in vec3  vWorld;
in float vU;
in float vV;
in float vDead;
in float vBand;
in float vOpen;

uniform sampler2D uStrip;   // R clip body · G removed silence · B kept breath · A cut edge
uniform sampler2D uLabel;   // the clip name tags, 1:1 with the strip
uniform vec3  uWarm;
uniform vec3  uAccent;
uniform vec3  uBase;
uniform vec3  uInk;
uniform float uCut;
uniform float uFlat;
uniform float uSeconds;
uniform float uPersp;
/** One colour per lane, taken from the palette by kind. Index 0 is unused (the strip). */
uniform vec3  uLaneCol[8];

out vec4 outColor;

void main() {
  vec3 N = normalize(vNormal);
  // Two-sided: a film strip has a back, and it is lit by the same key.
  vec3 V = normalize(vec3(0.0, 0.0, uPersp) - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  vec3 T = normalize(vTangent - N * dot(N, vTangent));
  vec3 L = normalize(vec3(-0.45, -0.75, 0.85));
  vec3 H = normalize(L + V);

  // ── A LANE. Its own slab of material in the machine's colours, with a lit leading edge so the
  //    stack reads as depth rather than as stripes painted on one surface. ──
  if (vBand > 0.5) {
    // A DARK CHIP WITH A LIT RIM, not a coloured slab. .sp-lane-mark is --color-bg-2 with a
    // hairline inset border, and the lane's LABEL sits 6px inside its own left edge — so a saturated
    // fill does not just break the palette, it swallows the only text that says which effect this
    // is. The colour goes on the rim, where it names the lane and gives the slab an edge to catch
    // the key with.
    vec3 col = uLaneCol[int(vBand + 0.5)];
    float edge = smoothstep(0.40, 0.5, abs(vV));
    vec3 body = uBase * 1.25 + col * (0.06 + edge * 0.85);
    float lam = max(dot(N, L), 0.0);
    float sh  = pow(max(dot(N, H), 0.0), 40.0) * 0.22;
    float dz  = clamp((vWorld.z + 1100.0) / 1500.0, 0.0, 1.0);
    outColor = vec4((body * (0.42 + lam * 0.7) + vec3(sh)) * mix(0.58, 1.0, dz), vOpen);
    return;
  }

  float lambert = max(dot(N, L), 0.0);

  vec4 strip = texture(uStrip, vec2(vU, 0.5));

  // ── the face's own material, from the fixture ──
  vec3 albedo = uBase;
  albedo = mix(albedo, uInk * 0.34, strip.r * 0.34);      // clip body: a neutral lift, never a fake picture
  albedo = mix(albedo, uInk * 0.55, strip.b * 0.35);      // a breath the edit keeps
  albedo = mix(albedo, uAccent,     strip.g * 0.62);      // a pause the planner takes
  albedo = mix(albedo, uWarm,       strip.a * 0.90);      // the boundary the cut creates

  // ONE HAIRLINE PER SECOND OF THE TAKE, a longer mark every five — width measured in SCREEN space.
  // A fixed smoothstep(0.985, 1.0, ..) is a fixed slice of strip-space, and 48 of them across a
  // ribbon that recedes to a few pixels per second is a guaranteed moire: the first pass shimmered
  // with dark banding wherever the sampling rate crossed the tick spacing. fwidth gives the line a
  // constant apparent thickness instead, so it thins out honestly as the tail goes away.
  // A RULER THAT CANNOT BE RESOLVED IS NOT A RULER, IT IS A TINT. Once a second occupies under a
  // couple of pixels the individual hairlines merge, and because they are gated to the outer bands
  // of the face the merge shows up as horizontal stripes down the whole strip — which is exactly
  // what the second pass did. Each grade fades itself out as its own spacing collapses, so the
  // second marks drop first and the five-second marks carry on alone, the way a real ruler behaves.
  float sPos = vU * uSeconds;
  float sStep = fwidth(sPos);
  float sec  = abs(fract(sPos) - 0.5);
  // Soft gates, not step(): the ruler lives on the outer bands of the face, and a hard cutoff there
  // draws a crisp horizontal edge down the ENTIRE length of the strip — read as banding, which is
  // worse than the ticks it was meant to place.
  float tick = (1.0 - smoothstep(0.5 - sStep * 1.2, 0.5, sec))
             * smoothstep(0.26, 0.36, abs(vV)) * clamp(1.0 - sStep * 2.5, 0.0, 1.0);
  float fPos = sPos / 5.0;
  float fStep = fwidth(fPos);
  float fiv  = abs(fract(fPos) - 0.5);
  float five = (1.0 - smoothstep(0.5 - fStep * 1.2, 0.5, fiv))
             * smoothstep(0.14, 0.24, abs(vV)) * clamp(1.0 - fStep * 2.5, 0.0, 1.0);
  albedo = mix(albedo, uInk * 0.8, max(tick * 0.20, five * 0.38));

  // THE NAME TAG. Sampled in the strip's own space, so it rides the clip through the ripple without
  // any mapping of its own, and it fades with the run it is printed on when that run collapses.
  vec4 tag = texture(uLabel, vec2(vU, vV + 0.5));
  albedo = mix(albedo, uInk * 0.95, tag.a * strip.r);

  // The strip's own body: a touch heavier along the lower edge, so the face has a direction and the
  // two rails read as machined edges rather than as where the geometry stops.
  albedo *= 1.0 - 0.22 * smoothstep(0.1, 0.5, vV);

  // ── light ──
  float ambient = 0.24 + 0.16 * (0.5 + 0.5 * N.y);

  // ANISOTROPIC SPECULAR — the single term that makes this read as a strip of film rather than as a
  // rotating rectangle. A film strip is extruded along its length, so its highlight stretches ACROSS
  // that axis and sweeps as the surface rolls. An isotropic Blinn lobe gives a round hotspot that
  // just gets brighter, which is what a flat card does.
  // The exponent is a width, and 220 was too tight: across the strip's own height the only thing
  // that varies is the view vector, so a lobe that narrow resolves into a hard-edged band rather
  // than a streak. 90 keeps it unmistakably directional and lets it fall off inside the face.
  //
  // AND IT IS ATTENUATED BY THE FLATTEN. On a curled ribbon the lobe sweeps because the surface
  // turns through it; on the flat strip every fragment is coplanar and facing the camera, so the
  // same term has no variation left and fires across the whole object at once — the third pass
  // blew the left half of the settled timeline to white. The rake is a property of the curl, so it
  // leaves with the curl and a low sheen is what remains.
  //
  // AND IT IS MASKED BY THE DIFFUSE TERM. An anisotropic lobe is 1.0 everywhere T.H is near zero,
  // which on a long near-straight run is the WHOLE run — so without a facing mask the tail arrives
  // as a solid white wedge whenever the strip lines up with the light, whether that stretch is
  // turned toward the key or away from it. Gating on N.L keeps the sweep and removes the flare:
  // a highlight only exists where light actually lands.
  float TdH  = dot(T, H);
  float aniso = sqrt(max(0.0, 1.0 - TdH * TdH));
  float rake  = mix(1.0, 0.12, uFlat) * smoothstep(0.0, 0.35, lambert);
  float spec  = pow(aniso, 90.0) * 0.62 * rake + pow(max(dot(N, H), 0.0), 42.0) * 0.18 * lambert;

  // the rim, so the silhouette catches the key at the edge-on crossings
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);

  vec3 lit = albedo * (ambient + lambert * 0.95)
           + vec3(1.0) * spec
           + uAccent * fres * 0.18;

  // Depth, as an attenuation rather than a fog to a colour: LAW 2 says every shadow on this property
  // is the ground, never pure black, and mixing toward a constant would also flatten the specular it
  // is supposed to be behind. Gentle on purpose — the first pass dropped the NEAR end to 77% and the
  // whole strip read as unlit.
  float depth = clamp((vWorld.z + 1100.0) / 1500.0, 0.0, 1.0);
  lit *= mix(0.58, 1.0, depth);

  // a collapsing run leaves rather than vanishing
  float alpha = 1.0 - vDead * uCut;
  outColor = vec4(lit, alpha);
}`;

/* ────────────────────────────────────────────────────────────────────────────────────────────────
   MATH — only what one mesh needs
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The projection CSS `perspective` defines, so the GL strip and the DOM chat above it share one
 * camera. CSS puts the eye at `+z = perspective` looking down −z with the origin at the element's
 * centre, and does NOT divide by an aspect ratio — the frustum is the element's own pixel box.
 */
function perspectiveMatrix(w: number, h: number, d: number): Float32Array {
  /* CSS's camera, exactly — NOT a `gluPerspective`. The eye sits at `+z = perspective` looking down
     −z at the z=0 plane, the transform origin is the stage's centre, and there is NO aspect divide:
     the frustum is the element's own pixel box, so a point at z=0 lands on screen at its literal px
     coordinate. Every one of `BODY_KEYS`'s numbers was authored against that camera, so any other
     projection silently rescales the whole scene — which is what a `(2*d)/w` first term did on the
     first run: the ribbon came up filling the viewport instead of sitting upper-right.

         screen = xy · d / (d − z)      ⇒      w_clip = 1 − z/d
         ndc    = screen · 2 / extent           x_clip = 2x/w,  y_clip = −2y/h   (CSS +y is down)

     Column-major, so the fourth entry of the third column is the perspective divide. */
  return new Float32Array([
    2 / w, 0, 0, 0,
    0, -2 / h, 0, 0,
    0, 0, -1 / d, -1 / d,
    0, 0, 0, 1,
  ]);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Sample the body-pose track at a travel percentage, linearly between keys — the CSS does the same. */
function poseAt(keys: readonly number[], at: number): { t: [number, number, number]; yaw: number; pitch: number; scale: number } {
  const n = keys.length / 7;
  let i = 0;
  while (i < n - 1 && keys[(i + 1) * 7] <= at) i += 1;
  const a = i * 7;
  const b = Math.min(n - 1, i + 1) * 7;
  const span = keys[b] - keys[a] || 1;
  const f = clamp01((at - keys[a]) / span);
  const mix = (o: number): number => keys[a + o] + (keys[b + o] - keys[a + o]) * f;
  return { t: [mix(1), mix(2), mix(3)], yaw: mix(4), pitch: mix(5), scale: mix(6) };
}

/** `cubic-bezier(x1,y1,x2,y2)` evaluated at x — the two authored curl/flatten easings. */
function ease(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const bx = (t: number): number => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
  const by = (t: number): number => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k += 1) {
    const m = (lo + hi) / 2;
    if (bx(m) < x) lo = m;
    else hi = m;
  }
  return by((lo + hi) / 2);
}

/** `#rrggbb` or `rgb()/rgba()` from a computed custom property → linear-ish 0..1 triple. */
function readColor(style: CSSStyleDeclaration, name: string, fallback: [number, number, number]): [number, number, number] {
  const raw = style.getPropertyValue(name).trim();
  if (!raw) return fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  const nums = raw.match(/[\d.]+/g);
  if (nums && nums.length >= 3) {
    const [r, g, b] = nums;
    return [Number(r) / 255, Number(g) / 255, Number(b) / 255];
  }
  return fallback;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // Surfaced for a developer, never for a visitor: the DOM strip is already on screen behind this.
    console.error("[hero-gl] shader compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
   THE COMPONENT
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Stations across the face. Two would be enough for position; more gives the shading room to bend. */
const ACROSS = 6;
/** Texels along the strip's own length for the fixture mask. 2880px of strip at ~1.4 texels/px. */
const STRIP_TEXELS = 4096;

export function HeroRibbonGL(p: HeroRibbonGLProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Every prop is a module-scope constant from `hero-scene.ts`, so each one's identity is stable for
  // the life of the page and this effect runs exactly once despite listing the arrays. That is the
  // reason it can be an honest dependency list instead of a ref written during render: nothing here
  // is derived per-render, so there is no identity to churn and no GL context to needlessly rebuild.
  useEffect(() => {
    const canvas = canvasRef.current;
    const section = document.getElementById(p.sectionId);
    if (!canvas || !section) return;

    // A visitor who asked for less motion gets the resting DOM strip, which already shows beat I.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[hero-gl] link failed:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    /* ── geometry: one strip, ACROSS+1 rows by stations+1 columns ─────────────────────────────── */
    const stations = p.spine.length / 6 - 1;
    const runs = p.runs;
    const runCount = runs.length / 3;

    /** Removed px strictly before a strip position, and whether that position is inside a cut run. */
    const cutStateAt = (x: number): { shift: number; dead: number } => {
      let shift = 0;
      let dead = 0;
      for (let r = 0; r < runCount; r += 1) {
        const s = runs[r * 3];
        const e = runs[r * 3 + 1];
        if (runs[r * 3 + 2] !== 1) continue;
        if (e <= x) shift += e - s;
        else if (x >= s) dead = 1;
      }
      return { shift, dead };
    };

    /**
     * The source station a RESULT position hangs from — the ripple, inverted.
     *
     * `LANES` places its marks in result px, because that is where they are true: the A24 look runs
     * the length of the FINISHED cut, not of the source take. The strip's vertices are in source px
     * and slide by `shift` as beat H lands. Walking the kept runs converts one to the other, so a
     * lane is welded to the station it belongs to and rides the cut instead of being pinned to a
     * layout that only exists once the cut is over.
     */
    const sourceForResult = (r: number): number => {
      let kept = 0;
      for (let q = 0; q < runCount; q += 1) {
        const s = runs[q * 3];
        const e = runs[q * 3 + 1];
        if (runs[q * 3 + 2] === 1) continue;
        const width = e - s;
        if (kept + width >= r) return s + (r - kept);
        kept += width;
      }
      return p.lengthPx;
    };

    /** Band 0 is the strip across its whole length; bands 1..N are the lanes, each over its span. */
    const laneCount = p.lanes.length / 5;
    const bands: { u0: number; u1: number; from: number; to: number }[] = [
      { u0: 0, u1: 1, from: 0, to: 0 },
    ];
    for (let l = 0; l < laneCount; l += 1) {
      bands.push({
        u0: sourceForResult(p.lanes[l * 5]) / p.lengthPx,
        u1: sourceForResult(p.lanes[l * 5 + 1]) / p.lengthPx,
        from: p.lanes[l * 5 + 2],
        to: p.lanes[l * 5 + 3],
      });
    }

    const rows = ACROSS + 1;
    /** u, v, pos(3), up(3), tangent(3), shift, dead, band, open. */
    const STRIDE = 15;
    const verts: number[] = [];
    const indices: number[] = [];
    /** Per-band travel windows, read back per frame to drive `aOpen` without rebuilding geometry. */
    const bandWindows: { from: number; to: number }[] = [];
    /** Where each band's `aOpen` values start in the buffer, so only that slice is rewritten. */
    const bandVertexRange: { start: number; count: number }[] = [];

    /**
     * The strip's columns, BROKEN EXACTLY ON RUN BOUNDARIES.
     *
     * Uniform stations do not respect the edit: a run boundary lands mid-segment, so `aDead` and the
     * alpha derived from it interpolate ACROSS that segment and the collapse leaves a tapering wedge
     * of half-transparent geometry where a cut should be. It is visible at the strip's tail, where
     * the last run is a removed silence — a cyan shard hanging off the end of the finished timeline.
     *
     * Emitting each run's own columns, with a duplicated column at every boundary, makes the seam
     * zero-width: two coincident columns with opposite `dead` flags, so the transition happens
     * between two vertices at the same position instead of over 18px of ribbon. This is the same
     * property `solveRibbon` gets for free by never letting a plate straddle a cut.
     */
    const stripColumns: { u: number; shift: number; dead: number }[] = [];
    for (let q = 0; q < runCount; q += 1) {
      const s = runs[q * 3];
      const e = runs[q * 3 + 1];
      const dead = runs[q * 3 + 2];
      const { shift } = cutStateAt(s + (e - s) * 0.5);
      const segs = Math.max(1, Math.round(((e - s) / p.lengthPx) * stations));
      for (let c = 0; c <= segs; c += 1) {
        stripColumns.push({ u: (s + ((e - s) * c) / segs) / p.lengthPx, shift, dead });
      }
    }

    bands.forEach((band, bi) => {
      // A lane spans a fraction of the strip, so it gets its own station count rather than the
      // strip's 160 — a 240ms transition mark needs a handful of columns, not one.
      const span = band.u1 - band.u0;
      const segs = bi === 0 ? stripColumns.length - 1 : Math.max(4, Math.round(span * stations));
      const base = verts.length / STRIDE;
      bandVertexRange.push({ start: base, count: (segs + 1) * rows });
      bandWindows.push({ from: band.from, to: band.to });

      for (let c = 0; c <= segs; c += 1) {
        const u = bi === 0 ? stripColumns[c].u : band.u0 + (span * c) / segs;
        // The station either side, for the central-difference tangent. Fractional stations are
        // interpolated: a lane's columns do not land on the spine's own sampling.
        const f = u * stations;
        const i0 = Math.min(stations, Math.max(0, Math.floor(f)));
        const i1 = Math.min(stations, i0 + 1);
        const t = f - i0;
        const lerp = (o: number): number => p.spine[i0 * 6 + o] * (1 - t) + p.spine[i1 * 6 + o] * t;
        const a = Math.max(0, i0 - 1);
        const b = Math.min(stations, i0 + 2);
        let tx = p.spine[b * 6] - p.spine[a * 6];
        let ty = p.spine[b * 6 + 1] - p.spine[a * 6 + 1];
        let tz = p.spine[b * 6 + 2] - p.spine[a * 6 + 2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        // A lane never collapses: it is authored on the result, so it has no removed run to be in.
        const shift = bi === 0 ? stripColumns[c].shift : cutStateAt(u * p.lengthPx).shift;
        const bandDead = bi === 0 ? stripColumns[c].dead : 0;
        for (let r = 0; r < rows; r += 1) {
          verts.push(
            u, r / ACROSS - 0.5,
            lerp(0), lerp(1), lerp(2),
            lerp(3), lerp(4), lerp(5),
            tx, ty, tz,
            shift, bandDead, bi, bi === 0 ? 1 : 0,
          );
        }
      }
      for (let c = 0; c < segs; c += 1) {
        for (let r = 0; r < ACROSS; r += 1) {
          const v0 = base + c * rows + r;
          const v1 = v0 + rows;
          indices.push(v0, v1, v0 + 1, v0 + 1, v1, v1 + 1);
        }
      }
    });

    const buf = new Float32Array(verts);
    const idx = new Uint32Array(indices);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    const S = STRIDE * 4;
    const attrib = (name: string, size: number, offset: number): void => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, offset * 4);
    };
    attrib("aU", 1, 0);
    attrib("aV", 1, 1);
    attrib("aPos", 3, 2);
    attrib("aUp", 3, 5);
    attrib("aTan", 3, 8);
    attrib("aShift", 1, 11);
    attrib("aDead", 1, 12);
    attrib("aBand", 1, 13);
    attrib("aOpen", 1, 14);

    /* ── the fixture, as a 1D mask ────────────────────────────────────────────────────────────── */
    const mask = new Uint8Array(STRIP_TEXELS * 4);
    const EDGE_PX = 3;
    for (let i = 0; i < STRIP_TEXELS; i += 1) {
      const x = (i / (STRIP_TEXELS - 1)) * p.lengthPx;
      let r = 0;
      let alpha = 0;
      for (let q = 0; q < runCount; q += 1) {
        const s = runs[q * 3];
        const e = runs[q * 3 + 1];
        if (runs[q * 3 + 2] === 1 || x < s || x > e) continue;
        r = 255;
        if (e - x <= EDGE_PX) alpha = 255;
      }
      let g = 0;
      let b = 0;
      for (let q = 0; q < p.silences.length / 3; q += 1) {
        const s = p.silences[q * 3];
        const e = p.silences[q * 3 + 1];
        if (x < s || x > e) continue;
        if (p.silences[q * 3 + 2] === 1) g = 255;
        else b = 255;
      }
      mask[i * 4] = r;
      mask[i * 4 + 1] = g;
      mask[i * 4 + 2] = b;
      mask[i * 4 + 3] = alpha;
    }
    /* ── the clip name tags, rasterised once at the strip's own scale ─────────────────────────── */
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = p.lengthPx;
    labelCanvas.height = p.heightPx;
    const ctx = labelCanvas.getContext("2d");
    if (ctx) {
      // The strip is 2880 x 128 ribbon px and the texture is 1:1 with it, so a tag drawn at a clip's
      // own startPx lands on that clip with no mapping to get wrong. 15px here is roughly the label
      // rung once the settle scale is applied, which is what the DOM lane labels read at.
      ctx.font = "500 15px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(234, 242, 255, 0.62)";
      for (const clip of p.clipLabels) {
        const room = clip.endPx - clip.startPx - 16;
        if (room < 40) continue; // a tag wider than its clip is noise, not information
        ctx.save();
        ctx.beginPath();
        ctx.rect(clip.startPx + 8, 6, room, 20);
        ctx.clip();
        ctx.fillText(clip.label, clip.startPx + 8, 7);
        ctx.restore();
      }
    }
    const labelTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, labelTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, labelCanvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, STRIP_TEXELS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    // Mipmapped, because the tail minifies hard: 4096 texels of strip land on a few hundred pixels
    // there, and point-sampling that is how a cut edge starts flickering in and out as it recedes.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    /* ── palette: read from globals.css so the tokens stay the one owner ──────────────────────── */
    const style = getComputedStyle(document.documentElement);
    const inkRaw = style.getPropertyValue("--ink").trim().match(/[\d.]+/g);
    const ink: [number, number, number] = inkRaw && inkRaw.length >= 3
      ? [Number(inkRaw[0]) / 255, Number(inkRaw[1]) / 255, Number(inkRaw[2]) / 255]
      : [0.92, 0.95, 1];

    const U = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n);
    gl.uniform1i(U("uStrip"), 0);
    gl.uniform1i(U("uLabel"), 1);
    gl.uniform3fv(U("uWarm"), readColor(style, "--color-warm", [1, 0.7, 0.29]));
    gl.uniform3fv(U("uAccent"), readColor(style, "--color-accent", [0.37, 0.9, 1]));
    gl.uniform3fv(U("uBase"), readColor(style, "--color-bg-2", [0.055, 0.075, 0.125]));
    gl.uniform3fv(U("uInk"), ink);
    gl.uniform1f(U("uLen"), p.lengthPx);
    gl.uniform1f(U("uPersp"), p.perspectivePx);
    gl.uniform1f(U("uRecentre"), p.recentrePx);
    gl.uniform1f(U("uSeconds"), p.lengthPx / p.secondPx);

    /* Lane colour by kind. The look is a grade applied TO the footage, so it takes the footage warm;
       the transition and the effect are things the planner placed, so they take the machine's cyan
       at two weights. The palette is read from `globals.css`, never restated here. */
    const accentHi = readColor(style, "--color-accent-hi", [0.54, 0.94, 1]);
    const laneCols = new Float32Array(24);
    for (let l = 0; l < laneCount; l += 1) {
      const kind = p.lanes[l * 5 + 4];
      const col = kind === 0 ? readColor(style, "--color-warm", [1, 0.7, 0.29]) : kind === 1 ? accentHi : readColor(style, "--color-accent", [0.37, 0.9, 1]);
      laneCols[(l + 1) * 3] = col[0];
      laneCols[(l + 1) * 3 + 1] = col[1];
      laneCols[(l + 1) * 3 + 2] = col[2];
    }
    gl.uniform3fv(U("uLaneCol"), laneCols);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    /* ── the frame ─────────────────────────────────────────────────────────────────────────────── */
    let raf = 0;
    let running = false;
    let lastW = 0;
    let lastH = 0;
    const lastOpen = new Float32Array(bandWindows.length).fill(-1);

    /* The pose track, with the settle scale replaced by whatever the breakpoint ladder resolves to
       at this width — the same value the CSS media queries put in `--flat`. Only the last key is
       affected; every earlier one is authored at scale 1 by design, so the object rides at its
       authored size through the whole spectacle and only the settle fits itself to the page. */
    const keys = p.bodyKeys.slice();
    const bandSlots = new Float32Array(16);

    const applyFlatScale = (): void => {
      const w = window.innerWidth;
      let scale = p.flatSteps[1];
      for (let i = 0; i < p.flatSteps.length; i += 2) {
        const maxWidth = p.flatSteps[i];
        if (maxWidth >= 0 && w <= maxWidth) scale = p.flatSteps[i + 1];
      }
      keys[keys.length - 1] = scale;

      /* THE STACK, down the ribbon's own face — MEASURED from `.sp-lane`'s own rows, not derived.
         Deriving it was tried and was wrong by a full row: reproducing `--lane-h` plus a 2px margin
         in arithmetic here silently ignores whatever padding the readout above the rows contributes,
         and the result is a GPU bar sitting one row off the DOM label that names it — in a scene
         whose entire claim is that the numbers line up.

         `offsetTop`/`offsetHeight` are LAYOUT values and ignore transforms, which is what makes this
         readable at any scroll position. `getBoundingClientRect` would not be: `.sp-lane` animates
         `scaleY` from 0, so at rest every row measures zero-height and the whole stack would collapse
         onto the strip. The offsets are screen px and the pose multiplies ribbon-local px by the
         settle scale, so each one is divided by that scale on the way in. */
      const layoutTop = (el: HTMLElement): number => {
        let y = 0;
        let n: HTMLElement | null = el;
        while (n) {
          y += n.offsetTop;
          n = n.offsetParent as HTMLElement | null;
        }
        return y;
      };

      bandSlots[0] = 0;
      bandSlots[1] = p.heightPx * 0.5;
      const ribbonEl = document.getElementById("sp-ribbon");
      const laneEls = [...section.querySelectorAll<HTMLElement>(".sp-lane")];
      if (ribbonEl && laneEls.length >= laneCount) {
        const centre = layoutTop(ribbonEl) + ribbonEl.offsetHeight / 2;
        for (let l = 0; l < laneCount; l += 1) {
          const el = laneEls[l];
          bandSlots[(l + 1) * 2] = (layoutTop(el) + el.offsetHeight / 2 - centre) / scale;
          bandSlots[(l + 1) * 2 + 1] = el.offsetHeight / 2 / scale;
        }
      }
      gl.uniform2fv(U("uBand"), bandSlots);
    };

    const draw = (): void => {
      const rect = section.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const progress = clamp01(travel > 0 ? -rect.top / travel : 0);
      const at = progress * 100;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w !== lastW || h !== lastH) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        lastW = w;
        lastH = h;
        applyFlatScale();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniformMatrix4fv(U("uProj"), false, perspectiveMatrix(w, h, p.perspectivePx));
      }

      // Beat D unwinds on `--ease-flatten`; the curl itself carries `--ease-curl` through the pose.
      const flatRaw = clamp01((at - 42) / (54 - 42));
      const flat = ease(0.33, 0, 0.1, 1, flatRaw);
      const cut = ease(0.65, 0, 0.35, 1, clamp01((at - p.cutFrom) / (p.cutTo - p.cutFrom)));
      const pose = poseAt(keys, at);

      /* BEAT I — the lanes open, one after another, each across its own slot of the beat. `aOpen` is
         a vertex attribute rather than a uniform because it is PER BAND, and rewriting one float per
         vertex on the three lanes is a few hundred bytes against adding a second draw call per lane.
         Only the lane slices are touched; the strip's own vertices are never rewritten. */
      let openChanged = false;
      for (let bi = 1; bi < bandWindows.length; bi += 1) {
        const w = bandWindows[bi];
        const open = ease(0.33, 0, 0.1, 1, clamp01((at - w.from) / (w.to - w.from || 1)));
        if (Math.abs(open - lastOpen[bi]) < 0.001) continue;
        lastOpen[bi] = open;
        openChanged = true;
        const range = bandVertexRange[bi];
        for (let v = 0; v < range.count; v += 1) {
          buf[(range.start + v) * STRIDE + 14] = open;
        }
      }
      if (openChanged) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf);
      }

      gl.uniform1f(U("uFlat"), flat);
      gl.uniform1f(U("uCut"), cut);
      gl.uniform3f(U("uTranslate"), pose.t[0], pose.t[1], pose.t[2]);
      gl.uniform1f(U("uScale"), pose.scale);
      gl.uniform1f(U("uYaw"), (pose.yaw * Math.PI) / 180);
      gl.uniform1f(U("uPitch"), (pose.pitch * Math.PI) / 180);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);

      if (running) raf = requestAnimationFrame(draw);
    };

    // The scroll read is bounded to the section being on screen — the whole of §16's concession.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !running) {
            running = true;
            section.dataset.gl = "on";
            raf = requestAnimationFrame(draw);
          } else if (!entry.isIntersecting && running) {
            running = false;
            cancelAnimationFrame(raf);
          }
        }
      },
      { rootMargin: "25% 0px" },
    );
    observer.observe(section);

    // A lost context is a fallback, not an error: drop the flag and the DOM strip is there again.
    const onLost = (e: Event): void => {
      e.preventDefault();
      running = false;
      cancelAnimationFrame(raf);
      delete section.dataset.gl;
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      delete section.dataset.gl;
      gl.deleteTexture(tex);
      gl.deleteTexture(labelTex);
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ebo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    };
  }, [p]);

  return (
    <canvas
      ref={canvasRef}
      className="sp-gl"
      aria-hidden="true"
      // The DOM strip carries the accessible name and the real content; this is its picture.
      role="presentation"
    />
  );
}

export default HeroRibbonGL;
