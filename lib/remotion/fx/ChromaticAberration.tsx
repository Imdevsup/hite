import type { EffectRendererProps } from "../registry";
import { withinWindow } from "./window";

export function ChromaticAberration({ params, frame, startFrame, endFrame, children }: EffectRendererProps) {
  // `chromatic-flash` is a MOMENTARY hit — outside its window the clip must pass through untouched.
  if (!withinWindow(frame, startFrame, endFrame)) return <>{children}</>;
  const strength = (params.strength as number) ?? 0.6;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div style={{ filter: `drop-shadow(${strength * 2}px 0 0 #ff0040) drop-shadow(${-strength * 2}px 0 0 #00d8ff)` }}>
        {children}
      </div>
    </div>
  );
}
