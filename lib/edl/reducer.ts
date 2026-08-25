/**
 * lib/edl/reducer.ts — Layer 0→1, the ONE pure place the EDL mutates
 * (docs/CANONICAL-IR-SPEC.md §3.7, docs/DECISIONS.md §1.5).
 *
 * Pure: (Edl, EditCommand[]) → { edl, forwardPatches, inversePatches }. No I/O, no registry
 * calls, no Date.now/Math.random (CI-enforced). External facts (real media URLs, registry
 * validation, look expansion) are resolved at the boundary / compiler, not here.
 *
 * Undo model (deliberate reconciliation of the IR-SPEC vs COMMAND-SPEC fork): we persist BOTH
 *   • the semantic forward command batch (audit + replay-from-seed), and
 *   • Immer inverse patches (correct, simple in-memory undo — see lib/edl/history.ts).
 * This is strictly more robust than synthesising a precise inverse-command for every op.
 *
 * Position is DERIVED: a clip's timeline start is the running sum of preceding item durations
 * on its track; holes are explicit Gaps (§4.7). There is no stored timelineStartTick.
 *
 * FAIL LOUD. This is the one layer whose job is to reject degenerate input, and the product promise
 * is "type a change → the video changes": a silent no-op or a silently-wrong timeline is the worst
 * outcome there is, because the turn reports success and the bad EDL is persisted as the next
 * version. So an impossible command throws `CommandError` (the whole batch is a transaction and
 * rolls back) rather than being clamped into something technically valid.
 *
 * REMOVAL SEMANTICS (deliberately split, do not "unify" without changing callers): removals that
 * target a clip — REMOVE_CLIP, REMOVE_EFFECT — THROW on an unknown id, because a clip id is the
 * handle the AI just read off the timeline and a miss means it is editing a stale EDL. Removals of
 * decorations — REMOVE_TRANSITION/OVERLAY/CAPTION/AUDIO_BED — are idempotent no-ops, because
 * recompute() itself prunes transitions and the UI fires these from stale click targets.
 */
import { produceWithPatches, enablePatches, type Patch } from "immer";
import {
  Edl,
  type Edl as EdlType,
  type Clip,
  type Gap,
  type Track,
  type EffectInstance,
} from "./schema";
import type { EditCommand, ApplyTarget } from "./commands";
import {
  effectId,
  overlayId,
  lookId,
  transitionId,
  captionId,
  audioBedId,
  markerId,
  clipId,
  splitChildId,
  stableHash,
} from "./ids";

enablePatches();

export class CommandError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = "CommandError";
    this.kind = kind;
  }
}

// ───────────────────────── timeline helpers (derived position) ─────────────────────────
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const isClip = (i: Clip | Gap): i is Clip => i.schema === "Clip.1";
/** Plain deep copy of a (possibly Immer-draft) node — never reinsert a live proxy into the tree. */
function plain<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** A clip's duration on the timeline (source span / speed). speedRamp ignored in v1. */
function clipTimelineDur(c: Clip): number {
  return Math.max(1, Math.round((c.outTick - c.inTick) / (c.speed || 1)));
}

