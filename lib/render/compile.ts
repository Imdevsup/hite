/**
 * lib/render/compile.ts — `edlToRenderIR`, the canonical compiler (docs/CANONICAL-IR-SPEC.md §6).
 *
 * Synchronous + PURE given (edl, env, resolver): all async work (URL resolution, face-track DB
 * reads) happens at the boundary and is passed in via `MediaResolver`. Same inputs ⇒ byte-identical
 * IR ⇒ equal rootHash. `ticksToFrame` is called ONLY here (the single conversion seam).
 *
 * Honesty rule (the whole point of this layer): when the EDL asks for something the compiler cannot
 * express, it either degrades VISIBLY or drops the step and records a `RenderDiagnostic` — it never
 * substitutes a zero. A strength-0 effect, a 1-frame overlay and a scale-0 sticker all render as
 * "nothing happened" while every layer above reports success, in preview AND export alike.
 *
 * v1 scope notes: speed ramps lower to a static rate (the IR type carries the keyframed variant for
 * when they're implemented); volume envelopes DO lower, in absolute timeline frames (§5, VolumeCurve).
 */
import { ticksToFrame, msToTicks, tickToMs, type Tick } from "@/lib/edl/time";
import { effectId } from "@/lib/edl/ids";
import { allClipPositions, clipTimelineDur, isClip, itemDur, type ClipPos } from "@/lib/edl/query";
import type { Edl, Clip, Gap, Track, OverlayInstance, CaptionSegment, AudioBed, Placement } from "@/lib/edl/schema";
import { hashObj } from "./hash";
import type {
  RenderIR,
  RenderEnv,
  RenderDiagnostic,
  MediaResolver,
  RecipeTime,
  StackNode,
  TrackNode,
  ClipNode,
  GapNode,
  TransitionNode,
  EffectNode,
  OverlayNode,
  CaptionNode,
  AudioNode,
  ResolvedPlacement,
} from "./ir";

function resolution(aspect: RenderEnv["aspect"], quality: RenderEnv["quality"]): { width: number; height: number } {
  const base = aspect === "9:16" ? { width: 1080, height: 1920 } : aspect === "1:1" ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };
  if (quality === "full") return base;
  const even = (n: number) => Math.round((n * 0.5) / 2) * 2; // half-res, kept even for encoders
  return { width: even(base.width), height: even(base.height) };
}

function mapEngine(e: string): EffectNode["engine"] {
  if (e === "lut") return "lut";
  if (e === "gl-transitions") return "gl-transitions";
  return "remotion"; // ffmpeg/procedural/overlay-asset/composed all render via Remotion now
}

// ───────────────────────── output cap (§6, SET_OUTPUT_VARIANT.maxTicks) ─────────────────────────
/**
 * The hard output length for this render. `SET_OUTPUT_VARIANT` replaces `outputs` wholesale, so
 * there is normally exactly one variant; we still match the one being rendered by aspect so a
 * multi-variant EDL caps each render with its own budget. Everything past the cap is trimmed or
 * dropped below — "make it a 60s cut" must produce 60s in preview AND export, not a 3-minute video
 * with a knob nobody reads.
 */
function outputCapTicks(edl: Edl, aspect: RenderEnv["aspect"]): number {
  const variant = edl.outputs.find((o) => o.aspect === aspect) ?? edl.outputs[0];
  const max = variant?.maxTicks;
  return max != null && max > 0 ? Math.min(edl.durationTicks, max) : edl.durationTicks;
}

/** Clamp a half-open tick window to the output cap. `null` ⇒ it starts at/after the cap (drop it). */
function capWindow(w: { startTick: number; endTick: number }, capTick: number): { startTick: number; endTick: number } | null {
  if (w.startTick >= capTick) return null;
  return { startTick: w.startTick, endTick: Math.min(w.endTick, capTick) };
}

