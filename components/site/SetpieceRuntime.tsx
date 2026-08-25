"use client";

/**
 * components/site/SetpieceRuntime.tsx — the hero set-piece's ONLY JavaScript.
 *
 * It does two things, both of which the CSS cannot:
 *
 *  1. `will-change: transform` on the ribbon while the section is on screen, and nothing when it is
 *     not. `app/globals.css`'s 3D block asks for exactly this and says why: a permanent compositor
 *     layer for a set-piece that occupies one screen of a multi-screen page is memory the rest of
 *     the page pays for and never uses.
 *
 *  2. `data-play` for the ~15% of visitors whose browser has no scroll-driven animations (iOS ≤ 18.7,
 *     Firefox ≤ 156). They get the identical `@keyframes` on a time-based driver, played once. It is
 *     a degradation and the component says so: the viewer does not control the rate. It never runs
 *     under `prefers-reduced-motion`, and every state it passes through is already in the resting
 *     DOM, so a visitor who scrolls past during playback has lost nothing.
 *
 * WHAT IT IS NOT: a scroll listener. `ART-DIRECTION.md` §16's "zero JS scroll consumers" survives
 * intact for 100% of visitors — this is one `IntersectionObserver` on the section itself, the same
 * construction the nav already uses, and it reads no scroll position at any point.
 */
import { useEffect } from "react";

export interface SetpieceRuntimeProps {
  /** The `id` of the `.sp` section this observer governs. */
  readonly sectionId: string;
  /** The `id` of the rigid body inside it. */
  readonly ribbonId: string;
}

export function SetpieceRuntime({ sectionId, ribbonId }: SetpieceRuntimeProps): null {
  useEffect(() => {
    const section = document.getElementById(sectionId);
    const ribbon = document.getElementById(ribbonId);
    if (!section || !ribbon) return;

    // The timed edition is for browsers without scroll-driven animations, and never for a visitor
    // who has asked for less motion.
    const scrubbed =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("animation-timeline", "view()");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            ribbon.style.willChange = "transform";
            if (!scrubbed && !calm) {
              section.dataset.play = "true";
              // Played once, by design: re-triggering a 9s cutscene every time it scrolls back into
              // view is the "video of a UI" the brief bans, on a loop.
              observer.disconnect();
            }
          } else {
            ribbon.style.removeProperty("will-change");
          }
        }
      },
      { rootMargin: "20% 0px" },
    );
    observer.observe(section);
    return () => {
      observer.disconnect();
      ribbon.style.removeProperty("will-change");
    };
  }, [sectionId, ribbonId]);

  return null;
}

export default SetpieceRuntime;
