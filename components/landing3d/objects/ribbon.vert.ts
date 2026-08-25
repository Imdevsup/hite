/**
 * objects/ribbon.vert.ts — one PlaneGeometry, deformed on the GPU every frame. Never rebuilt.
 *
 * uv.x is `t`, the slot coordinate along the timeline; uv.y - 0.5 is `v`, the cross-section.
 * The vertex (1) maps slot space to path space through the state texture's prefix sum, so crushed
 * regions physically slide everything downstream left; (2) evaluates P_curl and P_flat analytically
 * with their derivatives and blends them with a per-vertex morph delay, so the ribbon unfurls from
 * the far end like a whip settling; (3) builds the frame from the curl's plane normal, blended
 * toward camera-facing on the straight runs and pinned vertical once flat, then rolls it about the
 * tangent through the curl; (4) offsets by lane so V2 / A1 / A2 / ruler ride the same deformation.
 */
import { PATH_GLSL } from "./paths";
import { SLOTS } from "./TimelineState";

export const RIBBON_VERT = /* glsl */ `
precision highp float;
${PATH_GLSL}
const float SLOT_COUNT = ${SLOTS.toFixed(1)};

// THE RIPPLE, AS 129 UNIFORM FLOATS.
//
// This started as a texture read in the vertex shader, then as a per-vertex attribute rebaked each
// frame. Both were reported truncating the timeline on an Intel Iris Xe (the bar stopped dead at a
// clip boundary while the geometry provably spanned the frame), and neither could be reproduced on
// any renderer available here. A dynamically indexed uniform array in a VERTEX shader is the oldest
// and most broadly supported path in GL ES 1.0, it is 129 floats rather than 74KB re-uploaded every
// frame, and it has no per-vertex data to go stale.
//
// Each entry is the ripple position, normalised 0..1, at that fraction along the timeline.
#define PREFIX_STEPS 128
uniform float uPrefix[PREFIX_STEPS + 1];
uniform float uHeadTEff;     // tEff of the reveal head (Act 1)
uniform float uMorph;
uniform float uDelay;
uniform float uTwist;        // radians at the apex
uniform float uVelTwist;     // scroll-velocity twist, radians
uniform float uWidth;
uniform float uWidthFlat;    // multiplier once flat
uniform float uFaceCamera;
uniform float uLaneOffset;   // world units along the width axis
uniform float uLaneHeight;   // width multiplier for this lane
uniform float uLaneReveal;   // 0 → 1 extrude
uniform float uHead;         // reveal: vertices with t > uHead collapse onto the head
uniform float uCompress;     // export: 0 → 1 toward the live centre
uniform float uLiveLength;

varying float vT;
varying float vTEff;
varying float vV;
varying float vM;
varying float vCurl;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHead;
// How much this part of the timeline is compressed: 1 where a clip is at full width, 0 where a
// crushed silence has collapsed. The fragment discards on THIS rather than on the per-slot state,
// so what is painted and what the geometry compressed can never disagree and leave a gap.
varying float vSlope;

/** The ripple position at x (0..1 along the timeline), linearly interpolated. */
float prefixAt(float x) {
  float f = clamp(x, 0.0, 1.0) * float(PREFIX_STEPS);
  float lo = floor(min(f, float(PREFIX_STEPS) - 1.0));
  int i = int(lo);
  return mix(uPrefix[i], uPrefix[i + 1], f - lo);
}

vec3 rotateAround(vec3 p, vec3 axis, float a) {
  float c = cos(a);
  float s = sin(a);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

void main() {
  float t = uv.x;
  float v = uv.y - 0.5;

  // Slot space to path space. The ripple is normalised 0..1; tEff is it in path units.
  float ripple = clamp(prefixAt(t), 0.0, 1.0);
  float tEff = ripple * uLiveLength;

  // Reveal: the nose leads, the unrevealed remainder folds onto it and is discarded by the fragment.
  // The reveal is an Act 1 device ONLY: once the timeline is flat every slot is drawn regardless of
  // the head, so nothing upstream can ever truncate the flat timeline.
  float flatNow = step(0.999, uMorph);
  float head = max(uHead, flatNow);
  vHead = step(t, head + 0.002);
  tEff = mix(min(tEff, uHeadTEff), tEff, vHead);

  // ── WHERE THE FLAT TIMELINE STARTS AND ENDS IS LAYOUT, NOT DATA ────────────────────────────
  // The span is the plane's own uv coordinate, so the bar reaches both frame edges no matter what
  // the per-slot attribute contains. The ripple delete only SLIDES clips inside that span, and its
  // influence is faded out at both ends, where the sequence's own start and end are by definition.
  // (Healthy data already agrees there, so the fade is invisible; it is insurance, not a lie.)
  float eps = 1.0 / float(PREFIX_STEPS);
  vSlope = clamp((prefixAt(t + eps) - prefixAt(t - eps)) / (2.0 * eps) * uLiveLength, 0.0, 2.0);

  float tFlat = t;
  if (ripple == ripple) {
    // Symmetric windows: the same correction at both ends, so a trim can never look lopsided.
    float ends = smoothstep(0.86, 1.0, t) + (1.0 - smoothstep(0.0, 0.14, t));
    tFlat = mix(ripple, t, clamp(ends, 0.0, 1.0));
  }
  // CENTRED, WITH EQUAL MARGINS. The scale is constant, so a ripple delete visibly SHORTENS the
  // sequence instead of zooming back to fill; what is left stays centred on the frame with the same
  // gap on either side. At full length it still runs off both edges.
  tFlat = 0.5 + (tFlat - 0.5) * uLiveLength;

  float m = localMorph(t, uMorph, uDelay);
  vec3 pf, df;
  pFlat(tFlat, pf, df);
  vec3 P = pf;
  vec3 T = normalize(df);
  // The curl is evaluated ONLY while the ribbon is still curled. Once flat, the position must not
  // depend on it at all: mix(curl, flat, 1.0) still multiplies the curl term by zero, and a NaN
  // there (real GPUs return NaN from normalize/pow edge cases where software GL returns 0) would
  // delete every vertex past that point. That is exactly how the flat timeline was being cut.
  if (m < 0.999) {
    vec3 pc, dc;
    pCurl(tEff, pc, dc);
    float dl = length(dc);
    vec3 tc = dl > 1e-6 ? dc / dl : T;
    vec3 blended = mix(pc, pf, m);
    vec3 tangent = normalize(mix(tc, T, m));
    // Belt and braces: a non-finite curl sample falls back to the flat line for that vertex.
    if (blended.x == blended.x && tangent.x == tangent.x) {
      P = blended;
      T = tangent;
    }
  }

  // Width axis. In the curl: the curl plane's normal (the ribbon banks like a track). On the straight
  // runs: blended toward camera-facing so the timeline shows its face instead of a hairline.
  vec3 planeN = uCurlRot * vec3(0.0, 0.0, 1.0);
  vec3 Wc = planeN - T * dot(planeN, T);
  Wc = length(Wc) > 1e-4 ? normalize(Wc) : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - P);
  vec3 Wf = cross(toCam, T);
  float lf = length(Wf);
  Wf = lf > 1e-4 ? Wf / lf : Wc;
  if (dot(Wf, Wc) < 0.0) Wf = -Wf;
  float cw = curlWindow(t) * (1.0 - m);
  float faceW = clamp(uFaceCamera, 0.0, 1.0) * (1.0 - cw);
  vec3 W = normalize(mix(Wc, Wf, faceW));
  W = normalize(mix(W, vec3(0.0, 1.0, 0.0), m));

  // Roll through the curl, eased in and out, never linear.
  float u = clamp((t - SEG_A) / SEG_B, 0.0, 1.0);
  // max() BEFORE pow(): u clamps to exactly 1 for every t past the curl's last segment, and sin(PI)
  // lands on a tiny NEGATIVE epsilon on real hardware (it is +0 on software renderers, which is why
  // this hid for so long). pow(negative, 1.25) is NaN, NaN * 0 is still NaN, and the NaN propagated
  // into the vertex position, deleting the entire timeline past t = SEG_A + SEG_B.
  float roll = (uTwist * pow(max(sin(PI * u), 0.0), 1.25) + uVelTwist) * cw;
  W = rotateAround(W, T, roll);

  float width = uWidth * mix(1.0, uWidthFlat, m) * uLaneHeight * (1.0 + uCompress * 1.2);
  vec3 laneOff = W * uLaneOffset * uLaneReveal * m;
  vec3 pos = P + laneOff + W * (v * width * uLaneReveal);

  vT = t;
  vTEff = tEff;
  vV = v;
  vM = m;
  vCurl = cw;
  // Last line of defence: a NaN anywhere upstream would put this vertex nowhere and take its two
  // triangles with it. Fall back to the spine.
  if (!(pos.x == pos.x) || !(pos.y == pos.y) || !(pos.z == pos.z)) pos = P;
  vWorld = pos;
  vNormal = normalize(cross(T, W));
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;