// ───────────────────────── look expansion + arithmetic interpolation (§6.4) ─────────────────────────
/**
 * Evaluate a recipe template expression (`dropMs`, `dropMs_minus_300`, `intensity_times_2`) against
 * the look's vars. Returns null when the expression names a var nobody supplied — the caller drops
 * the step and records a diagnostic. Returning 0 here (the old behaviour) is what turned "skull drop
 * on the beat" into a permanent, whole-video chromatic flash at strength 0.
 */
function evalExpr(expr: string, vars: Record<string, number>): number | null {
  const m = expr.match(/^(\w+?)_(plus|minus|times)_(\d+(?:\.\d+)?)$/);
  if (m) {
    const base = vars[m[1]];
    if (base === undefined) return null;
    const n = Number(m[3]);
    return m[2] === "plus" ? base + n : m[2] === "minus" ? base - n : base * n;
  }
  if (expr in vars) return vars[expr];
  const num = Number(expr);
  return Number.isFinite(num) ? num : null;
}

const TEMPLATE = /^\{\{(.+)\}\}$/;
/** Params with every `{{…}}` resolved; unresolvable expressions are collected, not defaulted. */
function evalRecipeParams(params: Record<string, unknown>, vars: Record<string, number>, unresolved: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") {
      const mm = v.match(TEMPLATE);
      if (!mm) {
        out[k] = v;
        continue;
      }
      const n = evalExpr(mm[1], vars);
      if (n === null) unresolved.push(mm[1]);
      else out[k] = n;
    } else out[k] = v;
  }
  return out;
}

/**
 * A recipe time → absolute ticks. Templates in a time position are MILLISECONDS (the recipe fields
 * are literally named `startMs`/`endMs`), so they convert through `msToTicks` exactly like the
 * literals the resolver already converted.
 */
function evalRecipeTime(t: RecipeTime, vars: Record<string, number>, unresolved: string[]): number | null {
  if (t.kind === "ticks") return t.ticks;
  const ms = evalExpr(t.expr, vars);
  if (ms === null) {
    unresolved.push(t.expr);
    return null;
  }
  return msToTicks(ms);
}

function numericParams(params: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === "number") out[k] = v;
  return out;
}

function makeEffectNode(effectKey: string, params: Record<string, unknown>, resolver: MediaResolver, salt: number): EffectNode {
  const entry = resolver.registryEntry(effectKey);
  const resolved = entry.engine === "lut" && entry.lutFile ? { ...params, lutFile: entry.lutFile } : params;
  return { kind: "effect", id: effectId(effectKey, resolved, undefined, salt), hash: "", effectKey, engine: mapEngine(entry.engine), params: resolved };
}

interface LookContext {
  positions: ClipPos[];
  res: { width: number; height: number };
  t2f: (t: number) => number;
  leadAssetId: string;
  capTick: number;
  diagnostics: RenderDiagnostic[];
}

