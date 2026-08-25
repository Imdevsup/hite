/**
 * components/site/SiteChrome.test.tsx — the gates behind the landing's chrome.
 *
 * The chrome is the one thing on every screen, so its two failure modes are expensive and quiet:
 * a link that 404s, and a claim that stops being true. Three things are enforced here, each because
 * DESIGN-DIRECTION names it:
 *
 *   1. Every internal link resolves to a real route in `app/`. A dead link in persistent chrome is
 *      on every page of the property.
 *   2. §7.2 / §10.4 — nothing links the beat-sync how-to, because beats are not wired.
 *   3. §7.4 — no banned phrase, no price, and no use of the word "beta" (the budget of two is spent
 *      by the FAQ, not by chrome).
 *
 * A fourth gate lived here until §6.4's catalog section was deleted: the footer carried an Effects
 * column of `#cat-<category>` links and this file held those slugs against `CATALOG_GROUPS`, so the
 * chrome could not advertise a category the renderer had stopped painting. The column is gone —
 * five anchors into a section that no longer exists — so the assertion has no subject. The gate it
 * guarded is untouched: `lib/landing/catalog.ts` still derives what may be advertised from
 * `isRenderableEntry`, `lib/landing/catalog.test.ts` still checks that derivation against a live
 * recomputation, and the count still reaches the FAQ and llms.txt. Only the chrome's copy of the
 * category list is gone, and a list that no longer exists cannot drift.
 *
 * Rendering is real: `renderToStaticMarkup` over the actual components, not a snapshot of props.
 * `useEffect` never runs in that path, which is the point — what it renders IS the server-rendered
 * static state §5.9 requires the page to ship.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import SiteChrome, {
  FinalCta,
  SITE_FOOTER_COLUMNS,
  SITE_NAV_LINKS,
  SOURCE_URL,
  SiteFooter,
  SiteHeader,
  type SiteLink,
} from "./SiteChrome";

const APP_DIR = path.resolve(__dirname, "../../app");

/** Every route `app/` actually serves, with Next's `(group)` segments removed. */
function routesOnDisk(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // A parenthesised segment is a route group and contributes nothing to the URL.
      const segment = entry.name.startsWith("(") && entry.name.endsWith(")") ? "" : `/${entry.name}`;
      routes.push(...routesOnDisk(path.join(dir, entry.name), prefix + segment));
    } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
      routes.push(prefix === "" ? "/" : prefix);
    }
  }
  return routes;
}

const ALL_LINKS: readonly SiteLink[] = [
  ...SITE_NAV_LINKS,
  ...SITE_FOOTER_COLUMNS.flatMap((column) => column.links),
];

describe("site chrome — links (§10.1, §10.4)", () => {
  it("every internal link points at a route that exists on disk", () => {
    const routes = new Set(routesOnDisk(APP_DIR));
    // Sanity: the walker found the real app, not an empty directory.
    expect(routes.has("/")).toBe(true);
    expect(routes.has("/app")).toBe(true);

    for (const link of ALL_LINKS) {
      if (!link.href.startsWith("/")) continue;
      expect(routes.has(link.href), `${link.label} → ${link.href}`).toBe(true);
    }
  });

  it("links are either an in-page anchor, an app route, or the repo", () => {
    for (const link of ALL_LINKS) {
      const ok = link.href.startsWith("#") || link.href.startsWith("/") || link.href.startsWith(SOURCE_URL);
      expect(ok, `${link.label} → ${link.href}`).toBe(true);
    }
  });

  it("nothing links the beat-sync guide — beats are not wired", () => {
    for (const link of ALL_LINKS) {
      expect(link.href).not.toContain("sync-video-cuts-to-the-beat");
      expect(link.label.toLowerCase()).not.toContain("beat");
    }
  });

  it("names no anchor that no longer has a section", () => {
    /**
     * THIS ASSERTED §6.0's THREE ANCHORS — "How it works", "Docs", "FAQ" — until 2026-08-20, when
     * every section was deleted from `app/page.tsx` and all three stopped resolving. The nav is
     * rendered by chrome on EVERY route, so keeping them would have been three links that visibly do
     * nothing, sitewide.
     *
     * It is written as an invariant rather than as a new fixed list on purpose: the previous form
     * pinned the exact three labels, which is what made an ordinary deletion turn it red for a
     * reason that had nothing to do with what it was guarding. Stated this way it holds whether the
     * nav is empty, restored, or something else entirely — what it refuses is a nav that advertises
     * a destination the property does not have.
     */
    for (const link of SITE_NAV_LINKS) {
      expect(link.label.length, "a nav entry needs a label").toBeGreaterThan(0);
      expect(link.href, `nav "${link.label}" must not be a placeholder`).not.toBe("#");
    }
    // `app/page.test.tsx` owns the other half: that each `#anchor` here resolves on the page.
    expect(SITE_NAV_LINKS.every((l) => l.href.startsWith("#") || l.href.startsWith("/"))).toBe(true);
  });

  it("§6.7's footer columns, in order", () => {
    expect(SITE_FOOTER_COLUMNS.map((column) => column.title)).toEqual([
      "Product",
      "Docs",
      "Compare",
      "Company",
    ]);
  });
});

