/**
 * components/site/SiteChrome.tsx — the landing's persistent chrome.
 *
 * DESIGN-DIRECTION §6.0 (NAV) and §6.7 (final CTA + footer). Three components plus a wrapper that
 * composes them, so the assembly agent can either drop `<SiteChrome>` around the sections or place
 * `<SiteHeader/>`, `<FinalCta/>` and `<SiteFooter/>` by hand.
 *
 * THIS FILE SHIPS ZERO JAVASCRIPT, AND THAT IS A §12 DECISION, NOT AN ACCIDENT.
 * It used to open with `"use client"`, because §6.0 specifies the glass materialising "via ONE
 * IntersectionObserver sentinel" and the unit was one file. Its own comment named the cost: "the
 * footer's markup is also in the client bundle." Measured by source-map attribution of
 * `.next/static/chunks/app/page-*.js`, that cost was **7.0KB gzipped** — the largest single piece of
 * first-party JS on the property — to ship a wordmark, a skip link, five footer columns and
 * twenty-two links to a browser that only ever flips one boolean. The boolean now lives alone in
 * `./SiteHeaderGlass.tsx`; everything here is a Server Component.
 *
 * So the rule for anyone editing this file: **no hooks, no event handlers, no browser APIs.** If
 * something here needs one, it goes in a new island beside `SiteHeaderGlass`, not by re-adding the
 * directive at the top — that single line silently re-bundles this entire module.
 *
 * This file also imports NO registry data, so the 39KB `public/registry/manifest.json` that
 * `lib/landing/catalog.ts` parses never reaches the browser. Nothing in the chrome names an effect
 * any more — the footer's Effects column went with the catalog section — so there is no longer even
 * a reason to want it here. Keep it that way.
 *
 * THE THREE RULES THIS FILE EXISTS TO KEEP (§6.0):
 *   1. STICKY, NEVER FIXED — `position: fixed` + `backdrop-filter` is the iOS repaint trap.
 *   2. THE BOX HEIGHT NEVER ANIMATES — the header is `--nav-h` (56px = 14 frames) at every scroll
 *      position. Only the tint layer's opacity changes, so the page never reflows under the reader.
 *   3. THE SKIP LINK IS THE FIRST FOCUSABLE NODE — it is the first child of <header>, and <header>
 *      is the first thing on the page.
 *
 * NO BACKDROP-FILTER, AND THAT IS THE POINT. "Glass" here is a high-alpha canvas tint plus a
 * hairline, not a blurred backdrop. Three separate lines of the direction forbid the blur: §5.7
 * permits `filter: blur()` in SETTLE only, §12 caps a blurring layer at 480×240px (a full-width bar
 * is wider), and §12 requires zero blur in the LCP region — which is exactly where a top nav lives.
 * A tint costs one paint; a full-width backdrop blur costs a raster pass per frame of every scroll.
 */

import Link from "next/link";
import { Github } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PRIMARY_CTA } from "@/lib/site/primaryCta";
import { SiteHeaderGlass } from "./SiteHeaderGlass";

/* ══════════════════════════════════════════════════════════════════════════════
   CONTRACTS AND CONTENT — exported so the assembly agent and the test can read
   the same arrays the components render. No link here points at a route that
   does not exist on disk; `SiteChrome.test.tsx` enforces that.
   ══════════════════════════════════════════════════════════════════════════ */

export interface SiteLink {
  readonly label: string;
  /** Either an in-page anchor (`#id`) or a real route/URL. Never a placeholder. */
  readonly href: string;
}

export interface SiteFooterColumn {
  readonly title: string;
  readonly links: readonly SiteLink[];
}

/**
 * The repo, re-exported from its one owner.
 *
 * The constant itself moved to `lib/site/primaryCta.ts` when the landing was stripped: the
 * hosted CTA needs the same URL, and that module imports nothing, so both can read it without
 * this client component pulling in `lib/seo/jsonld.ts` (which drags the registry manifest into
 * the bundle). The name stays exported here because five call sites and `jsonld.test.ts` use it.
 */
