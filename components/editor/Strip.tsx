"use client";
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "@/lib/editor/store";
import { usePlanner } from "@/components/editor/planner";
import { AFFORDANCE } from "@/components/editor/affordances";
import { useFilmstrip, frameAt } from "@/components/editor/filmstrip";
import { allClipPositions, lanes, type ClipPos, type Lane, type SpanLane } from "@/lib/edl/query";
import { tickToMs } from "@/lib/edl/time";
import type { Edl } from "@/lib/edl/schema";

/**
 * THE CLIPS — §13 item 7. "One row of clip blocks with thumbnails, 56px. A single composite widget
 * (`role="listbox"`): one tab stop, arrows move within it. That is the standard pattern and it is why
 * the count is honest rather than gamed."
 *
 * WHAT THIS IS NOT. It is not the 865-line timeline it replaces. There is no ruler, no SMPTE, no zoom
 * stepper, no lane labels, no `V1`/`A1`, no snap guides, no marker flags and no header reading
 * `S SPLIT · BACKSPACE DELETE · I/O TRIM`. §13 kills every one of them by name. A person who has
 * never opened a video editor does not know what a lane or an in-point is, and a row of blocks whose
 * widths are their lengths is a timeline they can read without being taught one.
 *
 * SCALE-TO-FIT, NOT PIXELS-PER-SECOND. The row is always the whole timeline, so there is nothing to
 * scroll to and no zoom to be lost in. A block's width is its share of the duration — which is why
 * removing a pause makes the blocks visibly grow into the space, and why "the AI cut nine seconds" is
 * something you SEE rather than something you are told.
 *
 * SELECTION IS THE ONLY MODE. Arrow to a clip (or click it) and it is selected: the playhead lands on
 * its first frame so the picture shows it, and three handles appear ON it — trim its start, trim its
 * end, delete it. §13: "No panel, no modal, no numeric field." Those handles are focusable only after
 * a selection, which is why they are not on the first screen and not in its count.
 *
 * EVERY MUTATION GOES THROUGH THE STORE'S COMMAND HELPERS, so a trim by hand and a trim by the
 * planner are the same `EditCommand`, reduced by the same reducer, on the same undo stack.
 */

/** §13: "one row of clip blocks with thumbnails, 56px". */
const STRIP_H = 56;
/** One frame at 30fps, and one second with Shift — the two steps a hand reaches for. */
const FRAME_MS = Math.round(1000 / 30);
const SECOND_MS = 1000;