describe("site chrome — server-rendered structure (§5.9, §6.0, §9.1)", () => {
  const header = renderToStaticMarkup(<SiteHeader />);
  const footer = renderToStaticMarkup(<SiteFooter />);
  const finalCta = renderToStaticMarkup(<FinalCta />);
  const whole = renderToStaticMarkup(
    <SiteChrome>
      <p>section</p>
    </SiteChrome>,
  );

  it("the skip link is the first focusable node", () => {
    const firstAnchor = header.indexOf("<a ");
    expect(firstAnchor).toBeGreaterThan(-1);
    // The first <a> in the header IS the skip link…
    expect(header.slice(firstAnchor, firstAnchor + 240)).toContain('data-skip-link="true"');
    expect(header).toContain("Skip to content");
    // …and nothing else focusable precedes it (the only markup before is the aria-hidden sentinel).
    const before = header.slice(0, firstAnchor);
    for (const focusable of ["<button", "<input", "<select", "<textarea", "tabindex"]) {
      expect(before, focusable).not.toContain(focusable);
    }
  });

  it("ships the glass OFF and the bar at a fixed height — the box never animates", () => {
    expect(header).toContain('data-glass="off"');
    expect(header).toContain("var(--nav-h)");
    // Sticky, never fixed (the iOS backdrop-filter repaint trap), and no blurred backdrop at all.
    expect(header).toContain("sticky");
    expect(header).not.toContain("backdrop-filter");
    expect(header).not.toContain("backdrop-blur");
  });

  it("the final CTA's heading is visible text, never sr-only", () => {
    expect(finalCta).toContain("Say what you want changed.");
    const heading = finalCta.slice(finalCta.indexOf("<h2"), finalCta.indexOf("</h2>"));
    expect(heading).not.toContain("sr-only");
  });

  it("renders one main landmark with the skip link's target id", () => {
    expect(whole.match(/<main/g)?.length).toBe(1);
    expect(whole).toContain('id="main"');
    expect(whole).toContain('href="#main"');
  });

  it("names both landmark navs", () => {
    expect(header).toContain('aria-label="Primary"');
    expect(footer).toContain('aria-label="Footer"');
  });

  it("every footer link is in the markup", () => {
    for (const column of SITE_FOOTER_COLUMNS) {
      for (const link of column.links) {
        expect(footer, link.label).toContain(link.label);
      }
    }
  });
});

