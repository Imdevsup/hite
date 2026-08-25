import type { EffectRendererProps } from "../registry";
import { withinWindow } from "./window";

export function Vignette({ params, frame, startFrame, endFrame, children }: EffectRendererProps) {
  if (!withinWindow(frame, startFrame, endFrame)) return <>{children}</>;
  const strength = (params.strength as number) ?? 0.5;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {children}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${strength}) 100%)`,
        }}
      />
    </div>
  );
}
