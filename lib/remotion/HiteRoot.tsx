/**
 * lib/remotion/HiteRoot.tsx — the SINGLE composition that consumes the Render IR.
 *
 * docs/CANONICAL-IR-SPEC.md §5/§6, docs/DECISIONS.md §1.8. Both surfaces use this exact tree:
 *   • preview  → <Player component={HiteRoot} inputProps={{ ir }} />   (P4)
 *   • export   → <Composition component={HiteRoot} /> + renderMedia    (P5)
 * so they are pixel-identical by construction. Frames are already materialized in the IR
 * (ticksToFrame ran once in the compiler); this component does NO tick math.
 *
 * Frame spaces (get these wrong and preview/export agree on the WRONG picture): the IR is entirely in
 * ABSOLUTE timeline frames, while useCurrentFrame() inside any <Sequence> is relative to that
 * sequence. Every crossing is explicit here — clipRelativeWindow for effect windows, volumeProp's
 * offset for volume curves, `window.startFrame + local` in CaptionView/TransitionView.
 *
 * v1 coverage: clips (video trim+speed+volume, stills via <Img>), gaps, windowed remotion-engine
 * effects, LUT + color looks (CSS-filter approximation via fx/ColorGrade), transition treatments,
 * overlays (resolved placement), captions (central font + per-word read-along), audio beds.
 * TODOs (type-safe, render later):
 *   • lut effects → P6 WebGL tetrahedral 3D-LUT sampler (replaces the CSS-filter approximation)
 *   • gl-transitions used as clip effects → P6 WebGL shaders (no renderer yet → skipped)
 *   • per-frame face-tracked overlay interpolation (uses first keyframe for now)
 */
import { AbsoluteFill, Sequence, OffthreadVideo, Img, Audio, useCurrentFrame, interpolate } from "remotion";
import type { CSSProperties, ReactNode } from "react";
import type {
  RenderIR,
  TrackNode,
  ClipNode,
  EffectNode,
  OverlayNode,
  CaptionNode,
  AudioNode,
  TransitionNode,
  VolumeCurve,
} from "@/lib/render/ir";
import { getEffectRenderer } from "./registry";
import { captionStyle, captionAnchor, captionWordStyle } from "./fonts";
import { TransitionView, boundaryWindow } from "./fx/TransitionView";
import { ProceduralOverlay, hasProceduralOverlay } from "./fx/OverlayProcedural";

/**
 * Remotion's `volume` callback is handed SEQUENCE-RELATIVE frames, while the IR stores every
 * keyframe in ABSOLUTE timeline frames (ir.ts VolumeCurve) — so the curve must be rebased onto the
 * node's own <Sequence>, exactly like clipRelativeWindow does for effect windows. Without the
 * rebase a duck authored at 0:20 on a clip that starts at 0:18 fires 20s into the clip. Pure —
 * exported for tests.
 */
