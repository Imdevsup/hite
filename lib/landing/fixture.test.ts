/**
 * lib/landing/fixture.test.ts — the gate DESIGN-DIRECTION §7.3 asks for.
 *
 * "A snapshot test fails the build if the generated output changes without the fixture changing."
 * Two failures this catches, and they are the whole reason the file exists:
 *
 *   1. Someone edits `public/landing/*.json` by hand to make a number nicer. The page would then be
 *      showing a timeline `reduceBatch` never produced — a fabricated demo.
 *   2. Someone changes the reducer (ripple semantics, split rounding, normalisation) and the
 *      committed artifact silently becomes a lie about the current pipeline.
 *
 * The comparison is byte-for-byte against a fresh run of the real generator, so neither can pass.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reduceBatch } from "@/lib/edl/reducer";
import { Edl } from "@/lib/edl/schema";
import { allClipPositions } from "@/lib/edl/query";
import { TICKS_PER_SECOND, msToTicks } from "@/lib/edl/time";
import { buildMechanismFixture, serializeFixture, toDisplayFixture } from "./build-fixture";
import {
  LANDING_FIXTURE_DISPLAY_PATH,
  LANDING_FIXTURE_PATH,
  LANDING_FIXTURE_URL,
} from "./fixture-path";
import {
  FIND_SILENCES_DEFAULT_MIN_MS,
  FIXTURE_SILENCES_MS,
  FIXTURE_SOURCE_TICKS,
  FIXTURE_VARIANTS,
  HEADLINE_VARIANT_ID,
} from "./fixture-source";
import { MECHANISM, MECHANISM_HEADLINE, MECHANISM_SOURCE } from "./fixture";
import { ticksToTimecode } from "./format";

const readArtifact = (relPath: string): string => readFileSync(join(process.cwd(), relPath), "utf8");

describe("landing fixture provenance", () => {
  it("the committed artifacts are byte-identical to a fresh run of the real generator", () => {
    const fixture = buildMechanismFixture();
    expect(readArtifact(LANDING_FIXTURE_PATH)).toBe(serializeFixture(fixture));
    expect(readArtifact(LANDING_FIXTURE_DISPLAY_PATH)).toBe(
      serializeFixture(toDisplayFixture(fixture, LANDING_FIXTURE_URL)),
    );
  });

  it("the generator is deterministic — two runs produce the same bytes", () => {
    expect(serializeFixture(buildMechanismFixture())).toBe(serializeFixture(buildMechanismFixture()));
  });

  it("every committed EDL is a valid Edl.2", () => {
    const fixture = buildMechanismFixture();
    expect(() => Edl.parse(fixture.source.edl)).not.toThrow();
    for (const v of fixture.variants) expect(() => Edl.parse(v.edl)).not.toThrow();
  });

  it("replaying the committed commands through reduceBatch reproduces the committed EDL", () => {
    // The provenance claim, restated from outside the generator: these exact commands, this exact
    // reducer, that exact timeline. `contentHash` excludes `revision`, so it compares CONTENT.
    const fixture = buildMechanismFixture();
    for (const variant of fixture.variants) {
      const replayed = reduceBatch(fixture.source.edl, variant.commands).edl;
      expect(replayed.contentHash, variant.id).toBe(variant.edl.contentHash);
      expect(replayed.durationTicks, variant.id).toBe(variant.durationTicks);
    }
  });

  it("stays inside the 40-command batch cap the vocabulary enforces", () => {
    // `EditBatch` caps a turn at 40 commands (lib/edl/commands.ts). A fixture that exceeded it would
    // be depicting an edit the product could not actually accept in one batch.
    for (const v of buildMechanismFixture().variants) expect(v.commandCount, v.id).toBeLessThanOrEqual(40);
  });
});

describe("landing fixture — the numbers the page prints", () => {
  it("the headline edit is 0:48 → 0:39, and both strings come from the artifact", () => {
    // DESIGN-DIRECTION §2.2. These are the two numerals in the set-piece; if either drifts, the
    // section's whole claim ("the page loses nine seconds of its own width") stops being true.
    expect(MECHANISM_SOURCE.timecode).toBe("0:48");
    expect(MECHANISM_HEADLINE.timecode).toBe("0:39");
    expect(MECHANISM_HEADLINE.removedTimecode).toBe("0:09");
    expect(MECHANISM.headlineVariantId).toBe(HEADLINE_VARIANT_ID);
  });

  it("the nine removed seconds are exactly the dead air over the product's own threshold", () => {
    const overThreshold = FIXTURE_SILENCES_MS.filter(
      (s) => s.endMs - s.startMs >= FIND_SILENCES_DEFAULT_MIN_MS,
    ).reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
    expect(overThreshold).toBe(9000);
    expect(MECHANISM_HEADLINE.removedTicks).toBe(msToTicks(overThreshold));
    expect(MECHANISM_SOURCE.durationTicks - MECHANISM_HEADLINE.removedTicks).toBe(
      MECHANISM_HEADLINE.durationTicks,
    );
  });

  it("timecodes are what the one formatter produces for the generated tick counts", () => {
    // Guards the §7.3 rule from the other side: a component that formatted its own ticks could print
    // a different string than the artifact carries. There is one formatter, and this is it.
    expect(MECHANISM_SOURCE.timecode).toBe(ticksToTimecode(MECHANISM_SOURCE.durationTicks));
    for (const v of MECHANISM.variants) {
      expect(v.timecode, v.id).toBe(ticksToTimecode(v.durationTicks));
      expect(v.removedTimecode, v.id).toBe(ticksToTimecode(v.removedTicks));
    }
  });

  it("the three §6.3 variants are genuinely different timelines", () => {
    // A segmented control whose options render the same thing is a fake control. Each option must
    // land on its own duration AND its own clip count or cut positions.
    const durations = MECHANISM.variants.map((v) => v.durationTicks);
    expect(new Set(durations).size).toBe(MECHANISM.variants.length);
    for (const v of MECHANISM.variants) {
      expect(v.durationTicks, v.id).toBeLessThan(MECHANISM_SOURCE.durationTicks);
      expect(v.commandCount, v.id).toBeGreaterThan(0);
    }
    expect(MECHANISM.variants.map((v) => v.prompt)).toEqual(FIXTURE_VARIANTS.map((v) => v.prompt));
  });

  it("clip geometry is contiguous, gapless, and sums to the stated duration", () => {
    // The lanes are drawn straight off these rectangles. A hole or an overlap would render a
    // timeline the reducer would never produce — Edl.2 tracks are strictly sequential (§4.7).
    for (const v of MECHANISM.variants) {
      expect(v.clips.length, v.id).toBe(v.clipCount);
      expect(v.clips[0].startTick, v.id).toBe(0);
      for (let i = 1; i < v.clips.length; i++) {
        expect(v.clips[i].startTick, `${v.id} clip ${i}`).toBe(v.clips[i - 1].endTick);
      }
      expect(v.clips[v.clips.length - 1].endTick, v.id).toBe(v.durationTicks);
      const summed = v.clips.reduce((s, c) => s + c.durationTicks, 0);
      expect(summed, v.id).toBe(v.durationTicks);
      expect(v.cutTicks, v.id).toEqual(v.clips.slice(1).map((c) => c.startTick));
    }
  });

  it("clip geometry matches what the EDL position query derives, not a stored copy", () => {
    // Position in Edl.2 is DERIVED. If the artifact's rectangles ever stopped agreeing with
    // `allClipPositions`, the page would be drawing a timeline the editor does not have.
    for (const variant of buildMechanismFixture().variants) {
      const derived = allClipPositions(variant.edl).map((p) => ({
        id: p.clip.id,
        startTick: p.startTick,
        endTick: p.endTick,
      }));
      expect(variant.clips.map((c) => ({ id: c.id, startTick: c.startTick, endTick: c.endTick })), variant.id).toEqual(
        derived,
      );
    }
  });

  it("the frame ruler agrees with the timebase: 48 seconds is 1440 frames at 30fps", () => {
    // §2.1's unit. 1 frame = 4px and the content column is exactly 10 seconds only if this holds.
    expect(MECHANISM_SOURCE.durationTicks).toBe(48 * TICKS_PER_SECOND);
    expect(MECHANISM_SOURCE.durationFrames).toBe(48 * MECHANISM.fps);
    expect(MECHANISM.fps).toBe(30);
  });
});

describe("landing fixture honesty", () => {
  it("declares that no footage exists", () => {
    // §11 T0: `public/` ships no video. A consumer that reads `hasMedia` cannot accidentally render
    // a program frame that does not exist, and nothing here can quietly start claiming one does.
    expect(MECHANISM.asset.hasMedia).toBe(false);
    for (const track of buildMechanismFixture().source.edl.tracks) {
      for (const item of track.items) {
        if (item.schema === "Clip.1") expect(item.mediaRefs.full.url).toBe("");
      }
    }
  });

  it("the display projection carries no EDL — the perf budget depends on it", () => {
    // §12 caps landing client JS at 140KB gzipped and a JSON module import is not tree-shaken.
    const display = JSON.parse(readArtifact(LANDING_FIXTURE_DISPLAY_PATH)) as Record<string, unknown>;
    expect(JSON.stringify(display)).not.toContain('"Edl.2"');
    expect(display.fullArtifactUrl).toBe(LANDING_FIXTURE_URL);
  });

  it("the fixture never claims beat analysis", () => {
    // Beats are not wired (`lib/render/resolver.ts` says so in its own header). This edit is
    // transcript-shaped dead air and must stay that way until beats actually run.
    const everything = readArtifact(LANDING_FIXTURE_PATH).toLowerCase();
    for (const word of ["beat", "bpm", "drop", "sync"]) expect(everything).not.toContain(word);
    expect(new Set(FIXTURE_SILENCES_MS.map((s) => s.kind))).toEqual(
      new Set(["leading", "between", "trailing"]),
    );
  });

  it("the source take really is one untouched clip", () => {
    expect(MECHANISM_SOURCE.clipCount).toBe(1);
    expect(MECHANISM_SOURCE.clips[0].durationTicks).toBe(FIXTURE_SOURCE_TICKS);
  });

  it("the authored silences are chronological, non-overlapping, and inside the take", () => {
    // The generator maps a SOURCE position to a TIMELINE position by subtracting what has already
    // rippled away, which is only correct if the spans arrive in order and never overlap. Asserting
    // it here names the authoring mistake; without it, a reordered span surfaces as an opaque
    // "could not isolate" throw from deep inside the reduction.
    let previousEndMs = -1;
    for (const s of FIXTURE_SILENCES_MS) {
      expect(s.endMs, `${s.startMs}..${s.endMs}`).toBeGreaterThan(s.startMs);
      expect(s.startMs, `${s.startMs}..${s.endMs}`).toBeGreaterThanOrEqual(previousEndMs);
      previousEndMs = s.endMs;
    }
    expect(msToTicks(previousEndMs)).toBeLessThanOrEqual(FIXTURE_SOURCE_TICKS);
  });
});
