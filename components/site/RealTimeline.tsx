"use client";

/**
 * components/site/RealTimeline.tsx — LANDING §6.3 "STILL A REAL TIMELINE", the falsifiable proof.
 *
 * DESIGN-DIRECTION §6.3 is the whole brief for this file:
 *
 *   H2: `The AI writes the edit. You still own it.`
 *   A three-way segmented control over one prompt. Each option re-renders a real timeline from a
 *   GENERATED EDL fixture (§7.3), labelled as a recorded example. The visitor makes the core claim
 *   falsifiable in one click — no backend call, no footage, no dishonesty.
 *   Beside it, ONE draggable clip edge. Drag it; the frame count changes.
 *
 * WHY THE PROOF WORKS WITH ZERO PIXELS (§11 T0). `public/` ships no video and no screenshot, and the
 * fixture says so in its own data (`MECHANISM.asset.hasMedia === false`). So the proof is not a
 * picture of an edit — it is the edit's GEOMETRY, and the geometry is real: every tick below comes
 * out of `lib/edl/reducer.ts` via `scripts/build-landing-fixtures.ts`, and `fixture.test.ts` fails
 * the build if the committed artifact and the live reducer ever disagree. Where a program frame
 * would go, the take lane carries the honest media-offline instrument state — asset id, duration,
 * "source not linked" — which is a real thing an editor shows.
 *
 * THE DRAG IS NOT A MIME. `TRIM_CLIP { edge: "out", toTick }` (`lib/edl/commands.ts:57`) sets a
 * clip's SOURCE out point from a timeline tick and clamps it to `availableOutTick`, the end of the
 * real media (`lib/edl/reducer.ts:484–494`). Because position in Edl.2 is derived, moving that edge
 * moves the timeline's duration. This component performs exactly that arithmetic in ticks — it does
 * not re-implement a different rule, and it does not ship the reducer to the browser. The bounds are
 * the reducer's own: at least one frame of clip, never past the end of the source take.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   • No `.stage-light`. §4.6 rules that a stage colour without its stage NAME adjacent and legible
 *     is decoration and must be deleted. Nothing in this section changes pipeline stage, so the
 *     section's only light is the timeline itself; surface interest is `.tex-hatch` (§4.4).
 *   • No digit roll. §5.3's roll is one beat of the §6.2 COMMIT+RIPPLE set-piece; here the duration
 *     is a direct-manipulation readout that must track a drag frame-for-frame, and a 720ms roll on a
 *     dragged value is lag, not motion.
 *   • No `.t-timecode`. §4.3 rations it to "the ONE oversized numeral per page" — §6.2's pinned
 *     theater owns it (`Mechanism.tsx`, the digit roll), and nothing else on the property carries it.
 *   • No parked playhead. §6.3 does not ask for one, and every meaningful rest position on this
 *     timeline is a splice, so a decorative playhead would sit on top of a cut edge and read as
 *     clutter. The one accent vertical here is the edge the visitor can actually move.
 *   • No example-prompt deep links. The three strings in the segmented control are FIXTURE data
 *     (`lib/landing/fixture-source.ts`: "verbatim from §6.3's segmented control"), not launchable
 *     example prompts; §7.2's allowlist (`lib/landing/prompts.ts`) owns anything that links to /app.
 *
 * MOTION (§5.9): every transition below is authored inside `motion-safe:`
 * (`prefers-reduced-motion: no-preference`) and additionally carries `motion-reduce:`. The static
 * state is what server-renders. Nothing auto-updates, so WCAG 2.2.2 needs no pause control here.
 * SETTLE (§5.2) runs blur-free in this section: every settling element exceeds §5.7's 480×240px
 * blur cap, and §5.7's own escape hatch is to drop the blur and keep opacity + translate.
 */

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import {
  LANDING_FIXTURE_URL,
  MECHANISM,
  MECHANISM_HEADLINE,
  MECHANISM_SOURCE,
  MECHANISM_VARIANTS,
  type FixtureClip,
  type FixtureSpan,
  type LandingFixtureDisplay,
} from "@/lib/landing/fixture";
import { LANDING_FPS, ticksToLandingFrames, ticksToSeconds, ticksToTimecode } from "@/lib/landing/format";
import { framesToTicks, TICKS_PER_SECOND, type Tick } from "@/lib/edl/time";

