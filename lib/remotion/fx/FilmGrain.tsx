import type { EffectRendererProps } from "../registry";
import { withinWindow } from "./window";

export function FilmGrain({ params, frame, startFrame, endFrame, children }: EffectRendererProps) {
  if (!withinWindow(frame, startFrame, endFrame)) return <>{children}</>;
  const intensity = (params.intensity as number) ?? 0.04;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {children}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "120px 120px",
          backgroundPosition: `${(frame * 7) % 120}px ${(frame * 11) % 120}px`,
          mixBlendMode: "overlay",
          opacity: intensity,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
