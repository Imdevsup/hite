"use client";
import { useEffect, useState } from "react";

/**
 * Editor mobile-layout breakpoint. Phones + small tablets (portrait) fall under this;
 * desktop (>= 821px) is everything above. Kept as a single source of truth so the
 * EditorShell branch and any CSS media queries agree on the same 820px line.
 */
export const MOBILE_MAX_WIDTH = 820;
const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/**
 * SSR-safe viewport check for the editor's mobile layout.
 *
 * Returns `false` on the server AND on the very first client render (no `window` /
 * to match the server HTML), then flips to the real `matchMedia` result in a mount
 * effect. Because the desktop layout is the first-paint default, the server-rendered
 * markup and first client paint always agree → no hydration mismatch. The phone then
 * upgrades to the mobile shell one tick after mount.
 *
 * This is a pure read of the viewport — it dispatches nothing, mutates no store, and
 * touches no data path. The desktop render path is never affected by it (the consumer
 * only swaps shells when this is `true`).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    // addEventListener is the modern API; fall back to addListener for older Safari.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  return isMobile;
}
