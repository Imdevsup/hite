/**
 * objects/ribbon.frag.ts — paints a real NLE onto the deformed plane.
 *
 * Everything is derived per pixel from the state texture and the atlases: clip blocks with a 2px
 * gap and rounded corners (fwidth-antialiased), the filmstrip across the top 45%, the mirrored
 * waveform across the lower 35%, the name tag in the top-left corner (row chosen by on-screen
 * width, hidden under 48px), silence regions, the selection outline, transition bowties, keyframe
 * diamonds, caption ticks, the ruler with composed timecodes, the playhead's practical light, the
 * analysis scan sweep, the grade wash, the export fill, fresnel rim, fog and animated grain.
 *
 * `uLaneKind`: 0 V1 video · 1 V2 overlays · 2 A1 dialogue · 3 A2 music · 4 ruler · 5 effects
 * sub-lane · 6 caption lane.
 */
import { SLOTS } from "./TimelineState";
import { DIGIT_COUNT, LABEL_ATLAS_HEIGHT, LABEL_ATLAS_WIDTH, LABEL_INK_WIDTH, LABEL_ROW_HEIGHT, LABEL_SLOT_WIDTH } from "./ClipLabels";

export const RIBBON_FRAG = /* glsl */ `
precision highp float;
#define PI 3.141592653589793
const float SLOT_COUNT = ${SLOTS.toFixed(1)};
const float LABEL_SLOT_W = ${LABEL_SLOT_WIDTH.toFixed(1)};
const float LABEL_INK_W = ${LABEL_INK_WIDTH.toFixed(1)};
const float LABEL_ATLAS_W = ${LABEL_ATLAS_WIDTH.toFixed(1)};
const float LABEL_ATLAS_H = ${LABEL_ATLAS_HEIGHT.toFixed(1)};
const float LABEL_ROW_H = ${LABEL_ROW_HEIGHT.toFixed(1)};
const float DIGITS = ${DIGIT_COUNT.toFixed(1)};

uniform sampler2D uState;
uniform sampler2D uLabels;
uniform sampler2D uPosters;
uniform sampler2D uWave;
uniform sampler2D uDigits;
uniform float uClipCount;
uniform float uLaneKind;
uniform float uTotalSeconds;
uniform float uLiveLength;

uniform vec3 uColA, uColB;         // violet → cyan
uniform vec3 uColA2, uColB2;       // graded: indigo → teal
uniform float uGrade;              // 0 → 1, sweeps along tEff (uGradeT is the wash front)
uniform float uGradeT;
uniform vec3 uRim;
uniform vec3 uKeyDir;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uAmber, uRose, uMint, uSelect;

uniform float uFurniture;          // 0 in Act 1 → 1 once flat
uniform float uLabelOpacity;       // .15 in the curl → 1 flat
uniform float uAnalyzed;           // 0 before analyzeTranscript; scan front in tEff
uniform float uScanT;              // bright band position in tEff (-1 = off)
uniform float uPlayheadT;          // tEff of the playhead; practical light lives here
uniform float uPlayheadOn;
uniform float uBeat;               // 0..1 phase at 92bpm
uniform float uBeatPulse;          // 0 → 1 once the score is in
uniform float uBeatGrid;           // 0 → 1 grid visible
uniform float uBeatSnap;           // 0 → 1 cut lines jump to the grid
uniform float uBeatsPerSecond;
uniform float uExportFill;         // 0 → 1 progress across the compressed bar
uniform float uCompress;
uniform float uTime;
uniform float uOpacity;
uniform float uEmissive;
uniform float uSilencePulse;

varying float vT;
varying float vTEff;
varying float vV;
varying float vM;
varying float vCurl;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHead;
varying float vSlope;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 row(float r) { return texture2D(uState, vec2(vT, (r + 0.5) / 4.0)); }

// Rounded-rectangle signed distance in pixels. b = half extents, r = radius.
float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float aa(float d) { return 1.0 - smoothstep(-0.75, 0.75, d); }

// One digit cell of the strip, sampled at local uv (0..1 across the cell, 0..1 top→bottom).
float digit(float d, vec2 uvLocal) {
  if (uvLocal.x < 0.0 || uvLocal.x > 1.0 || uvLocal.y < 0.0 || uvLocal.y > 1.0) return 0.0;
  return texture2D(uDigits, vec2((d + uvLocal.x) / DIGITS, uvLocal.y)).a;
}

// hh:mm:ss:ff composed from 11 cells. \`xPx\` from the label's left, \`yPx\` from its top, cell 7×12px.
float timecode(float seconds, vec2 px, float cellW, float cellH) {
  float whole = floor(seconds);
  float h = floor(whole / 3600.0);
  float m = floor(mod(whole, 3600.0) / 60.0);
  float s = mod(whole, 60.0);
  float f = floor(fract(seconds) * 30.0);
  float cell = floor(px.x / cellW);
  if (cell < 0.0 || cell > 10.0) return 0.0;
  vec2 uvLocal = vec2(fract(px.x / cellW), px.y / cellH);
  float d = 10.0;
  if (cell == 0.0) d = floor(h / 10.0);
  else if (cell == 1.0) d = mod(h, 10.0);
  else if (cell == 3.0) d = floor(m / 10.0);
  else if (cell == 4.0) d = mod(m, 10.0);
  else if (cell == 6.0) d = floor(s / 10.0);
  else if (cell == 7.0) d = mod(s, 10.0);
  else if (cell == 9.0) d = floor(f / 10.0);
  else if (cell == 10.0) d = mod(f, 10.0);
  return digit(d, uvLocal);
}

// A dissolve glyph: two triangles meeting at the cut, soft-edged, brightest at the cut, with a
// hairline through it. \`bx\` / \`y\` are pixels from the cut and from the lane's centre line;
// \`draw\` grows it from nothing.
float bowtie(float bx, float y, float draw) {
  float halfW = 12.0 * clamp(draw, 0.0, 1.0);
  if (halfW < 0.5) return 0.0;
  float ax = abs(bx);
  float h = ax / halfW * 7.5;
  float inside = (1.0 - smoothstep(h - 0.9, h + 0.9, abs(y))) * (1.0 - smoothstep(halfW - 1.0, halfW + 0.5, ax));
  float grad = 1.0 - smoothstep(0.0, halfW, ax) * 0.55;
  float hairline = 1.0 - smoothstep(0.0, 1.1, ax);
  return clamp(inside * 0.62 * grad + hairline * 0.9, 0.0, 1.0);
}

void main() {
  if (vHead < 0.5) discard;

  vec4 s0 = row(0.0);
  vec4 s1 = row(1.0);
  vec4 s2 = row(2.0);
  vec4 s3 = row(3.0);
  float clipIdx = floor(s0.r * 64.0 + 0.5);
  float state = s0.g;
  float scale = s0.b;
  // Pixel-space geometry of this clip on screen. Clip bounds are 16-bit pairs in row 1 (8-bit texture).
  float slot = vT * SLOT_COUNT;
  float start = floor(s1.r * 255.0 + 0.5) * 256.0 + floor(s1.g * 255.0 + 0.5);
  float end = floor(s1.b * 255.0 + 0.5) * 256.0 + floor(s1.a * 255.0 + 0.5);
  // A state read that does not describe a clip (bounds missing or inverted) is treated as a plain
  // stretch of bar, never as a hole: the timeline always reaches the frame edge, whatever a driver
  // hands back for a texel.
  bool validClip = end > start && end <= SLOT_COUNT + 0.5 && clipIdx < uClipCount + 0.5;
  if (!validClip) {
    start = 0.0;
    end = SLOT_COUNT;
    state = 0.0;
    scale = 1.0;
    clipIdx = 0.0;
  }
  if (validClip && state > 0.7 && state < 0.8) discard;          // deleted
  // Crushed: judged by how far the GEOMETRY compressed here, so the paint and the compression agree
  // exactly and a collapsed silence never leaves a gap between the clips that closed over it.
  if (vSlope < 0.14 && uLaneKind < 3.5) discard;
  float slotsPerPx = max(fwidth(slot), 1e-4);
  float clipPx = (end - start) * scale / slotsPerPx;
  float xPx = (slot - start) * scale / slotsPerPx;   // from the clip's left edge
  float hPx = 1.0 / max(fwidth(vV), 1e-4);
  float yTopPx = (0.5 - vV) * hPx;                    // from the clip's top edge
  vec2 centred = vec2(xPx - clipPx * 0.5, (vV) * hPx);

  // Base gradient along the sequence, graded by the wash once apply_grade has passed this point.
  float along = clamp(vTEff / max(uLiveLength, 0.05), 0.0, 1.0);
  vec3 pre = mix(uColA, uColB, smoothstep(0.0, 1.0, along));
  vec3 post = mix(uColA2, uColB2, smoothstep(0.0, 1.0, along));
  float graded = uGrade * smoothstep(uGradeT + 0.04, uGradeT - 0.04, vTEff);
  vec3 base = mix(pre, post, graded);

  // Lighting: key, fresnel rim, view-dependent sheen.
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float ndl = max(dot(N, normalize(uKeyDir)), 0.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  vec3 H = normalize(normalize(uKeyDir) + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0);

  vec3 col = base * (0.18 + 0.85 * ndl) + base * uEmissive;
  col += uRim * fres * (0.9 + 0.8 * vCurl);
  col += vec3(1.0) * spec * 0.35;

  // The long edges carry a hot filament — it is what flashes when the ribbon rolls.
  float border = smoothstep(0.36, 0.5, abs(vV));
  col += mix(base, vec3(1.0), 0.3) * border * (0.6 + fres * 1.1) * (0.4 + 0.6 * vCurl);

  float alpha = 1.0;
  // Two gates. furniture (ruler, playhead, tags, handles, brackets) arrives when the timeline lays
  // flat; analyzed (clip blocks, filmstrip, waveform, silences) arrives in analyzeTranscript's wake.
  float analyzed = smoothstep(uAnalyzed + 0.015, uAnalyzed - 0.015, vTEff) * uFurniture;
  float furniture = uFurniture;

  // ── Video lanes: clip blocks ─────────────────────────────────────────────────────────────
  if (uLaneKind < 0.5 || uLaneKind > 0.5 && uLaneKind < 1.5) {
    float lane = uLaneKind;
    float occupancy = lane > 0.5 ? s2.a : 1.0;
    if (lane > 0.5 && occupancy < 0.02) discard;

    // THE BAR IS CONTINUOUS, and clips are separated by a crisp seam at each boundary.
    //
    // It used to inset a rounded rectangle per clip, sized from the per-slot scale. That cannot
    // survive the ripple: the geometry compresses a clip containing crushed silences non-uniformly,
    // so the computed rectangle and the drawn pixels disagree and the timeline breaks into islands
    // with gaps between them. A seam is measured at the boundary itself and is always exact.
    float trans = s2.r;
    float edgePx = (slot - start) / max(slotsPerPx, 1e-4);
    float seam = (1.0 - smoothstep(0.0, 1.7, edgePx)) * (1.0 - clamp(trans * 2.0, 0.0, 1.0));
    float box = roundedBox(centred, vec2(max(clipPx * 0.5 - 1.0, 1.0), hPx * 0.5 - 0.5), 3.0);
    float blockMix = analyzed;
    // Before analysis the bar is one unbroken object; the seams resolve in the scan's wake.
    col *= mix(1.0, 1.0 - 0.72 * seam, blockMix);
    alpha = 1.0;

    // Filmstrip across the top 45%: 16:9 tiles repeating along the clip.
    if (lane < 0.5 && vV > 0.05 && analyzed > 0.01) {
      float tileW = hPx * 0.45 * 16.0 / 9.0;
      float tileU = fract(xPx / max(tileW, 1.0));
      float tileV = (0.5 - vV) / 0.45;
      vec3 poster = texture2D(uPosters, vec2((clipIdx + tileU) / uClipCount, tileV)).rgb;
      poster = mix(poster, poster * vec3(0.8, 0.95, 1.1), graded);
      col = mix(col, poster * 1.15 + base * 0.08, analyzed * 0.85);
    }
    // Overlay beats on V2: a warm light-leak block.
    if (lane > 0.5) {
      vec3 leak = mix(vec3(0.95, 0.55, 0.25), vec3(0.9, 0.2, 0.45), fract(xPx / 120.0));
      col = mix(col, leak * (0.5 + 0.5 * occupancy), 0.7) * occupancy;
      alpha *= occupancy;
    }

    // Mirrored dialogue waveform across the lower 35%.
    if (lane < 0.5 && vV < -0.15) {
      float amp = texture2D(uWave, vec2(vT, 0.5)).r;
      float y = abs(((vV + 0.5) / 0.35) - 0.5) * 2.0;
      float wave = 1.0 - smoothstep(amp - 0.06, amp + 0.02, y);
      col = mix(col, vec3(0.55, 0.95, 1.0) * 0.9 + base * 0.2, wave * analyzed * 0.8);
    }

    // Silence: amber, slow scanning pulse.
    if (state > 0.2 && state < 0.3) {
      float pulse = 0.65 + 0.35 * sin(uTime * 2.2 - slot * 0.25);
      col = mix(col, uAmber * (0.9 + 0.5 * pulse), 0.78 * analyzed * uSilencePulse);
      // Small upward tick at the region's head.
      float tick = (1.0 - smoothstep(0.0, 1.5, abs(xPx - 1.0))) * step(0.3, vV);
      col += uAmber * tick * 1.2;
    }

    // Selection: bright 1px outline. Select, then act.
    if (state > 0.45 && state < 0.55) {
      float outline = aa(abs(box + 1.0) - 0.8);
      col = mix(col, uSelect, outline * 0.95);
      col += uSelect * 0.08;
    }

    // Name tag, top-left, 6px inset. Row 0 full, row 1 middle-ellipsis; hidden under 48px.
    if (lane < 0.5) {
      float tagPx = LABEL_INK_W * 0.5;
      float showFull = step(tagPx + 24.0, clipPx);
      float rowSel = 1.0 - showFull;
      float visible = smoothstep(48.0, 60.0, clipPx);
      float lx = xPx - 6.0;
      float ly = yTopPx - 6.0;
      float rowH = LABEL_ROW_H * 0.5;
      if (lx > 0.0 && lx < tagPx && ly > 0.0 && ly < rowH) {
        vec2 auv = vec2((clipIdx * LABEL_SLOT_W + lx * 2.0) / LABEL_ATLAS_W, (rowSel * LABEL_ROW_H + ly * 2.0) / LABEL_ATLAS_H);
        vec4 tag = texture2D(uLabels, auv);
        float tagA = tag.a * visible * uLabelOpacity * 0.95;
        col = mix(col, tag.rgb, tagA);
      }
    }

    // Transition bowtie at the head of the clip, and the same glyph on the tail of the previous one:
    // two soft triangles straddling the cut, antialiased, brighter toward the cut, drawing in.
    if (lane < 0.5 && trans > 0.001 && furniture > 0.01) {
      col = mix(col, vec3(0.92, 0.97, 1.0), bowtie(xPx, vV * hPx, trans * 2.0));
    }
    float tailTrans = texture2D(uState, vec2((end + 0.5) / SLOT_COUNT, 2.5 / 4.0)).r;
    if (lane < 0.5 && tailTrans > 0.001 && furniture > 0.01) {
      col = mix(col, vec3(0.92, 0.97, 1.0), bowtie(xPx - clipPx, vV * hPx, tailTrans * 2.0));
    }
    // Boundary selection before the transitions land.
    if (lane < 0.5 && s2.b > 0.5) {
      float line = 1.0 - smoothstep(0.0, 1.5, xPx);
      col = mix(col, uSelect, line * 0.9);
    }

    // Fade handles: triangular ramps at the head and tail of the sequence.
    if (lane < 0.5 && furniture > 0.01) {
      float seqPx = vTEff / max(fwidth(vTEff), 1e-5);
      float seqEndPx = (uLiveLength - vTEff) / max(fwidth(vTEff), 1e-5);
      float ramp = 18.0;
      float headRamp = step(seqPx, ramp) * step(vV * hPx, (seqPx / ramp - 0.5) * hPx);
      float tailRamp = step(seqEndPx, ramp) * step(vV * hPx, (seqEndPx / ramp - 0.5) * hPx);
      col = mix(col, vec3(1.0), (headRamp + tailRamp) * 0.35 * furniture);
      // In / out brackets.
      float bracket = (step(seqPx, 2.0) + step(seqEndPx, 2.0)) * step(0.2, abs(vV));
      col += vec3(1.0) * bracket * 0.9 * furniture;
    }

    // Beat grid and cuts snapping to it.
    if (lane < 0.5 && uBeatGrid > 0.001) {
      float beat = vTEff * uTotalSeconds * uBeatsPerSecond;
      float gridLine = 1.0 - smoothstep(0.0, 1.2, abs(fract(beat) - 0.5) / max(fwidth(beat), 1e-4) - 0.0);
      gridLine *= step(0.02, fract(beat)) * step(fract(beat), 0.98);
      float gl = (1.0 - smoothstep(0.0, 1.0, abs(fract(beat + 0.5) - 0.5) / max(fwidth(beat), 1e-4)));
      col += vec3(0.6, 0.9, 1.0) * gl * 0.35 * uBeatGrid * step(0.42, abs(vV));
      // The cut line at the head moves to the nearest beat with the snap.
      float startBeat = (start * scale / SLOT_COUNT) * uTotalSeconds * uBeatsPerSecond;
      float nearest = floor(startBeat + 0.5);
      float stagger = smoothstep(vTEff - 0.02, vTEff + 0.02, uBeatSnap * 1.04);
      float snappedBeat = mix(startBeat, nearest, stagger);
      float cutPx = (beat - snappedBeat) / max(fwidth(beat), 1e-4);
      float cutLine = 1.0 - smoothstep(0.0, 1.5, abs(cutPx));
      float flash = stagger * (1.0 - stagger) * 4.0;
      col += mix(uSelect, vec3(1.0), flash) * cutLine * (0.8 + flash * 2.0) * uBeatGrid;
    }

    // Export fill: a progress bar racing left to right across the compressed bar.
    if (lane < 0.5 && uExportFill > 0.001) {
      float fill = step(vTEff, uExportFill * uLiveLength);
      col = mix(col, uMint * 1.4, fill * 0.5);
      float front = 1.0 - smoothstep(0.0, 0.02, abs(vTEff - uExportFill * uLiveLength));
      col += uMint * front * 2.0;
    }
  }

  // ── Audio lanes ─────────────────────────────────────────────────────────────────────────
  if (uLaneKind > 1.5 && uLaneKind < 3.5) {
    float box = roundedBox(centred, vec2(clipPx * 0.5 - 1.0, hPx * 0.5 - 0.5), 2.0);
    float block = 1.0;
    float amp = texture2D(uWave, vec2(uLaneKind < 2.5 ? vT : vTEff / max(uLiveLength, 0.05), 0.5)).r;
    if (uLaneKind > 2.5) amp *= 0.75 + 0.35 * pow(1.0 - uBeat, 4.0) * uBeatPulse;
    float y = abs(vV) * 2.0;
    float wave = 1.0 - smoothstep(amp - 0.05, amp + 0.02, y);
    vec3 tint = uLaneKind < 2.5 ? vec3(0.45, 0.85, 1.0) : mix(vec3(0.7, 0.5, 1.0), vec3(0.5, 0.95, 0.8), uBeat * uBeatPulse);
    col = mix(base * 0.25, tint, wave) * block;
    col += tint * 0.05;
    alpha = max(block * 0.85, wave);
    if (uLaneKind < 2.5 && state > 0.2 && state < 0.3) col = mix(col, uAmber, 0.5 * uSilencePulse);
    if (uLaneKind < 2.5 && state > 0.45 && state < 0.55) col = mix(col, uSelect, aa(abs(box + 1.0) - 0.8));
  }

  // ── Ruler ───────────────────────────────────────────────────────────────────────────────
  if (uLaneKind > 3.5 && uLaneKind < 4.5) {
    float seconds = vTEff * uTotalSeconds;
    float secPx = 1.0 / max(fwidth(seconds), 1e-5);
    col = vec3(0.0);
    alpha = 0.0;
    // Baseline.
    float baseline = 1.0 - smoothstep(0.0, 1.0, abs((vV + 0.5) * hPx - 1.0));
    col += vec3(0.8, 0.85, 0.95) * baseline * 0.35;
    alpha = max(alpha, baseline * 0.35);
    // Ticks at the densest interval that still leaves 6px, with taller majors at 10×.
    float interval = 1.0;
    if (secPx * 1.0 < 6.0) interval = 10.0;
    if (secPx * 10.0 < 6.0) interval = 60.0;
    if (secPx * 60.0 < 6.0) interval = 600.0;
    float tk = seconds / interval;
    float tickPx = abs(fract(tk) - 0.5) / max(fwidth(tk), 1e-5);
    float minor = 1.0 - smoothstep(0.0, 1.0, tickPx - 0.0);
    minor = (1.0 - smoothstep(0.0, 1.0, abs(fract(tk + 0.5) - 0.5) / max(fwidth(tk), 1e-5)));
    float isMajor = step(fract((seconds + interval * 0.5) / (interval * 10.0)) * 10.0, 1.0);
    float tickH = mix(0.28, 0.55, isMajor);
    float tick = minor * step((vV + 0.5), tickH);
    col += vec3(0.85, 0.9, 1.0) * tick * 0.8;
    alpha = max(alpha, tick * 0.8);
    // Labels on the majors: hh:mm:ss:ff composed from the digit strip.
    float labelInterval = interval * 10.0;
    if (secPx * labelInterval < 140.0) labelInterval *= 3.0;
    if (secPx * labelInterval < 140.0) labelInterval *= 2.0;
    float labelSec = floor(seconds / labelInterval + 0.5) * labelInterval;
    float dxPx = (seconds - labelSec) * secPx;
    float tc = timecode(labelSec, vec2(dxPx + 3.0, (0.5 - vV) * hPx - 2.0), 6.5, 11.0);
    col += vec3(0.9, 0.93, 1.0) * tc;
    alpha = max(alpha, tc);
    // Markers: three coloured flags above the ruler at story beats, placed asymmetrically.
    float mk = 0.0;
    vec3 mkCol = vec3(0.0);
    float m1 = 0.17, m2 = 0.46, m3 = 0.81;
    float flagW = 5.0 / secPx * uTotalSeconds / max(uLiveLength, 0.05);
    float a1 = step(abs(along - m1), 0.004) * step(0.1, vV);
    float a2 = step(abs(along - m2), 0.004) * step(0.1, vV);
    float a3 = step(abs(along - m3), 0.004) * step(0.1, vV);
    col += uRose * a1 + uMint * a2 + uAmber * a3;
    alpha = max(alpha, max(a1, max(a2, a3)));
    // Beat grid ticks on the ruler too.
    if (uBeatGrid > 0.001) {
      float beat = seconds * uBeatsPerSecond;
      float gl = (1.0 - smoothstep(0.0, 1.0, abs(fract(beat + 0.5) - 0.5) / max(fwidth(beat), 1e-4)));
      col += vec3(0.6, 0.9, 1.0) * gl * 0.5 * uBeatGrid * step(vV, -0.1);
      alpha = max(alpha, gl * 0.5 * uBeatGrid);
    }
    alpha *= furniture;
  }

  // ── Effects sub-lane: keyframe diamonds connected by faint lines ───────────────────────
  if (uLaneKind > 4.5 && uLaneKind < 5.5) {
    float density = s2.g;
    col = vec3(0.0);
    alpha = 0.0;
    if (density > 0.001) {
      float kPx = xPx;
      float spacing = 26.0;
      float cell = fract(kPx / spacing) - 0.5;
      float dx = abs(cell) * spacing;
      float dy = abs(vV) * hPx;
      float diamond = 1.0 - smoothstep(3.5, 4.5, dx + dy);
      float line = 1.0 - smoothstep(0.0, 1.0, dy - 0.3);
      col = vec3(0.85, 0.9, 1.0) * (diamond + line * 0.25);
      alpha = (diamond + line * 0.25) * density * furniture;
    }
  }

  // ── Caption lane: dense ticks ───────────────────────────────────────────────────────────
  if (uLaneKind > 5.5) {
    float density = s3.a;
    col = vec3(0.0);
    alpha = 0.0;
    if (density > 0.001) {
      float period = 3.0;
      float cell = floor(slot / period);
      float h = 0.35 + 0.6 * hash12(vec2(cell, 7.0));
      float within = fract(slot / period);
      float tick = step(0.15, within) * step(within, 0.85) * step((vV + 0.5), h);
      float on = step(hash12(vec2(cell, 3.0)), 0.8);
      col = mix(vec3(0.7, 0.85, 1.0), uMint, 0.4) * tick * on;
      alpha = tick * on * density * furniture * 0.9;
    }
  }

  // ── Scan sweep: a bright gaussian band with a chromatic leading edge ───────────────────
  if (uScanT > -0.5) {
    float d = (vTEff - uScanT) / 0.035;
    float band = exp(-d * d);
    float ld = (vTEff - uScanT - 0.02) / 0.012;
    float lead = exp(-ld * ld);
    col += vec3(1.0) * band * 1.5 + vec3(0.7, 0.95, 1.0) * lead * 0.8;
  }
  // ── Grade wash front ───────────────────────────────────────────────────────────────────
  if (uGrade > 0.001) {
    float d = (vTEff - uGradeT) / 0.03;
    col += mix(uColA2, uColB2, 0.5) * exp(-d * d) * 1.4 * uGrade;
  }

  // ── The practical: a small light travelling with the playhead ─────────────────────────
  if (uPlayheadOn > 0.001) {
    float d = abs(vTEff - uPlayheadT) / 0.02;
    float glow = exp(-d * d);
    col += vec3(0.9, 0.97, 1.0) * glow * 0.9 * uPlayheadOn;
    float line = 1.0 - smoothstep(0.0, 1.2, abs(vTEff - uPlayheadT) / max(fwidth(vTEff), 1e-5));
    col += vec3(1.0) * line * 1.5 * uPlayheadOn;
    alpha = max(alpha, (glow * 0.5 + line) * uPlayheadOn);
  }

  // Beat pulse on everything once the score is in.
  col *= 1.0 + 0.06 * pow(1.0 - uBeat, 5.0) * uBeatPulse;

  // Fog.
  float dist = length(cameraPosition - vWorld);
  float fd = uFogDensity * dist;
  float f = clamp(1.0 - exp(-fd * fd), 0.0, 1.0);
  col = mix(col, uFogColor, f);
  // Both tails die in fog while curled: no end cap is ever in frame. Once flat the in/out brackets
  // ARE the ends, so the fade lifts with the morph.
  float tails = smoothstep(0.0, 0.14, vT) * (1.0 - smoothstep(0.95, 1.0, vT));
  alpha *= mix(tails, 1.0, vM);

  gl_FragColor = vec4(col, alpha * uOpacity);
}
`;
