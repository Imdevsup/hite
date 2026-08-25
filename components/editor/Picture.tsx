"use client";
import { Player, type PlayerRef } from "@remotion/player";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { usePlanner } from "@/components/editor/planner";
import { AFFORDANCE } from "@/components/editor/affordances";
import { HiteRoot } from "@/lib/remotion/HiteRoot";
import { edlToRenderIR } from "@/lib/render/compile";
import { makeMediaResolver } from "@/lib/render/resolver";
import { DEFAULT_RENDER_FPS, resolveRenderFps } from "@/lib/jobs/fps";
import { loadCatalog } from "@/lib/registry/catalog";
import type { RegistryEntry } from "@/lib/registry/types";
import type { RenderIR } from "@/lib/render/ir";
import type { Edl } from "@/lib/edl/schema";
import { useHydrated } from "@/lib/useHydrated";

/**
 * THE PICTURE — §13 item 4. "16:9, ~62 % of viewport height, `role="button"`, click toggles play.
 * IT IS THE TRANSPORT."
 *
 * There is no play button, no skip-to-start, no skip-to-end and no timecode. §13 removes each one by
 * name and gives the reason for the first: "the picture is the transport". The reason for the last is
 * the sharper one — "the brief fails the design if timecode appears before the user has done
 * anything" — so `00:00:00:00 / 00:00:48:00`, which used to sit above this frame at all times, is
 * gone. The scrubber's POSITION is the time.
 *
 * WHAT IS UNCHANGED FROM THE SURFACE THIS REPLACES, because it was right: the Edl.2 is compiled
 * client-side through `edlToRenderIR` and drawn by `HiteRoot` — the SAME compositor and the SAME
 * resolver the export worker runs, which is the whole reason preview and export agree. The fps comes
 * from `resolveRenderFps`, the one owner of that rule, because a different fps means a different
 * frame count for the same timeline.
 *
 * THE HARD CUT (§13's sanctioned exception 1). When an AI edit lands the compiled IR is swapped
 * under the player in a single frame, with no transition anywhere in the path — so the picture cuts
 * rather than dissolves, without a `steps(1,end)` on anything. The planner also lands the playhead on
 * the first clip the edit actually touched, so the cut is one the user can see.
 *
 * HOLD TO COMPARE (§13's sanctioned exception 2). Hold Alt (long-press on touch) and the picture
 * reverts to the timeline as it was before the last AI turn, for as long as you hold. §13: "It makes
 * the AI's work falsifiable in one gesture." Nothing is compared when there is nothing to compare —
 * before the first AI turn the gesture does nothing and says nothing.
 */

/** §13: the picture is "~62 % of viewport height". */
const PICTURE_VH = 62;

const ASPECT_RATIO: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };

/** The OUTPUT aspect this timeline renders at — the number the frame must be shaped by. */
export function pictureAspect(edl: Edl | null): string {
  return edl?.outputs[0]?.aspect ?? "16:9";
}

/**
 * The width of the picture COLUMN — the frame and everything that must line up with its edges.
 *
 * Height-bound rather than width-bound so the frame can never push the composer off the screen, and
 * shaped by the OUTPUT aspect rather than by the source asset: a 9:16 output letterboxed into a 16:9
 * box would be a preview that does not match the export.
 */
export function pictureColumnWidth(aspect: string): string {
  return `min(100%, calc(${PICTURE_VH}vh * ${ASPECT_RATIO[aspect] ?? 16 / 9}))`;
}

