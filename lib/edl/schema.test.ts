import { describe, expect, test } from "vitest";
import { Edl, emptyEdl2 } from "./schema";
import { upgradeEdlV1toV2 } from "./migrate";
import { msToTicks } from "./time";
import { emptyEdl as emptyEdlV1 } from "@/lib/ai/schema/edl";

describe("Edl.2 schema", () => {
  test("emptyEdl2 → one full-span clip on one video track, parses", () => {
    const edl = emptyEdl2("a1", 300_000); // 10s
    expect(() => Edl.parse(edl)).not.toThrow();
    expect(edl.schema).toBe("Edl.2");
    expect(edl.tracks).toHaveLength(1);
    expect(edl.tracks[0].items).toHaveLength(1);
    const clip = edl.tracks[0].items[0] as { schema: string; inTick: number; outTick: number };
    expect(clip.schema).toBe("Clip.1");
    expect(clip.inTick).toBe(0);
    expect(clip.outTick).toBe(300_000);
  });

  test("rejects float (non-integer) ticks", () => {
    expect(() => Edl.parse({ ...emptyEdl2("a", 300_000), durationTicks: 1.5 })).toThrow();
  });

  test("rejects an unknown overlay placement mode", () => {
    const e = emptyEdl2("a", 300_000) as unknown as Record<string, unknown>;
    e.overlays = [
      { schema: "Overlay.1", id: "o", overlayKey: "x", window: { startTick: 0, endTick: 100 }, placement: { mode: "weird" }, params: {} },
    ];
    expect(() => Edl.parse(e)).toThrow();
  });

  test("there is no timelineStartTick on clips (position is derived)", () => {
    const clip = emptyEdl2("a", 300_000).tracks[0].items[0] as Record<string, unknown>;
    expect("timelineStartTick" in clip).toBe(false);
    expect("timelineStartMs" in clip).toBe(false);
  });
});

describe("v1 → Edl.2 migration", () => {
  test("upgrades a seed v1 EDL to ticks losslessly", () => {
    const v2 = upgradeEdlV1toV2(emptyEdlV1("asset-x", 10_000)); // 10s in ms
    expect(v2.schema).toBe("Edl.2");
    expect(v2.durationTicks).toBe(msToTicks(10_000)); // 300000
    expect(v2.tracks).toHaveLength(1);
    const clip = v2.tracks[0].items[0] as { id: string; inTick: number; outTick: number };
    expect(clip.id).toBe("c0");
    expect(clip.inTick).toBe(0);
    expect(clip.outTick).toBe(300_000);
  });

  test("inserts an explicit Gap where v1 left a timelineStartMs hole", () => {
    const v1 = emptyEdlV1("a", 20_000) as unknown as { clips: unknown[] };
    v1.clips = [
      { id: "c0", assetId: "a", trim: { startMs: 0, endMs: 5_000 }, trackIndex: 0, timelineStartMs: 0, speed: 1, volume: 1, effects: [] },
      { id: "c1", assetId: "a", trim: { startMs: 0, endMs: 5_000 }, trackIndex: 0, timelineStartMs: 10_000, speed: 1, volume: 1, effects: [] },
    ];
    const v2 = upgradeEdlV1toV2(v1);
    const items = v2.tracks[0].items as { schema: string; durationTicks?: number }[];
    expect(items.map((i) => i.schema)).toEqual(["Clip.1", "Gap.1", "Clip.1"]);
    expect(items[1].durationTicks).toBe(msToTicks(5_000)); // 5s gap = 150000 ticks
  });

  test("chapters → markers; effect ms-windows → tick-windows", () => {
    const v1 = emptyEdlV1("a", 10_000) as unknown as { clips: { effects: unknown[] }[]; chapters: unknown[] };
    v1.clips[0].effects = [{ id: "fx1", effectKey: "rgb-split-hard", params: { strength: 8 }, startMs: 2_000, endMs: 3_000 }];
    v1.chapters = [{ id: "ch1", startMs: 4_000, title: "Drop" }];
    const v2 = upgradeEdlV1toV2(v1);
    expect(v2.markers).toEqual([
      { schema: "Marker.1", id: "ch1", atTick: msToTicks(4_000), title: "Drop", color: "BLUE", kind: "chapter" },
    ]);
    const fx = (v2.tracks[0].items[0] as { effects: { window?: { startTick: number; endTick: number } }[] }).effects[0];
    expect(fx.window).toEqual({ startTick: msToTicks(2_000), endTick: msToTicks(3_000) });
  });
});
