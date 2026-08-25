/**
 * lib/landing/build-fixture.ts — the generator behind the landing page's timeline proof.
 *
 * DESIGN-DIRECTION §7.3 (FIXTURE PROVENANCE — generated, never authored). Everything the Mechanism
 * (§6.2) and the falsifiable-timeline section (§6.3) display is produced HERE, by running the REAL
 * `reduceBatch` from `lib/edl/reducer.ts` over real `EditCommand[]`. Nothing is transcribed by hand.
 *
 * Pure — no filesystem, no clock, no randomness. `scripts/build-landing-fixtures.ts` is a thin
 * writer around it, and `fixture.test.ts` re-runs it and diffs the result against the committed
 * artifact, so the page can never print a number the pipeline would not produce.
 *
 * WHY SPLIT_CLIP + REMOVE_CLIP AND NOT PROPOSE_CUTS. §2.2 names the motion the page animates: the
 * clip rectangle splits at the silent spans (`SPLIT_CLIP`), the dead segments collapse, and
 * everything downstream slides left (`REMOVE_CLIP { ripple: true }` — the vocabulary's real default,
 * `lib/edl/commands.ts:53`). That is the canonical command sequence for this edit and the one the
 * timeline UI dispatches per gesture. It is deliberately NOT a claim about how a single planner turn
 * would reach the same EDL: `SPLIT_CLIP` mints its right-hand child with a derived id
 * (`splitChildId`), which a model cannot reference inside the same batch, so the planner reaches an
 * identical timeline through `PROPOSE_CUTS` instead. Both are real; this file shows the one the
 * animation depicts, and `prompts.test.ts` exercises the one the planner emits.
 *
 * DERIVING THE COMMANDS. Command ids are resolved by reducing one command at a time and reading the
 * real EDL back — exactly how the UI works, and the only way to address a split's right-hand child
 * without hand-copying a hash. The accumulated list is then replayed as ONE batch from the pristine
 * source EDL, and the two results must agree on `contentHash` or this module throws. That
 * equivalence is the provenance guarantee: the committed `EditCommand[]` really does produce the
 * committed EDL in a single atomic reduction.
 */
import type { EditCommand } from "@/lib/edl/commands";
import { reduceBatch } from "@/lib/edl/reducer";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { allClipPositions, clipAtTick } from "@/lib/edl/query";
import { msToTicks, type Tick } from "@/lib/edl/time";
import { ticksToLandingFrames, ticksToTimecode, LANDING_FPS } from "./format";
import {
  FIXTURE_ASSET_ID,
  FIXTURE_SILENCES_MS,
  FIXTURE_SOURCE_TICKS,
  FIXTURE_VARIANTS,
  HEADLINE_VARIANT_ID,
  removalSpans,
  type FixtureVariant,
  type SilenceKind,
} from "./fixture-source";

/** Bumped when the artifact's shape changes, so a stale committed JSON fails loudly, not subtly. */
export const LANDING_FIXTURE_SCHEMA = "LandingFixture.1" as const;

/** One clip's derived timeline geometry — the rectangle a lane draws. */
export interface FixtureClip {
  id: string;
  /** Absolute timeline span. Position in Edl.2 is DERIVED (`lib/edl/query.ts`), never stored. */
  startTick: Tick;
  endTick: Tick;
  durationTicks: Tick;
  /** The same span on the page's frame ruler (§2.1), via the codebase's one ticks→frame conversion. */
  startFrame: number;
  endFrame: number;
  /** Which part of the source take survived here — what makes the cut list readable. */
  sourceInTick: Tick;
  sourceOutTick: Tick;
}

/** A silent span, in the coordinate space named by the field it sits on. */
export interface FixtureSpan {
  startTick: Tick;
  endTick: Tick;
  durationTicks: Tick;
  kind: SilenceKind;
}

export interface FixtureVariantResult {
  id: string;
  /** The visitor-facing prompt, verbatim from §6.3's segmented control. */
  prompt: string;
  note: string;
  /** The real commands, as reduced. This is the array the §6.2 `<pre>` quotes. */
  commands: EditCommand[];
  /** Pretty-printed `commands` — the exact text the `<pre>` displays (§7.3). */
  commandsJson: string;
  commandCount: number;
  /** Spans this variant deleted, in SOURCE ticks — the waveform regions that light up. */
  removed: FixtureSpan[];
  /** The resulting timeline. */
  durationTicks: Tick;
  durationFrames: number;
  timecode: string;
  removedTicks: Tick;
  removedTimecode: string;
  clipCount: number;
  clips: FixtureClip[];
  /** Interior cut edges on the RESULT timeline, in ticks — where the playhead crosses a splice. */
  cutTicks: Tick[];
  /** The EDL itself, straight out of `reduceBatch`. */
  edl: Edl;
}

