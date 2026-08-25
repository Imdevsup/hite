/**
 * THE PRIMARY CALL TO ACTION — one owner, because it went false the moment the hosting model changed.
 *
 * The landing used to say "Open the editor" / "Make my first edit" in five places, every one of them
 * linking to `/app`. That was true while HITE was going to be a hosted product. It is not true now:
 * the decision on record is that **www.tryhite.xyz serves the landing page only, and the editor runs
 * on the visitor's own machine after they clone the repo**. A hosted "Open the editor" button is
 * therefore a promise the deployment cannot keep — the visitor clicks it, and either lands on a route
 * with no Supabase project behind it or on a 503 from `middleware.ts`. Under this repo's honesty
 * rules that is not a copy nit; it is the same class of defect as a fabricated metric, and it sat on
 * the most-clicked pixel of the property.
 *
 * ── Why this is detected and not configured ──────────────────────────────────────────────────────
 *
 * The obvious fix is an env var somebody remembers to set on Vercel. Somebody eventually does not,
 * and the lie ships again silently. So the default is DERIVED from the one signal that is always
 * present and never forgotten: Vercel sets `VERCEL=1` on every build it runs. Building on Vercel
 * means "this is the public landing" and the CTA converts to clone-and-run; building anywhere else
 * means a cloned repo on someone's laptop, where `/app` genuinely is reachable and the direct link
 * is the honest, useful one.
 *
 * That resolution happens in `next.config.ts`, not here, and for a reason: `VERCEL` is not a
 * `NEXT_PUBLIC_` variable, so it does not exist in a client bundle. `SiteChrome` is a client
 * component. Reading `process.env.VERCEL` from here would evaluate to `undefined` in the browser,
 * the server would render "Get it running" and the client would hydrate "Open the editor", and React
 * would log a hydration mismatch over a claim that is supposed to be stable. `next.config.ts` runs on
 * the build machine, where `VERCEL` is real, and inlines the resolved answer into both bundles.
 *
 * Override with `NEXT_PUBLIC_HITE_EDITOR=local` if you genuinely do deploy the editor somewhere.
 */

/** Whether the editor is reachable from the deployment this bundle was built for. */
export type EditorReachability =
  /** A cloned repo. `/app` is served by the same dev/prod server as the landing. */
  | "local"
  /** The public landing. The editor is not deployed here; the visitor has to clone and run it. */
  | "hosted-landing";

/**
 * Resolved at build time by `next.config.ts`. The `?? "hosted-landing"` fallback is deliberate and is
 * the safe direction: if this value ever fails to be inlined, the page under-promises (it tells a
 * local visitor to clone something they have already cloned) instead of over-promising (telling the
 * whole internet to open an editor that is not there). Cosmetic failure beats a false claim.
 */
export const EDITOR_REACHABILITY: EditorReachability =
  process.env.NEXT_PUBLIC_HITE_EDITOR === "local" ? "local" : "hosted-landing";

/**
 * The source repository, and the ONE owner of that URL for the whole property.
 *
 * It moved here from `SiteChrome` when the landing was stripped: the hosted CTA needs it, and
 * `SiteChrome` is a client component that cannot import `lib/seo/jsonld.ts` (that module pulls in the
 * registry manifest). This file imports nothing at all, so both can read it and there is no third
 * copy to drift. `SiteChrome` re-exports it as `SOURCE_URL`; `jsonld.test.ts` pins the two equal.
 *
 * ⚠ HONESTY FLAG, UNCHANGED BY THE MOVE: as of 2026-08-19 this repository is PRIVATE, so every link
 * that points here is a 404 for a visitor and the "open source" claim is true only of the local MIT
 * LICENSE. Publishing it is the one-line fix; changing this constant is the other.
 */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Imdevsup/hite";

export interface PrimaryCta {
  readonly label: string;
  readonly href: string;
}

/**
 * The one label and one destination for the primary CTA, everywhere it appears: the header button,
 * the hero, the closing band and the footer's Product column.
 *
 * These were three different labels ("Open the editor", "Make my first edit", and the footer's copy
 * of the second) for one action. One action gets one name — partly so the page stops offering the
 * visitor what looks like three different doors, and mostly so the next person who has to change what
 * this promises changes it once.
 *
 * THE HOSTED DESTINATION WAS `#for-developers` AND IS NOW THE REPO, because the anchor stopped
 * existing. That band rendered `quickstartLines()` — the real `git clone` / `pnpm install` /
 * `pnpm dev` sequence — and was the best possible landing for this button, but every section was
 * deleted from `app/page.tsx` on 2026-08-20 and an in-page anchor with no target is a button that
 * does nothing. The repo is the only destination left that is actually true, and it carries the same
 * instructions in its README.
 *
 * If the quickstart band is ever remounted, point this back at `#for-developers`: an on-page target
 * beats an outbound hop, and `app/page.test.tsx`'s anchor gate will keep it honest either way.
 */
/**
 * OWNER DECISION, 2026-08-23: the primary call to action points at the repository EVERYWHERE, local
 * builds included. The editor is never advertised from the landing; a contributor who has cloned the
 * repo reaches `/app` directly. `EDITOR_REACHABILITY` still exists for the few places that need to
 * know whether `/app` is served (prompt deep links), but it no longer shapes this button.
 */
export const PRIMARY_CTA: PrimaryCta = { label: "Source", href: REPO_URL };