function itemDur(i: Clip | Gap): number {
  return isClip(i) ? clipTimelineDur(i) : i.durationTicks;
}
function trackDur(t: Track): number {
  return t.items.reduce((s, i) => s + itemDur(i), 0);
}
interface ClipLoc {
  track: Track;
  itemIdx: number;
  clip: Clip;
  startTick: number;
}
function locateClip(edl: EdlType, id: string): ClipLoc | null {
  for (const track of edl.tracks) {
    let cursor = 0;
    for (let i = 0; i < track.items.length; i++) {
      const it = track.items[i];
      if (isClip(it) && it.id === id) return { track, itemIdx: i, clip: it, startTick: cursor };
      cursor += itemDur(it);
    }
  }
  return null;
}
function ensureTrack(edl: EdlType, trackId: string): Track {
  let t = edl.tracks.find((x) => x.id === trackId);
  if (!t) {
    t = { schema: "Track.1", id: trackId, kind: "video", role: "main", items: [] };
    edl.tracks.push(t);
  }
  return t;
}
function insertAtTick(track: Track, atTick: number, item: Clip | Gap): void {
  let cursor = 0;
  for (let i = 0; i < track.items.length; i++) {
    if (cursor === atTick) {
      track.items.splice(i, 0, item);
      return;
    }
    const d = itemDur(track.items[i]);
    if (cursor < atTick && atTick < cursor + d) {
      throw new CommandError("insert_mid_item", `atTick ${atTick} falls inside an item; split first`);
    }
    cursor += d;
  }
  if (atTick > cursor) {
    track.items.push({ schema: "Gap.1", id: `gap_${track.id}_${cursor}`, durationTicks: atTick - cursor });
  }
  track.items.push(item);
}
/**
 * Position-snapping insert for MOVE_CLIP. Unlike insertAtTick (which demands an exact item
 * boundary and throws mid-item), this snaps `atTick` to the NEAREST boundary among the current
 * items and splices there. A drag from the UI feeds a continuous tick that almost never equals a
 * boundary, so requiring an exact match made same-track reorders (and most drops) throw
 * `insert_mid_item` and silently refuse to move. Trailing gaps past the end are dropped by
 * normalizeTrack, so dropping "after the last clip" lands at the end without a phantom gap.
 */
function insertSnapped(track: Track, atTick: number, item: Clip | Gap): void {
  let cursor = 0;
  let bestIdx = track.items.length;
  let bestDist = Math.abs(atTick - cursor); // boundary before item 0
  for (let i = 0; i < track.items.length; i++) {
    cursor += itemDur(track.items[i]);
    const dist = Math.abs(atTick - cursor); // boundary AFTER item i
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i + 1;
    }
  }
  track.items.splice(bestIdx, 0, item);
}
type VolumeEnvelope = Clip["volumeEnvelope"];

/** The envelope's gain at `atTick`, linearly interpolated and clamped at both ends — exactly how
 *  the renderer reads it (Remotion `interpolate` with extrapolate:"clamp"). */
function gainAtTick(env: VolumeEnvelope, atTick: number): number {
  const first = env[0];
  if (atTick <= first.atTick) return first.gain;
  for (let i = 1; i < env.length; i++) {
    const prev = env[i - 1];
    const cur = env[i];
    if (atTick <= cur.atTick) {
      const span = cur.atTick - prev.atTick;
      return span <= 0 ? cur.gain : prev.gain + ((cur.gain - prev.gain) * (atTick - prev.atTick)) / span;
    }
  }
  return env[env.length - 1].gain;
}

/**
 * The right split-child's volume envelope, rebased onto its own start.
 *
 * `VolumeKeyframe.atTick` is CLIP-RELATIVE TIMELINE ticks (schema.ts VolumeKeyframe): the compiler
 * adds the clip's timeline start to reach absolute IR frames, and Remotion invokes the volume
 * callback with a frame relative to the clip's <Sequence>. The child restarts at 0 on its own
 * timeline slot, so every keyframe shifts back by the split's timeline offset.
 * Keyframes that fall before the child are dropped — but the curve's VALUE at the split is
 * re-anchored as a keyframe at 0, otherwise the child would open at the gain of the first surviving
 * keyframe and the audio would jump at a cut that is meant to change nothing.
 */
function envelopeAfterSplit(env: VolumeEnvelope, offsetTicks: number): VolumeEnvelope {
  if (env.length === 0) return [];
  const shifted = env.map((k) => ({ atTick: k.atTick - offsetTicks, gain: k.gain }));
  const kept = shifted.filter((k) => k.atTick > 0);
  if (kept.length === shifted.length) return kept; // split lands before the first keyframe: nothing to re-anchor
  return [{ atTick: 0, gain: gainAtTick(env, offsetTicks) }, ...kept];
}

/**
 * Mint a clip. `availableOutTick` is the end of the REAL MEDIA (how far TRIM_CLIP edge:"out" may
 * later extend this clip), not the trim point — see `mediaEndTick`.
 *
 * An inverted/empty source range THROWS instead of being clamped. The old
 * `Math.max(inTick + 1, outTick)` turned one swapped in/out pair into an invisible 1/30000s sliver
 * that passed every later check (assertSaneRanges included — the clamp had already "fixed" the
 * range) and was persisted as the next version, replacing the whole timeline with a flash.
 */
