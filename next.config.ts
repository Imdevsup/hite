import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * WHO THE PRIMARY CTA IS ALLOWED TO PROMISE AN EDITOR TO. See `lib/site/primaryCta.ts` for the full
   * reasoning; the short version is that www.tryhite.xyz hosts the landing page ONLY and the editor
   * runs on the visitor's own machine, so a deployed "Open the editor" button is a false claim.
   *
   * It is derived, not configured, because a var somebody has to remember to set on Vercel is a var
   * somebody eventually forgets — and the failure mode is the lie shipping again with nothing to
   * catch it. `VERCEL=1` is set automatically on every build Vercel runs, so "built on Vercel" means
   * the public landing and anything else means a clone on a laptop, where `/app` really is reachable.
   *
   * It has to be resolved HERE rather than read in the component: `VERCEL` is not `NEXT_PUBLIC_`, so
   * it does not exist in a client bundle, and `SiteChrome` is a client component. Resolving it on the
   * build machine and inlining the answer keeps the server and the client rendering the same claim.
   *
   * An explicit `NEXT_PUBLIC_HITE_EDITOR` always wins, for anyone who does deploy the editor.
   */
  env: {
    NEXT_PUBLIC_HITE_EDITOR:
      process.env.NEXT_PUBLIC_HITE_EDITOR ?? (process.env.VERCEL ? "hosted-landing" : "local"),
  },

  /**
   * DESIGN-DIRECTION §12 — how the ≤140KB landing budget gets DIAGNOSED, not just enforced.
   *
   * `scripts/check-bundle.mjs` can report which module owns which byte, but only if the chunks ship
   * with `.js.map` files. Emitting those unconditionally would publish the whole first-party source
   * to anyone who opens devtools and add a few MB to every deploy, so it is opt-in:
   *
   *     HITE_BUNDLE_ANALYZE=1 NEXT_DIST_DIR=.next-analyze npx next build --webpack
   *     HITE_VERIFY_DIST=.next-analyze node scripts/check-bundle.mjs --why
   *
   * Off by default, and therefore off in CI and on Vercel. Keep it that way.
   */
  productionBrowserSourceMaps: process.env.HITE_BUNDLE_ANALYZE === "1",
  // Allow an isolated build output dir via env so a one-off `next build` can run without colliding
  // on the `.next` files a long-lived `next dev` server (or a concurrent build) keeps rewriting —
  // that shared-dir race surfaces as spurious ENOENT on manifest temp files during page-data
  // collection. Honor BOTH names: NEXT_DIST_DIR (ad-hoc / CI) and HITE_VERIFY_DIST (the throwaway
  // dir that scripts/verify-build.mjs generates per-run). These MUST stay in sync with that script.
  distDir: process.env.HITE_VERIFY_DIST || process.env.NEXT_DIST_DIR || ".next",
  images: {
    // Media lives in Supabase Storage. The `*.public.blob.vercel-storage.com` pattern that used to
    // sit here named Vercel Blob, which this project no longer uses at all — `@vercel/blob` is not a
    // dependency and no code produces a blob URL. Note nothing currently renders `next/image`, so
    // this list is a standing allow-list for the actual storage host rather than something in use.
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  transpilePackages: ["@remotion/player", "remotion"],
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
  // NO `outputFileTracingIncludes`, and that is deliberate — nothing reads a file at runtime.
  //
  // Two blocks used to live here and both are obsolete:
  //   • `/api/render/**` traced the Remotion bundler toolchain into the render function, back when
  //     that route bundled and rendered the composition inside its own request timeout. POST
  //     /api/render now just inserts a job row and returns; the worker process renders from the
  //     repo, not from a traced function bundle.
  //   • `/api/plan/**` and `/api/refine/**` traced `./public/registry/**` because `searchRegistry`
  //     was said to read `public/registry/manifest.json` off disk inside the planner loop. It does
  //     not: `lib/registry/catalog.ts:1` (and every other consumer) does
  //     `import manifestData from ".../manifest.json"`, so the manifest is bundled as a MODULE.
  //     There is no runtime fs read left to trace.
  // If you reintroduce a runtime file read, reintroduce the tracing entry with it.
  //
  // NO `webpack:` hook either. It carried an `IgnorePlugin({ resourceRegExp: /^node:/ })` for the
  // client bundle, because `lib/registry/catalog.ts` once did a server-only `await import("node:…")`
  // that webpack still parsed and rejected with UnhandledSchemeError. That dynamic import is gone
  // (see the module import above); the only remaining `node:` importers are `lib/ffmpeg/*`, which is
  // imported exclusively by `worker/*` and never reaches a client bundle. Verified by a full
  // `next build --webpack` with the hook removed.

  /**
   * DESIGN-DIRECTION §10.1/§10.2 — the three abandoned landing concepts.
   *
   * `/c1`, `/c2` and `/c3` served 200 in production and were near-duplicates of `/`, each emitting
   * its own JSON-LD identity nodes under the same `@id`s. The routes are deleted (`app/c1|c2|c3`,
   * `components/concepts`, `components/landing`, `app/landing.css`); these redirects keep the URLs
   * resolving so the crawl signal consolidates onto `/` instead of evaporating into 404s.
   *
   * 301, not 410, and permanent: §10.1 rules they are near-duplicates of `/`, so consolidating is
   * correct. §10.2 requires the redirect and the deletion to land together — a deletion without the
   * redirect is a self-inflicted set of dead indexed URLs.
   *
   * `/.well-known/llms.txt` is the same rule applied to §9.4's other deletion. `public/llms.txt` and
   * `public/.well-known/llms.txt` are gone, replaced by `app/llms.txt/route.ts` and
   * `app/llms-full.txt/route.ts` "so they cannot drift again". `/llms.txt` keeps its address because
   * the route handler serves it; the `.well-known` copy would otherwise become a 404 for the one
   * class of client most likely to have it bookmarked, so it 301s onto the surviving document.
   */
  async redirects() {
    return [
      ...["/c1", "/c2", "/c3"].map((source) => ({ source, destination: "/", permanent: true })),
      { source: "/.well-known/llms.txt", destination: "/llms.txt", permanent: true },
    ];
  },

  async headers() {
    return [
      {
        // Registry manifest is regenerated per deploy; browsers can hold it
        // for an hour and revalidate stale in the background for a day.
        // When we add a content-hash URL we'll bump to `immutable`.
        source: "/registry/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
        ],
      },
      {
        // Effect preview webms are per-key stable artifacts — long TTL fine.
        source: "/effect-previews/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default config;