/** Returns look-expanded effects keyed by clip id ("all" resolved) + flat look overlays. */
function expandLooks(edl: Edl, resolver: MediaResolver, ctx: LookContext): { byClip: Map<string, EffectNode[]>; overlays: OverlayNode[] } {
  const byClip = new Map<string, EffectNode[]>();
  const overlays: OverlayNode[] = [];
  let salt = 0;
  for (const look of edl.looksApplied) {
    let recipe;
    try {
      recipe = resolver.lookRecipe(look.lookKey);
    } catch {
      continue; // unknown look — skip rather than crash the compile
    }
    // `durationMs` is a FACT the compiler owns (recipes use it for full-length overlays). Analysis
    // vars (dropMs, faceId…) can only come from the resolver; when it has none, the steps that need
    // them are dropped below rather than fabricated.
    const vars = { durationMs: tickToMs(edl.durationTicks), ...(resolver.recipeVars?.(look.lookKey) ?? {}), ...numericParams(look.params) };
    const scoped = look.targetClipIds?.length
      ? ctx.positions.filter((p) => look.targetClipIds?.includes(p.clip.id))
      : ctx.positions;

    for (const step of recipe.steps) {
      const unresolved: string[] = [];
      const params = evalRecipeParams(step.params, vars, unresolved);
      const drop = (detail: string) => ctx.diagnostics.push({ code: "look-step-unresolved", key: look.lookKey, detail });
      const stepLabel = step.effectKey ?? step.overlayKey ?? "step";

      if (step.kind === "effect" && step.effectKey) {
        const target = step.target ?? { kind: "all" as const };
        if (target.kind === "unreadable") {
          drop(`${stepLabel} dropped: unreadable target ${target.raw}`);
          continue;
        }
        let window: EffectNode["window"];
        let clips = scoped;
        if (target.kind === "range") {
          const startTick = evalRecipeTime(target.start, vars, unresolved);
          const endTick = evalRecipeTime(target.end, vars, unresolved);
          if (startTick === null || endTick === null || unresolved.length) {
            drop(`${stepLabel} dropped: cannot resolve {{${unresolved.join("}}, {{")}}} — no analysis data for this look`);
            continue;
          }
          if (endTick <= startTick) {
            drop(`${stepLabel} dropped: inverted range [${startTick}, ${endTick})`);
            continue;
          }
          // A drop near 0:00 makes `{{dropMs_minus_300}}` negative; the timeline starts at 0.
          const clamped = { startTick: Math.max(0, startTick), endTick };
          if (clamped.endTick <= clamped.startTick) {
            drop(`${stepLabel} dropped: range [${startTick}, ${endTick}) lands before the timeline`);
            continue;
          }
          window = { startFrame: ctx.t2f(clamped.startTick), endFrame: ctx.t2f(clamped.endTick) };
          // A ranged step belongs only to the clips the range actually covers — attaching it to every
          // clip would leave dead effect nodes whose window never opens.
          clips = scoped.filter((p) => p.startTick < clamped.endTick && p.endTick > clamped.startTick);
          if (!clips.length) {
            drop(`${stepLabel} dropped: range [${clamped.startTick}, ${clamped.endTick}) covers no clip`);
            continue;
          }
        } else if (unresolved.length) {
          drop(`${stepLabel} dropped: cannot resolve {{${unresolved.join("}}, {{")}}} — no analysis data for this look`);
          continue;
        }
        for (const p of clips) {
          const arr = byClip.get(p.clip.id) ?? [];
          const node = makeEffectNode(step.effectKey, params, resolver, salt++);
          if (window) node.window = window;
          arr.push(node);
          byClip.set(p.clip.id, arr);
        }
      } else if (step.kind === "overlay" && step.overlayKey) {
        if (!step.window) {
          drop(`${stepLabel} dropped: the recipe gives it no startMs/endMs window`);
          continue;
        }
        const startTick = evalRecipeTime(step.window.start, vars, unresolved);
        const endTick = evalRecipeTime(step.window.end, vars, unresolved);
        if (startTick === null || endTick === null || unresolved.length) {
          drop(`${stepLabel} dropped: cannot resolve {{${unresolved.join("}}, {{")}}} — no analysis data for this look`);
          continue;
        }
        if (endTick <= startTick) {
          drop(`${stepLabel} dropped: inverted window [${startTick}, ${endTick})`);
          continue;
        }
        const capped = capWindow({ startTick: Math.max(0, startTick), endTick }, ctx.capTick);
        if (!capped || capped.endTick <= capped.startTick) {
          drop(`${stepLabel} dropped: window [${startTick}, ${endTick}) falls outside [0, ${ctx.capTick})`);
          continue;
        }
        // A `{{…}}` still sitting in the placement (e.g. `trackFaceId: "{{faceId}}"`) means no face
        // analysis backs it. That degrades to the VISIBLE centered fallback in resolvePlacement
        // rather than dropping the overlay — but it is still recorded, never silent.
        const placement = step.placement ?? { mode: "center" as const };
        if (placement.mode === "face" && TEMPLATE.test(placement.trackFaceId)) {
          drop(`${stepLabel} placed centered: ${placement.trackFaceId} has no face track in this build`);
        }
        overlays.push({
          kind: "overlay",
          id: `ov_look_${salt++}`,
          hash: "",
          overlayKey: step.overlayKey,
          window: { startFrame: ctx.t2f(capped.startTick), endFrame: ctx.t2f(capped.endTick) },
          placement: resolvePlacement(placement, ctx.leadAssetId, resolver, ctx.res),
          params,
        });
      } else {
        // An `applyEffect` with no effectKey (or an `applyOverlay` with no overlayKey) is a broken
        // registry entry. Recording it beats expanding a look that quietly does one step less.
        drop(`a ${step.kind} step names no key`);
      }
    }
  }
  return { byClip, overlays };
}

