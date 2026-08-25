/**
 * lib/remotion/fx/transition.ts — pure, frame-exact transition timing + presentation math.
 *
 * v1 transition model (no @remotion/transitions dependency, no IR position changes):
 * clips are laid strictly END-TO-END in the IR (compile.ts buildVideoTrack — see the duration
 * invariant in compile.test.ts), so the two clips of a transition ABUT at a single boundary frame
 * and never overlap. We therefore cannot cross-dissolve their actual pixels in v1; instead we paint
 * a deterministic BOUNDARY TREATMENT on an overlay layer spanning [boundary − d/2, boundary + d/2]
 * that reads as the named transition at edit speed (a dip/flash/sweep/streak over the cut).
 *
 * This is honest: it is a transition *treatment*, identical in <Player> preview and renderMedia
 * export (pure CSS, no randomness — `lib/remotion/**` bans Math.random/Date.now), and a strict
 * upgrade over the previous behavior (transitions rendered as `null`). True pixel cross-dissolve is
 * the @remotion/transitions <TransitionSeries> follow-up tracked in HiteRoot's header.
 *
 * Everything here is a PURE function of (frame, window, key) → testable in the node env.
 */
import type React from "react";

export type TransitionFamily =
  | "dissolve" // fade / crossfade / dissolve → dip through a dark veil
  | "flash" // flash-cut / burn-to-white → bright spike
  | "burn-black" // burn-to-black → dark spike
  | "wipe" // hard directional sweep
  | "slide" // directional translate veil
  | "zoom" // scale veil
  | "whip" // directional motion-blur streak
  | "rgbsplit"; // cube-rotate / rgb-split / glitch → chromatic flash

export type Dir = "left" | "right" | "up" | "down";

/**
 * The transition stems whose v1 BOUNDARY TREATMENT is a faithful rendering of what the name promises.
 *
 * The other 28 registry transitions (crossfade, dissolve, wipe-*, slide-*, zoom-*, cube-rotate-*) all
 * name an operation that BLENDS OR MOVES THE TWO CLIPS' PIXELS. v1 cannot do that — the clips abut
 * and never overlap (see the module header) — so those keys lower to a veil that is not the named
 * effect: "crossfade" comes out as a dip to black, "cube-rotate" as a chromatic flash. Advertising
 * them is over-promising, so `isRenderableTransitionKey` filters them out of what the model and the
 * palette are offered. Real blended transitions (@remotion/transitions TransitionSeries consuming
 * TransitionNode.offsetFrame) are the follow-up that earns those keys back — until then this list is
 * the honest catalog, and the ONLY place it is defined.
 *
 * Stems are the registry key minus the `trans-` prefix and the `-fast` variant suffix, matched
 * EXACTLY (substring matching would let "crossfade" in through "fade").
 */
export const RENDERABLE_TRANSITION_STEMS: ReadonlySet<string> = new Set([
  "fade", // dip through black — what a fade IS
  "flash-cut",
  "burn-to-white",
  "burn-to-black",
  "glitch-cut",
  "rgb-split-cut",
  "whip-pan-l",
  "whip-pan-r",
]);

/** Registry key → its stem (`trans-wipe-left-fast` → `wipe-left`). Pure. */
export function transitionStem(key: string): string {
  return key.toLowerCase().replace(/^trans-/, "").replace(/-fast$/, "");
}

/** Does this transitionKey render as the thing it is named after? (See RENDERABLE_TRANSITION_STEMS.) */
export function isRenderableTransitionKey(key: string): boolean {
  return RENDERABLE_TRANSITION_STEMS.has(transitionStem(key));
}

export interface TransitionPresentation {
  family: TransitionFamily;
  dir: Dir;
}

/**
 * Classify a registry transitionKey (e.g. "trans-wipe-left-fast", "fade", "trans-crossfade") into a
 * presentation family + direction. Robust to the `trans-` prefix, the `-fast` suffix, and the bare
 * keys the reducer/tests use ("fade"). Unknown keys fall back to a dissolve — the safe universal.
 *
 * This maps EVERY key to something drawable so an already-authored EDL always renders; it is NOT a
 * claim that the result matches the name. `isRenderableTransitionKey` above is that claim, and it is
 * what the catalog/model-facing lists filter on.
 */
export function classifyTransition(key: string): TransitionPresentation {
  const k = key.toLowerCase();
  const dir: Dir = k.includes("left")
    ? "left"
    : k.includes("right")
      ? "right"
      : k.includes("up")
        ? "up"
        : k.includes("down")
          ? "down"
          : "left";
  const has = (...subs: string[]) => subs.some((s) => k.includes(s));

  let family: TransitionFamily = "dissolve";
  if (has("burn-to-black", "burn-black")) family = "burn-black";
  else if (has("burn-to-white", "burn", "flash")) family = "flash";
  else if (has("rgb-split", "rgbsplit", "cube", "glitch")) family = "rgbsplit";
  else if (has("whip")) family = "whip";
  else if (has("wipe")) family = "wipe";
  else if (has("slide")) family = "slide";
  else if (has("zoom")) family = "zoom";
  else if (has("fade", "crossfade", "dissolve")) family = "dissolve";

  return { family, dir };
}

/** 0→1→0 triangle peaking at the window midpoint (the cut boundary). Pure, clamped. */
export function pulse(frame: number, startFrame: number, endFrame: number): number {
  const span = Math.max(1, endFrame - startFrame);
  const t = (frame - startFrame) / span; // 0..1 across the window
  if (t <= 0 || t >= 1) return 0;
  return 1 - Math.abs(t * 2 - 1); // triangle, peak 1 at t=0.5
}

