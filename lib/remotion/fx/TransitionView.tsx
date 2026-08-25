/**
 * lib/remotion/fx/TransitionView.tsx — renders a TransitionNode as a boundary treatment overlay.
 *
 * Consumed by HiteRoot's TrackView. The window is computed (boundaryWindow, from ./transition) so it
 * STRADDLES the cut between the two abutting clips; the veil math also lives in ./transition (pure,
 * tested). Wrapped in a <Sequence> by the caller, so useCurrentFrame() here is window-relative — we
 * add the window start back to feed transitionVeil absolute-timeline frames (it clamps to [start,end)).
 *
 * Named TransitionView (not Transition) on purpose: a `Transition.tsx` sibling of the pure
 * `transition.ts` module differs only by case and is unresolvable on case-insensitive filesystems
 * (it made tsc pick the wrong file). Distinct names remove that hazard.
 */
import { useCurrentFrame } from "remotion";
import type { TransitionNode } from "@/lib/render/ir";
import { classifyTransition, transitionVeil, boundaryWindow } from "./transition";

export { boundaryWindow };

export function TransitionView({
  node,
  window,
}: {
  node: TransitionNode;
  window: { startFrame: number; endFrame: number };
}) {
  const local = useCurrentFrame();
  const frame = window.startFrame + local; // window-relative → absolute timeline
  const pres = classifyTransition(node.transitionKey);
  const style = transitionVeil(pres, frame, window.startFrame, window.endFrame);
  if (!style) return null;
  return <div style={style} />;
}