export function volumeProp(v: VolumeCurve, sequenceStartFrame: number): number | ((f: number) => number) {
  if (v.kind === "static") return v.gain;
  // A one-keyframe envelope IS a constant gain — and `interpolate` throws on a single-value input
  // range, which would take the whole render down.
  if (v.atFrames.length < 2) return v.gains[0] ?? 1;
  const atFrames = v.atFrames.map((f) => f - sequenceStartFrame);
  return (f: number) => interpolate(f, atFrames, v.gains, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

/**
 * Rebase an effect's window onto its clip. The IR window is in ABSOLUTE TIMELINE frames (ir.ts
 * EffectNode.window — NOT clip-local, whatever the EDL schema's comment says); the clip renders
 * inside a <Sequence from={clipStartFrame}> where useCurrentFrame() is clip-relative, so the bounds
 * have to move into that space before a renderer can gate on them. Returns undefined bounds for a
 * whole-clip effect. Pure — exported for tests.
 */
export function clipRelativeWindow(
  window: { startFrame: number; endFrame: number } | undefined,
  clipStartFrame: number,
): { startFrame: number | undefined; endFrame: number | undefined } {
  if (!window) return { startFrame: undefined, endFrame: undefined };
  return { startFrame: window.startFrame - clipStartFrame, endFrame: window.endFrame - clipStartFrame };
}

/**
 * Wrap `children` in the registered renderer for one effect, or hand them back untouched when the
 * key has no renderer (gl-transitions used as clip effects → P6 WebGL). `frame` and `clipStartFrame`
 * are the caller's CLIP-RELATIVE frame and the clip's ABSOLUTE start, in that order.
 *
 * A plain element factory rather than JSX inlined into ClipFx, because react-hooks/static-components
 * rejects any JSX tag whose identifier came out of a call — a component *built* during render would
 * remount, and so reset its state, every frame. Nothing is built here: getEffectRenderer is a lookup
 * in the module-level map in ./registry, which hands back the same component identity for the life
 * of the process. Not a component itself (it takes no props object and renders no hooks), so the
 * effect stack stays one plain reduction over node.effects.
 */
function withEffectRenderer(
  fx: EffectNode,
  frame: number,
  clipStartFrame: number,
  children: ReactNode,
): ReactNode {
  const Renderer = getEffectRenderer(fx.effectKey);
  if (!Renderer) return children;
  const { startFrame, endFrame } = clipRelativeWindow(fx.window, clipStartFrame);
  return (
    <Renderer params={fx.params} frame={frame} startFrame={startFrame} endFrame={endFrame}>
      {children}
    </Renderer>
  );
}

/** Exported for tests (rendered against a stubbed Remotion — see HiteRoot.render.test.tsx). */
export function ClipFx({ node }: { node: ClipNode }) {
  const frame = useCurrentFrame();
  // A still on the timeline (the AI and the media window both allow it) must render as an <Img>:
  // <OffthreadVideo> pointed at a PNG breaks the preview frame and CRASHES renderMedia on export,
  // minutes into a render. trim/playbackRate/volume are meaningless for a still — the clip's
  // timeline span alone decides how long it is on screen.
  let content: ReactNode =
    node.source.mediaKind === "image" ? (
      <Img src={node.source.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      <OffthreadVideo
        src={node.source.url}
        trimBefore={node.inFrame}
        trimAfter={node.outFrame}
        playbackRate={node.playback.kind === "static" ? node.playback.rate : 1}
        volume={volumeProp(node.volume, node.startFrame)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    );
  // Wrap in any effect that has a REGISTERED renderer — gate on the renderer, not the engine. The
  // `remotion`-engine fx (glitch/zoom/grain/vignette) and the `lut`-engine film looks (A24, Kodachrome,
  // VHS… → CSS-filter approximation in fx/ColorGrade) both have renderers, so both must paint here in
  // preview AND export (same HiteRoot tree ⇒ WYSIWYG). `gl-transitions`-engine fx have no renderer yet
  // (P6 WebGL) → getEffectRenderer returns undefined → they're skipped naturally, no engine check needed.
  // The IR effect window is in ABSOLUTE timeline frames; `frame` here is CLIP-RELATIVE (useCurrentFrame
  // inside the clip's Sequence). Rebase the window onto the clip so the renderer's gate lines up.
  for (const fx of node.effects) content = withEffectRenderer(fx, frame, node.startFrame, content);
  return <>{content}</>;
}

/**
 * Whether public/overlays/ actually holds the .webm files the asset path below would fetch.
 *
 * It ships only a README (the repo's asset ledger says so), so nothing may be fetched from there.
 * Flip this when real overlay assets land — and resolve them through the media resolver like every
 * other asset, rather than assuming a filename exists.
 */
const OVERLAY_ASSETS_SHIPPED = false;

/** Exported for tests (see HiteRoot.render.test.tsx). */
export function OverlayView({ node }: { node: OverlayNode }) {
  // The free-tier watermark is rendered as a styled brand mark — NOT an external asset — so it can
  // never 404 the render (it is injected unconditionally for free exports, the default tier).
  if (node.overlayKey === "system-watermark") {
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: "3.2%" }}>
        <span
          style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: "2.4vw",
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "rgba(255,255,255,0.62)",
            textShadow: "0 1px 8px rgba(0,0,0,0.55)",
          }}
        >
          HITE
        </span>
      </AbsoluteFill>
    );
  }
  // Known overlay keys (scan-lines, light-leak, lightning, skull/drop) render as DETERMINISTIC CSS so
  // they never 404 (public/overlays/ ships only a README; a missing OffthreadVideo src crashes
  // renderMedia and shows broken in preview). These are full-bleed treatments — placement is ignored.
  if (hasProceduralOverlay(node.overlayKey)) {
    return (
      <AbsoluteFill>
        <ProceduralOverlay overlayKey={node.overlayKey} />
      </AbsoluteFill>
    );
  }
  // AN UNKNOWN KEY PAINTS NOTHING. It used to assume a real asset had been dropped at
  // /overlays/<key>.webm — but public/overlays/ ships only a README, so that path is a guaranteed
  // 404, and (as the comment above says) a missing OffthreadVideo src does not degrade: it CRASHES
  // renderMedia. The reducer accepts any overlayKey, so a single hallucinated key from the model was
  // enough to kill an export outright. Skipping matches how ClipFx already treats an effect it
  // cannot draw, and turns a dead render into a missing overlay.
  //
  // The moment real overlay assets ship, this is where they get resolved — through the media
  // resolver like every other asset, not by assuming a filename exists.
  if (!OVERLAY_ASSETS_SHIPPED) return null;
  const src = `/overlays/${node.overlayKey}.webm`;
  const kf = node.placement.mode === "face" ? node.placement.track.keyframes[0] : undefined;
  // A face track with no keyframes used to fall back to {x:0,y:0,w:0,h:0} — a 0×0 div, i.e. an
  // overlay that reports success and renders NOTHING. compile.ts already redirects an empty track to
  // a centered static placement; this mirrors that as the last line of defence, in percentages
  // (the component has no access to the composition size) matching staticPlacement's 40% box.
  const box: CSSProperties =
    node.placement.mode === "static"
      ? { left: node.placement.x, top: node.placement.y, width: node.placement.w, height: node.placement.h }
      : kf
        ? { left: kf.bbox[0], top: kf.bbox[1], width: kf.bbox[2], height: kf.bbox[3] }
        : { left: "30%", top: "30%", width: "40%", height: "40%" };
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", ...box }}>
        <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    </AbsoluteFill>
  );
}

