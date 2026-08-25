"use client";
import { useEditor } from "./store";
import { msToTicks } from "@/lib/edl/time";
import { allClipPositions } from "@/lib/edl/query";
import type { Placement } from "@/lib/edl/schema";

/**
 * Editor action helpers — the bridge from tool-window clicks to the command layer.
 *
 * Every helper now emits a typed EditCommand through the SAME reducer the AI uses
 * (store.dispatch), so manual edits get undo/redo + audit for free and there is exactly one
 * mutation path. Selection rules: a selected clip targets it; otherwise effects apply to all,
 * overlays anchor at the playhead, transitions go between the selected clip and the next.
 */

export function applyEffectFromWindow(effectKey: string, params: Record<string, unknown> = {}): boolean {
  const s = useEditor.getState();
  if (!s.edl) return false;
  return s.dispatch(
    [{ type: "ADD_EFFECT", target: s.selectedClipId ? { clipId: s.selectedClipId } : "all", effectKey, params }],
    { rationale: `effect ${effectKey}` },
  );
}

export function applyOverlayFromWindow(
  overlayKey: string,
  opts: { startMs?: number; endMs?: number; placement?: Placement; params?: Record<string, unknown> } = {},
): boolean {
  const s = useEditor.getState();
  if (!s.edl) return false;
  const startMs = opts.startMs ?? s.currentTimeMs;
  const endMs = opts.endMs ?? startMs + 2000;
  return s.dispatch(
    [{ type: "ADD_OVERLAY", overlayKey, window: { startTick: msToTicks(startMs), endTick: msToTicks(endMs) }, placement: opts.placement ?? { mode: "center" }, params: opts.params ?? {} }],
    { rationale: `overlay ${overlayKey}` },
  );
}

export function applyLookFromWindow(lookKey: string): boolean {
  const s = useEditor.getState();
  if (!s.edl) return false;
  return s.dispatch([{ type: "COMPOSE_LOOK", lookKey }], { rationale: `look ${lookKey}` });
}

export function applyTransitionFromWindow(transitionKey: string, durationMs = 400): boolean {
  const s = useEditor.getState();
  if (!s.edl) return false;
  const positions = allClipPositions(s.edl);
  if (positions.length < 2) return false;

  let i: number;
  if (s.selectedClipId) {
    i = positions.findIndex((p) => p.clip.id === s.selectedClipId);
    if (i < 0 || i === positions.length - 1) return false;
  } else {
    i = 0;
  }
  const a = positions[i];
  const b = positions[i + 1];
  // The reducer rejects durationTicks > min(clipA, clipB) span. Clamp here so a short clip yields a
  // shorter transition instead of a silent no-op (which surfaced as a misleading "<2 clips" toast).
  const maxDur = Math.min(a.endTick - a.startTick, b.endTick - b.startTick);
  const durationTicks = Math.max(1, Math.min(msToTicks(durationMs), maxDur));
  return s.dispatch(
    [{ type: "ADD_TRANSITION", betweenClipIds: [a.clip.id, b.clip.id], transitionKey, durationTicks, params: {} }],
    { rationale: `transition ${transitionKey}` },
  );
}

export function addCaptionAtPlayhead(text: string, style = "default"): boolean {
  const s = useEditor.getState();
  if (!s.edl || !text.trim()) return false;
  const startMs = s.currentTimeMs;
  return s.dispatch(
    [{ type: "ADD_CAPTION", window: { startTick: msToTicks(startMs), endTick: msToTicks(startMs + 2000) }, text: text.trim(), style }],
    { rationale: "caption" },
  );
}

/**
 * Append an uploaded video/image asset to the END of the main video track (ADD_CLIP). This is the
 * MANUAL multi-clip path: the EDL is seeded from the first video, but every clip after that had no UI
 * surface — only the AI could place them — so a user couldn't build a sequence by hand. We append on
 * the SAME track as the existing clips (v1 single-video-track invariant; a 2nd video track would just
 * occlude — see moveClip), at the current timeline tail, using the asset's full source range.
 *
 * Returns false (so the caller can toast) when there's no EDL, the asset is unknown, or its duration
 * isn't probed yet (outTick would be degenerate — the bin shows "—" until the probe lands).
 */