// ───────────────────────── placement ─────────────────────────
function staticPlacement(placement: Placement, res: { width: number; height: number }): ResolvedPlacement {
  const scale = 0.4;
  const w = Math.round(res.width * scale);
  const h = Math.round(res.height * scale);
  const M = 24;
  switch (placement.mode) {
    case "center": return { mode: "static", x: Math.round((res.width - w) / 2), y: Math.round((res.height - h) / 2), w, h };
    case "xy": return { mode: "static", x: placement.x, y: placement.y, w, h };
    case "topLeft": return { mode: "static", x: M, y: M, w, h };
    case "topRight": return { mode: "static", x: res.width - w - M, y: M, w, h };
    case "bottomLeft": return { mode: "static", x: M, y: res.height - h - M, w, h };
    case "bottomRight": return { mode: "static", x: res.width - w - M, y: res.height - h - M, w, h };
    default: return { mode: "static", x: 0, y: 0, w, h };
  }
}
/**
 * `face` mode needs a face track with keyframes. There is no face analysis in this build (the
 * pipeline was cut), so the resolver returns an empty track — and an empty track used to reach
 * HiteRoot as a 0×0 box: the overlay was placed, hashed, reported as applied, and rendered
 * INVISIBLE. Fall back to the centered static placement instead: wrong-ish position, but visible
 * and observable (the caller records a diagnostic when the face id itself is a template).
 */
function resolvePlacement(placement: Placement, leadAssetId: string, resolver: MediaResolver, res: { width: number; height: number }): ResolvedPlacement {
  if (placement.mode === "face") {
    const track = resolver.faceTrack(leadAssetId, placement.trackFaceId);
    if (!track.keyframes.length) return staticPlacement({ mode: "center" }, res);
    return { mode: "face", track };
  }
  return staticPlacement(placement, res);
}

// ───────────────────────── node builders ─────────────────────────
/**
 * Absolute-timeline volume keyframes; HiteRoot rebases them onto the node's Sequence (§5).
 *
 * `VolumeKeyframe.atTick` is NODE-RELATIVE in the EDL — 0 is the clip's (or bed's) own start on the
 * timeline, which is why SPLIT_CLIP rebases the right child's envelope (reducer.ts
 * `envelopeAfterSplit`) and why a moved clip carries its ducking with it. `baseTick` is that node's
 * timeline start, so this is the ONE place the envelope crosses into the IR's absolute frame space.
 * Dropping it made every envelope on a node that doesn't start at 0 read as clip-relative frames,
 * which HiteRoot then rebased a SECOND time — a fade-in became silence (or full volume) for the
 * whole node, identically in preview and export.
 */
function volumeCurve(
  envelope: { atTick: number; gain: number }[],
  staticGain: number,
  t2f: (t: number) => number,
  baseTick: number,
): ClipNode["volume"] {
  return envelope.length
    ? { kind: "keyframed", atFrames: envelope.map((k) => t2f(baseTick + k.atTick)), gains: envelope.map((k) => k.gain) }
    : { kind: "static", gain: staticGain };
}

