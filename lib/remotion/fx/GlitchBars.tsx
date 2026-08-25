import type { EffectRendererProps } from "../registry";
import { withinWindow } from "./window";

export function GlitchBars({ params, frame, startFrame, endFrame, children }: EffectRendererProps) {
  if (!withinWindow(frame, startFrame, endFrame)) return <>{children}</>;
  const density = (params.density as number) ?? 0.4;
  const bars = Math.max(2, Math.round(density * 12));
  const seed = Math.floor(frame / 3);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {children}
      {Array.from({ length: bars }).map((_, i) => {
        const pct = ((seed * 17 + i * 97) % 100);
        const h = ((seed * 31 + i * 53) % 18) + 2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${pct}%`,
              height: `${h}px`,
              background: "rgba(194, 242, 78, 0.08)",
              mixBlendMode: "screen",
              transform: `translateX(${(seed * 13 + i) % 40 - 20}px)`,
            }}
          />
        );
      })}
    </div>
  );
}