export function appendAssetToTimeline(assetId: string): boolean {
  const s = useEditor.getState();
  if (!s.edl) return false;
  const asset = s.assets.find((a) => a.id === assetId);
  if (!asset || (asset.kind !== "video" && asset.kind !== "image")) return false;
  const durMs = asset.duration_ms ?? (asset.kind === "image" ? 4000 : 0); // images have no duration → default 4s
  if (durMs <= 0) return false;

  // Append after the last clip on the main track. allClipPositions walks tracks in order, so the
  // first position's track is the main video track; its tail is the max endTick across that track.
  const positions = allClipPositions(s.edl);
  const mainTrackId = positions[0]?.track.id ?? s.edl.tracks[0]?.id;
  if (!mainTrackId) return false;
  const tail = positions.filter((p) => p.track.id === mainTrackId).reduce((mx, p) => Math.max(mx, p.endTick), 0);

  return s.dispatch(
    [{ type: "ADD_CLIP", assetId, trackId: mainTrackId, atTick: tail, inTick: 0, outTick: msToTicks(durMs) }],
    { rationale: "append clip" },
  );
}

export function setCaptionStyle(captionId: string, style: string): boolean {
  if (!style) return false;
  return useEditor.getState().dispatch([{ type: "SET_CAPTION_STYLE", captionId, style }], { rationale: "set caption style" });
}

/**
 * Drop a marker at the playhead (ADD_MARKER). Markers were AI-only and invisible; with the Timeline
 * now flagging them, this gives the user a manual create path too. Auto-titled by its timecode so it's
 * never blank; kind "comment" (a user pin, distinct from AI/chapter markers).
 */
export function addMarkerAtPlayhead(title?: string): boolean {
  const s = useEditor.getState();
  if (!s.edl) return false;
  const ms = Math.max(0, s.currentTimeMs);
  const sec = Math.floor(ms / 1000);
  const auto = `Marker ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return s.dispatch(
    [{ type: "ADD_MARKER", atTick: msToTicks(ms), title: title?.trim() || auto, color: "CYAN", kind: "comment" }],
    { rationale: "add marker" },
  );
}

export function setClipSpeed(clipId: string, speed: number): boolean {
  if (!(speed > 0)) return false;
  return useEditor.getState().dispatch([{ type: "SET_CLIP_SPEED", clipId, speed }], { rationale: "set speed" });
}

export function setClipVolume(clipId: string, volume: number): boolean {
  const v = Math.max(0, Math.min(2, volume));
  return useEditor.getState().dispatch([{ type: "SET_CLIP_VOLUME", clipId, volume: v }], { rationale: "set volume" });
}

export function removeEffect(clipId: string, effectId: string): boolean {
  return useEditor.getState().dispatch([{ type: "REMOVE_EFFECT", clipId, effectId }], { rationale: "remove effect" });
}

export function removeOverlay(overlayId: string): boolean {
  return useEditor.getState().dispatch([{ type: "REMOVE_OVERLAY", overlayId }], { rationale: "remove overlay" });
}

export function removeTransition(transitionId: string): boolean {
  return useEditor.getState().dispatch([{ type: "REMOVE_TRANSITION", transitionId }], { rationale: "remove transition" });
}

export function clearLooks(): boolean {
  return useEditor.getState().dispatch([{ type: "CLEAR_LOOKS" }], { rationale: "clear looks" });
}

/**
 * Add an uploaded asset as a music/SFX bed. This is the REAL, rendered audio path: the reducer mints
 * an AudioBed, the compiler lowers it to an AudioNode, and HiteRoot plays it via <Audio> in BOTH the
 * preview and the export (WYSIWYG). The bed underlays from the playhead to the end of the timeline
 * (clamped to at least 1s) so a track dropped at 0 scores the whole edit; trim later on the timeline.
 */
export function addAudioBed(assetId: string, opts: { startMs?: number; volume?: number; loop?: boolean } = {}): boolean {
  const s = useEditor.getState();
  if (!s.edl) return false;
  const startMs = Math.max(0, opts.startMs ?? s.currentTimeMs);
  const startTick = msToTicks(startMs);
  // End at the timeline tail; guarantee a non-degenerate window even when the playhead sits at the end.
  const endTick = Math.max(startTick + msToTicks(1000), s.edl.durationTicks);
  return s.dispatch(
    [{ type: "ADD_AUDIO_BED", assetId, window: { startTick, endTick }, volume: opts.volume ?? 0.4, loop: opts.loop ?? false }],
    { rationale: "audio bed" },
  );
}

export function removeAudioBed(audioBedId: string): boolean {
  return useEditor.getState().dispatch([{ type: "REMOVE_AUDIO_BED", audioBedId }], { rationale: "remove audio bed" });
}

/**
 * Set the output aspect (reframe) — the SINGLE source of truth for aspect. The reducer writes
 * `outputs[0].aspect`, which the Preview canvas compiles with AND the Export deck renders with, so
 * picking an aspect keeps preview and export pixel-aligned (no silent WYSIWYG divergence).
 */
export function setOutputVariant(aspect: "16:9" | "9:16" | "1:1", maxTicks?: number): boolean {
  return useEditor.getState().dispatch([{ type: "SET_OUTPUT_VARIANT", aspect, maxTicks }], { rationale: "set output variant" });
}