function buildClipNode(
  c: Clip,
  startTick: number,
  refKey: "full" | "proxy",
  resolver: MediaResolver,
  t2f: (t: number) => number,
  lookEffects: EffectNode[],
  maxDur: number,
): ClipNode {
  // A clip straddling the output cap keeps its head and loses its tail: the timeline length shrinks
  // to the remaining budget, and outTick shrinks with it so the source range matches what plays.
  const fullDur = clipTimelineDur(c);
  const dur = Math.min(fullDur, maxDur);
  const outTick = dur < fullDur ? c.inTick + Math.max(1, Math.floor(dur * (c.speed || 1))) : c.outTick;
  const endTick = startTick + dur;
  const ownEffects = c.effects
    .filter((e) => e.enabled)
    .map((e, i) => {
      const node = makeEffectNode(e.effectKey, e.params, resolver, i);
      if (e.window) node.window = { startFrame: t2f(e.window.startTick), endFrame: t2f(e.window.endTick) };
      return node;
    });
  return {
    kind: "clip",
    id: c.id,
    hash: "",
    source: { assetId: c.assetId, url: resolver.urlForAsset(c.assetId, refKey), refKey, mediaKind: resolver.assetKind?.(c.assetId) ?? "video" },
    startTick,
    endTick,
    startFrame: t2f(startTick),
    endFrame: t2f(endTick),
    inTick: c.inTick,
    outTick,
    inFrame: t2f(c.inTick),
    outFrame: t2f(outTick),
    playback: { kind: "static", rate: c.speed }, // v1: ramps lower to static
    volume: volumeCurve(c.volumeEnvelope, c.volume, t2f, startTick),
    effects: [...ownEffects, ...lookEffects],
  };
}
function buildGapNode(g: Gap, startTick: number, t2f: (t: number) => number, maxDur: number): GapNode {
  const endTick = startTick + Math.min(g.durationTicks, maxDur);
  return { kind: "gap", id: g.id, hash: "", startTick, endTick, startFrame: t2f(startTick), endFrame: t2f(endTick) };
}

function buildVideoTrack(
  tr: Track,
  refKey: "full" | "proxy",
  resolver: MediaResolver,
  t2f: (t: number) => number,
  byClip: Map<string, EffectNode[]>,
  capTick: number,
): TrackNode {
  const items: TrackNode["items"] = [];
  let cursor = 0;
  for (const it of tr.items) {
    if (cursor >= capTick) break; // past the output cap — the rest of the track is not rendered
    const budget = capTick - cursor;
    if (isClip(it)) items.push(buildClipNode(it, cursor, refKey, resolver, t2f, byClip.get(it.id) ?? [], budget));
    else items.push(buildGapNode(it, cursor, t2f, budget));
    cursor += itemDur(it);
  }
  return { kind: "track", id: tr.id, hash: "", trackKind: tr.kind === "audio" ? "audio" : "video", role: tr.role, items };
}

function weaveTransitions(track: TrackNode, edl: Edl, t2f: (t: number) => number): void {
  for (const tr of edl.transitions) {
    const a = track.items.findIndex((n) => n.kind === "clip" && n.id === tr.betweenClipIds[0]);
    const b = track.items.findIndex((n) => n.kind === "clip" && n.id === tr.betweenClipIds[1]);
    if (a < 0 || b < 0 || b !== a + 1) continue; // not on this track / not adjacent / cut by maxTicks
    const node: TransitionNode = {
      kind: "transition",
      id: tr.id,
      hash: "",
      transitionKey: tr.transitionKey,
      fromHash: "",
      toHash: "",
      durationTicks: tr.durationTicks,
      durationInFrames: t2f(tr.durationTicks),
      offsetTick: 0,
      offsetFrame: 0,
      presentation: { name: tr.transitionKey, props: tr.params },
      timing: { name: "linear", params: {} },
    };
    track.items.splice(b, 0, node);
  }
  // §6.5 cumulative offsets on the shrinking output timeline
  let cumClip = 0;
  for (const item of track.items) {
    if (item.kind === "transition") {
      item.offsetTick = cumClip - item.durationTicks;
      item.offsetFrame = t2f(item.offsetTick);
    } else if (item.kind === "clip" || item.kind === "gap") {
      cumClip += item.endTick - item.startTick;
    }
  }
}

