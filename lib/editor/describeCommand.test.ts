import { describe, expect, test } from "vitest";
import { describeCommand } from "./describeCommand";
import { AiEditCommand, UiOnlyCommand, type EditCommand } from "@/lib/edl/commands";

describe("describeCommand", () => {
  test("maps every AiEditCommand member to a non-empty label", () => {
    // One representative per AI command type — guards against an unhandled case slipping the diff UI.
    const samples: EditCommand[] = [
      { type: "ADD_CLIP", assetId: "a", trackId: "t", atTick: 0, inTick: 0, outTick: 100 },
      { type: "REMOVE_CLIP", clipId: "c", ripple: true },
      { type: "MOVE_CLIP", clipId: "c", toTrackId: "t", atTick: 0 },
      { type: "SPLIT_CLIP", clipId: "c", atTick: 50 },
      { type: "TRIM_CLIP", clipId: "c", edge: "in", toTick: 10 },
      { type: "SET_CLIP_SPEED", clipId: "c", speed: 2 },
      { type: "PROPOSE_CUTS", clips: [{ assetId: "a", inTick: 0, outTick: 10, speed: 1, volume: 1 }] },
      { type: "ADD_EFFECT", target: "all", effectKey: "saturation-up", params: {} },
      { type: "ADD_TRANSITION", betweenClipIds: ["a", "b"], transitionKey: "fade", durationTicks: 1000, params: {} },
      { type: "ADD_OVERLAY", overlayKey: "skull", window: { startTick: 0, endTick: 100 }, placement: { mode: "center" }, params: {} },
      { type: "COMPOSE_LOOK", lookKey: "look-a24" },
      { type: "ADD_CAPTION", window: { startTick: 0, endTick: 100 }, text: "hello world this is long", style: "default" },
      { type: "ADD_AUDIO_BED", assetId: "a", window: { startTick: 0, endTick: 100 }, volume: 0.4, loop: false },
      { type: "ADD_MARKER", atTick: 0, title: "Drop", color: "BLUE", kind: "comment" },
      { type: "SET_OUTPUT_VARIANT", aspect: "9:16" },
    ];
    for (const cmd of samples) {
      const label = describeCommand(cmd);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe("Edit"); // the fallback should never be hit for known types
    }
    // every AiEditCommand union member is represented above
    expect(samples.length).toBe(AiEditCommand.options.length);
  });

  test("maps every UiOnlyCommand member to a non-empty, non-fallback label", () => {
    // One representative per UI-only command type — guards the undo-history labels (incl. REMOVE_AUDIO_BED).
    const samples: EditCommand[] = [
      { type: "SET_CLIP_VOLUME", clipId: "c", volume: 0.5 },
      { type: "REMOVE_EFFECT", clipId: "c", effectId: "fx" },
      { type: "REMOVE_TRANSITION", transitionId: "xf" },
      { type: "REMOVE_OVERLAY", overlayId: "ov" },
      { type: "REMOVE_CAPTION", captionId: "cap" },
      { type: "REMOVE_AUDIO_BED", audioBedId: "ab" },
      { type: "CLEAR_LOOKS" },
      { type: "SET_CAPTION_STYLE", captionId: "cap", style: "bold" },
      { type: "ADJUST_WORD_TIMING", captionId: "cap", startTick: 0, endTick: 10 },
    ];
    for (const cmd of samples) {
      const label = describeCommand(cmd);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe("Edit");
    }
    expect(samples.length).toBe(UiOnlyCommand.options.length);
  });

  test("includes the effect/look key in the label", () => {
    expect(describeCommand({ type: "ADD_EFFECT", target: "all", effectKey: "grain-fine", params: {} })).toContain("grain-fine");
    expect(describeCommand({ type: "COMPOSE_LOOK", lookKey: "look-a24" })).toContain("look-a24");
  });

  test("truncates long caption text", () => {
    const label = describeCommand({ type: "ADD_CAPTION", window: { startTick: 0, endTick: 100 }, text: "x".repeat(80), style: "default" });
    expect(label.length).toBeLessThan(60);
  });
});