export { REPO_URL as SOURCE_URL } from "@/lib/site/primaryCta";
import { REPO_URL as SOURCE_URL } from "@/lib/site/primaryCta";

/** Remotion's own licence page, cited verbatim in `LICENSE`'s third-party notice. Public, working. */
const REMOTION_LICENSE_URL = "https://www.remotion.dev/docs/license";

/**
 * The line under every primary CTA on the landing — §3's microline, and the ONE owner of it.
 *
 * IT LIVES HERE BECAUSE IT WENT FALSE ONCE ALREADY. It read "Free to start · no card · you keep
 * your edits" in three separate files (this one, `Hero.tsx`, `PromptRailFaq.tsx`) and in the two
 * marketing shells. Then the login wall was deleted: `/app` mints an anonymous Supabase session in
 * `middleware.ts` and that cookie is now the ONLY key to a visitor's projects, so "you keep your
 * edits" started promising a durability no account backs any more. Five copies of a claim is five
 * chances to fix four of them.
 *
 * Every clause is checkable today: there is no payment path anywhere in the codebase (§6.8), there
 * is no sign-up screen and nothing asks for an email (`middleware.ts`), and no card is ever
 * collected. What happens to the work afterwards needs a sentence, not a clause, so §6.7's FAQ
 * carries it ("Do I need an account?") instead of this line overclaiming in three words.
 *
 * ⚠ NO DIGITS. `SiteChrome.test.tsx` asserts the only number in the chrome's visible text is the
 * copyright year — every other digit in chrome would be a count, a rating, a price or a duration.
 */
export const CTA_MICROLINE = "Free to start · no sign-up · no card";

/**
 * EMPTY, BECAUSE THE SECTIONS IT POINTED AT WERE DELETED.
 *
 * It was §6.0's three anchors, in the spec's order: `How it works · Docs · FAQ`. Override via
 * `SiteHeader`'s `navLinks` prop if an assembly wants its own — one prop, one place.
 *
 * All three entries — `#how-it-works`, `#for-developers`, `#faq` — were in-page anchors into the
 * landing's own sections, and `app/page.tsx` unmounted every one of them on 2026-08-20 at the
 * owner's instruction. This array is rendered by the header on EVERY page of the property, so
 * leaving them would have put three links that visibly do nothing into persistent chrome sitewide —
 * damage well outside the page that was actually emptied.
 *
 * They are not repointed at substitutes. There is no honest target: `/how-to` and `/compare` are
 * real routes but neither is "How it works", and inventing a new information architecture is a
 * design decision, not a consequence of a deletion. The header falls back to the wordmark, the
 * source link and the CTA, which are all still true.
 *
 * Restore the three entries together with the sections, from `landing-before-strip` (`3ee8f15`).
 * `app/page.test.tsx` fails if an entry here ever names an id the page does not render.
 */
export const SITE_NAV_LINKS: readonly SiteLink[] = [];

/*
 * FOOTER_EFFECT_CATEGORIES lived here — five links into the catalog section's group headings. The
 * catalog is gone, so they would be five dead anchors in persistent chrome on every page. They also
 * forced `app/_components/LandingFooter.tsx` to exist purely to rewrite their hrefs; that file is
 * deleted with them. Deleting a section is supposed to make the page simpler, not leave scaffolding
 * behind pointing at it.
 */

/**
 * §6.7's grouped columns, minus Effects (see above — the catalog it indexed is gone).
 *
 * Every entry is a route that exists (`app/`), an in-page anchor, or the repo. Two deliberate
 * omissions, both honesty gates rather than oversights:
 *   · `/how-to/sync-video-cuts-to-the-beat` exists but documents beat-sync, which is NOT wired
 *     (`lib/render/resolver.ts`; `planBeatCuts` returns `{bpm:0, cutTicks:[]}`). §10.4 keeps the URL
 *     and drops it from the sitemap until beats ship — so the footer must not link it either.
 *   · `/llms.txt` is not linked: it is crawler surface, and it still carries a banned phrase
 *     ("to the pixel", §7.4) until that file is replaced by the route handler.
 */