/** One entry of the generated fixture's variant list — what a segment renders. */
type FixtureVariant = LandingFixtureDisplay["variants"][number];

/** Inline styles that also set custom properties. React's CSSProperties has no slot for them. */
type CssVars = CSSProperties & Record<`--${string}`, string | number>;

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   DERIVED FROM THE FIXTURE (§7.3: "there are no numeric literals in landing components")
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const SOURCE_TICKS: Tick = MECHANISM_SOURCE.durationTicks;
const SOURCE_SECONDS = ticksToSeconds(SOURCE_TICKS);
/** One frame at the page's ruler rate, via the codebase's one frames→ticks conversion. */
const FRAME_TICKS: Tick = framesToTicks(1, LANDING_FPS);

/**
 * THE LANE'S SCALE. §2.1 fixes 1 frame = 4px and 1 second = 30 frames = 120px, and §4.1's ruler
 * strip marks a minor tick every 6 frames (24px). This lane runs at one second per MINOR TICK — so a
 * second of footage is exactly six frames of page, and the whole 48-second take is 1152px, which
 * fits inside the wide column (`--maxw-wide`). Below that width the lane is fluid: the proportions,
 * and therefore the proof, hold at every size and nothing ever scrolls sideways.
 */
const LANE_SECOND_PX = "calc(var(--frame) * 6)";
const LANE_MAX_INLINE = `calc(${LANE_SECOND_PX} * ${SOURCE_SECONDS})`;

/** Numerals sit one CONTENT COLUMN apart: §2.1's column is 1200px = exactly ten seconds. */
const RULER_NUMERAL_SECONDS = 10;
const RULER_NUMERALS: readonly { tick: Tick; label: string }[] = Array.from(
  { length: Math.ceil(SOURCE_SECONDS / RULER_NUMERAL_SECONDS) },
  (_, i) => {
    const tick = i * RULER_NUMERAL_SECONDS * TICKS_PER_SECOND;
    return { tick, label: ticksToTimecode(tick) };
  },
);

/**
 * Fixed slot counts, so a variant switch MORPHS instead of re-mounting.
 *
 * §5.3's rule for the ripple is "no layout animation anywhere": the clip rectangles and the removed
 * spans are therefore lane-width layers revealed by `clip-path: inset()` — paint only, and the one
 * sanctioned exception in §12's hot-path row. That only animates if the DOM nodes survive the
 * switch, so every variant renders the same number of slots and the unused ones collapse. Slot N of
 * one variant and slot N of the next are the same rectangle moving, which is the honest reading:
 * clips are ordered in time, so slot N is "the Nth cut" in both.
 */
const CLIP_SLOTS = MECHANISM_VARIANTS.reduce((n, v) => Math.max(n, v.clips.length), 0);
const REMOVED_SLOTS = MECHANISM_VARIANTS.reduce((n, v) => Math.max(n, v.removed.length), 0);

