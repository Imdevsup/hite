import type { Edl } from "@/lib/edl/schema";
import { allClipPositions } from "@/lib/edl/query";

/**
 * WHAT THE AI TOUCHED — ART-DIRECTION §13, "the change diff".
 *
 * §13 sanctions exactly two motions in the editor beyond the strict duration/easing subset, and this
 * is the first: "When an AI edit lands, every touched clip gets a 1px `--color-accent` outline
 * holding 400 ms and fading over 600 ms, and the picture hard-cuts from before to after. Today the
 * user cannot see what the AI touched."
 *
 * Everything here is derived by comparing two real Edl.2 objects — the one on screen before the turn
 * and the one the route returned. Nothing is reported by the model and nothing is guessed: a clip is
 * "touched" when its identity, its position on the timeline, its trim, its speed or its effect list
 * actually differ. That matters because the planner's own `changes` strings are prose it wrote, and
 * prose is not evidence about which block on the strip moved.
 */

/** The comparable state of one clip: everything a command can change about it. */
function fingerprint(clip: { id: string; inTick: number; outTick: number; speed: number; effects: readonly { effectKey: string }[] }, startTick: number): string {
  const keys = clip.effects.map((e) => e.effectKey).join(",");
  return `${startTick}|${clip.inTick}|${clip.outTick}|${clip.speed}|${keys}`;
}

/**
 * The ids of every clip in `next` that is new or differs from its counterpart in `prev`.
 *
 * A clip REMOVED by the turn has no id in `next` and so cannot be outlined — there is nothing left on
 * screen to outline. It still shows, because removing a clip moves everything downstream of it, and
 * those clips are reported here by their changed start tick. That is why position is part of the
 * fingerprint rather than only the trim.
 */
export function touchedClipIds(prev: Edl | null, next: Edl): string[] {
  if (!prev) return [];
  const before = new Map(allClipPositions(prev).map((p) => [p.clip.id, fingerprint(p.clip, p.startTick)]));
  const touched: string[] = [];
  for (const pos of allClipPositions(next)) {
    const was = before.get(pos.clip.id);
    if (was === undefined || was !== fingerprint(pos.clip, pos.startTick)) touched.push(pos.clip.id);
  }
  return touched;
}

/**
 * Where to put the playhead so the user SEES the change.
 *
 * §13 asks the picture to hard-cut from before to after. It does that on its own — swapping the
 * compiled IR under the player changes the frame in one frame, with no transition anywhere in the
 * path — but only if the playhead is somewhere the edit actually altered. Landing on the first
 * touched clip is what turns "the timeline changed" into "look at what changed".
 *
 * Returns null when nothing was touched, in which case the playhead must not move: moving it would
 * imply an edit that did not happen.
 */
export function firstTouchedStartTick(next: Edl, touched: readonly string[]): number | null {
  if (touched.length === 0) return null;
  const ids = new Set(touched);
  let earliest: number | null = null;
  for (const pos of allClipPositions(next)) {
    if (!ids.has(pos.clip.id)) continue;
    if (earliest === null || pos.startTick < earliest) earliest = pos.startTick;
  }
  return earliest;
}
