"use client";
import { MotionConfig } from "motion/react";

/** Global motion config — `reducedMotion="user"` auto-respects the OS setting for all transform
 *  transitions. Per-component guards still handle DOM-structure changes (split text, count-ups). */
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