/** 0→1 ramp across the window (used by directional sweeps that travel once across the boundary). */
export function ramp(frame: number, startFrame: number, endFrame: number): number {
  const span = Math.max(1, endFrame - startFrame);
  return Math.max(0, Math.min(1, (frame - startFrame) / span));
}

const TEAL = "rgba(20,231,209,";
const EASE = (t: number) => t * t * (3 - 2 * t); // smoothstep for softer dips

/**
 * Compute the veil style for a transition family at an ABSOLUTE-timeline `frame`, given the overlay
 * window [startFrame, endFrame). Returns null outside the window or when the treatment is invisible,
 * so the caller can skip painting. Pure — no Remotion imports, fully unit-testable.
 */
export function transitionVeil(
  p: TransitionPresentation,
  frame: number,
  startFrame: number,
  endFrame: number,
): React.CSSProperties | null {
  if (frame < startFrame || frame >= endFrame) return null;
  const k = pulse(frame, startFrame, endFrame); // 0..1..0 dip strength
  const r = ramp(frame, startFrame, endFrame); // 0..1 travel
  if (k <= 0 && p.family !== "wipe" && p.family !== "slide") return null;

  const base: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

  switch (p.family) {
    case "dissolve": {
      // Dip through a soft dark veil — reads as a dissolve/crossfade between the abutting clips.
      return { ...base, background: `rgba(0,0,0,${(EASE(k) * 0.92).toFixed(4)})` };
    }
    case "burn-black": {
      return { ...base, background: `rgba(0,0,0,${EASE(k).toFixed(4)})` };
    }
    case "flash": {
      // Hot white spike (burn-to-white / flash-cut).
      return { ...base, background: `rgba(255,255,255,${EASE(k).toFixed(4)})` };
    }
    case "rgbsplit": {
      // Chromatic flash for cube/rgb-split/glitch transitions.
      const o = (EASE(k) * 0.85).toFixed(4);
      const shift = (k * 14).toFixed(2);
      return {
        ...base,
        background: `rgba(0,0,0,${(EASE(k) * 0.4).toFixed(4)})`,
        boxShadow: `inset ${shift}px 0 40px rgba(255,0,64,${o}), inset ${-shift}px 0 40px rgba(0,220,255,${o})`,
        mixBlendMode: "screen",
      };
    }
    case "zoom": {
      // Bright radial bloom that scales — reads as a zoom transition.
      const scale = 1 + k * 0.6;
      return {
        ...base,
        background: `radial-gradient(circle at center, rgba(255,255,255,${(EASE(k) * 0.7).toFixed(4)}) 0%, rgba(255,255,255,0) ${(60 / scale).toFixed(1)}%)`,
        transform: `scale(${scale.toFixed(3)})`,
      };
    }
    case "whip": {
      // Directional motion-blur streak that sweeps across the boundary.
      const angle = p.dir === "right" ? "90deg" : p.dir === "left" ? "270deg" : p.dir === "down" ? "180deg" : "0deg";
      const pos = (p.dir === "right" || p.dir === "down" ? r : 1 - r) * 100;
      const a = (EASE(k) * 0.8).toFixed(4);
      return {
        ...base,
        background: `linear-gradient(${angle}, rgba(0,0,0,0) ${(pos - 18).toFixed(1)}%, rgba(0,0,0,${a}) ${pos.toFixed(1)}%, rgba(0,0,0,0) ${(pos + 18).toFixed(1)}%)`,
        filter: `blur(${(k * 6).toFixed(2)}px)`,
      };
    }
    case "slide": {
      // Solid panel that slides across the cut in the named direction.
      const off = (p.dir === "right" || p.dir === "down" ? r - 1 : 1 - r) * 100;
      const axis = p.dir === "left" || p.dir === "right" ? "X" : "Y";
      return { ...base, background: "rgba(8,10,12,0.98)", transform: `translate${axis}(${off.toFixed(2)}%)` };
    }
    case "wipe": {
      // Hard-edged teal-rimmed wipe revealing across the boundary window.
      const pct = (p.dir === "right" || p.dir === "down" ? r : 1 - r) * 100;
      const angle = p.dir === "right" ? "90deg" : p.dir === "left" ? "270deg" : p.dir === "down" ? "180deg" : "0deg";
      return {
        ...base,
        background: `linear-gradient(${angle}, rgba(8,10,12,0.98) ${pct.toFixed(1)}%, ${TEAL}0.55) ${pct.toFixed(1)}%, ${TEAL}0) ${(pct + 2).toFixed(1)}%, rgba(0,0,0,0) ${(pct + 2).toFixed(1)}%)`,
      };
    }
    default:
      return { ...base, background: `rgba(0,0,0,${(EASE(k) * 0.9).toFixed(4)})` };
  }
}

/**
 * Boundary window for a transition between two abutting clips. `boundaryFrame` is the cut (the
 * previous clip's endFrame == next clip's startFrame). The treatment spans ±durationInFrames/2 and
 * is clamped to [0, compDuration], never zero/negative-length. Pure.
 *
 * Lives in THIS module (not the `Transition.tsx` component) on purpose: a sibling file differing
 * only by case is unresolvable on case-sensitive filesystems (Linux/Vercel) and was silently
 * mis-resolved by the vitest resolver to this `.ts` — yielding `undefined` for the import. Keeping
 * all pure transition math in one canonically-cased module removes that hazard.
 */
export function boundaryWindow(
  boundaryFrame: number,
  durationInFrames: number,
  compDurationInFrames: number,
): { startFrame: number; endFrame: number } {
  const half = Math.max(1, Math.round(durationInFrames / 2));
  const startFrame = Math.max(0, boundaryFrame - half);
  const endFrame = Math.min(compDurationInFrames, boundaryFrame + half);
  return { startFrame, endFrame: Math.max(startFrame + 1, endFrame) };
}
