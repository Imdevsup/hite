import { describe, expect, test } from "vitest";
import { touchedClipIds, firstTouchedStartTick } from "./changeDiff";
import { reduceBatch } from "@/lib/edl/reducer";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { secToTicks } from "@/lib/edl/time";

/**
 * WHAT THE AI TOUCHED — §13's first sanctioned exception, tested through the REAL reducer.
 *
 * The property that matters is that "touched" is DERIVED, not reported. The planner's own `changes`
 * strings are prose it wrote about its own work; the outline on the strip has to be evidence. So
 * every case below builds its "after" by pushing real `EditCommand[]` through `reduceBatch` — the
 * same function the editor and the planner both mutate through — and asserts on what actually moved.
 */

const base = (): Edl => emptyEdl2("a1", secToTicks(48), "https://example.test/take.mp4");

/** `reduceBatch` answers `{ edl, forwardPatches, inversePatches }`; only the timeline matters here. */
const apply = (edl: Edl, commands: Parameters<typeof reduceBatch>[1]): Edl => reduceBatch(edl, commands).edl;

describe("touchedClipIds", () => {
  test("nothing changed means nothing is outlined", () => {
    const edl = base();
    expect(touchedClipIds(edl, edl)).toEqual([]);
  });

  test("a split marks both halves — one is new, the other's span changed", () => {
    const before = base();
    const after = apply(before, [{ type: "SPLIT_CLIP", clipId: "c0", atTick: secToTicks(20) }]);
    const touched = touchedClipIds(before, after);
    expect(touched.length).toBe(2);
  });

  test("a removal marks everything downstream of it, because a ripple moves them", () => {
    const before = apply(base(), [
      { type: "SPLIT_CLIP", clipId: "c0", atTick: secToTicks(16) },
      { type: "SPLIT_CLIP", clipId: "c0", atTick: secToTicks(8) },
    ]);
    const ids = before.tracks[0].items.map((i) => (i.schema === "Clip.1" ? i.id : null)).filter(Boolean) as string[];
    expect(ids.length).toBe(3);

    const after = apply(before, [{ type: "REMOVE_CLIP", clipId: ids[0], ripple: true }]);
    const touched = touchedClipIds(before, after);
    // The removed clip is gone and cannot be outlined; the two that slid left are the change.
    expect(touched).not.toContain(ids[0]);
    expect(touched).toContain(ids[1]);
    expect(touched).toContain(ids[2]);
  });

  test("an effect on one clip marks that clip and no other", () => {
    const before = apply(base(), [{ type: "SPLIT_CLIP", clipId: "c0", atTick: secToTicks(24) }]);
    const ids = before.tracks[0].items.map((i) => (i.schema === "Clip.1" ? i.id : null)).filter(Boolean) as string[];
    const after = apply(before, [
      { type: "ADD_EFFECT", target: { clipId: ids[1] }, effectKey: "zoom-punch", params: {} },
    ]);
    expect(touchedClipIds(before, after)).toEqual([ids[1]]);
  });

  test("with no previous timeline nothing is claimed as a change", () => {
    // The first AI turn on a fresh project has nothing to diff against, and inventing a full-timeline
    // outline would say "HITE changed all of this" about a timeline it created.
    expect(touchedClipIds(null, base())).toEqual([]);
  });
});

describe("firstTouchedStartTick", () => {
  test("is the earliest touched clip's start, so the cut is one the user can see", () => {
    const before = apply(base(), [
      { type: "SPLIT_CLIP", clipId: "c0", atTick: secToTicks(30) },
      { type: "SPLIT_CLIP", clipId: "c0", atTick: secToTicks(10) },
    ]);
    const ids = before.tracks[0].items.map((i) => (i.schema === "Clip.1" ? i.id : null)).filter(Boolean) as string[];
    const after = apply(before, [
      { type: "ADD_EFFECT", target: { clipId: ids[2] }, effectKey: "zoom-punch", params: {} },
      { type: "ADD_EFFECT", target: { clipId: ids[1] }, effectKey: "zoom-punch", params: {} },
    ]);
    const touched = touchedClipIds(before, after);
    expect(firstTouchedStartTick(after, touched)).toBe(secToTicks(10));
  });

  test("returns null when nothing was touched — the playhead must not move", () => {
    expect(firstTouchedStartTick(base(), [])).toBeNull();
  });
});