function buildOverlayNode(o: OverlayInstance, leadAssetId: string, resolver: MediaResolver, t2f: (t: number) => number, res: { width: number; height: number }, capTick: number): OverlayNode | null {
  const w = capWindow(o.window, capTick);
  if (!w) return null;
  return { kind: "overlay", id: o.id, hash: "", overlayKey: o.overlayKey, window: { startFrame: t2f(w.startTick), endFrame: t2f(w.endTick) }, placement: resolvePlacement(o.placement, leadAssetId, resolver, res), params: o.params };
}
function buildCaptionNode(c: CaptionSegment, t2f: (t: number) => number, capTick: number): CaptionNode | null {
  const w = capWindow(c.window, capTick);
  if (!w) return null;
  return {
    kind: "caption",
    id: c.id,
    hash: "",
    window: { startFrame: t2f(w.startTick), endFrame: t2f(w.endTick) },
    text: c.text,
    style: c.style,
    fontHash: hashObj({ style: c.style }),
    words: c.words.filter((word) => word.startTick < w.endTick).map((word) => ({ text: word.text, startFrame: t2f(word.startTick), endFrame: t2f(Math.min(word.endTick, w.endTick)) })),
  };
}
function buildAudioNode(a: AudioBed, resolver: MediaResolver, t2f: (t: number) => number, capTick: number): AudioNode | null {
  const w = capWindow(a.window, capTick);
  if (!w) return null;
  return {
    kind: "audio",
    id: a.id,
    hash: "",
    source: { assetId: a.assetId, url: resolver.urlForAsset(a.assetId, "full"), inFrame: 0, outFrame: t2f(w.endTick - w.startTick) },
    startFrame: t2f(w.startTick),
    endFrame: t2f(w.endTick),
    volume: volumeCurve(a.volumeEnvelope, a.volume, t2f, w.startTick),
    loop: a.loop,
  };
}

// ───────────────────────── bottom-up hashing (§7) ─────────────────────────
function hashLeaf(n: ClipNode | GapNode | OverlayNode | CaptionNode | AudioNode): void {
  switch (n.kind) {
    case "clip":
      for (const fx of n.effects) fx.hash = hashObj({ kind: "effect", effectKey: fx.effectKey, engine: fx.engine, params: fx.params, window: fx.window });
      n.hash = hashObj({ kind: "clip", source: { url: n.source.url, refKey: n.source.refKey, mediaKind: n.source.mediaKind }, inFrame: n.inFrame, outFrame: n.outFrame, playback: n.playback, volume: n.volume, effects: n.effects.map((f) => f.hash) });
      return;
    case "gap":
      n.hash = hashObj({ kind: "gap", dur: n.endFrame - n.startFrame });
      return;
    case "overlay":
      n.hash = hashObj({ kind: "overlay", overlayKey: n.overlayKey, window: n.window, placement: n.placement, params: n.params });
      return;
    case "caption":
      n.hash = hashObj({ kind: "caption", window: n.window, text: n.text, style: n.style, fontHash: n.fontHash, words: n.words });
      return;
    case "audio":
      n.hash = hashObj({ kind: "audio", source: { url: n.source.url, inFrame: n.source.inFrame, outFrame: n.source.outFrame }, volume: n.volume, loop: n.loop });
      return;
  }
}
function hashTrack(track: TrackNode): void {
  for (const it of track.items) if (it.kind !== "transition") hashLeaf(it);
  for (let i = 0; i < track.items.length; i++) {
    const it = track.items[i];
    if (it.kind === "transition") {
      const prev = track.items[i - 1];
      const next = track.items[i + 1];
      it.fromHash = prev?.hash ?? "";
      it.toHash = next?.hash ?? "";
      it.hash = hashObj({ kind: "transition", transitionKey: it.transitionKey, fromHash: it.fromHash, toHash: it.toHash, durationInFrames: it.durationInFrames, presentation: it.presentation, timing: it.timing });
    }
  }
  track.hash = hashObj({ kind: "track", trackKind: track.trackKind, role: track.role, children: track.items.map((i) => i.hash) });
}