export const SITE_FOOTER_COLUMNS: readonly SiteFooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: PRIMARY_CTA.label, href: PRIMARY_CTA.href },
      /* "How it works" → `#how-it-works` and "What to type" → `#what-to-type` stood here and are
         gone with the sections they named (see `SITE_NAV_LINKS` above for the full reasoning). A
         "Log in" → `/login` row went earlier for the same class of reason: a link from persistent
         chrome to something that does not exist is broken on every page of the property, not just
         on the one that lost it. */
    ],
  },
  {
    title: "Docs",
    links: [
      /* "For developers" → `#for-developers` and "FAQ" → `#faq` are gone with their sections. The
         four rows left are real routes on disk, so this column still works — which is exactly why
         the dead anchors had to be removed rather than the column deleted wholesale. */
      { label: "How to edit videos by typing", href: "/how-to/edit-videos-by-typing" },
      { label: "How to edit a phonk video", href: "/how-to/edit-a-phonk-video" },
      { label: "All guides", href: "/how-to" },
    ],
  },
  {
    title: "Compare",
    links: [
      { label: "HITE vs CapCut", href: "/compare/hite-vs-capcut" },
      { label: "Best AI video editor for TikTok", href: "/compare/best-ai-video-editor-tiktok" },
      { label: "Best AI video editor for phonk", href: "/compare/best-ai-video-editor-phonk" },
      { label: "All comparisons", href: "/compare" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Source on GitHub", href: SOURCE_URL },
      { label: "Report an issue", href: `${SOURCE_URL}/issues` },
      { label: "License", href: `${SOURCE_URL}/blob/master/LICENSE` },
    ],
  },
];

/**
 * 44px — the §4.5 tap target, expressed in the page's own unit (11 frames).
 *
 * NOT `h-11`: `html` sets `font-size: 14px`, so Tailwind's rem-based spacing scale is multiplied by
 * 0.875 and `h-11` measures 38.5px. Measured in a browser, not assumed. Anything that must be a real
 * CSS pixel size on this property has to come from --frame.
 */
const TAP_TARGET = "calc(var(--frame)*11)";

/**
 * Chrome text: quiet at rest (--t-3 = 7.00:1), full ink on hover AND on focus-visible — §4.5 makes
 * those two states visually identical. Colour only; nothing here moves.
 *
 * ⚠ THE `!` ON EVERY COLOUR IS LOAD-BEARING, NOT A HABIT. `app/globals.css` resets `a { color:
 * inherit; text-decoration: none }` OUTSIDE any cascade layer, and an unlayered rule beats every
 * rule in `@layer utilities` no matter its specificity. Without the important modifier a link's
 * colour utility is silently dead and every link on the property renders at inherited --t-1 — which
 * is what a browser probe of this component showed before this line. The real fix is one line in
 * globals.css (move that reset into `@layer base`); until it lands, this is how a link gets a colour.
 *
 * Deliberately carries NO display utility: callers set their own, so a responsive `hidden lg:…`
 * never has to fight an unprefixed `inline-flex` for the same property.
 */
const CHROME_LINK = cn(
  "items-center gap-[var(--space-2)] text-[length:var(--fs-sm)]",
  "text-[color:var(--t-3)]! hover:text-[color:var(--t-1)]! focus-visible:text-[color:var(--t-1)]!",
  "motion-safe:transition-[color] motion-safe:duration-[var(--d-tap)] motion-safe:ease-[var(--ease-apple)]",
);

