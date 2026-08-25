/**
 * lib/edl/query.ts — read-only timeline queries over Edl.2 (derived positions).
 *
 * Position is not stored (§4.7): a clip's timeline start is the running sum of preceding item
 * durations on its track. This module is the ONE place the UI, the store, and the action helpers
 * read that derived geometry, so nothing recomputes it ad-hoc. (The reducer keeps its own internal
 * copies to stay a pure, dependency-free module.)
 */
import type { Edl, Clip, Gap, Track, CaptionSegment, AudioBed, OverlayInstance } from "./schema";

export const isClip = (i: Clip | Gap): i is Clip => i.schema === "Clip.1";

export function clipTimelineDur(c: Clip): number {
  return Math.max(1, Math.round((c.outTick - c.inTick) / (c.speed || 1)));
}
export function itemDur(i: Clip | Gap): number {
  return isClip(i) ? clipTimelineDur(i) : i.durationTicks;
}
export function trackDuration(t: Track): number {
  return t.items.reduce((s, i) => s + itemDur(i), 0);
}

export interface ClipPos {
  clip: Clip;
  track: Track;
  trackIndex: number;
  itemIndex: number;
  startTick: number;
  endTick: number;
}

/** Every clip with its derived absolute timeline span, in track then item order. */
export function allClipPositions(edl: Edl): ClipPos[] {
  const out: ClipPos[] = [];
  edl.tracks.forEach((track, trackIndex) => {
    let cursor = 0;
    track.items.forEach((it, itemIndex) => {
      const d = itemDur(it);
      if (isClip(it)) out.push({ clip: it, track, trackIndex, itemIndex, startTick: cursor, endTick: cursor + d });
      cursor += d;
    });
  });
  return out;
}

export function locateClip(edl: Edl, id: string): ClipPos | null {
  return allClipPositions(edl).find((p) => p.clip.id === id) ?? null;
}

/** First clip whose half-open span [startTick, endTick) contains `tick`. */
export function clipAtTick(edl: Edl, tick: number): ClipPos | null {
  return allClipPositions(edl).find((p) => tick >= p.startTick && tick < p.endTick) ?? null;
}

// ───────────────────────── lanes (the Timeline's view of the IR layer model) ─────────────────────────
//
// HiteRoot stacks ir.scene.layers = [video tracks…, overlay, caption, audio] as full-bleed siblings.
// The Timeline must MIRROR that layering so what you see equals what renders/exports: each video track
// is its own lane, and captions/audioBeds/overlays each get a lane when present. Flattening every track
// onto one row (the old behaviour) silently hid a 2nd video track, every audio bed, and every caption.

/** A window with a stable id + label, used for the non-clip lanes (overlay/caption/audio). */
export interface SpanItem {
  id: string;
  startTick: number;
  endTick: number;
  label: string;
}

/** A transition seam at the boundary between two adjacent clips on a video lane (rendered as a mark). */
export interface SeamItem {
  id: string;
  /** the shared cut edge in ticks (the first clip's endTick). */
  atTick: number;
  transitionKey: string;
}

export interface VideoLane {
  kind: "video";
  track: Track;
  trackIndex: number;
  /** main vs overlay/etc — drives the lane label ("V1", "V2 · overlay"). */
  role: Track["role"];
  clips: ClipPos[];
  /** transition treatments living on THIS track, placed at their cut edge. */
  seams: SeamItem[];
}
export interface SpanLane {
  kind: "overlay" | "caption" | "audio";
  items: SpanItem[];
}
export type Lane = VideoLane | SpanLane;

const captionLabel = (c: CaptionSegment): string => (c.text.length > 18 ? `${c.text.slice(0, 17)}…` : c.text) || "caption";

/**
 * The full lane model the Timeline renders, in the SAME top→bottom order HiteRoot stacks layers:
 * video tracks (in EDL order) first, then overlays, captions, audio beds. Only non-empty span lanes
 * are emitted. Every video track is always emitted (an empty track is still a real, selectable lane).
 */
export function lanes(edl: Edl): Lane[] {
  const byTrack = allClipPositions(edl); // already track-then-item ordered
  const posById = new Map(byTrack.map((p) => [p.clip.id, p]));
  const out: Lane[] = edl.tracks.map((track, trackIndex) => {
    const clips = byTrack.filter((p) => p.trackIndex === trackIndex);
    // A transition belongs to the lane that holds its clips. Anchor the seam at the first clip's
    // end edge (clips abut in v1). Mirrors compile.ts/HiteRoot which weave transitions per-track.
    const seams: SeamItem[] = edl.transitions
      .map((t) => {
        const a = posById.get(t.betweenClipIds[0]);
        return a && a.trackIndex === trackIndex
          ? { id: t.id, atTick: a.endTick, transitionKey: t.transitionKey }
          : null;
      })
      .filter((s): s is SeamItem => s !== null);
    return { kind: "video" as const, track, trackIndex, role: track.role, clips, seams };
  });

  if (edl.overlays.length) {
    out.push({
      kind: "overlay",
      items: edl.overlays.map((o: OverlayInstance) => ({ id: o.id, startTick: o.window.startTick, endTick: o.window.endTick, label: o.overlayKey })),
    });
  }
  if (edl.captions.length) {
    out.push({
      kind: "caption",
      items: edl.captions.map((c: CaptionSegment) => ({ id: c.id, startTick: c.window.startTick, endTick: c.window.endTick, label: captionLabel(c) })),
    });
  }
  if (edl.audioBeds.length) {
    out.push({
      kind: "audio",
      items: edl.audioBeds.map((a: AudioBed) => ({ id: a.id, startTick: a.window.startTick, endTick: a.window.endTick, label: "audio bed" })),
    });
  }
  return out;
}