/**
 * Which word is being spoken at an ABSOLUTE timeline frame. -1 before the first word, after the last,
 * and in the gaps between them. Pure — exported for tests.
 */
export function activeWordIndex(words: CaptionNode["words"], frame: number): number {
  return words.findIndex((w) => frame >= w.startFrame && frame < w.endFrame);
}

/** Exported for tests (see activeWordIndex + HiteRoot.render.test.tsx). */
export function CaptionView({ node }: { node: CaptionNode }) {
  // Wrapped in a <Sequence> by TrackView, so useCurrentFrame() here is window-relative — add the
  // window start back to get the ABSOLUTE timeline frame the IR's word timings live in (the same
  // convention TransitionView uses).
  const frame = node.window.startFrame + useCurrentFrame();
  // Screen anchor is style-aware (lib/remotion/fonts.ts captionAnchor) so a lower-third sits bottom-left
  // and a hashtag sticker sits top-right — matching how captionStyle makes each one LOOK. padding draws
  // a resolution-independent safe area so the caption never kisses the frame edge on any aspect.
  const a = captionAnchor(node.style);
  const style = captionStyle(node.style);
  // Per-word timings are compiled into the IR but used to be thrown away here, so "karaoke" was
  // static styling and nothing more. When words are present, paint the read-along: spoken words stay
  // lit, the current word is highlighted, upcoming words sit dim. Word frames are ABSOLUTE (like the
  // rest of the IR) and `frame` arrives absolute from TrackView, so no rebasing is needed.
  if (!node.words.length) {
    return (
      <AbsoluteFill style={{ justifyContent: a.justifyContent, alignItems: a.alignItems, padding: a.inset }}>
        <span style={style}>{node.text}</span>
      </AbsoluteFill>
    );
  }
  const active = activeWordIndex(node.words, frame);
  return (
    <AbsoluteFill style={{ justifyContent: a.justifyContent, alignItems: a.alignItems, padding: a.inset }}>
      <span style={style}>
        {node.words.map((w, i) => (
          <span
            key={`${i}-${w.startFrame}`}
            style={captionWordStyle(node.style, i === active ? "active" : frame >= w.endFrame ? "spoken" : "upcoming")}
          >
            {i === 0 ? w.text : ` ${w.text}`}
          </span>
        ))}
      </span>
    </AbsoluteFill>
  );
}