function newClipFromMedia(
  assetId: string,
  inTick: number,
  outTick: number,
  id: string,
  availableOutTick: number,
  speed = 1,
  volume = 1,
): Clip {
  if (inTick < 0 || outTick <= inTick) {
    throw new CommandError(
      "degenerate_clip",
      `clip source range must satisfy 0 <= inTick < outTick (got ${inTick}..${outTick})`,
    );
  }
  return {
    schema: "Clip.1",
    id,
    assetId,
    mediaRefs: { full: { schema: "MediaRef.1", url: "", availableInTick: 0, availableOutTick } },
    activeRefKey: "full",
    inTick,
    outTick,
    speed,
    volume,
    volumeEnvelope: [],
    effects: [],
  };
}
function effectTargets(edl: EdlType, t: ApplyTarget): Clip[] {
  const all = edl.tracks.flatMap((tr) => tr.items.filter(isClip));
  if (t === "all") return all;
  if ("clipId" in t) {
    const loc = locateClip(edl, t.clipId);
    if (!loc) throw new CommandError("no_matching_clip", `clipId not found: ${t.clipId}`);
    return [loc.clip];
  }
  // range: clips whose timeline span overlaps [startTick, endTick)
  const out: Clip[] = [];
  for (const tr of edl.tracks) {
    let cursor = 0;
    for (const it of tr.items) {
      const d = itemDur(it);
      if (isClip(it) && cursor < t.range.endTick && cursor + d > t.range.startTick) out.push(it);
      cursor += d;
    }
  }
  return out;
}

function normalizeTrack(t: Track): void {
  const out: (Clip | Gap)[] = [];
  for (const it of t.items) {
    if (!isClip(it)) {
      if (it.durationTicks <= 0) continue;
      const prev = out[out.length - 1];
      if (prev && !isClip(prev)) {
        prev.durationTicks += it.durationTicks;
        continue;
      }
    }
    out.push(it);
  }
  while (out.length && !isClip(out[out.length - 1])) out.pop(); // drop trailing gaps
  t.items = out;
}
function recompute(d: EdlType): void {
  // prune transitions whose clips vanished OR are no longer strictly adjacent (e.g. a split
  // inserted a clip between the pair). ADD_TRANSITION requires item-adjacency; enforce it here too.
  const clipPos = new Map<string, { track: Track; idx: number; clip: Clip }>();
  d.tracks.forEach((t) => t.items.forEach((it, idx) => { if (isClip(it)) clipPos.set(it.id, { track: t, idx, clip: it }); }));
  d.transitions = d.transitions.filter((tr) => {
    const a = clipPos.get(tr.betweenClipIds[0]);
    const b = clipPos.get(tr.betweenClipIds[1]);
    if (!a || !b || a.track !== b.track || b.idx !== a.idx + 1) return false;
    // ADD_TRANSITION enforces `durationTicks <= min(adjacent clip timeline durations)`, but a LATER
    // TRIM_CLIP / SET_CLIP_SPEED can shrink either neighbour far below that. Re-enforce it on every
    // batch by CLAMPING (not dropping): the user asked for this transition, and clipTimelineDur is
    // always >= 1 so a legal duration always exists. Leaving it illegal persists an EDL that makes
    // a TransitionSeries emit negative sequence durations the moment one is wired up.
    const maxDur = Math.min(clipTimelineDur(a.clip), clipTimelineDur(b.clip));
    if (tr.durationTicks > maxDur) tr.durationTicks = maxDur;
    return true;
  });
  let dur = 0;
  for (const t of d.tracks) dur = Math.max(dur, trackDur(t));
  for (const o of d.overlays) dur = Math.max(dur, o.window.endTick);
  for (const c of d.captions) dur = Math.max(dur, c.window.endTick);
  for (const a of d.audioBeds) dur = Math.max(dur, a.window.endTick);
  d.durationTicks = dur;
}

