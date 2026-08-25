import type { EffectRendererProps } from "../registry";
import { withinWindow } from "./window";

export function RgbSplit({ params, frame, startFrame, endFrame, children }: EffectRendererProps) {
  if (!withinWindow(frame, startFrame, endFrame)) return <>{children}</>;
  const strength = (params.strength as number) ?? 0.8;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        filter:
          `drop-shadow(${strength * 4}px 0 0 rgba(255,0,64,0.9)) drop-shadow(${-strength * 4}px 0 0 rgba(0,220,255,0.9))`,
      }}
    >
      {children}
    </div>
  );
}