export interface LandingFixture {
  schema: typeof LANDING_FIXTURE_SCHEMA;
  /** How this file came to exist, in one sentence — quotable by the page and by answer engines. */
  provenance: string;
  /** The page's ruler rate; the frame numbers below are computed at it. */
  fps: number;
  asset: {
    id: string;
    /** Always false at T0: `public/` ships no footage (§11). Consumers must draw media-offline. */
    hasMedia: boolean;
  };
  source: {
    durationTicks: Tick;
    durationFrames: number;
    timecode: string;
    clipCount: number;
    clips: FixtureClip[];
    /** Every silence the analysis found, in source ticks — the "before" waveform's quiet regions. */
    silences: FixtureSpan[];
    edl: Edl;
  };
  /** The variant §6.2 animates: `source.timecode` → this variant's `timecode`. */
  headlineVariantId: string;
  variants: FixtureVariantResult[];
}

const PROVENANCE =
  "Generated by scripts/build-landing-fixtures.ts: real EditCommands reduced by lib/edl/reducer.ts. " +
  "A recorded example on a take with no media file — the timeline is real, the picture is not shipped.";

/** Derived timeline geometry for every clip in an EDL, reusing the codebase's position query. */
function clipsOf(edl: Edl): FixtureClip[] {
  return allClipPositions(edl).map((p) => ({
    id: p.clip.id,
    startTick: p.startTick,
    endTick: p.endTick,
    durationTicks: p.endTick - p.startTick,
    startFrame: ticksToLandingFrames(p.startTick),
    endFrame: ticksToLandingFrames(p.endTick),
    sourceInTick: p.clip.inTick,
    sourceOutTick: p.clip.outTick,
  }));
}

/**
 * The commands one variant needs, resolved against the live EDL (see the module header).
 *
 * Silences are walked in source order while tracking how much has already rippled away, so a span's
 * SOURCE position maps to its current TIMELINE position. A span that already starts on a clip edge
 * (the dead intro) or ends on one (the hanging outro) needs only one split — asking `SPLIT_CLIP` for
 * a cut at a clip's own boundary is `split_out_of_range`, by design.
 */
function commandsFor(sourceEdl: Edl, variant: FixtureVariant): { commands: EditCommand[]; edl: Edl } {
  const commands: EditCommand[] = [];
  let edl = sourceEdl;
  let rippledAway = 0;

  const push = (cmd: EditCommand): void => {
    commands.push(cmd);
    edl = reduceBatch(edl, [cmd]).edl;
  };

  for (const span of removalSpans(variant)) {
    const startTick = span.startTick - rippledAway;
    const endTick = span.endTick - rippledAway;

    const head = clipAtTick(edl, startTick);
    if (!head) throw new Error(`fixture: no clip at tick ${startTick} for variant "${variant.id}"`);
    if (startTick > head.startTick) push({ type: "SPLIT_CLIP", clipId: head.clip.id, atTick: startTick });

    const dead = clipAtTick(edl, startTick);
    if (!dead || dead.startTick !== startTick) {
      throw new Error(`fixture: split did not open a clip edge at ${startTick} for variant "${variant.id}"`);
    }
    if (endTick < dead.endTick) push({ type: "SPLIT_CLIP", clipId: dead.clip.id, atTick: endTick });

    const target = clipAtTick(edl, startTick);
    if (!target || target.startTick !== startTick || target.endTick !== endTick) {
      throw new Error(`fixture: could not isolate ${startTick}..${endTick} for variant "${variant.id}"`);
    }
    push({ type: "REMOVE_CLIP", clipId: target.clip.id, ripple: true });

    rippledAway += span.endTick - span.startTick;
  }

  return { commands, edl };
}