/* A link inside a sentence. Underlined, because a link in prose that is only a colour change is a
   colour-alone affordance (WCAG 1.4.1). Same `!` story as CHROME_LINK, and the unlayered reset's
   `text-decoration` shorthand kills the decoration colour as well as the line. */
const PROSE_LINK = cn(
  "text-[color:var(--t-2)]! underline! decoration-[var(--line-4)]! underline-offset-4",
  "hover:text-[color:var(--t-1)]! focus-visible:text-[color:var(--t-1)]!",
  "motion-safe:transition-[color] motion-safe:duration-[var(--d-tap)] motion-safe:ease-[var(--ease-apple)]",
);

/* The one solid button. --color-accent-cta (12.19:1 on the canvas) under --color-on-accent
   (12.88:1 ON the accent, and on --color-accent too, so the hover state also passes); --r-sm because
   §4.4 rules a small radius reads precise and a pill reads consumer. The tighter inline padding below
   640px is what keeps the bar inside a 320px viewport — the label never shortens.
   The height repeats TAP_TARGET's expression as a literal ON PURPOSE: Tailwind scans source text, so
   an interpolated `h-[${TAP_TARGET}]` would produce no class at all. Do not "DRY" this. */
const CTA_BUTTON = cn(
  "relative inline-flex items-center justify-center whitespace-nowrap rounded-[var(--r-sm)]",
  "h-[calc(var(--frame)*11)] px-[var(--space-4)] sm:px-[var(--space-5)]",
  "bg-[var(--color-accent-cta)] text-[color:var(--color-on-accent)]! text-[length:var(--fs-sm)]",
  "hover:bg-[var(--color-accent)]",
  "motion-safe:transition-[background-color] motion-safe:duration-[var(--d-tap)] motion-safe:ease-[var(--ease-apple)]",
);

/* ══════════════════════════════════════════════════════════════════════════════
   THE SKIP LINK — WCAG 2.2 SC 2.4.1, and the first focusable node on the page.

   ⚠ WHY THIS IS NOT `components/marketing/SkipLink`. That component renders the
   `.skip-link` class from globals.css, which parks itself with
   `transform: translateY(-120%)` against a `margin: 12px`. Measured in a browser:
   120% of a 38px pill is 45.6px, the margin pushes it back down 12px, and 4.4px of
   a saturated cyan pill is therefore visible in the top-left corner of every page
   that uses it — at rest, for everyone. That class is outside this unit's
   ownership (it is also worth fixing there for the marketing pages), so the
   landing renders its own, parked at -200% of its own height where it cannot peek.
   ══════════════════════════════════════════════════════════════════════════ */