export function Picture() {
  const edl = useEditor((s) => s.edl);
  const assets = useEditor((s) => s.assets);
  const isPlaying = useEditor((s) => s.isPlaying);
  const currentMs = useEditor((s) => s.currentTimeMs);
  const turn = usePlanner((s) => s.turn);
  const hydrated = useHydrated();
  const [comparing, setComparing] = useState(false);

  const [catalog, setCatalog] = useState<RegistryEntry[]>([]);
  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  // The SAME resolver the export render uses.
  const resolver = useMemo(
    () => makeMediaResolver({ assetUrls: new Map(assets.map((a) => [a.id, a.blob_url])), catalog }),
    [assets, catalog],
  );
  const assetFps = useMemo(() => new Map(assets.map((a) => [a.id, a.fps])), [assets]);

  const before = turn?.before ?? null;
  const canCompare = before !== null && !turn?.undone;

  // ALT is a hold, not a toggle: keyup and blur both release it, and a window that loses focus while
  // the key is down must not leave the picture stuck on a timeline the user can no longer see is old.
  useEffect(() => {
    if (!canCompare) return;
    const down = (e: KeyboardEvent) => {
      if (e.altKey) setComparing(true);
    };
    const up = (e: KeyboardEvent) => {
      if (!e.altKey) setComparing(false);
    };
    const release = () => setComparing(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      setComparing(false);
    };
  }, [canCompare]);

  const shown: Edl | null = comparing && canCompare ? before : edl;
  const aspect = shown?.outputs[0]?.aspect ?? "16:9";
  const fps = useMemo(
    () => (shown ? resolveRenderFps(shown, assetFps) : DEFAULT_RENDER_FPS),
    [shown, assetFps],
  );
  const ir = useMemo<RenderIR | null>(() => {
    if (!shown) return null;
    return edlToRenderIR(
      shown,
      { aspect, quality: "full", tier: "free", fps, engineFingerprint: "remotion@4.0.450/preview" },
      resolver,
    );
  }, [shown, aspect, fps, resolver]);

  const ratio = ASPECT_RATIO[aspect] ?? 16 / 9;

  return (
    <div className="relative w-full">
      <div
        data-affordance={AFFORDANCE.picture}
        role="button"
        tabIndex={0}
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={() => useEditor.getState().togglePlay()}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          useEditor.getState().togglePlay();
        }}
        className="hite-picture relative w-full"
        style={{ aspectRatio: `${ratio}` }}
      >
        {/* The Player is client-only: it owns a real media element and a clock, and rendering it on
            the server would produce markup the first client paint has to throw away. The frame, its
            size and its focus ring are all painted before any of that arrives, so nothing about the
            layout waits on JavaScript. */}
        {hydrated && ir ? (
          <PlayerSurface ir={ir} currentMs={currentMs} isPlaying={isPlaying} />
        ) : null}

        {comparing && canCompare && (
          <span
            className="hite-compare-badge pointer-events-none absolute left-[var(--space-3)] top-[var(--space-3)]"
            data-arrive
          >
            Before this edit
          </span>
        )}
      </div>

      {/* Spoken, not printed. The picture's own state has to reach a screen reader, and §13 forbids
          putting it on screen as a readout. */}
      <p className="sr-only" role="status" aria-live="polite">
        {comparing && canCompare ? "Showing the timeline as it was before the last edit." : ""}
      </p>
    </div>
  );
}

/**
 * The two-way playhead sync between the store and Remotion's player.
 *
 * Ported unchanged from the surface this replaces, because the subtlety in it was hard-won: during
 * playback the PLAYER owns the clock (the store is fed by it), so only a large jump — a real scrub —
 * is pushed back down, and a 0-1 frame echo never is. Fighting that produced a playhead that
 * stuttered against itself.
 */
const PlayerSurface = memo(function PlayerSurface({
  ir,
  currentMs,
  isPlaying,
}: {
  readonly ir: RenderIR;
  readonly currentMs: number;
  readonly isPlaying: boolean;
}) {
  const playerRef = useRef<PlayerRef>(null);
  const fps = ir.fps;
  const inputProps = useMemo(() => ({ ir }), [ir]);
  const lastPushed = useRef({ frame: -1, playing: false });

  // Store → Player
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const frame = Math.round((currentMs / 1000) * fps);
    if (isPlaying) {
      if (Math.abs(frame - p.getCurrentFrame()) > 4) {
        p.seekTo(frame);
        lastPushed.current.frame = frame;
      }
      return;
    }
    if (Math.abs(frame - lastPushed.current.frame) > 1) {
      p.seekTo(frame);
      lastPushed.current.frame = frame;
    }
  }, [currentMs, fps, isPlaying]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (isPlaying && !lastPushed.current.playing) {
      p.play();
      lastPushed.current.playing = true;
    } else if (!isPlaying && lastPushed.current.playing) {
      p.pause();
      lastPushed.current.playing = false;
    }
  }, [isPlaying]);

  // Player → Store
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    let lastMs = -1;
    const onFrame = () => {
      const frame = p.getCurrentFrame();
      const ms = Math.round((frame / fps) * 1000);
      if (Math.abs(ms - lastMs) < 50) return;
      lastMs = ms;
      lastPushed.current.frame = frame;
      useEditor.setState({ currentTimeMs: ms });
    };
    const onPlay = () => {
      lastPushed.current.playing = true;
      useEditor.setState({ isPlaying: true });
    };
    const onPause = () => {
      lastPushed.current.playing = false;
      useEditor.setState({ isPlaying: false });
    };
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
  }, [fps]);

  return (
    <Player
      ref={playerRef}
      component={HiteRoot}
      compositionWidth={ir.resolution.width}
      compositionHeight={ir.resolution.height}
      fps={Math.round(fps)}
      durationInFrames={Math.max(1, ir.durationInFrames)}
      // No chrome of its own: the frame IS the play control and the scrubber below it is the only
      // transport. Remotion's own bar would put a second playhead and a second timecode on screen.
      controls={false}
      clickToPlay={false}
      loop
      inputProps={inputProps}
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
});
