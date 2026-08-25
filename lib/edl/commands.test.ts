import { describe, expect, test } from "vitest";
import { AiEditCommand, EditBatch } from "./commands";

/**
 * The command schemas are the AI's input edge: whatever they accept, the reducer must then survive.
 * These lock in the CRUCIBLE audit's rejections — every input below used to parse cleanly and reach
 * the reducer, where it became a silent no-op or a silently-wrong timeline.
 */

const ok = (cmd: unknown) => AiEditCommand.safeParse(cmd).success;

describe("command schema — positional ticks are never negative", () => {
  test("a negative atTick is rejected (it silently appended the clip at the END of the track)", () => {
    expect(ok({ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: -90_000, inTick: 0, outTick: 60_000 })).toBe(false);
    expect(ok({ type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 0, inTick: 0, outTick: 60_000 })).toBe(true);
  });

  test("negative ticks are rejected on every other positional field too", () => {
    expect(ok({ type: "MOVE_CLIP", clipId: "c0", toTrackId: "track_0", atTick: -1 })).toBe(false);
    expect(ok({ type: "SPLIT_CLIP", clipId: "c0", atTick: -1 })).toBe(false);
    expect(ok({ type: "TRIM_CLIP", clipId: "c0", edge: "out", toTick: -1 })).toBe(false);
    expect(ok({ type: "ADD_MARKER", atTick: -1, title: "x" })).toBe(false);
    expect(ok({ type: "ADD_CAPTION", window: { startTick: -1, endTick: 30_000 }, text: "x" })).toBe(false);
  });
});

describe("command schema — degenerate ranges are named, not clamped", () => {
  test("ADD_CLIP with outTick <= inTick is rejected, naming outTick", () => {
    const bad = AiEditCommand.safeParse({ type: "ADD_CLIP", assetId: "a", trackId: "t", atTick: 0, inTick: 120_000, outTick: 60_000 });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      // z.union buries member issues in unionErrors — assert the refine actually fired on outTick.
      const paths = bad.error.issues.flatMap((i) =>
        i.code === "invalid_union" ? i.unionErrors.flatMap((e) => e.issues.map((x) => x.path.join("."))) : [i.path.join(".")],
      );
      expect(paths).toContain("outTick");
    }
    expect(ok({ type: "ADD_CLIP", assetId: "a", trackId: "t", atTick: 0, inTick: 60_000, outTick: 120_000 })).toBe(true);
  });

  test("PROPOSE_CUTS with an inverted clip pair is rejected", () => {
    expect(ok({ type: "PROPOSE_CUTS", clips: [{ assetId: "primary", inTick: 200_000, outTick: 100_000 }] })).toBe(false);
    expect(ok({ type: "PROPOSE_CUTS", clips: [{ assetId: "primary", inTick: 100_000, outTick: 200_000 }] })).toBe(true);
  });

  test("an equal or inverted tick window is rejected (it renders in exactly zero frames)", () => {
    expect(ok({ type: "ADD_CAPTION", window: { startTick: 3000, endTick: 3000 }, text: "x" })).toBe(false);
    expect(ok({ type: "ADD_EFFECT", effectKey: "flash-white", window: { startTick: 500, endTick: 100 } })).toBe(false);
    expect(ok({ type: "ADD_EFFECT", effectKey: "flash-white", window: { startTick: 100, endTick: 500 } })).toBe(true);
  });

  test("zero-length durations are rejected", () => {
    expect(ok({ type: "ADD_TRANSITION", betweenClipIds: ["a", "b"], transitionKey: "fade", durationTicks: 0 })).toBe(false);
    expect(ok({ type: "SET_OUTPUT_VARIANT", aspect: "9:16", maxTicks: 0 })).toBe(false);
    expect(ok({ type: "SET_OUTPUT_VARIANT", aspect: "9:16", maxTicks: 1_800_000 })).toBe(true);
    expect(ok({ type: "SET_OUTPUT_VARIANT", aspect: "9:16" })).toBe(true);
  });
});

describe("command schema — a whole batch fails on one bad command", () => {
  test("one inverted ADD_CLIP rejects the batch (it never reaches the reducer)", () => {
    const batch = {
      summary: "cut the dead air",
      commands: [
        { type: "ADD_EFFECT", effectKey: "saturation-up" },
        { type: "ADD_CLIP", assetId: "a", trackId: "track_0", atTick: 0, inTick: 120_000, outTick: 60_000 },
      ],
    };
    expect(EditBatch.safeParse(batch).success).toBe(false);
  });
});