function TrackView({ track, compDurationInFrames }: { track: TrackNode; compDurationInFrames: number }) {
  // The cut boundary of a transition is the END of the clip immediately before it (clips abut in v1).
  // Walk the items once tracking the running endFrame so each transition knows its boundary.
  const transitions: { node: TransitionNode; window: { startFrame: number; endFrame: number } }[] = [];
  let prevEnd = 0;
  for (const item of track.items) {
    if (item.kind === "clip" || item.kind === "gap") prevEnd = item.endFrame;
    else if (item.kind === "transition") {
      transitions.push({ node: item, window: boundaryWindow(prevEnd, item.durationInFrames, compDurationInFrames) });
    }
  }
  return (
    <>
      {track.items.map((item) => {
        switch (item.kind) {
          case "clip":
            return (
              <Sequence key={item.id} from={item.startFrame} durationInFrames={Math.max(1, item.endFrame - item.startFrame)} name={item.id}>
                <ClipFx node={item as ClipNode} />
              </Sequence>
            );
          case "overlay": {
            const o = item as OverlayNode;
            return (
              <Sequence key={o.id} from={o.window.startFrame} durationInFrames={Math.max(1, o.window.endFrame - o.window.startFrame)}>
                <OverlayView node={o} />
              </Sequence>
            );
          }
          case "caption": {
            const c = item as CaptionNode;
            return (
              <Sequence key={c.id} from={c.window.startFrame} durationInFrames={Math.max(1, c.window.endFrame - c.window.startFrame)}>
                <CaptionView node={c} />
              </Sequence>
            );
          }
          case "audio": {
            const a = item as AudioNode;
            return (
              <Sequence key={a.id} from={a.startFrame} durationInFrames={Math.max(1, a.endFrame - a.startFrame)}>
                <Audio src={a.source.url} volume={volumeProp(a.volume, a.startFrame)} loop={a.loop} />
              </Sequence>
            );
          }
          // gap → empty; transition → painted on top in the pass below (must overlay BOTH clips).
          default:
            return null;
        }
      })}
      {/* Transition treatments paint AFTER (on top of) every clip in this track so the veil covers
          both the outgoing and incoming clip — a transition node sits between them in `items`, which
          would otherwise render under the incoming clip. */}
      {transitions.map(({ node, window }) => (
        <Sequence key={node.id} from={window.startFrame} durationInFrames={Math.max(1, window.endFrame - window.startFrame)} name={`trans:${node.transitionKey}`}>
          <TransitionView node={node} window={window} />
        </Sequence>
      ))}
    </>
  );
}

export function HiteRoot({ ir }: { ir: RenderIR }) {
  return (
    <AbsoluteFill style={{ background: "black" }}>
      {ir.scene.layers.map((track) => (
        <TrackView key={track.id} track={track} compDurationInFrames={ir.durationInFrames} />
      ))}
    </AbsoluteFill>
  );
}
