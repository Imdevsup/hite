import type { EffectRendererProps } from "../registry";
import { withinWindow } from "./window";

/**
 * Pure scale curve for the zoom-punch: snap up to `amount` over `enterFrames`, hold, then release
 * once the (clip-relative) window closes. All inputs are clip-relative FRAMES. Exported for tests —
 * this is the timing math that previously had a frames-vs-ms unit bug.
 */
export function zoomPunchScale(
  frame: number,
  amount: number,
  startFrame: number | undefined,
  endFrame: number | undefined,
  enterFrames = 4,
): number {
  const start = startFrame ?? 0;
  const past = endFrame != null && frame >= endFrame; // window closed → no punch
  const before = frame < start; // not started yet
  const local = frame - start;
  const t = past || before ? 0 : Math.max(0, Math.min(1, local / enterFrames));
  return 1 + (amount - 1) * t;
}

export function ZoomPunch({ params, startFrame, endFrame, frame, children }: EffectRendererProps) {
  // Outside the window the punch is scale 1 — pass the clip through un-wrapped, like every other
  // renderer (lib/remotion/fx/window.ts), so "no effect" is one behaviour across the fx set.
  if (!withinWindow(frame, startFrame, endFrame)) return <>{children}</>;
  const amount = (params.amount as number) ?? 1.12;
  // `frame`, `startFrame`, `endFrame` are all clip-relative frames (see EffectRendererProps).
  const scale = zoomPunchScale(frame, amount, startFrame, endFrame);
  return (
    <div style={{ width: "100%", height: "100%", transform: `scale(${scale})`, transformOrigin: "center" }}>
      {children}
    </div>
  );
}