/** Structural sanity the schema's per-field `> 0` checks miss: no inverted/zero source ranges or windows. */
function assertSaneRanges(d: EdlType): void {
  for (const t of d.tracks) {
    for (const it of t.items) {
      if (isClip(it) && it.inTick >= it.outTick) {
        throw new CommandError("degenerate_clip", `clip ${it.id} has inTick >= outTick`);
      }
    }
  }
  const windows = [
    ...d.overlays.map((o) => o.window),
    ...d.captions.map((c) => c.window),
    ...d.audioBeds.map((a) => a.window),
    // Per-effect enable windows were NOT checked here: an equal/inverted one (an easy off-by-zero
    // for a half-open window) is stored verbatim and the effect then renders in exactly zero frames
    // — the batch reports "added the flash", the video never changes.
    ...d.tracks.flatMap((t) => t.items.filter(isClip).flatMap((c) => c.effects.map((e) => e.window))),
  ];
  for (const w of windows) {
    if (w && w.startTick >= w.endTick) throw new CommandError("degenerate_window", "window startTick >= endTick");
  }
}

/**
 * Clip ids are the handle every other command (REMOVE/MOVE/SPLIT/TRIM/transitions/effect targeting)
 * resolves against, and every resolver takes the FIRST match — so two clips sharing an id is a
 * silent mis-targeting bug, not a cosmetic one. Minting keeps them distinct (see `mintClipLineage`);
 * this is the invariant that proves it, including for model-supplied PROPOSE_CUTS ids.
 */
function assertUniqueClipIds(d: EdlType): void {
  const seen = new Set<string>();
  for (const t of d.tracks) {
    for (const it of t.items) {
      if (!isClip(it)) continue;
      if (seen.has(it.id)) throw new CommandError("duplicate_clip_id", `two clips share the id ${it.id}`);
      seen.add(it.id);
    }
  }
}

/**
 * Recompute the content hash. Excludes the hash field itself AND `revision`: revision counts edits,
 * it is not content, and including it meant two byte-identical timelines (an edit and its
 * undo→redo twin, or a no-op batch) never shared a hash — which defeats content-addressing and
 * makes every "did this batch actually change anything?" check trivially true. Derived; never patched.
 */
export function withContentHash(edl: EdlType): EdlType {
  const rest = { ...edl };
  delete (rest as { contentHash?: string }).contentHash;
  delete (rest as { revision?: number }).revision;
  return { ...edl, contentHash: stableHash(rest) };
}

// ───────────────────────── per-batch context ─────────────────────────
/** Caller-supplied facts + per-batch counters threaded through every `apply` call. */
interface BatchContext {
  /** Real media length per assetId, in ticks (see `ReduceOptions.assetDurationsTicks`). */
  readonly assetDurationsTicks: Readonly<Record<string, number>>;
  /** The revision this batch is applied ON TOP OF — part of every minted clip's lineage. */
  readonly baseRevision: number;
  /** Bumped once per minted clip; keeps identical mints inside one batch distinct. */
  mintOrdinal: number;
}

/**
 * How far a freshly minted clip may later be extended by TRIM_CLIP edge:"out". The reducer is pure
 * and cannot read asset rows, so with no caller-supplied duration a clip is its own bound (the
 * pre-existing behaviour) — which is why "extend that clip by 2 seconds" after an AI cut was a
 * silent no-op: every minted clip had availableOutTick === its own outTick. Callers that know the
 * real media length pass `assetDurationsTicks`.
 *
 * A supplied duration SHORTER than the requested out point is a loud error, not a clamp: the caller
 * is asserting the media's real length, so the command is asking for footage that does not exist.
 */
function mediaEndTick(ctx: BatchContext, assetId: string, outTick: number): number {
  const known: number | undefined = ctx.assetDurationsTicks[assetId];
  if (known === undefined) return outTick;
  if (known < outTick) {
    throw new CommandError(
      "clip_exceeds_media",
      `clip out ${outTick} is past asset ${assetId}'s real length (${known} ticks)`,
    );
  }
  return known;
}

/**
 * Lineage for a minted clip id. `assetId:atTick:inTick` alone is NOT unique — two identical
 * ADD_CLIPs ("duplicate this clip", or a model retry inside one batch) minted ONE id for two clips,
 * and every lookup afterwards (locateClip, the transition-pruning position map) then saw only one of
 * them. The base revision separates batches, the ordinal separates mints within a batch. Both are
 * deterministic, so replay-from-seed still reproduces byte-identical ids.
 */
