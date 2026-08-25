/**
 * lib/landing/fixture-source.ts — the ONLY authored numbers behind the landing's timeline proof.
 *
 * DESIGN-DIRECTION §7.3: "A hand-authored EDL that drifts from `reduceBatch` becomes a fabricated
 * demo — the same class of lie as a fake metric, and harder to catch." So the split is strict:
 *
 *   • THIS FILE is the committed INPUT — a source clip length and the silent spans an analysis pass
 *     would report on it. Nothing here is a timeline; nothing here is a duration the page prints.
 *   • `build-fixture.ts` derives the EditCommand[] and runs the REAL `reduceBatch` over them.
 *   • Every number the page shows — 0:48, 0:39, the clip counts, the command JSON — comes out of
 *     that reduction and is regenerated + diffed by `fixture.test.ts`.
 *
 * WHAT THE SILENCES ARE. `lib/ai/tools/generated/findSilences.ts` returns exactly this shape —
 * `{ startTick, endTick, kind }` over a transcript, with `kind` distinguishing the dead intro, the
 * pauses between spoken segments, and the hanging outro. This array stands in for one run of that
 * tool. It is stated in MILLISECONDS because that is the unit transcripts arrive in (the tool does
 * the ms→ticks conversion itself); `build-fixture.ts` converts with the same `msToTicks`.
 *
 * THERE IS NO FOOTAGE. `public/` ships no video, and the fixture asserts that rather than hiding it:
 * the clip's media url is empty, so anything rendering this fixture must draw the honest
 * media-offline state (DESIGN-DIRECTION §11 T0). The timeline geometry is real regardless — it is
 * derived from real commands through the real reducer, and that is the claim the page makes.
 */
import { msToTicks, secToTicks, type Tick } from "@/lib/edl/time";

/** Matches `findSilences`'s own SilenceKind: dead intro, pause between segments, hanging outro. */
export type SilenceKind = "leading" | "between" | "trailing";

export interface SilenceSpanMs {
  startMs: number;
  endMs: number;
  kind: SilenceKind;
}

/** The asset the fixture edit is performed on. No media file exists for it — see the header. */
export const FIXTURE_ASSET_ID = "landing-fixture-take" as const;

/** The source clip's length. DESIGN-DIRECTION §2.2 fixes the theater at 48 seconds wide. */
export const FIXTURE_SOURCE_TICKS: Tick = secToTicks(48);

/**
 * The dead air in the fixture take, in source milliseconds.
 *
 * Seven spans of 900–2200ms (what a 600ms threshold catches) plus four short 350–450ms breaths
 * (what it does not). The two sets are what makes §6.3's segmented control falsifiable: the same
 * take, three real thresholds, three different timelines. Sums are load-bearing and asserted in
 * `fixture.test.ts` — 9000ms over the 600ms threshold, so the headline edit is 0:48 → 0:39.
 */
export const FIXTURE_SILENCES_MS: readonly SilenceSpanMs[] = [
  { startMs: 0, endMs: 1200, kind: "leading" },
  { startMs: 6400, endMs: 7500, kind: "between" },
  { startMs: 10200, endMs: 10650, kind: "between" },
  { startMs: 13900, endMs: 15200, kind: "between" },
  { startMs: 19400, endMs: 19750, kind: "between" },
  { startMs: 22100, endMs: 23000, kind: "between" },
  { startMs: 28600, endMs: 30000, kind: "between" },
  { startMs: 33100, endMs: 33500, kind: "between" },
  { startMs: 36800, endMs: 37700, kind: "between" },
  { startMs: 41300, endMs: 41700, kind: "between" },
  { startMs: 45800, endMs: 48000, kind: "trailing" },
] as const;

/**
 * The default gap length `findSilences` counts as dead air (`DEFAULT_MIN_MS` in that file). Kept in
 * sync by `fixture.test.ts` rather than imported, because importing the tool would drag the Supabase
 * admin client and the whole `ai` SDK into a build script that needs neither.
 */
export const FIND_SILENCES_DEFAULT_MIN_MS = 600;

export interface FixtureVariant {
  /** Stable id — the value a section uses for radio/segmented-control state. */
  readonly id: string;
  /** The prompt this variant answers, verbatim from DESIGN-DIRECTION §6.3's segmented control. */
  readonly prompt: string;
  /** Minimum gap length that counts as dead air, in ms. 0 = every detected pause. */
  readonly minSilenceMs: number;
  /** Milliseconds of silence deliberately left in place at each cut. 0 = remove the whole span. */
  readonly keepRoomMs: number;
  /** Why this variant differs, in the page's own voice. */
  readonly note: string;
}

/**
 * §6.3's three-way segmented control, over one prompt. The thresholds are the honest part:
 *
 *   • `dead-air` runs the product's real default (600ms) and removes the whole span.
 *   • `room` runs the same detection but leaves the 200ms the prompt asks for.
 *   • `hard-cuts` drops the threshold entirely, so every pause in the take is cut — no invented
 *     number, just "all of them" instead of "the long ones".
 */
export const FIXTURE_VARIANTS: readonly FixtureVariant[] = [
  {
    id: "dead-air",
    prompt: "cut the dead air",
    minSilenceMs: FIND_SILENCES_DEFAULT_MIN_MS,
    keepRoomMs: 0,
    note: "Every pause longer than 600ms, removed whole.",
  },
  {
    id: "room",
    prompt: "cut the dead air, keep 200ms of room",
    minSilenceMs: FIND_SILENCES_DEFAULT_MIN_MS,
    keepRoomMs: 200,
    note: "The same pauses, with 200ms of silence left at every cut.",
  },
  {
    id: "hard-cuts",
    prompt: "cut the dead air, hard cuts",
    minSilenceMs: 0,
    keepRoomMs: 0,
    note: "No threshold — every pause in the take is cut, including the short breaths.",
  },
] as const;

/** The variant §6.2's set-piece animates. Its numbers are the ones §2.2 names: 0:48 → 0:39. */
export const HEADLINE_VARIANT_ID = "dead-air" as const;

/** One silence span in ticks, after the variant's threshold and room padding are applied. */
export interface RemovalSpan {
  startTick: Tick;
  endTick: Tick;
  kind: SilenceKind;
}

/**
 * The spans a variant actually deletes, in SOURCE ticks.
 *
 * The room padding is applied where a listener would want it: a `leading`/`between` gap keeps its
 * tail so the next line is not clipped off its own breath, and a `trailing` gap keeps its head so
 * the take does not end on the last syllable. A padded span that would collapse to nothing is
 * dropped rather than emitted as a degenerate command — the reducer would (correctly) throw, and a
 * fixture whose input can produce an invalid batch is a fixture that will break the build later.
 */
export function removalSpans(variant: FixtureVariant): RemovalSpan[] {
  const out: RemovalSpan[] = [];
  for (const s of FIXTURE_SILENCES_MS) {
    if (s.endMs - s.startMs < variant.minSilenceMs) continue;
    const startMs = s.kind === "trailing" ? s.startMs + variant.keepRoomMs : s.startMs;
    const endMs = s.kind === "trailing" ? s.endMs : s.endMs - variant.keepRoomMs;
    if (endMs <= startMs) continue;
    out.push({ startTick: msToTicks(startMs), endTick: msToTicks(endMs), kind: s.kind });
  }
  return out;
}
