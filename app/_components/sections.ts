/**
 * app/_components/sections.ts — the landing's anchor contract.
 *
 * `SITE_NAV_LINKS` and `SITE_FOOTER_COLUMNS` (components/site/SiteChrome.tsx) name these anchors;
 * the section components take them as props. The ids live here, at the one place that knows both
 * halves, so a rename is a single edit and `app/page.test.tsx` can assert that every in-page href
 * resolves to an id the assembled tree renders.
 *
 * A plain module rather than an export from `page.tsx`: a route file's export surface is validated
 * by Next, and a shared constant is not one of the exports it expects there. `_components` is a
 * private folder (leading underscore), so nothing here is routable — the same convention
 * `app/app/_components` already uses.
 */
export const SECTION_IDS = {
  /** §6.1 — the 39 words and the console. */
  hero: "hero",
  /** §6.2 — the pinned set-piece. Nav: "How it works". */
  mechanism: "how-it-works",
  /** §6.3 — the falsifiable proof. */
  realTimeline: "real-timeline",
  /**
   * §6.4, the gated catalog, is DELIBERATELY ABSENT. It was 595 words — the largest section on the
   * page by a wide margin, and a wall of effect names is the opposite of "type a sentence, get an
   * edit". The gate itself is untouched and still load-bearing: `lib/landing/catalog.ts` and
   * `lib/ai/tools/renderableEntry.ts` still stop the model from being offered a key the renderer
   * cannot paint, and llms.txt still publishes the honest count for answer engines. What went away
   * is the visitor having to read it.
   */
  /** §6.5 — the developer band. Nav: "Docs" (there is no /docs route; this band is the entry point). */
  developers: "for-developers",
  /** §6.6 — the prompt rail. */
  promptRail: "what-to-type",
  /** §6.7 — the FAQ. */
  faq: "faq",
} as const;