function mintClipLineage(ctx: BatchContext, lineage: string): string {
  return `${lineage}:r${ctx.baseRevision}#${ctx.mintOrdinal++}`;
}

/**
 * Positional ticks are absolute timeline coordinates; there is no "before zero". A negative one is a
 * sign error, and insertAtTick's cursor can never match it, so the clip would silently land at the
 * END of the track — the opposite of what was asked.
 */
function assertPositionalTick(field: string, atTick: number): void {
  if (atTick < 0) throw new CommandError("negative_tick", `${field} must be >= 0 (got ${atTick})`);
}

// ───────────────────────── the command handlers (one per EditCommand variant) ─────────────────────────
function apply(d: EdlType, cmd: EditCommand, ctx: BatchContext): void {
  switch (cmd.type) {
    case "ADD_CLIP": {
      assertPositionalTick("ADD_CLIP.atTick", cmd.atTick);
      const track = ensureTrack(d, cmd.trackId);
      const id = clipId(mintClipLineage(ctx, `${cmd.assetId}:${cmd.atTick}:${cmd.inTick}`));
      const clip = newClipFromMedia(
        cmd.assetId,
        cmd.inTick,
        cmd.outTick,
        id,
        mediaEndTick(ctx, cmd.assetId, cmd.outTick),
      );
      insertAtTick(track, cmd.atTick, clip);
      return;
    }
    case "REMOVE_CLIP": {
      const loc = locateClip(d, cmd.clipId);
      if (!loc) throw new CommandError("no_matching_clip", cmd.clipId);
      // `?? true` mirrors the schema default IN CODE: the UI path dispatches raw EditCommands that
      // were never Zod-parsed, so an omitted `ripple` would read as false and leave a gap where the
      // caller asked for a ripple delete. Same reason `params` is defaulted below.
      if (cmd.ripple ?? true) {
        loc.track.items.splice(loc.itemIdx, 1);
      } else {
        loc.track.items[loc.itemIdx] = { schema: "Gap.1", id: `gap_${loc.track.id}_${loc.startTick}`, durationTicks: clipTimelineDur(loc.clip) };
      }
      return;
    }
    case "MOVE_CLIP": {
      assertPositionalTick("MOVE_CLIP.atTick", cmd.atTick);
      const loc = locateClip(d, cmd.clipId);
      if (!loc) throw new CommandError("no_matching_clip", cmd.clipId);
      const moved = plain(loc.clip);
      loc.track.items.splice(loc.itemIdx, 1); // ripple out of source
      // Snap to the nearest boundary on the destination track: a UI drag feeds a continuous tick
      // that won't equal an item edge, and after the source splice the boundaries have shifted.
      // (insertAtTick's exact-match requirement would throw insert_mid_item here — see insertSnapped.)
      insertSnapped(ensureTrack(d, cmd.toTrackId), cmd.atTick, moved);
      return;
    }
    case "SPLIT_CLIP": {
      const loc = locateClip(d, cmd.clipId);
      if (!loc) throw new CommandError("no_matching_clip", cmd.clipId);
      const localOffset = cmd.atTick - loc.startTick;
      if (localOffset <= 0 || localOffset >= clipTimelineDur(loc.clip)) {
        throw new CommandError("split_out_of_range", `atTick ${cmd.atTick} not strictly inside clip`);
      }
      const splitSource = loc.clip.inTick + Math.round(localOffset * loc.clip.speed);
      // Guard the SOURCE range, not just the timeline span: sub-tick rounding at extreme speeds
      // can map the split onto an edge and produce a zero-length/inverted child.
      if (splitSource <= loc.clip.inTick || splitSource >= loc.clip.outTick) {
        throw new CommandError("split_out_of_range", "split maps outside the clip's source range");
      }
      // The right child KEEPS the parent's effects. Dropping them (the old `effects: []`) meant a
      // purely STRUCTURAL cut silently ungraded the second half of the clip in preview and export —
      // "cut out the boring middle" removed the look from everything after the cut. Ids are
      // re-minted so the halves stay independently addressable by REMOVE_EFFECT. Effect windows are
      // ABSOLUTE timeline ticks (HiteRoot rebases them per clip) and a split moves nothing on the
      // timeline, so they carry over unshifted — unlike the clip-relative volume envelope.
      const rightId = splitChildId(`${loc.clip.id}:${cmd.atTick}`, 1);
      const right: Clip = plain(loc.clip);
      right.id = rightId;
      right.inTick = splitSource;
      right.effects = right.effects.map((fx, i) => ({
        ...fx,
        id: effectId(fx.effectKey, fx.params, undefined, `${rightId}:${i}`),
      }));
      right.volumeEnvelope = envelopeAfterSplit(right.volumeEnvelope, localOffset);
      // AND THE LOOK FOLLOWS THE CUT TOO. Effects live on the clip and were already carried above,
      // but a look is stored once in `looksApplied` and names the clips it covers — so the new right
      // half was not in any look's target list, and a purely structural split silently ungraded
      // everything after the cut in preview AND export. Exactly the bug the effects comment above
      // describes, one level up. A look with no targetClipIds covers the whole timeline and needs
      // nothing done to it.
      for (const look of d.looksApplied) {
        if (look.targetClipIds?.includes(loc.clip.id) && !look.targetClipIds.includes(rightId)) {
          look.targetClipIds.push(rightId);
        }
      }
      loc.clip.outTick = splitSource; // left
      loc.track.items.splice(loc.itemIdx + 1, 0, right);
      return;
    }
    case "TRIM_CLIP": {
      const loc = locateClip(d, cmd.clipId);
      if (!loc) throw new CommandError("no_matching_clip", cmd.clipId);
      const clip = loc.clip;
      const newEdge = clip.inTick + Math.round((cmd.toTick - loc.startTick) * clip.speed);
      // Two different failures, both previously silent:
      //   • trimming an edge PAST the other one doesn't empty the clip, it inverts it — the old
      //     clamp left an unselectable 1-tick sliver where the user asked for "nothing left".
      //   • trimming INTO a hard bound (media start / media end) is a clamp, which is right, but a
      //     clamp that changes nothing is a command the user watched succeed and do nothing.
      if (cmd.edge === "in") {
        if (newEdge >= clip.outTick) {
          throw new CommandError("trim_collapses_clip", `trimming in to ${newEdge} leaves < 1 tick of clip ${clip.id}`);
        }
        const clamped = Math.max(0, newEdge); // can't trim before the start of the media
        if (clamped !== newEdge && clamped === clip.inTick) {
          throw new CommandError("trim_out_of_bounds", `clip ${clip.id} is already at the start of its media`);
        }
        clip.inTick = clamped;
      } else {
        if (newEdge <= clip.inTick) {
          throw new CommandError("trim_collapses_clip", `trimming out to ${newEdge} leaves < 1 tick of clip ${clip.id}`);
        }
        const available = clip.mediaRefs.full.availableOutTick;
        const clamped = Math.min(newEdge, available); // can't extend past the media that exists
        if (clamped !== newEdge && clamped === clip.outTick) {
          throw new CommandError("trim_out_of_bounds", `clip ${clip.id} already ends at its media's last tick (${available})`);
        }
        clip.outTick = clamped;
      }
      return;
    }
    case "SET_CLIP_SPEED": {
      const loc = locateClip(d, cmd.clipId);
      if (!loc) throw new CommandError("no_matching_clip", cmd.clipId);
      // Schema only guards `.positive()`, so the AI could emit speed 0.0001 or 99999 and silently
      // collapse/explode the clip's derived timeline duration (dur = source / speed). Clamp to a
      // generous NLE-safe envelope (0.1×..100×) so a pathological value can't wreck the geometry.
      loc.clip.speed = clamp(cmd.speed, 0.1, 100);
      return;
    }
    case "SET_CLIP_VOLUME": {
      const loc = locateClip(d, cmd.clipId);
      if (!loc) throw new CommandError("no_matching_clip", cmd.clipId);
      loc.clip.volume = clamp(cmd.volume, 0, 2);
      return;
    }
    case "PROPOSE_CUTS": {
      const primary = d.tracks.flatMap((t) => t.items.filter(isClip))[0]?.assetId;
      if (!primary) throw new CommandError("no_primary_asset", "no existing clip to infer assetId");
      const clips: Clip[] = cmd.clips.map((c) => {
        const assetId = c.assetId && c.assetId !== "primary" ? c.assetId : primary;
        return newClipFromMedia(
          assetId,
          c.inTick,
          c.outTick,
          c.id ?? clipId(mintClipLineage(ctx, `propose:${assetId}:${c.inTick}`)),
          mediaEndTick(ctx, assetId, c.outTick),
          c.speed,
          c.volume,
        );
      });
      let track = d.tracks.find((t) => t.kind === "video" && t.role === "main") ?? d.tracks[0];
      if (!track) {
        track = { schema: "Track.1", id: "track_0", kind: "video", role: "main", items: [] };
        d.tracks.push(track);
      }
      track.items = clips;
      return;
    }
    case "ADD_EFFECT": {
      // Both `??`s apply a schema default IN CODE for the raw UI path (see REMOVE_CLIP). A missing
      // target used to reach `"clipId" in undefined` and throw a bare TypeError, which the store
      // logged as an ordinary "command rejected" — a dead button indistinguishable from a refusal.
      const target = cmd.target ?? "all";
      const params = cmd.params ?? {};
      const targets = effectTargets(d, target);
      if (targets.length === 0) throw new CommandError("no_matching_clip", "ADD_EFFECT matched no clips");
      for (const clip of targets) {
        const fx: EffectInstance = {
          schema: "Effect.1",
          id: effectId(cmd.effectKey, params, target, clip.effects.length),
          effectKey: cmd.effectKey,
          params,
          window: cmd.window,
          enabled: true,
        };
        clip.effects.push(fx);
      }
      return;
    }
    case "REMOVE_EFFECT": {
      const loc = locateClip(d, cmd.clipId);
      if (!loc) throw new CommandError("no_matching_clip", cmd.clipId);
      loc.clip.effects = loc.clip.effects.filter((e) => e.id !== cmd.effectId);
      return;
    }
    case "ADD_TRANSITION": {
      const a = locateClip(d, cmd.betweenClipIds[0]);
      const b = locateClip(d, cmd.betweenClipIds[1]);
      if (!a || !b) throw new CommandError("no_matching_clip", "transition references a missing clip");
      if (a.track !== b.track || b.itemIdx !== a.itemIdx + 1) {
        throw new CommandError("transition_not_adjacent", "clips must be adjacent on the same track");
      }
      const maxDur = Math.min(clipTimelineDur(a.clip), clipTimelineDur(b.clip));
      if (cmd.durationTicks > maxDur) throw new CommandError("transition_too_long", `durationTicks > ${maxDur}`);
      if (d.transitions.some((t) => t.betweenClipIds[0] === a.clip.id && t.betweenClipIds[1] === b.clip.id)) {
        throw new CommandError("transition_exists", "a transition already spans this boundary");
      }
      d.transitions.push({
        schema: "Transition.1",
        id: transitionId(cmd.betweenClipIds, cmd.transitionKey),
        betweenClipIds: cmd.betweenClipIds,
        transitionKey: cmd.transitionKey,
        durationTicks: cmd.durationTicks,
        params: cmd.params ?? {}, // schema default, applied in code for the raw UI path (see REMOVE_CLIP)
      });
      return;
    }
    case "REMOVE_TRANSITION": {
      d.transitions = d.transitions.filter((t) => t.id !== cmd.transitionId);
      return;
    }
    case "ADD_OVERLAY": {
      d.overlays.push({
        schema: "Overlay.1",
        id: overlayId(cmd.overlayKey, cmd.window, cmd.placement),
        overlayKey: cmd.overlayKey,
        window: cmd.window,
        placement: cmd.placement,
        params: cmd.params ?? {}, // schema default, applied in code for the raw UI path (see REMOVE_CLIP)
      });
      return;
    }
    case "REMOVE_OVERLAY": {
      d.overlays = d.overlays.filter((o) => o.id !== cmd.overlayId);
      return;
    }
    case "REMOVE_CAPTION": {
      d.captions = d.captions.filter((c) => c.id !== cmd.captionId);
      return;
    }
    case "REMOVE_AUDIO_BED": {
      d.audioBeds = d.audioBeds.filter((a) => a.id !== cmd.audioBedId);
      return;
    }
    case "COMPOSE_LOOK": {
      d.looksApplied.push({ schema: "Look.1", id: lookId(cmd.lookKey, cmd.targetClipIds), lookKey: cmd.lookKey, targetClipIds: cmd.targetClipIds, params: {} });
      return;
    }
    case "CLEAR_LOOKS": {
      d.looksApplied = [];
      return;
    }
    case "ADD_CAPTION": {
      d.captions.push({ schema: "Caption.1", id: captionId(cmd.window, cmd.text), window: cmd.window, text: cmd.text, style: cmd.style, words: [] });
      return;
    }
    case "SET_CAPTION_STYLE": {
      const cap = d.captions.find((c) => c.id === cmd.captionId);
      if (!cap) throw new CommandError("no_matching_caption", cmd.captionId);
      cap.style = cmd.style;
      return;
    }
    case "ADJUST_WORD_TIMING": {
      const cap = d.captions.find((c) => c.id === cmd.captionId);
      if (!cap) throw new CommandError("no_matching_caption", cmd.captionId);
      // NB: despite the name this retimes the caption SEGMENT's window; `cap.words[]` (per-word
      // karaoke timings, populated from the transcript) is deliberately left alone — there is no
      // command yet that carries new per-word ticks, and re-deriving them from the moved window
      // would fabricate timings. A segment moved far from its words will show them out of step.
      cap.window = { startTick: cmd.startTick, endTick: cmd.endTick };
      return;
    }
    case "ADD_AUDIO_BED": {
      d.audioBeds.push({ schema: "AudioBed.1", id: audioBedId(cmd.assetId, cmd.window), assetId: cmd.assetId, window: cmd.window, volume: cmd.volume, volumeEnvelope: [], loop: cmd.loop });
      return;
    }
    case "ADD_MARKER": {
      d.markers.push({ schema: "Marker.1", id: markerId(cmd.atTick, cmd.title), atTick: cmd.atTick, title: cmd.title, color: cmd.color, kind: cmd.kind });
      return;
    }
    case "SET_OUTPUT_VARIANT": {
      d.outputs = [{ aspect: cmd.aspect, maxTicks: cmd.maxTicks }];
      return;
    }
    default: {
      const _exhaustive: never = cmd;
      throw new CommandError("unknown_command", String((_exhaustive as { type?: string })?.type));
    }
  }
}

