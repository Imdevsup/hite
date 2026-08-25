import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/jsonld";

/**
 * sitemap.xml — every URL we are willing to stand behind.
 *
 * DESIGN-DIRECTION §10.4: `/how-to/sync-video-cuts-to-the-beat` is deliberately ABSENT. The page
 * still exists and still resolves (deleting it would throw away an indexed URL and its history), but
 * beat detection is not wired — `lib/render/resolver.ts` says so in its own header and
 * `lib/ai/tools/generated/planBeatCuts.ts` returns `{ bpm: 0, cutTicks: [] }`. Its content is
 * rewritten to say plainly which parts ship; until beats are verified in prod it is not a URL we
 * should be actively asking a crawler to rank. Add it back in the same change that wires beats.
 *
 * The concept routes `/c1`, `/c2` and `/c3` are gone (§10.2) and 301 to `/` from `next.config.ts`;
 * a redirect target does not belong in a sitemap. `/app` and `/api/*` are disallowed in robots.ts
 * and the editor is additionally deindexed via `metadata.robots.index:false`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL;
  const now = new Date();

  // GEO content layer — static comparison + how-to pages (BLUF + tables/steps + schema). These have
  // the longest indexing/citation lead time, so they ship in the sitemap from day one.
  const contentPaths = [
    "/compare",
    "/compare/hite-vs-capcut",
    "/compare/best-ai-video-editor-tiktok",
    "/compare/best-ai-video-editor-phonk",
    "/how-to",
    "/how-to/edit-videos-by-typing",
    "/how-to/edit-a-phonk-video",
  ];

  return [
    { url: base, changeFrequency: "weekly", priority: 1, lastModified: now },
    // The technical blueprint. It describes the code rather than marketing it, so it is the page a
    // contributor and an answer engine are both most likely to want.
    { url: `${base}/docs`, changeFrequency: "weekly" as const, priority: 0.9, lastModified: now },
    ...contentPaths.map((p) => ({
      url: `${base}${p}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
      lastModified: now,
    })),
  ];
}
