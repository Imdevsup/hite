/**
 * lib/remotion/fx/OverlayProcedural.tsx — procedural CSS/SVG overlays so HiteRoot never points an
 * <OffthreadVideo> at a missing /overlays/<key> asset (public/overlays/ ships only a README → those
 * paths 404, which breaks the skull-drop + VHS looks in preview AND crashes renderMedia on export).
 *
 * Same philosophy as the free-tier watermark in HiteRoot: render the overlay as deterministic CSS
 * (no randomness — `lib/remotion/**` bans Math.random/Date.now), so it is identical in <Player> and
 * renderMedia and can never 404. When a real overlay asset is dropped into public/overlays/ later,
 * OverlayView falls back to <OffthreadVideo> for keys that aren't procedural.
 *
 * `hasProceduralOverlay` + the family classification are PURE → unit-testable.
 */
import { useCurrentFrame } from "remotion";

export type OverlayFamily = "scanlines" | "lightleak" | "lightning" | "drop" | "none";

/** Classify a registry overlayKey into a procedural family (or "none" → use the asset/url). Pure. */
export function overlayFamily(overlayKey: string): OverlayFamily {
  const k = overlayKey.toLowerCase();
  if (k.includes("scan")) return "scanlines";
  if (k.includes("leak")) return "lightleak";
  if (k.includes("lightning")) return "lightning";
  if (k.includes("skull") || k.includes("drop")) return "drop";
  return "none";
}

export function hasProceduralOverlay(overlayKey: string): boolean {
  return overlayFamily(overlayKey) !== "none";
}

/** Triangle 0→1→0 across a period; pure helper for the animated leak/lightning intensity. */
function tri(frame: number, period: number): number {
  const p = Math.max(1, period);
  const t = (frame % p) / p;
  return 1 - Math.abs(t * 2 - 1);
}

export function ProceduralOverlay({ overlayKey }: { overlayKey: string }) {
  const frame = useCurrentFrame();
  const fam = overlayFamily(overlayKey);

  switch (fam) {
    case "scanlines":
      // CRT scan lines — static repeating gradient, very light, multiply blend.
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.0) 0px, rgba(0,0,0,0.0) 2px, rgba(0,0,0,0.22) 3px, rgba(0,0,0,0.0) 4px)",
            mixBlendMode: "multiply",
            opacity: 0.6,
          }}
        />
      );

    case "lightleak": {
      // Warm leak that breathes from the top-right corner.
      const k = 0.4 + tri(frame, 90) * 0.6;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(60% 80% at 90% 5%, rgba(255,140,60,0.55) 0%, rgba(255,80,40,0.18) 35%, rgba(0,0,0,0) 70%)",
            mixBlendMode: "screen",
            opacity: Math.round(k * 1000) / 1000,
          }}
        />
      );
    }

    case "lightning": {
      // Hard white flashes on a short, deterministic cadence (every ~18 frames, 2-frame strike).
      const phase = frame % 18;
      const on = phase < 2 ? 1 : phase < 4 ? 0.35 : 0;
      if (on === 0) return null;
      return <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "rgba(255,255,255,1)", opacity: on, mixBlendMode: "screen" }} />;
    }

    case "drop": {
      // Beat-drop hit: a punchy vignette + chromatic rim glow that pulses. Honest stylized stand-in
      // for the literal skull asset (which can be dropped in later); never 404s, reads as a "drop".
      const k = 0.55 + tri(frame, 24) * 0.45;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            boxShadow: `inset 0 0 ${(120 * k).toFixed(0)}px ${(40 * k).toFixed(0)}px rgba(0,0,0,0.7), inset ${(10 * k).toFixed(1)}px 0 60px rgba(255,0,64,${(0.5 * k).toFixed(3)}), inset ${(-10 * k).toFixed(1)}px 0 60px rgba(0,220,255,${(0.5 * k).toFixed(3)})`,
            mixBlendMode: "screen",
          }}
        />
      );
    }

    default:
      return null;
  }
}