export function Strip() {
  const edl = useEditor((s) => s.edl);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const touched = usePlanner((s) => s.turn?.touched ?? EMPTY_TOUCHED);

  if (!edl) return null;
  const positions = allClipPositions(edl);
  const total = Math.max(1, edl.durationTicks);
  const extraLanes = lanes(edl).filter(isSpanLane);
  const selectedIndex = positions.findIndex((p) => p.clip.id === selectedClipId);

  /** Selection follows focus, which is the single-select listbox pattern and one fewer thing to press. */
  function select(pos: ClipPos | undefined) {
    if (!pos) return;
    useEditor.getState().selectClip(pos.clip.id);
    useEditor.getState().seekTo(tickToMs(pos.startTick));
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
      <div
        data-affordance={AFFORDANCE.strip}
        role="listbox"
        tabIndex={0}
        aria-label="Clips"
        aria-activedescendant={selectedClipId ? `hite-clip-${selectedClipId}` : undefined}
        className="focus-inset relative flex w-full min-w-0 gap-[2px] overflow-x-auto rounded-[var(--r-sm)]"
        style={{ height: `${STRIP_H}px` }}
        onKeyDown={(e) => {
          if (positions.length === 0) return;
          const at = selectedIndex === -1 ? 0 : selectedIndex;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            select(positions[Math.min(positions.length - 1, at + 1)]);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            select(positions[Math.max(0, at - 1)]);
          } else if (e.key === "Home") {
            e.preventDefault();
            select(positions[0]);
          } else if (e.key === "End") {
            e.preventDefault();
            select(positions[positions.length - 1]);
          } else if (e.key === "Escape" && selectedClipId) {
            e.preventDefault();
            useEditor.getState().selectClip(null);
          }
        }}
      >
        {positions.map((pos) => (
          <ClipBlock
            key={pos.clip.id}
            pos={pos}
            total={total}
            selected={pos.clip.id === selectedClipId}
            touched={touched.includes(pos.clip.id)}
            onSelect={() => select(pos)}
          />
        ))}
      </div>

      {/* §13 on lanes: "there is ONE lane, and a second appears only when a second element exists."
          Captions, overlays and audio beds are real EDL entries that the renderer paints, so hiding
          them would make the strip disagree with the picture. A readout, never a control. */}
      {extraLanes.map((lane) => (
        <div
          key={lane.kind}
          aria-label={`${lane.kind} — ${lane.items.length}`}
          className="relative h-[6px] w-full overflow-hidden rounded-[var(--r-pill)]"
          style={{ background: "var(--s-1)" }}
        >
          {lane.items.map((item) => (
            <span
              key={item.id}
              className="absolute top-0 block h-full rounded-[var(--r-pill)]"
              style={{
                left: `${(item.startTick / total) * 100}%`,
                width: `${Math.max(0.5, ((item.endTick - item.startTick) / total) * 100)}%`,
                background: "var(--color-accent-dim)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const EMPTY_TOUCHED: readonly string[] = [];

/** Everything that is not a video track: overlays, captions, audio beds. */
const isSpanLane = (lane: Lane): lane is SpanLane => lane.kind !== "video";

function ClipBlock({
  pos,
  total,
  selected,
  touched,
  onSelect,
}: {
  readonly pos: ClipPos;
  readonly total: number;
  readonly selected: boolean;
  readonly touched: boolean;
  readonly onSelect: () => void;
}) {
  const url = pos.clip.mediaRefs[pos.clip.activeRefKey]?.url ?? pos.clip.mediaRefs.full.url;
  const strip = useFilmstrip(url || null);
  // The clip's own SOURCE midpoint, not its timeline position — a moved clip keeps showing its own
  // footage rather than whatever now sits where it landed.
  const frame = frameAt(strip, tickToMs((pos.clip.inTick + pos.clip.outTick) / 2));
  const share = Math.max(0.6, ((pos.endTick - pos.startTick) / total) * 100);

  return (
    <div
      id={`hite-clip-${pos.clip.id}`}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-label={`Clip ${pos.itemIndex + 1}`}
      data-touched={touched ? "true" : undefined}
      onClick={onSelect}
      className="hite-clip relative h-full shrink-0"
      style={{
        width: `${share}%`,
        minWidth: "18px",
        backgroundImage: frame ? `url(${frame})` : undefined,
      }}
    >
      {selected && <ClipHandles clipId={pos.clip.id} />}
    </div>
  );
}

/**
 * THE THREE HANDLES — §13: "click a clip → three handles appear on the clip itself — trim-in,
 * trim-out, delete. No panel, no modal, no numeric field."
 *
 * The trims are a drag AND a keyboard step, because a 1-frame trim by pointer on a block 40px wide is
 * not a gesture anybody can land. Both go through `nudgeTrim`, which builds a `TRIM_CLIP` command and
 * pushes it through the same reducer the planner's batch goes through — a drag coalesces into ONE
 * undo step via `coalesceKey`, and `endGesture` closes it so the next drag is a fresh one.
 *
 * A refused trim is not silent. The reducer fails loud (`trim_collapses_clip`, `degenerate_clip`) and
 * the store writes that sentence into `commandError`, which `EditorAlerts` renders in plain English.
 */
function ClipHandles({ clipId }: { readonly clipId: string }) {
  return (
    <>
      <TrimHandle clipId={clipId} side="in" />
      <TrimHandle clipId={clipId} side="out" />

      <button
        type="button"
        aria-label="Delete this clip and close the gap"
        onClick={(e) => {
          e.stopPropagation();
          useEditor.getState().rippleDelete();
        }}
        className="absolute left-1/2 top-1/2 flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[var(--r-pill)]"
        style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
      >
        {/* §10's drawing rule: straight strokes, square caps, mitered joins, 1.6px, 24-unit grid.
            No icon library, no rounded caps, no filled glyphs. */}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
          <path d="M5 5 L19 19" />
          <path d="M19 5 L5 19" />
        </svg>
      </button>
    </>
  );
}

/**
 * One edge of one clip, as a drag AND as a keyboard step.
 *
 * A component per edge rather than a shared handler factory, because each edge owns its own drag and
 * the two must not be able to see each other's: the previous shape kept one ref for both and had to
 * check which side a move belonged to on every event, which is a bug waiting for the day two pointers
 * are down at once.
 *
 * THE POINTER PATH IS INCREMENTAL. `nudgeTrim` takes a DELTA from the edge's CURRENT position, so a
 * drag sends the travel since the last move and re-bases as it goes. Sending the total travel each
 * time would compound it into a runaway trim. Every one of those deltas shares a `coalesceKey`, so the
 * whole gesture is ONE undo step, and `endGesture` closes the run on release.
 */
function TrimHandle({ clipId, side }: { readonly clipId: string; readonly side: "in" | "out" }) {
  const dragFrom = useRef<number | null>(null);

  const trim = (deltaMs: number) => {
    useEditor.getState().nudgeTrim(side, deltaMs, { coalesceKey: `trim-${clipId}-${side}` });
  };

  /** Horizontal travel → ms, using the strip's own scale: the whole timeline over its rendered width. */
  const msPerPixel = (el: HTMLElement): number => {
    const strip = el.closest('[role="listbox"]') as HTMLElement | null;
    const edl: Edl | null = useEditor.getState().edl;
    if (!strip || !edl || strip.clientWidth === 0) return 0;
    return tickToMs(edl.durationTicks) / strip.clientWidth;
  };

  return (
    <button
      type="button"
      aria-label={
        side === "in"
          ? "Trim the start of this clip. Arrow keys move it a frame at a time."
          : "Trim the end of this clip. Arrow keys move it a frame at a time."
      }
      className={`absolute top-0 flex h-full w-[var(--space-3)] items-center justify-center rounded-[var(--r-xs)] cursor-col-resize ${side === "in" ? "left-0" : "right-0"}`}
      style={{ background: "var(--color-accent)", color: "var(--color-on-accent)" }}
      onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragFrom.current = e.clientX;
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLButtonElement>) => {
        const from = dragFrom.current;
        if (from === null) return;
        const deltaMs = Math.round((e.clientX - from) * msPerPixel(e.currentTarget));
        if (deltaMs === 0) return;
        dragFrom.current = e.clientX;
        trim(deltaMs);
      }}
      onPointerUp={(e: ReactPointerEvent<HTMLButtonElement>) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragFrom.current = null;
        useEditor.getState().endGesture();
      }}
      onPointerCancel={() => {
        dragFrom.current = null;
        useEditor.getState().endGesture();
      }}
      onKeyDown={(e: ReactKeyboardEvent<HTMLButtonElement>) => {
        const step = e.shiftKey ? SECOND_MS : FRAME_MS;
        if (e.key === "ArrowRight") trim(step);
        else if (e.key === "ArrowLeft") trim(-step);
        else return;
        e.preventDefault();
        // Each keypress is its own undo step: a person pressing an arrow twice means two decisions,
        // where a person dragging means one.
        useEditor.getState().endGesture();
      }}
    >
      <span aria-hidden className="block h-3 w-[2px] rounded-[var(--r-pill)] bg-current opacity-70" />
    </button>
  );
}
