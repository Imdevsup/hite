"use client";
import { useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { AFFORDANCE } from "@/components/editor/affordances";
import { formatElapsed } from "@/components/editor/ActivityTrace";
import { tickToMs } from "@/lib/edl/time";

/**
 * THE SCRUBBER — §13 item 5. "Full picture width, 4px, `--color-accent` playhead. NO NUMERALS."
 *
 * WHAT IS NOT HERE, AND WHY. The strip this replaces carried an SMPTE ruler, a lane header reading
 * `S SPLIT · BACKSPACE DELETE · I/O TRIM`, a zoom stepper, marker flags and two timecode readouts.
 * §13 kills "SMPTE anywhere" by name, and kills the timecode with the sharpest line in the section:
 * "the brief fails the design if timecode appears before the user has done anything." A person who
 * has never opened a video editor does not know what `00:00:12:04` is, does not need to, and cannot
 * be helped by it — the position of a mark in a bar is a time they already understand.
 *
 * SO WHERE DID THE NUMBER GO. §13 keeps exactly one door open: "the duration appears on hover and
 * during scrub, nowhere else." That is what `showTime` is. It is minutes and seconds — never SMPTE,
 * never frames — because the question it answers is "how far in am I", and it disappears the moment
 * the pointer leaves.
 *
 * ACCESSIBILITY IS NOT THE EXCEPTION. A slider must expose its value, so `aria-valuetext` speaks the
 * position for a screen reader at all times. That is not a numeral on screen and it is not optional:
 * hiding a slider's value from assistive technology in the name of a clean surface would be trading
 * one user's clarity for another's.
 *
 * THE 4px BAR HAS A 44px TARGET. §16 makes ≥44px a component obligation; a 4px-tall hit area is a
 * miss on a trackpad and impossible on a phone. `.hite-scrubber` is 44px of transparent hit area
 * around 4px of visible rule.
 */
export function Scrubber() {
  const edl = useEditor((s) => s.edl);
  const currentMs = useEditor((s) => s.currentTimeMs);
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [hovering, setHovering] = useState(false);

  const durationMs = edl ? tickToMs(edl.durationTicks) : 0;
  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, currentMs / durationMs)) : 0;
  const showTime = hovering || scrubbing;

  /** One frame at 30fps, and one second with Shift — the two steps a person actually reaches for. */
  const step = (deltaMs: number) => {
    useEditor.getState().seekTo(Math.min(durationMs, Math.max(0, currentMs + deltaMs)));
  };

  const seekToPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || durationMs <= 0) return;
    const next = ((clientX - rect.left) / rect.width) * durationMs;
    useEditor.getState().seekTo(Math.min(durationMs, Math.max(0, next)));
  };

  return (
    <div className="relative w-full">
      <div
        data-affordance={AFFORDANCE.scrubber}
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs)}
        aria-valuenow={Math.round(currentMs)}
        aria-valuetext={`${formatElapsed(currentMs / 1000)} of ${formatElapsed(durationMs / 1000)}`}
        className="hite-scrubber"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setScrubbing(true);
          seekToPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (scrubbing) seekToPointer(e.clientX);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setScrubbing(false);
        }}
        onPointerCancel={() => setScrubbing(false)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 1000 : Math.round(1000 / 30);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            step(big);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            step(-big);
          } else if (e.key === "Home") {
            e.preventDefault();
            useEditor.getState().seekTo(0);
          } else if (e.key === "End") {
            e.preventDefault();
            useEditor.getState().seekTo(durationMs);
          }
        }}
      >
        {/* The playhead. 2px of accent — §4.1's "the machine" — sitting on the 4px rule the
            stylesheet paints, so the mark and its track are one object. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-[calc(50%-6px)] block h-3 w-[2px] rounded-[var(--r-pill)]"
          style={{ left: `calc(${fraction * 100}% - 1px)`, background: "var(--color-accent)" }}
        />
      </div>

      {/* §13's one exception, and it lives outside the 44px target so it can never be the thing the
          pointer lands on. `--t-3` is the body floor at 7.00:1; 12px is the hard floor. */}
      {showTime && durationMs > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-full block text-[12px] tabular-nums text-[var(--t-3)]"
        >
          {formatElapsed(currentMs / 1000)} of {formatElapsed(durationMs / 1000)}
        </span>
      )}
    </div>
  );
}