function SkipLink({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      data-skip-link="true"
      className={cn(
        "fixed left-0 top-0 z-[200] m-[var(--space-3)] inline-flex items-center rounded-[var(--r-sm)]",
        "px-[var(--space-5)] bg-[var(--color-accent-cta)] text-[color:var(--color-on-accent)]!",
        "text-[length:var(--fs-label)] uppercase",
        "-translate-y-[200%] focus:translate-y-0 focus-visible:translate-y-0",
        "motion-safe:transition-transform motion-safe:duration-[var(--d-state)] motion-safe:ease-[var(--ease-apple)]",
      )}
      style={{
        blockSize: TAP_TARGET,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontWeight: "var(--fw-cta)",
        letterSpacing: "var(--tk-mono)",
      }}
    >
      Skip to content
    </a>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE WORDMARK — HITE, set in the brand face, with its period drawn as a 6px
   cyan frame-square. §16 keeps this motif explicitly: it is the playhead.
   The square is aria-hidden; the accessible name stays exactly "HITE".
   ══════════════════════════════════════════════════════════════════════════ */

function Wordmark({ fontSize, className }: { fontSize: string; className?: string }) {
  return (
    <Link
      href="/"
      className={cn("inline-flex items-center text-[color:var(--t-1)]!", className)}
      style={{ blockSize: TAP_TARGET }}
    >
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          // Martian Mono's width axis. §4.3 allows wdth ≥ 87.5 for strings ≤ 24 characters; "HITE"
          // is four. Inert until layout.tsx loads the variable face — harmless on a static one.
          fontVariationSettings: '"wght" 500, "wdth" 87.5',
          fontWeight: "var(--fw-strong)",
          fontSize,
          letterSpacing: "var(--tk-mono)",
        }}
      >
        HITE
        {/* The period. Inline-block INSIDE the text run, so `vertical-align: baseline` puts its
            bottom edge exactly on the baseline — a flex sibling only gets a synthesized baseline
            and floats mid-cap, which is how this reads as a stray dot instead of a full stop. */}
        <span
          aria-hidden="true"
          className="ms-[var(--space-1)] inline-block size-[6px] bg-[var(--color-accent)] align-baseline"
        />
      </span>
    </Link>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   §6.0 — THE NAV
   ══════════════════════════════════════════════════════════════════════════ */

export interface SiteHeaderProps {
  /** Defaults to `SITE_NAV_LINKS`. Pass a different set if the section ids differ. */
  navLinks?: readonly SiteLink[];
  /**
   * Id of an element the hero renders at its own foot. When present it wins, because the hero knows
   * its real height; when absent the header parks its own sentinel at §6.1's `min(70svh, 780px)`.
   * Either way there is exactly ONE IntersectionObserver on the page from this unit.
   */
  heroFootId?: string;
  /** The `<main>` the skip link jumps to. Must match the id on the page's main landmark. */
  skipTargetId?: string;
}

export function SiteHeader({ navLinks = SITE_NAV_LINKS, heroFootId, skipTargetId = "main" }: SiteHeaderProps) {
  return (
    <>
      {/* WCAG 2.2 SC 2.4.1 — the first focusable node on the page. It sits OUTSIDE <header> so its
          z-index competes at the root rather than inside the bar's stacking context; a focused skip
          link that a section can paint over is a skip link that does not work. */}
      <SkipLink targetId={skipTargetId} />

      {/* The one client island in the chrome (`./SiteHeaderGlass.tsx`): it owns the sentinel, the
          IntersectionObserver and the `data-glass` attribute, and nothing else. Everything below is
          server-rendered `children` — it crosses the RSC boundary as markup, never as bundled JS. */}
      <SiteHeaderGlass heroFootId={heroFootId}>
        {/* THE GLASS: tint + hairline on one layer, opacity only. The header's own box is untouched,
            so nothing below it ever moves. --d-state / --ease-apple is the nav's voice (§5.1).
            No z-index games: this layer is first in DOM order and the content below is `relative`,
            so paint order alone puts the content on top.

            `group-data-[glass=on]` reads the island's attribute in CSS rather than through React, so
            crossing the hero foot costs one compositor-driven opacity transition instead of a
            re-render of this whole subtree — and this markup stays server-only. */}
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 border-b opacity-0 group-data-[glass=on]:opacity-100",
            "motion-safe:transition-opacity motion-safe:duration-[var(--d-state)] motion-safe:ease-[var(--ease-apple)]",
          )}
          style={{
            background: "color-mix(in oklab, var(--color-bg) 92%, transparent)",
            borderBlockEndColor: "var(--line-2)",
          }}
        />

        <div className="container relative flex h-full items-center gap-[var(--space-6)]">
          <Wordmark fontSize="var(--fs-sm)" />

          {/* §12's mobile rule is "expensive things are deleted, not scaled down": below 768px the
              four anchors are dropped rather than hidden behind a hamburger no one asked for. The
              same four live in the footer, which is a legitimate bypass for a single-scroll page.
              The breakpoints are measured, not guessed: at 14px Instrument Sans the four anchors run
              ~311px and the wordmark + CTA ~232px, which clears a 768px viewport's 704px of content
              width but not a 640px one's 576px once "View source" is added — hence the anchors at
              md and the repo link at lg. Nothing in this bar is ever allowed to wrap. */}
          <nav aria-label="Primary" className="hidden items-center gap-[var(--space-5)] md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn(CHROME_LINK, "inline-flex whitespace-nowrap")}
                style={{ blockSize: TAP_TARGET }}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-[var(--space-5)]">
            <a
              href={SOURCE_URL}
              className={cn(CHROME_LINK, "hidden whitespace-nowrap lg:inline-flex")}
              style={{ blockSize: TAP_TARGET }}
            >
              <Github aria-hidden="true" size={16} strokeWidth={1.5} />
              View source
            </a>

            <Link
              href={PRIMARY_CTA.href}
              className={CTA_BUTTON}
              style={{ fontWeight: "var(--fw-cta)" }}
            >
              {/* §4.4 rations --glow-accent to ONE element per page, and §3 gives it to the hero CTA
                  while §6.0 gives it to this one. Both are literally true if the glow follows the
                  glass: the hero CTA owns it while the hero is on screen, this one takes over the
                  moment the hero is gone. Never two glows at once. */}
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-0 rounded-[var(--r-sm)]",
                  "opacity-0 group-data-[glass=on]:opacity-100",
                  "motion-safe:transition-opacity motion-safe:duration-[var(--d-state)] motion-safe:ease-[var(--ease-apple)]",
                )}
                style={{ boxShadow: "var(--glow-accent)" }}
              />
              <span className="relative">{PRIMARY_CTA.label}</span>
            </Link>
          </div>
        </div>

        {/* §5.5 SCRUB — 2px progress fill at the bar's bottom edge. `.nav-progress` (globals.css)
            drives it off `animation-timeline: scroll(root block)`: no JS, no scroll subscription,
            and it rests at scaleX(0) where scroll-driven animations are unavailable or the reader
            asked for reduced motion. Decoration, so aria-hidden. */}
        <div
          aria-hidden="true"
          className="nav-progress absolute inset-x-0 bottom-0 h-[2px] bg-[var(--color-accent)]"
        />
      </SiteHeaderGlass>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   §6.7 — THE FINAL CTA
   "Say what you want changed." + one button + the microline. Nothing else: there
   is no payment path, so there is no price, no plan table and no Buy button
   anywhere on this property (§6.8).
   ══════════════════════════════════════════════════════════════════════════ */

