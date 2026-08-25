/**
 * lib/edl/migrate.ts — registered v1 → Edl.2 upgrade (docs/CANONICAL-IR-SPEC.md §4.5).
 *
 * Run on load so every saved project keeps working: it parses the as-built v1 EDL
 * (lib/ai/schema/edl.ts), converts float-ms → integer ticks (lossless at tps=30000),
 * groups flat clips by `trackIndex` into OTIO `Track[]`, inserts explicit `Gap`s wherever
 * v1's `timelineStartMs` left a hole, and maps `chapters` → `markers`.
 */
import { msToTicks, TICKS_PER_SECOND } from "./time";
import { Edl } from "./schema";
import { Edl as LegacyEdlV1 } from "@/lib/ai/schema/edl";

export function upgradeEdlV1toV2(v1: unknown): Edl {
  const e = LegacyEdlV1.parse(v1);
  const tps = TICKS_PER_SECOND;
  const ms = (n: number) => msToTicks(n, tps);

  // Group clips by trackIndex, preserving a sorted track order.
  const byTrack = new Map<number, typeof e.clips>();
  for (const c of e.clips) {
    const arr = byTrack.get(c.trackIndex) ?? [];
    arr.push(c);
    byTrack.set(c.trackIndex, arr);
  }
  const trackIndices = [...byTrack.keys()].sort((a, b) => a - b);

  const tracks = trackIndices.map((idx) => {
    const sorted = [...byTrack.get(idx)!].sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    const items: unknown[] = [];
    let cursor = 0; // running tick position on this track
    for (const c of sorted) {
      const startTick = ms(c.timelineStartMs);
      if (startTick > cursor) {
        items.push({ schema: "Gap.1", id: `gap_${idx}_${cursor}`, durationTicks: startTick - cursor });
      }
      const inTick = ms(c.trim.startMs);
      const outTick = Math.max(inTick + 1, ms(c.trim.endMs)); // guarantee positive, in<out
      items.push({
        schema: "Clip.1",
        id: c.id,
        assetId: c.assetId,
        mediaRefs: { full: { schema: "MediaRef.1", url: "", availableInTick: 0, availableOutTick: outTick } },
        activeRefKey: "full",
        inTick,
        outTick,
        speed: c.speed,
        volume: c.volume,
        volumeEnvelope: [],
        effects: c.effects.map((fx) => ({
          schema: "Effect.1",
          id: fx.id,
          effectKey: fx.effectKey,
          params: fx.params,
          window:
            fx.startMs != null && fx.endMs != null
              ? { startTick: ms(fx.startMs), endTick: Math.max(ms(fx.startMs) + 1, ms(fx.endMs)) }
              : undefined,
          enabled: true,
        })),
      });
      cursor = startTick + (outTick - inTick);
    }
    return { schema: "Track.1", id: `track_${idx}`, kind: "video", role: "main", items };
  });

  return Edl.parse({
    schema: "Edl.2",
    timebase: { ticksPerSecond: tps },
    durationTicks: ms(e.durationMs),
    revision: 0,
    tracks,
    transitions: e.transitions.map((t) => ({
      schema: "Transition.1",
      id: t.id,
      betweenClipIds: t.betweenClipIds,
      transitionKey: t.transitionKey,
      durationTicks: Math.max(1, ms(t.durationMs)),
      params: t.params,
    })),
    overlays: e.overlays.map((o) => ({
      schema: "Overlay.1",
      id: o.id,
      overlayKey: o.overlayKey,
      window: { startTick: ms(o.startMs), endTick: Math.max(ms(o.startMs) + 1, ms(o.endMs)) },
      placement: o.placement,
      params: o.params,
    })),
    captions: e.captions.map((c) => ({
      schema: "Caption.1",
      id: c.id,
      window: { startTick: ms(c.startMs), endTick: Math.max(ms(c.startMs) + 1, ms(c.endMs)) },
      text: c.text,
      style: c.style,
      words: [],
    })),
    audioBeds: e.audioBeds.map((a) => ({
      schema: "AudioBed.1",
      id: a.id,
      assetId: a.assetId,
      window: { startTick: ms(a.startMs), endTick: Math.max(ms(a.startMs) + 1, ms(a.endMs)) },
      volume: a.volume,
      volumeEnvelope: [],
      loop: a.loop,
    })),
    markers: e.chapters.map((ch) => ({
      schema: "Marker.1",
      id: ch.id,
      atTick: ms(ch.startMs),
      title: ch.title,
      color: "BLUE",
      kind: "chapter",
    })),
    outputs: e.outputs.map((o) => ({
      aspect: o.aspect,
      maxTicks: o.maxMs != null ? ms(o.maxMs) : undefined,
    })),
    looksApplied: e.looksApplied.map((l) => ({
      schema: "Look.1",
      id: l.id,
      lookKey: l.lookKey,
      targetClipIds: l.targetClipIds,
      params: l.params,
    })),
    metadata: e.metadata,
  });
}