export interface ReduceResult {
  edl: EdlType;
  forwardPatches: Patch[];
  inversePatches: Patch[];
}

/** External facts the boundary knows and this pure module cannot look up. All optional. */
export interface ReduceOptions {
  /**
   * Real media length per assetId, in TICKS (`asset.duration_ms × 30`). Used as the
   * `availableOutTick` of every clip this batch mints, so a later TRIM_CLIP edge:"out" can actually
   * extend the clip to the footage that exists. Omit an asset (or the whole map) and its clips fall
   * back to being bounded by their own out point — the pre-existing, conservative behaviour.
   */
  assetDurationsTicks?: Record<string, number>;
}

/** Apply a whole batch as one transaction: all-or-nothing, one Zod re-parse at the end. */
export function reduceBatch(edl: EdlType, batch: EditCommand[], opts: ReduceOptions = {}): ReduceResult {
  const ctx: BatchContext = {
    assetDurationsTicks: opts.assetDurationsTicks ?? {},
    baseRevision: edl.revision,
    mintOrdinal: 0,
  };
  const [next, forwardPatches, inversePatches] = produceWithPatches(edl, (draft) => {
    const d = draft as unknown as EdlType;
    for (const cmd of batch) apply(d, cmd, ctx);
    for (const t of d.tracks) normalizeTrack(t);
    recompute(d);
    d.revision = edl.revision + 1;
  });
  Edl.parse(next); // tripwire — throws if a handler produced a structurally-invalid EDL
  assertSaneRanges(next as EdlType); // degenerate ranges Zod's per-field `>0` checks miss
  assertUniqueClipIds(next as EdlType); // one clip id ⇒ one clip, or every later lookup is ambiguous
  return { edl: withContentHash(next as EdlType), forwardPatches, inversePatches };
}

export function reduce(edl: EdlType, cmd: EditCommand, opts: ReduceOptions = {}): ReduceResult {
  return reduceBatch(edl, [cmd], opts);
}