/** Text nodes only — what a reader actually sees, with tags, classes and SVG path data stripped. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&copy;/g, "(c)")
    .replace(/&rsquo;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

describe("site chrome — the honesty gates (§7.4)", () => {
  const markup = [
    renderToStaticMarkup(<SiteHeader />),
    renderToStaticMarkup(<FinalCta />),
    renderToStaticMarkup(<SiteFooter />),
  ].join("\n");
  const copy = markup.toLowerCase();
  const reads = visibleText(markup);

  it("uses no banned phrase", () => {
    for (const phrase of ["to the pixel", "in seconds", "in minutes"]) {
      expect(copy, phrase).not.toContain(phrase);
    }
  });

  it("never says beta — the budget of two belongs to the FAQ", () => {
    expect(copy).not.toContain("beta");
  });

  it("has no price and no buy button", () => {
    for (const token of ["$", "/mo", "per month", "pricing", "upgrade", "buy "]) {
      expect(copy, token).not.toContain(token);
    }
  });

  it("makes no claim about counts, ratings or users", () => {
    // No fabricated metric can hide in chrome: the ONLY number a reader sees is the copyright year.
    // Any other digit in visible text is a count, a rating, a price or a duration — all banned here.
    expect(reads.match(/\d[\d,.]*/g) ?? []).toEqual(["2026"]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   §12 — THE CLIENT-BOUNDARY CONTRACT.

   The chrome ships zero JS, and the glass reaches the two layers it paints through CSS rather than
   through React. Both halves of that are one-line-reversible and neither fails loudly:

     · re-adding `"use client"` to SiteChrome.tsx silently re-bundles the whole module (measured:
       7.0KB gzipped, the largest first-party item on the page) and the budget gate is the only
       thing that would notice, one build later;
     · dropping `group` from <header>, renaming `data-glass`, or removing the variant class from a
       layer leaves a header that renders perfectly and simply never turns solid — a defect nobody
       sees in a diff and everybody sees on the site.

   So the contract is asserted here, from both ends at once.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe("site chrome — the client boundary (§12)", () => {
  const source = (file: string): string =>
    readFileSync(path.join(__dirname, file), "utf8");

  it("SiteChrome is a Server Component — the directive belongs in the island, not here", () => {
    expect(source("SiteChrome.tsx")).not.toMatch(/^\s*["']use client["']/);
  });

  it("the island owns the only browser API, and imports nothing heavy to do it", () => {
    const island = source("SiteHeaderGlass.tsx");
    expect(island).toMatch(/^\s*["']use client["']/);
    expect(island).toContain("IntersectionObserver");
    // `cn` drags tailwind-merge (6.3KB gzipped) into the client graph to join static strings.
    expect(island).not.toContain("@/lib/utils");
    expect(island).not.toMatch(/from ["']next\/link["']/);
    expect(island).not.toMatch(/from ["']lucide-react["']/);
    expect(island).not.toMatch(/from ["']motion/);
  });

  it("the header publishes the state the layers read, and marks itself as their group", () => {
    const header = renderToStaticMarkup(<SiteHeader />);
    const tag = header.slice(header.indexOf("<header"), header.indexOf(">", header.indexOf("<header")));
    expect(tag).toContain('data-glass="off"');
    // Tailwind compiles `group-data-[glass=on]:` to `:where(.group)[data-glass=on] *` — without the
    // marker class on this element the descendants' rule can never match.
    expect(tag).toMatch(/class="[^"]*\bgroup\b/);
  });

  it("both glass layers paint off the attribute, and rest transparent", () => {
    const header = renderToStaticMarkup(<SiteHeader />);
    const layers = [...header.matchAll(/class="([^"]*group-data-\[glass=on\][^"]*)"/g)];
    // The bar's tint, and the CTA's glow. §4.4 rations the glow to one element, and §6.0 hands it to
    // this button exactly when the hero's own has left the screen — so the two move together.
    expect(layers).toHaveLength(2);
    for (const [, className] of layers) {
      expect(className).toContain("group-data-[glass=on]:opacity-100");
      // SSR state is transparent: the bar is invisible chrome over the hero (§6.0 rule 3).
      expect(className).toContain("opacity-0");
    }
  });
});
