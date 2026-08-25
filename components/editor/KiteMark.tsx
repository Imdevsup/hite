type Props = {
  size?: number;
  className?: string;
  accent?: boolean;     // draw in accent (focused window)
  muted?: boolean;      // dimmed
  rotate?: number;      // degrees
  spin?: boolean;       // loading: gentle sway rotation
  stroke?: number;
};

/**
 * KiteMark — the HITE signature. A stylized kite: diamond + string + crossbar + tail.
 * Used as logo, focus indicator (top-left of focused window), cursor shape,
 * and loading state (sways gently — never a CSS spinner).
 *
 * SERVER COMPONENT, DELIBERATELY. This was a `"use client"` module wrapping `motion.svg` to animate
 * one `rotate` value, and it is imported by `app/error.tsx` and `app/not-found.tsx` — whose chunks
 * every route loads. That made it the sole reason `motion` (38.3KB gz) and `tailwind-merge` (6.6KB)
 * shipped to visitors of a landing page that imports neither: ~45KB of JS to turn an SVG a few
 * degrees. A transform and a keyframe do the same job with zero runtime, so the markup is now static
 * and the animation lives in `.kitemark-sway` (globals.css), which is authored inside
 * `prefers-reduced-motion: no-preference` per the motion system — the sway is decoration, and a
 * still kite is the honest resting state.
 */
export function KiteMark({
  size = 22,
  className,
  accent = false,
  muted = false,
  rotate = 0,
  spin = false,
  stroke = 1.6,
}: Props) {
  const color = accent
    ? "var(--color-accent)"
    : muted
      ? "var(--color-fg-dim)"
      : "var(--color-fg)";

  return (
    <svg
      viewBox="0 0 24 36"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={["overflow-visible", spin ? "kitemark-sway" : null, className]
        .filter(Boolean)
        .join(" ")}
      style={{
        transformOrigin: "50% 35%",
        // The sway animates around this base angle, so the two cannot fight.
        ...(rotate ? { rotate: `${rotate}deg` } : null),
      }}
    >
      <path d="M13 1 L3 21 L13 21 Z" />
      <path d="M13 1 L13 33" />
      <path d="M3 21 L21 21" />
      <path d="M13 21 L21 21 L13 30 Z" />
    </svg>
  );
}