/** Position on the lane, as a percentage of the SOURCE take — so the result lane visibly ends short. */
function pct(ticks: Tick): number {
  return (ticks / SOURCE_TICKS) * 100;
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** The clip whose out point is draggable: the last one, because nothing downstream of it ripples. */
function lastClipOf(variant: FixtureVariant): FixtureClip {
  const clip = variant.clips.at(-1);
  if (!clip) throw new Error(`landing fixture: variant "${variant.id}" reduced to zero clips`);
  return clip;
}

/**
 * How far the last clip's out point may travel, in whole frames, relative to where the AI put it.
 *
 * These are the reducer's own bounds, not invented ones: `TRIM_CLIP edge:"out"` throws
 * `trim_collapses_clip` at or before the clip's in point and clamps at `availableOutTick`, which for
 * this fixture is the end of the source take. A one-FRAME floor (rather than the reducer's one-TICK
 * floor) is the stricter of the two and the only one that stays visible on a ruler made of frames.
 */
export function trimRangeFrames(variant: FixtureVariant): { min: number; max: number } {
  const clip = lastClipOf(variant);
  return {
    min: Math.ceil((clip.sourceInTick + FRAME_TICKS - clip.sourceOutTick) / FRAME_TICKS),
    max: Math.floor((SOURCE_TICKS - clip.sourceOutTick) / FRAME_TICKS),
  };
}

/**
 * The timeline's duration once the visitor has moved that edge by `trimFrames`.
 *
 * Computed from the clip's own geometry rather than from the printed duration, so `trimFrames === 0`
 * returns the generated `variant.durationTicks` EXACTLY — the number that server-renders is the
 * number the reducer produced, with no rounding introduced by this file.
 */
export function trimmedTotalTicks(variant: FixtureVariant, trimFrames: number): Tick {
  const clip = lastClipOf(variant);
  const { min, max } = trimRangeFrames(variant);
  const outTick = clip.sourceOutTick + clamp(trimFrames, min, max) * FRAME_TICKS;
  return clip.startTick + (outTick - clip.sourceInTick);
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   SHARED STYLE FRAGMENTS — tokens only, consumed through var() (§4)
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * A clip rectangle: a bright top edge and a hairline foot over two surface rungs.
 *
 * The edges are baked into the GRADIENT rather than drawn as a border or an inset shadow, because
 * both of those are painted at the element's own box and this element is a full-lane layer cropped
 * by `clip-path` — a border would appear at the lane's edges, not the clip's. A horizontal gradient
 * band is the only construction that survives the crop.
 *
 * `--line-5` for the top edge, and it is a requirement rather than a preference: §4.2 names it "the
 * ONLY border allowed to be a control's SOLE boundary (WCAG 1.4.11 non-text, 3:1)", and a clip
 * rectangle's boundary is what tells a visitor where the footage stops and the removed time starts.
 * Measured on screen, the `--s-2`/`--s-3` fills alone did not carry that reading.
 */
const CLIP_FILL =
  "linear-gradient(180deg, var(--line-5) 0 1px, var(--s-3) 1px, var(--s-2) calc(100% - 1px), var(--line-3) calc(100% - 1px))";

/** The same construction for a removed span: a bright accent edge over an accent body. */
const REMOVED_FILL = "linear-gradient(180deg, var(--color-accent) 0 1px, var(--color-accent-dim) 1px)";

/** Every geometry transition on the lane. `--tl-move` is 0s while a drag is live (see the panel). */
const MOVE_CLASSES =
  "motion-safe:transition-[clip-path,transform,opacity] motion-safe:duration-[var(--tl-move)] " +
  "motion-safe:ease-[var(--ease-cut)] motion-reduce:transition-none";

/**
 * A lane-width layer translated by a percentage of ITS OWN width — i.e. of the lane. Compositor
 * only: no `left`, no `width`, nothing that reflows (§5.3 "no layout animation anywhere", §12).
 */
function markerLayer(ticks: Tick): CSSProperties {
  return {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    inlineSize: "100%",
    transform: `translateX(${pct(ticks).toFixed(4)}%)`,
    pointerEvents: "none",
  };
}

/** `clip-path` for a span of the lane, or a collapsed slot parked at the timeline's end. */
function spanClip(startTick: Tick | undefined, endTick: Tick | undefined): string {
  if (startTick === undefined || endTick === undefined) return "inset(0 0 0 100% round var(--r-xs))";
  return `inset(0 ${(100 - pct(endTick)).toFixed(4)}% 0 ${pct(startTick).toFixed(4)}% round var(--r-xs))`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════════════════════════════════════════ */

export interface RealTimelineProps {
  /** Section id — the nav/anchor target, and the stem the heading's id is derived from. */
  id?: string;
  /** Extra classes on the `<section>`, which already carries `.section`. */
  className?: string;
}

export function RealTimeline({ id = "real-timeline", className }: RealTimelineProps): ReactElement {
  const uid = useId();
  const headingId = `${id}-h`;
  const outputId = `${uid}-out`;

  const [variantId, setVariantId] = useState<string>(MECHANISM_HEADLINE.id);
  /** Frames the visitor has moved the last clip's out point by, relative to the AI's cut. */
  const [trimFrames, setTrimFrames] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  const laneRef = useRef<HTMLDivElement | null>(null);

  const variant = useMemo(
    () => MECHANISM_VARIANTS.find((v) => v.id === variantId) ?? MECHANISM_HEADLINE,
    [variantId],
  );
  const lastClip = lastClipOf(variant);
  const range = useMemo(() => trimRangeFrames(variant), [variant]);

  const outTick = lastClip.sourceOutTick + trimFrames * FRAME_TICKS;
  const totalTicks = trimmedTotalTicks(variant, trimFrames);
  const totalFrames = ticksToLandingFrames(totalTicks);
  const totalTimecode = ticksToTimecode(totalTicks);
  const removedTicks = SOURCE_TICKS - totalTicks;

  const setTrim = useCallback(
    (frames: number) => setTrimFrames(clamp(Math.round(frames), range.min, range.max)),
    [range.min, range.max],
  );

  const selectVariant = useCallback((next: string) => {
    setVariantId(next);
    setTrimFrames(0);
  }, []);

  /** Pointer x → the out point the visitor is pointing at, in frames off the AI's cut. */
  const trimFromClientX = useCallback(
    (clientX: number): number => {
      const rect = laneRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return trimFrames;
      const timelineTick = clamp((clientX - rect.left) / rect.width, 0, 1) * SOURCE_TICKS;
      const wantedOut = lastClip.sourceInTick + (timelineTick - lastClip.startTick);
      return (wantedOut - lastClip.sourceOutTick) / FRAME_TICKS;
    },
    [lastClip.sourceInTick, lastClip.sourceOutTick, lastClip.startTick, trimFrames],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // preventDefault stops the browser's own text-selection drag; focus is then moved by hand so
      // a pointer user who reaches for the arrow keys next lands on the slider.
      e.preventDefault();
      e.currentTarget.focus();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      setTrim(trimFromClientX(e.clientX));
    },
    [setTrim, trimFromClientX],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setTrim(trimFromClientX(e.clientX));
    },
    [dragging, setTrim, trimFromClientX],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  /**
   * WCAG 2.1.1 for the drag. The ± buttons satisfy SC 2.5.7 (Dragging Movements) separately —
   * keyboard support alone does not, because 2.5.7 asks for a single-POINTER path.
   */
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? LANDING_FPS : 1;
      const by = (frames: number): void => {
        e.preventDefault();
        setTrim(trimFrames + frames);
      };
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowDown":
          return by(-step);
        case "ArrowRight":
        case "ArrowUp":
          return by(step);
        case "PageDown":
          return by(-LANDING_FPS);
        case "PageUp":
          return by(LANDING_FPS);
        case "Home":
          e.preventDefault();
          return setTrim(range.min);
        case "End":
          e.preventDefault();
          return setTrim(range.max);
        default:
          return;
      }
    },
    [range.max, range.min, setTrim, trimFrames],
  );

  const panelVars: CssVars = {
    // The ripple's duration token, dropped to zero while a drag is live so the edge tracks the
    // pointer instead of easing 720ms behind it.
    "--tl-move": dragging ? "0s" : "var(--d-commit)",
    background: "var(--s-1)",
    padding: "var(--space-6)",
    overflow: "hidden",
  };

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={className ? `section ${className}` : "section"}
      // No arrival, and no `--settle-blur` override tuning one. `.settle` / `.settle-media` /
      // `@keyframes settle` were deleted in app/globals.css (the class blurred inside the LCP
      // viewport, which §16 budgets at zero) and §6's nine-animation inventory has no mid-page
      // arrival to replace them with. Two class names and the override went with the rules.
    >
      <div className="container">
        <p className="t-label" style={{ marginBlockEnd: "var(--space-3)" }}>
          Recorded example
        </p>
        <h2 id={headingId} className="t-h2 heading-gap">
          The AI writes the edit. You still own it.
        </h2>
        <p className="t-lead">
          One prompt, three ways to read it, three real timelines — each one reduced from real{" "}
          <span className="t-strong">EditCommand</span>s, not drawn. Drag the last clip&rsquo;s out point: the
          frame count moves with it.
        </p>
      </div>

      <div className="bleed" style={{ marginBlockStart: "var(--space-8)" }}>
        <div className="r-lg ring-hair tex-hatch" style={panelVars}>
          {/* ── THE SEGMENTED CONTROL (§6.3) — one prompt, three real readings ─────────────── */}
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="t-label" style={{ marginBlockEnd: "var(--space-3)" }}>
              Prompt
            </legend>
            <div className="grid grid-cols-1 gap-[var(--space-1)] md:grid-cols-3">
              {MECHANISM_VARIANTS.map((v) => {
                const checked = v.id === variant.id;
                return (
                  <label
                    key={v.id}
                    className="r-sm relative flex cursor-pointer items-center motion-safe:transition-[background-color,color,box-shadow] motion-safe:duration-[var(--d-state)] motion-safe:ease-[var(--ease-apple)] motion-reduce:transition-none"
                    style={{
                      minBlockSize: "calc(var(--frame) * 11)" /* 44px — WCAG 2.5.8 */,
                      paddingInline: "var(--space-4)",
                      paddingBlock: "var(--space-3)",
                      background: checked ? "var(--s-3)" : "var(--s-canvas)",
                      boxShadow: `inset 0 0 0 1px ${checked ? "var(--line-5)" : "var(--line-2)"}`,
                      color: checked ? "var(--t-1)" : "var(--t-3)",
                      fontSize: "var(--fs-sm)",
                    }}
                  >
                    <input
                      type="radio"
                      name={`${uid}-variant`}
                      value={v.id}
                      checked={checked}
                      onChange={() => selectVariant(v.id)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="r-xs"
                      style={{
                        inlineSize: "var(--space-2)",
                        blockSize: "var(--space-2)",
                        marginInlineEnd: "var(--space-3)",
                        flex: "0 0 auto",
                        background: checked ? "var(--color-accent)" : "transparent",
                        boxShadow: checked ? "none" : "inset 0 0 0 1px var(--line-4)",
                      }}
                    />
                    <span style={{ textWrap: "pretty" }}>{v.prompt}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="t-body" style={{ marginBlockStart: "var(--space-3)", color: "var(--t-3)" }}>
            {variant.note}
          </p>

          {/* ── THE READOUTS — every value derived, none typed (§7.3) ──────────────────────── */}
          <div
            className="grid gap-[var(--space-5)]"
            style={{
              marginBlockStart: "var(--space-7)",
              gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--frame) * 34), 1fr))",
            }}
          >
            <Meter
              label="The take"
              value={MECHANISM_SOURCE.timecode}
              sub={`${MECHANISM_SOURCE.durationFrames} f`}
            />
            <Meter
              label="After the edit"
              value={totalTimecode}
              sub={`${totalFrames} f`}
              emphasis
              outputId={outputId}
            />
            <Meter
              label="Removed"
              value={ticksToTimecode(removedTicks)}
              sub={`${ticksToLandingFrames(removedTicks)} f`}
            />
            <Meter
              label="Clips"
              value={String(variant.clips.length)}
              sub={`${variant.commandCount} commands`}
            />
          </div>

          {/* ── THE LANES. One x-scale, one ref: this box's width IS the source take. ──────── */}
          <div
            ref={laneRef}
            className="relative"
            style={{ marginBlockStart: "var(--space-6)", inlineSize: `min(100%, ${LANE_MAX_INLINE})` }}
          >
            {/* Ruler — §2.1's frame ruler laid on its side: a tick every second, a longer mark and
                a numeral every ten seconds (one content column). */}
            <div
              aria-hidden="true"
              className="relative"
              style={{
                blockSize: "var(--space-6)",
                backgroundRepeat: "no-repeat",
                backgroundImage: [
                  `repeating-linear-gradient(to right, var(--line-4) 0 1px, transparent 1px calc(100% * ${RULER_NUMERAL_SECONDS} / ${SOURCE_SECONDS}))`,
                  `repeating-linear-gradient(to right, var(--line-2) 0 1px, transparent 1px calc(100% / ${SOURCE_SECONDS}))`,
                ].join(", "),
                backgroundSize: "100% var(--space-2), 100% var(--space-1)",
                backgroundPosition: "0 100%, 0 100%",
              }}
            >
              {RULER_NUMERALS.map((n) => (
                <span
                  key={n.tick}
                  className="t-label tnum absolute hidden sm:block"
                  style={{
                    insetBlockStart: 0,
                    insetInlineStart: `${pct(n.tick).toFixed(4)}%`,
                    paddingInlineStart: "var(--space-1)",
                    color: "var(--t-4)",
                    letterSpacing: 0,
                  }}
                >
                  {n.label}
                </span>
              ))}
            </div>

            {/* ── LANE 1 · THE TAKE ─────────────────────────────────────────────────────── */}
            <LaneLabel>
              {`The take · ${MECHANISM_SOURCE.timecode} · ${MECHANISM_SOURCE.silences.length} silences found · ${variant.removed.length} removed`}
            </LaneLabel>
            <div
              className="r-xs relative overflow-hidden"
              role="img"
              aria-label={`Source take, ${MECHANISM_SOURCE.timecode}, one clip. ${MECHANISM_SOURCE.silences.length} silences found by findSilences; this prompt removes ${variant.removed.length} of them.`}
              style={{ blockSize: "var(--space-6)", background: CLIP_FILL }}
            >
              {/* Every silence the analysis found. The ones under this variant's threshold stay
                  unlit — which is what makes the three options falsifiable against each other.
                  Inset from the clip's own edges ON PURPOSE: drawn full height they punched through
                  the top and foot lines and the single 48-second take read as seven clips. A mark
                  ON a clip is what an editor draws, and it is also what is true here. */}
              {MECHANISM_SOURCE.silences.map((s) => (
                <span
                  key={`${s.startTick}-${s.endTick}`}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    insetBlock: "var(--space-1)",
                    insetInlineStart: `${pct(s.startTick).toFixed(4)}%`,
                    inlineSize: `${pct(s.durationTicks).toFixed(4)}%`,
                    minInlineSize: "1px",
                    background: "var(--s-canvas)",
                  }}
                />
              ))}
              {/* What THIS prompt deletes. Under "keep 200ms of room" these are visibly shorter than
                  the silence they sit inside, which is the whole point of that option. */}
              {Array.from({ length: REMOVED_SLOTS }, (_, i) => {
                const span: FixtureSpan | undefined = variant.removed[i];
                return (
                  <span
                    key={`removed-${i}`}
                    aria-hidden="true"
                    className={MOVE_CLASSES}
                    style={{
                      position: "absolute",
                      insetBlock: 0,
                      insetInlineStart: 0,
                      inlineSize: "100%",
                      clipPath: spanClip(span?.startTick, span?.endTick),
                      background: REMOVED_FILL,
                      opacity: span ? 1 : 0,
                    }}
                  />
                );
              })}
            </div>
            {/* §11 T0 — the honest media-offline instrument state, where a program frame would go. */}
            <p
              className="t-label"
              style={{
                marginBlockStart: "var(--space-2)",
                color: "var(--t-4)",
                letterSpacing: 0,
                textTransform: "none",
              }}
            >
              {MECHANISM.asset.id}
              {MECHANISM.asset.hasMedia ? "" : " — source not linked"}
            </p>

            {/* ── LANE 2 · THE CUT ──────────────────────────────────────────────────────── */}
            <LaneLabel>{`The cut · ${totalTimecode} · ${totalFrames} f · ${variant.clips.length} clips`}</LaneLabel>
            <div
              className="relative"
              role="group"
              aria-label={`Timeline after the edit — ${variant.clips.length} clips, ${totalTimecode}`}
              style={{ blockSize: "var(--space-7)" }}
            >
              {/* The empty track behind the clips, so a shorter timeline reads as time REMOVED.
                  Deliberately UNRINGED: a hairline around the whole track drew a top edge across
                  the removed region too, and the boundary between "footage" and "gone" — the one
                  thing this lane exists to show — stopped reading. The well is dark; the clips
                  carry the only edges. */}
              <span
                aria-hidden="true"
                className="r-xs absolute"
                style={{ inset: 0, background: "var(--s-canvas)" }}
              />
              {Array.from({ length: CLIP_SLOTS }, (_, i) => {
                const clip: FixtureClip | undefined = variant.clips[i];
                // Only the LAST clip's end moves; every edge before it is the reducer's, untouched.
                const end =
                  clip === undefined ? undefined : i === variant.clips.length - 1 ? totalTicks : clip.endTick;
                return (
                  <div
                    key={`clip-${i}`}
                    role={clip ? "img" : undefined}
                    aria-hidden={clip ? undefined : true}
                    aria-label={
                      clip && end !== undefined
                        ? `Clip ${i + 1} — ${ticksToTimecode(clip.startTick)} to ${ticksToTimecode(end)}`
                        : undefined
                    }
                    className={MOVE_CLASSES}
                    style={{
                      position: "absolute",
                      insetBlock: 0,
                      insetInlineStart: 0,
                      inlineSize: "100%",
                      clipPath: spanClip(clip?.startTick, end),
                      background: CLIP_FILL,
                      opacity: clip ? 1 : 0,
                    }}
                  />
                );
              })}
              {/* The splices. `cutTicks` is the fixture's own list of interior cut edges. */}
              {Array.from({ length: CLIP_SLOTS }, (_, i) => {
                const cut: Tick | undefined = variant.cutTicks[i];
                return (
                  <div
                    key={`cut-${i}`}
                    aria-hidden="true"
                    className={MOVE_CLASSES}
                    style={{ ...markerLayer(cut ?? SOURCE_TICKS), opacity: cut === undefined ? 0 : 1 }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        insetBlock: 0,
                        insetInlineStart: 0,
                        inlineSize: "2px",
                        marginInlineStart: "-1px",
                        background: "linear-gradient(to right, var(--s-canvas) 0 1px, var(--line-5) 1px 2px)",
                      }}
                    />
                  </div>
                );
              })}

              {/* ── THE ONE DRAGGABLE CLIP EDGE (§6.3) ─────────────────────────────────── */}
              <div className={MOVE_CLASSES} style={markerLayer(totalTicks)}>
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Out point of the last clip"
                  aria-valuemin={ticksToLandingFrames(lastClip.sourceOutTick + range.min * FRAME_TICKS)}
                  aria-valuemax={ticksToLandingFrames(lastClip.sourceOutTick + range.max * FRAME_TICKS)}
                  aria-valuenow={ticksToLandingFrames(outTick)}
                  aria-valuetext={`Frame ${ticksToLandingFrames(outTick)} of the take. Timeline ${totalTimecode}, ${totalFrames} frames.`}
                  aria-controls={outputId}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={onKeyDown}
                  className="absolute cursor-col-resize"
                  style={{
                    // 24 × 72px grab area — comfortably past SC 2.5.8's 24px minimum on touch.
                    insetBlock: "calc(var(--frame) * -3)",
                    insetInlineStart: 0,
                    inlineSize: "calc(var(--frame) * 6)",
                    marginInlineStart: "calc(var(--frame) * -3)",
                    pointerEvents: "auto",
                    touchAction: "none",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ inlineSize: "2px", blockSize: "100%", background: "var(--color-accent)" }}
                  />
                  {/* The grab affordance. Without it the edge reads as a playhead — an indicator you
                      watch, not an edge you move — which loses the section's one interaction. */}
                  <span
                    aria-hidden="true"
                    className="r-xs absolute"
                    style={{
                      insetBlockStart: "50%",
                      insetInlineStart: "50%",
                      transform: "translate(-50%, -50%)",
                      inlineSize: "var(--space-2)",
                      blockSize: "var(--space-6)",
                      background: "var(--color-accent)",
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="r-xs absolute"
                    style={{
                      insetBlockStart: 0,
                      insetInlineStart: "50%",
                      transform: "translateX(-50%)",
                      inlineSize: "var(--space-1)",
                      blockSize: "var(--space-1)",
                      background: "var(--color-accent)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* The bracket: a rule exactly as long as the timeline is. §2.2 — the edit edits the
                page. scaleX on a 1px line is lossless and compositor-only. */}
            <div
              aria-hidden="true"
              className="relative"
              style={{ marginBlockStart: "var(--space-2)", blockSize: "1px" }}
            >
              <span
                className={MOVE_CLASSES}
                style={{
                  position: "absolute",
                  insetBlock: 0,
                  insetInline: 0,
                  background: "var(--line-4)",
                  transformOrigin: "left",
                  transform: `scaleX(${(pct(totalTicks) / 100).toFixed(6)})`,
                }}
              />
            </div>
          </div>

          {/* ── THE TRIM CONTROLS — SC 2.5.7's single-pointer path, and the real command name ── */}
          <div
            className="flex flex-wrap items-center gap-[var(--space-3)]"
            style={{ marginBlockStart: "var(--space-5)" }}
          >
            <div role="group" aria-label="Trim the last clip" className="flex items-center gap-[var(--space-1)]">
              <NudgeButton
                label="Trim one frame off the end"
                glyph="−"
                onClick={() => setTrim(trimFrames - 1)}
                disabled={trimFrames <= range.min}
              />
              <NudgeButton
                label="Extend the end by one frame"
                glyph="+"
                onClick={() => setTrim(trimFrames + 1)}
                disabled={trimFrames >= range.max}
              />
            </div>
            <p className="t-code" style={{ margin: 0 }}>
              TRIM_CLIP · edge &ldquo;out&rdquo; ·{" "}
              {trimFrames === 0 ? "at the AI’s cut" : `${trimFrames > 0 ? "+" : ""}${trimFrames} f`}
            </p>
            {trimFrames !== 0 && (
              <button
                type="button"
                onClick={() => setTrimFrames(0)}
                className="t-label r-xs motion-safe:transition-[color] motion-safe:duration-[var(--d-tap)] motion-safe:ease-[var(--ease-apple)] motion-reduce:transition-none"
                style={{
                  minBlockSize: "calc(var(--frame) * 11)",
                  paddingInline: "var(--space-3)",
                  color: "var(--t-2)",
                  boxShadow: "inset 0 0 0 1px var(--line-3)",
                }}
              >
                Reset to the AI&rsquo;s cut
              </button>
            )}
          </div>

          {/* ── PROVENANCE — the sentence the generator wrote about itself (§7.3) ──────────── */}
          <p
            className="t-body"
            style={{ marginBlockStart: "var(--space-5)", color: "var(--t-3)", maxWidth: "var(--measure)" }}
          >
            {MECHANISM.provenance}{" "}
            <a
              href={LANDING_FIXTURE_URL}
              className="r-xs"
              style={{ color: "var(--t-2)", textDecoration: "underline", textUnderlineOffset: "0.25em" }}
            >
              Read the EDL
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

export default RealTimeline;

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   PARTS
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** A lane's mono caption. Sits above the lane it names, never inside it — text over a cyan removed
 *  span could not be held above 4.5:1, and a caption that has to dodge the data is a worse caption. */
function LaneLabel({ children }: { children: string }): ReactElement {
  return (
    <p className="t-label" style={{ marginBlockStart: "var(--space-5)", marginBlockEnd: "var(--space-2)" }}>
      {children}
    </p>
  );
}

interface MeterProps {
  label: string;
  /** The large figure: a timecode, or a plain count for the clip meter. */
  value: string;
  /** The frame count or command count beneath it. */
  sub: string;
  /** Render inside an `<output>` (implicit `role="status"`) so AT hears the value change. */
  outputId?: string;
  emphasis?: boolean;
}

/**
 * One readout: a mono label over a tabular figure. §4.3 rations `.t-timecode` to "the ONE oversized
 * numeral per page", which §6.2's pinned theater owns, so this uses the h3 step of the scale instead.
 */
function Meter({ label, value, sub, outputId, emphasis }: MeterProps): ReactElement {
  const figure = (
    <span
      className="font-mono tnum"
      style={{
        fontSize: "var(--fs-h3)",
        lineHeight: "var(--lh-h3)",
        letterSpacing: 0,
        color: emphasis ? "var(--t-1)" : "var(--t-2)",
      }}
    >
      {value}
    </span>
  );
  return (
    <div>
      <p className="t-label" style={{ marginBlockEnd: "var(--space-1)" }}>
        {label}
      </p>
      {outputId ? (
        <output id={outputId} style={{ display: "block" }}>
          {figure}
        </output>
      ) : (
        figure
      )}
      <p className="t-label tnum" style={{ marginBlockStart: "var(--space-1)", color: "var(--t-4)" }}>
        {sub}
      </p>
    </div>
  );
}

/** A 44px single-pointer alternative to the drag (WCAG 2.2 SC 2.5.7 + SC 2.5.8). */
function NudgeButton({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="r-xs flex items-center justify-center motion-safe:transition-[color,box-shadow] motion-safe:duration-[var(--d-tap)] motion-safe:ease-[var(--ease-apple)] motion-reduce:transition-none"
      style={{
        inlineSize: "calc(var(--frame) * 11)",
        blockSize: "calc(var(--frame) * 11)",
        color: disabled ? "var(--t-4)" : "var(--t-2)",
        boxShadow: "inset 0 0 0 1px var(--line-3)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "var(--fs-lead)", lineHeight: 1 }}>
        {glyph}
      </span>
    </button>
  );
}