function buildVariant(sourceEdl: Edl, variant: FixtureVariant): FixtureVariantResult {
  const { commands, edl: stepwise } = commandsFor(sourceEdl, variant);

  // The provenance guarantee: the committed command list, replayed as ONE atomic batch from the
  // pristine source, must land on the identical timeline the stepwise derivation reached.
  const edl = reduceBatch(sourceEdl, commands).edl;
  if (edl.contentHash !== stepwise.contentHash) {
    throw new Error(
      `fixture: variant "${variant.id}" is not reproducible as one batch ` +
        `(${edl.contentHash} vs ${stepwise.contentHash})`,
    );
  }

  const clips = clipsOf(edl);
  const removedTicks = sourceEdl.durationTicks - edl.durationTicks;
  return {
    id: variant.id,
    prompt: variant.prompt,
    note: variant.note,
    commands,
    commandsJson: JSON.stringify(commands, null, 2),
    commandCount: commands.length,
    removed: removalSpans(variant).map((s) => ({
      startTick: s.startTick,
      endTick: s.endTick,
      durationTicks: s.endTick - s.startTick,
      kind: s.kind,
    })),
    durationTicks: edl.durationTicks,
    durationFrames: ticksToLandingFrames(edl.durationTicks),
    timecode: ticksToTimecode(edl.durationTicks),
    removedTicks,
    removedTimecode: ticksToTimecode(removedTicks),
    clipCount: clips.length,
    clips,
    // Every clip edge except the timeline's own start and end — the splices a viewer can point at.
    cutTicks: clips.slice(1).map((c) => c.startTick),
    edl,
  };
}

/** Build the whole artifact. Deterministic: same input, byte-identical output, every run. */
export function buildMechanismFixture(): LandingFixture {
  const sourceEdl = emptyEdl2(FIXTURE_ASSET_ID, FIXTURE_SOURCE_TICKS);
  const variants = FIXTURE_VARIANTS.map((v) => buildVariant(sourceEdl, v));

  if (!variants.some((v) => v.id === HEADLINE_VARIANT_ID)) {
    throw new Error(`fixture: headline variant "${HEADLINE_VARIANT_ID}" is not in FIXTURE_VARIANTS`);
  }

  return {
    schema: LANDING_FIXTURE_SCHEMA,
    provenance: PROVENANCE,
    fps: LANDING_FPS,
    asset: { id: FIXTURE_ASSET_ID, hasMedia: false },
    source: {
      durationTicks: sourceEdl.durationTicks,
      durationFrames: ticksToLandingFrames(sourceEdl.durationTicks),
      timecode: ticksToTimecode(sourceEdl.durationTicks),
      clipCount: allClipPositions(sourceEdl).length,
      clips: clipsOf(sourceEdl),
      silences: FIXTURE_SILENCES_MS.map((s) => ({
        startTick: msToTicks(s.startMs),
        endTick: msToTicks(s.endMs),
        durationTicks: msToTicks(s.endMs) - msToTicks(s.startMs),
        kind: s.kind,
      })),
      edl: sourceEdl,
    },
    headlineVariantId: HEADLINE_VARIANT_ID,
    variants,
  };
}

/**
 * The display projection: everything the page renders, minus the four Edl.2 documents.
 *
 * Two artifacts rather than one, for a reason the performance budget makes concrete (§12: landing
 * client JS ≤140KB gzipped). A JSON module import is not tree-shaken — importing the full artifact
 * from any component that ends up in a client island ships all four EDLs to the browser, and no
 * component displays an EDL. So `fixture.ts` imports THIS, and the full artifact stays a static file
 * at `/landing/mechanism.json`: fetchable, quotable by an answer engine, and the thing a sceptic
 * checks the page against. Both are generated in the same pass and both are drift-tested, so the
 * small one can never say something the reduced timeline does not.
 */
export type LandingFixtureDisplay = Omit<LandingFixture, "source" | "variants"> & {
  source: Omit<LandingFixture["source"], "edl">;
  variants: Omit<FixtureVariantResult, "edl">[];
  /** Where the full artifact — EDLs included — can be read. */
  fullArtifactUrl: string;
};

/**
 * Drop the `edl` field, keeping every other key (and its order) intact.
 *
 * Written as an omit rather than by listing the fields to keep: a projection that enumerates its
 * output silently drops any field added to `FixtureVariantResult` later, and the page would then be
 * missing generated data with nothing failing. The one cast is what `delete` costs; the shape is
 * still checked at both call sites by `LandingFixtureDisplay`.
 */
function withoutEdl<T extends { edl: unknown }>(value: T): Omit<T, "edl"> {
  const copy: Record<string, unknown> = { ...value };
  delete copy.edl;
  return copy as Omit<T, "edl">;
}

export function toDisplayFixture(fixture: LandingFixture, fullArtifactUrl: string): LandingFixtureDisplay {
  const { source, variants, ...rest } = fixture;
  return {
    ...rest,
    source: withoutEdl(source),
    variants: variants.map(withoutEdl),
    fullArtifactUrl,
  };
}

/** The exact bytes a generated artifact must contain. One definition, two consumers. */
export function serializeFixture(fixture: LandingFixture | LandingFixtureDisplay): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