export function FinalCta({ id = "start" }: { id?: string }) {
  return (
    <section id={id} className="section" aria-labelledby="final-cta-heading">
      <div className="container">
        {/* LUXURY RULE #5 (§1.1): the space below a heading is exactly one third of the space above
            it — `.section` supplies --section-y above, `.heading-gap` supplies --section-y/3 below. */}
        <h2 id="final-cta-heading" className="t-h2 heading-gap">
          Say what you want changed.
        </h2>
        <div className="flex flex-col items-start gap-[var(--space-5)]">
          <Link
            href={PRIMARY_CTA.href}
            className={CTA_BUTTON}
            style={{ fontWeight: "var(--fw-cta)" }}
          >
            {PRIMARY_CTA.label}
          </Link>
          {/* §3's microline, from its one owner above. Every clause of it is true today. */}
          <p className="t-label">{CTA_MICROLINE}</p>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   §6.7 — THE FOOTER
   ══════════════════════════════════════════════════════════════════════════ */

export function SiteFooter({ columns = SITE_FOOTER_COLUMNS }: { columns?: readonly SiteFooterColumn[] }) {
  return (
    <footer
      style={{
        // Whole seconds only (§1.1 rule 6): --section-y-tight above, 0.75s (90px) below.
        paddingBlockStart: "var(--section-y-tight)",
        paddingBlockEnd: "var(--space-9)",
      }}
    >
      <div className="container">
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-x-[var(--gutter)] gap-y-[var(--space-8)] sm:grid-cols-3 lg:grid-cols-5"
        >
          {columns.map((column) => {
            const headingId = `footer-col-${column.title.toLowerCase()}`;
            return (
              <div key={column.title}>
                {/* A <p> rather than a heading on purpose: §6 wants ONE <h2> per section, and five
                    more headings in the footer would pollute the outline crawlers extract. The
                    aria-labelledby list gives assistive tech the same grouping without that cost. */}
                <p id={headingId} className="t-label">
                  {column.title}
                </p>
                <ul
                  aria-labelledby={headingId}
                  className="mt-[var(--space-5)] flex flex-col gap-[var(--space-1)]"
                >
                  {column.links.map((link) => (
                    <li key={link.href}>
                      {link.href.startsWith("/") ? (
                        <Link
                          href={link.href}
                          className={cn(CHROME_LINK, "inline-flex")}
                          style={{ minBlockSize: TAP_TARGET }}
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <a
                          href={link.href}
                          className={cn(CHROME_LINK, "inline-flex")}
                          style={{ minBlockSize: TAP_TARGET }}
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* The repo row. No social icons: no account has been verified for this property, and an
            invented one is a fabricated credential (§7.4). The repo is the only real handle. */}
        <div className="mt-[var(--space-8)] flex flex-col gap-[var(--space-5)] border-t border-[var(--line-1)] pt-[var(--space-7)] md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-[var(--space-3)]">
            <Wordmark fontSize="var(--fs-h3)" />
            {/* The Remotion disclosure, summarised from this repo's own LICENSE third-party notice —
                required by §6.5 because an unqualified MIT badge is a false statement for any
                company over three people. The full text stays in the developers band and LICENSE. */}
            <p className="max-w-[var(--measure)] text-[length:var(--fs-sm)] text-[color:var(--t-3)]">
              MIT licensed. Remotion, the render engine, is licensed separately — free for
              individuals, non-profits, and companies of up to three people.{" "}
              <a href={REMOTION_LICENSE_URL} className={PROSE_LINK}>
                Read Remotion&rsquo;s terms
              </a>
              .
            </p>
          </div>

          <div className="flex items-center gap-[var(--space-5)]">
            <a
              href={SOURCE_URL}
              aria-label="HITE on GitHub"
              className={cn(CHROME_LINK, "inline-flex justify-center")}
              style={{ blockSize: TAP_TARGET, inlineSize: TAP_TARGET }}
            >
              <Github aria-hidden="true" size={18} strokeWidth={1.5} />
            </a>
            {/* Matches the copyright line in LICENSE exactly. */}
            <p className="text-[length:var(--fs-sm)] text-[color:var(--t-4)]">
              &copy; 2026 HITE contributors
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE COMPOSITION
   ══════════════════════════════════════════════════════════════════════════ */

export interface SiteChromeProps {
  /** The landing's sections, in IA order. The final CTA and footer are appended by this component. */
  children: ReactNode;
  navLinks?: readonly SiteLink[];
  heroFootId?: string;
  /** Id of the <main> this component renders, and the skip link's target. */
  mainId?: string;
}

/**
 * Header → <main> → final CTA → footer.
 *
 * ⚠ This renders the page's ONE `<main>` landmark (so the skip link always has a target and the
 * assembly file cannot forget it). Do not wrap `children` in a second `<main>`. If the page needs to
 * own its own main element, drop this wrapper and place `<SiteHeader/>`, `<FinalCta/>` and
 * `<SiteFooter/>` directly — they are exported for exactly that.
 */
export default function SiteChrome({ children, navLinks, heroFootId, mainId = "main" }: SiteChromeProps) {
  return (
    <>
      <SiteHeader navLinks={navLinks} heroFootId={heroFootId} skipTargetId={mainId} />
      {/* tabIndex -1 so the skip link actually MOVES focus: <main> is not focusable by default, and
          a fragment jump that only scrolls leaves the keyboard user's focus back in the nav. */}
      <main id={mainId} tabIndex={-1}>
        {children}
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
