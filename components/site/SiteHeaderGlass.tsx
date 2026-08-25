"use client";

/**
 * components/site/SiteHeaderGlass.tsx — the ONLY interactive byte in the landing's chrome.
 *
 * WHY THIS FILE EXISTS (DESIGN-DIRECTION §12, the ≤140KB landing JS budget).
 * `SiteChrome.tsx` used to be one `"use client"` module, and its own header comment named the cost
 * honestly: "the footer's markup is also in the client bundle". Measured, that cost was **7.0KB
 * gzipped** — the wordmark, the skip link, the final CTA, five footer columns, twenty-two links and
 * every class constant, all shipped to a browser that only ever needed to flip one boolean. A
 * source-map attribution of `.next/static/chunks/app/page-*.js` is where that number comes from; it
 * was the single largest piece of first-party JS on the page.
 *
 * §6.0 asks for the glass to materialise "via ONE IntersectionObserver sentinel". That is a browser
 * API, so *something* has to be a client module — but it is this 40-line shell, not the chrome.
 * Everything else in `SiteChrome.tsx` is now a Server Component and ships zero JS.
 *
 * HOW THE STATE REACHES THE PAINTED LAYERS WITHOUT DRAGGING THEM ACROSS THE BOUNDARY.
 * The tint and the CTA glow are server-rendered `children`. They read the state through CSS, not
 * through React: this element publishes `data-glass="on" | "off"` and carries Tailwind's `group`
 * marker, and each layer paints itself with `group-data-[glass=on]:opacity-100` over a resting
 * `opacity-0`. That is strictly better than the previous construction as well as smaller — a scroll
 * that crosses the hero foot now costs one compositor-driven opacity transition instead of a React
 * re-render of the entire header subtree.
 *
 * THE THREE RULES OF §6.0 ARE UNCHANGED AND LIVE HERE:
 *   1. STICKY, NEVER FIXED — `position: fixed` + `backdrop-filter` is the iOS repaint trap.
 *   2. THE BOX HEIGHT NEVER ANIMATES — `--nav-h` (56px = 14 frames) at every scroll position. Only
 *      a child's opacity changes, so the page never reflows under the reader.
 *   3. `data-glass` SSRs as `"off"` — at the top of the page the bar is invisible chrome over the
 *      hero, which is what makes the first screen feel open. `SiteChrome.test.tsx` asserts it.
 *
 * IMPORTS NOTHING. Not `cn` (that would pull tailwind-merge's 6.5KB into the client graph for a
 * three-class string), not `next/link`, not an icon set. Every byte in this file is this file.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Where the built-in sentinel sits when the hero does not supply its own: §6.1 fixes the hero at
 * `min(70svh, 780px)`, so an element parked at that offset from the document origin marks the hero
 * foot without this unit needing to measure anything or subscribe to scroll (§12 budgets exactly one
 * JS scroll consumer, and it belongs to the Mechanism pin — an IntersectionObserver is not one).
 */
const HERO_FOOT_OFFSET = "min(70svh, 780px)";

export interface SiteHeaderGlassProps {
  /**
   * Id of an element the hero renders at its own foot. When present it wins, because the hero knows
   * its real height; when absent this component parks its own sentinel at §6.1's offset. Either way
   * there is exactly ONE IntersectionObserver on the page from this unit.
   */
  heroFootId?: string;
  /** The bar's contents — server-rendered, and never bundled into the client graph. */
  children: ReactNode;
}

export function SiteHeaderGlass({ heroFootId, children }: SiteHeaderGlassProps) {
  // `false` is the state that server-renders (§6.0 rule 3).
  const [glass, setGlass] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = (heroFootId ? document.getElementById(heroFootId) : null) ?? sentinelRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // Glass on only once the hero foot has left through the TOP of the viewport. Checking the
        // rect's sign as well as intersection keeps the bar clear when the sentinel is simply below
        // the fold (a short page, a zoomed-out desktop), where "not intersecting" is not "scrolled".
        setGlass(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [heroFootId]);

  return (
    <>
      {/* The sentinel. Absolutely positioned with no positioned ancestor, so its containing block is
          the initial one — i.e. it is pinned to the DOCUMENT at the hero's foot and does not travel
          with the sticky bar. It must live outside <header> for exactly that reason. */}
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none"
        style={{
          position: "absolute",
          insetInlineStart: 0,
          insetBlockStart: HERO_FOOT_OFFSET,
          inlineSize: "1px",
          blockSize: "1px",
        }}
      />

      <header
        data-glass={glass ? "on" : "off"}
        className="group sticky top-0 z-40"
        style={{ blockSize: "var(--nav-h)" }}
      >
        {children}
      </header>
    </>
  );
}
