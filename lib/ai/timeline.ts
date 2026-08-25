import type { Edl } from "@/lib/edl/schema";
import { allClipPositions } from "@/lib/edl/query";
import { tickToMs } from "@/lib/edl/time";

/**
 * Compact, token-cheap summary of the timeline for the planner's context.
 *
 * Positions are TICKS (suffix `t`) — the unit every command field takes — with ms in parentheses for
 * readability. A ms-only summary made the model READ ms and WRITE ticks in the same turn, a 30× unit
 * seam that put "cut at 0:14" 30× off whenever it copied a number straight through.
 *
 * ONE owner, deliberately: /api/plan and /api/refine each held a byte-identical private copy, and
 * the critique pass (lib/ai/agents/critique.ts) has to describe the RESULT of a batch in exactly the
 * format the model read the PARENT in — otherwise "compare this against what you asked for" is a
 * comparison across two different renderings of the same thing.
 */
export function summarizeEdl(edl: Edl): string {
  const positions = allClipPositions(edl);
  const head =
    `duration=${edl.durationTicks}t (${tickToMs(edl.durationTicks)}ms) tracks=${edl.tracks.length} clips=${positions.length} ` +
    `overlays=${edl.overlays.length} captions=${edl.captions.length} looks=${edl.looksApplied.length}`;
  const lines = positions.map((p, i) => {
    const fx = p.clip.effects.map((e) => e.effectKey).join(",") || "none";
    return (
      `clip ${i + 1}: id=${p.clip.id} asset=${p.clip.assetId} ` +
      `timeline=[${p.startTick}..${p.endTick}]t (${tickToMs(p.startTick)}..${tickToMs(p.endTick)}ms) fx=${fx}`
    );
  });
  return [head, ...lines].join("\n").slice(0, 6000);
}