export function edlToRenderIR(edl: Edl, env: RenderEnv, resolver: MediaResolver): RenderIR {
  const fps = env.fps;
  const tps = edl.timebase.ticksPerSecond;
  const t2f = (t: number) => ticksToFrame(t as Tick, fps, tps);
  const res = resolution(env.aspect, env.quality);
  const refKey: "full" | "proxy" = env.quality === "proxy" ? "proxy" : "full";
  const capTick = outputCapTicks(edl, env.aspect);

  const diagnostics: RenderDiagnostic[] = [];
  const positions = allClipPositions(edl);
  const leadAssetId = positions[0]?.clip.assetId ?? "";
  const looks = expandLooks(edl, resolver, { positions, res, t2f, leadAssetId, capTick, diagnostics });

  // video tracks (+ woven transitions)
  const videoTracks = edl.tracks.map((tr) => buildVideoTrack(tr, refKey, resolver, t2f, looks.byClip, capTick));
  for (const tn of videoTracks) weaveTransitions(tn, edl, t2f);

  // overlay / caption / audio tracks (deterministic order: by startFrame then id)
  const overlayNodes = [
    ...edl.overlays.map((o) => buildOverlayNode(o, leadAssetId, resolver, t2f, res, capTick)).filter((n): n is OverlayNode => n !== null),
    ...looks.overlays,
  ];
  if (env.tier === "free") {
    overlayNodes.push({ kind: "overlay", id: "ov_watermark", hash: "", overlayKey: "system-watermark", window: { startFrame: 0, endFrame: t2f(capTick) }, placement: staticPlacement({ mode: "bottomRight" }, res), params: {} });
  }
  overlayNodes.sort((a, b) => a.window.startFrame - b.window.startFrame || a.id.localeCompare(b.id));
  const captionNodes = edl.captions.map((c) => buildCaptionNode(c, t2f, capTick)).filter((n): n is CaptionNode => n !== null);
  const audioNodes = edl.audioBeds.map((a) => buildAudioNode(a, resolver, t2f, capTick)).filter((n): n is AudioNode => n !== null);

  const layers: TrackNode[] = [...videoTracks];
  if (overlayNodes.length) layers.push({ kind: "track", id: "track_overlay", hash: "", trackKind: "overlay", role: "overlay", items: overlayNodes });
  if (captionNodes.length) layers.push({ kind: "track", id: "track_caption", hash: "", trackKind: "caption", role: "caption", items: captionNodes });
  if (audioNodes.length) layers.push({ kind: "track", id: "track_audio", hash: "", trackKind: "audio", role: "music", items: audioNodes });

  for (const track of layers) hashTrack(track);
  const scene: StackNode = { kind: "stack", id: "stack", hash: hashObj({ kind: "stack", children: layers.map((l) => l.hash) }), layers };

  // Output duration = the full sequential length (Σclips) capped by the output variant's maxTicks,
  // NOT Σclips − Σtransitions.
  //
  // A crossfade shortens the timeline ONLY when the two clips actually OVERLAP. In v1 transitions
  // are painted as boundary treatments and clip nodes are laid strictly end-to-end here
  // (buildVideoTrack's cumulative cursor — no rebasing onto an overlap). Subtracting Σtransitions
  // therefore made durationInFrames shorter than the last clip's endFrame, so Remotion's
  // <Player>/<Composition> capped the comp and silently dropped the final clip's tail in BOTH preview
  // and export. Until @remotion/transitions lands (TransitionSeries consuming offsetFrame) the honest,
  // WYSIWYG-correct duration is the un-shortened total. The transition nodes (with offsetTick/Frame)
  // remain in the IR for that future work; they just don't affect duration while unrendered.
  const durationTicks = capTick;

  return {
    schema: "RenderIR.1",
    timebase: { ticksPerSecond: tps },
    fps,
    resolution: res,
    durationTicks,
    durationInFrames: t2f(durationTicks),
    meta: { edlContentHash: edl.contentHash ?? "", engineFingerprint: env.engineFingerprint, quality: env.quality },
    scene,
    rootHash: scene.hash,
    diagnostics,
  };
}
