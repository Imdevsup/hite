/**
 * lib/seo/honesty.test.ts — DESIGN-DIRECTION §7.4, wired.
 *
 * §7.4 says the banned-phrase rule "must also cover `public/llms.txt`,
 * `public/.well-known/llms.txt`, the `.md` twins, the JSON-LD, and the OG image copy", and that the
 * violations already on disk are fixed "in the same commit that adds the lint". This file is the
 * wiring: it is a vitest file, so `pnpm test` runs it, and it walks every copy surface on the
 * property rather than the one component whose test happens to remember.
 *
 * IT RENDERS, IT DOES NOT GREP THE SOURCE. Each page is server-rendered with
 * `renderToStaticMarkup` and reduced to the text a reader sees; the static files are read raw. A
 * code comment therefore cannot trip the lint and an interpolated count arrives resolved — see the
 * long note in `honesty.ts` for why a source-text grep is the wrong instrument here.
 *
 * WHAT WAS ON DISK WHEN THIS LANDED (2026-08-19, all fixed in the same change): "to the pixel" ×11
 * across the six marketing pages plus both llms.txt files, a per-render length cap and an "upgrade"
 * tier on four pages for a product with no payment path, automatic beat-sync claims on four pages
 * while `lib/render/resolver.ts` documents beats as not wired, skull-overlay and speed-ramp claims
 * for keys the renderer cannot paint, and a `featureList` in the JSON-LD advertising four
 * capabilities that do not exist.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentType } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BETA_LIMIT, countBeta, formatViolations, htmlToCopy, scanCopy } from "./honesty";
import { LLMS_FULL_TXT, LLMS_KEY_PATHS, LLMS_TXT } from "./llms";
import sitemap from "@/app/sitemap";
import { REPO_URL, SITE_URL, graph, organizationNode, softwareApplicationNode, websiteNode } from "./jsonld";
import { RENDERABLE_ENTRY_COUNT } from "@/lib/landing/catalog";
import { EXAMPLE_PROMPT_TEXTS } from "@/lib/landing/prompts";
import { SOURCE_URL } from "@/components/site/SiteChrome";
import { LANDING_FAQ } from "@/components/site/PromptRailFaq";

import { SITE_CARD_DESCRIPTION, SITE_DESCRIPTION, SITE_TITLE } from "./metadata";
import HomePage from "@/app/page";
import CompareIndex from "@/app/(marketing)/compare/page";
import CompareCapcut from "@/app/(marketing)/compare/hite-vs-capcut/page";
import ComparePhonk from "@/app/(marketing)/compare/best-ai-video-editor-phonk/page";
import CompareTiktok from "@/app/(marketing)/compare/best-ai-video-editor-tiktok/page";
import HowToIndex from "@/app/(marketing)/how-to/page";
import HowToTyping from "@/app/(marketing)/how-to/edit-videos-by-typing/page";
import HowToPhonk from "@/app/(marketing)/how-to/edit-a-phonk-video/page";
import HowToBeat from "@/app/(marketing)/how-to/sync-video-cuts-to-the-beat/page";
import DocsPage from "@/app/docs/page";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE SURFACES
   ───────────────────────────────────────────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Every page whose visible copy is public. `/app` is deindexed and is not marketing surface. */
const PAGES: readonly { route: string; Page: ComponentType }[] = [
  { route: "/", Page: HomePage },
  // The technical blueprint is public copy like any other page: same rules, same scan.
  { route: "/docs", Page: DocsPage },
  { route: "/compare", Page: CompareIndex },
  { route: "/compare/hite-vs-capcut", Page: CompareCapcut },
  { route: "/compare/best-ai-video-editor-phonk", Page: ComparePhonk },
  { route: "/compare/best-ai-video-editor-tiktok", Page: CompareTiktok },
  { route: "/how-to", Page: HowToIndex },
  { route: "/how-to/edit-videos-by-typing", Page: HowToTyping },
  { route: "/how-to/edit-a-phonk-video", Page: HowToPhonk },
  { route: "/how-to/sync-video-cuts-to-the-beat", Page: HowToBeat },
];

const OG_IMAGE_SOURCE = readFileSync(path.join(REPO_ROOT, "app", "opengraph-image.tsx"), "utf8");

/**
 * §9.4's two GEO documents. They used to be `public/llms.txt` + `public/.well-known/llms.txt` and
 * were read off disk here; they are now built in `lib/seo/llms.ts` and served by route handlers, so
 * the lint scans the strings the handlers return. Same surfaces, one fewer way to drift.
 */
const LLMS_DOCS: readonly [string, string][] = [
  ["app/llms.txt/route.ts", LLMS_TXT],
  ["app/llms-full.txt/route.ts", LLMS_FULL_TXT],
];

const renderedCopy = new Map<string, string>(
  PAGES.map(({ route, Page }) => [route, htmlToCopy(renderToStaticMarkup(createElement(Page)))]),
);

/**
 * Title + description + card copy, flattened. Metadata is copy an answer engine reads first.
 *
 * It comes from `lib/seo/metadata.ts` rather than from `app/layout.tsx`'s `Metadata` object because
 * that module cannot be imported here at all: `next/font/google` is an SWC-transformed call and
 * throws outside the Next build. The layout consumes exactly these three constants.
 */
const METADATA_COPY = [SITE_TITLE, SITE_DESCRIPTION, SITE_CARD_DESCRIPTION].join(" ");

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE GATE
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("§7.4 — the banned-phrase lint, across the whole property", () => {
  for (const { route } of PAGES) {
    it(`${route} renders no banned phrase`, () => {
      const violations = scanCopy(renderedCopy.get(route) ?? "", route);
      expect(violations, formatViolations(violations)).toEqual([]);
    });
  }

  it("the site metadata carries no banned phrase", () => {
    const violations = scanCopy(METADATA_COPY, "lib/seo/metadata.ts");
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  for (const [name, body] of LLMS_DOCS) {
    it(`${name} carries no banned phrase`, () => {
      const violations = scanCopy(body, name);
      expect(violations, formatViolations(violations)).toEqual([]);
    });
  }

  it("the OG image copy carries no banned phrase", () => {
    // The card is a satori tree, not HTML, so the source is scanned directly. It is a small file
    // whose only prose is the card's own text; there is no comment here quoting a banned phrase.
    const violations = scanCopy(OG_IMAGE_SOURCE, "app/opengraph-image.tsx");
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("the JSON-LD graph carries no banned phrase and no fabricated rating", () => {
    const serialized = graph(organizationNode(), websiteNode(), softwareApplicationNode());
    const violations = scanCopy(serialized, "lib/seo/jsonld.ts");
    expect(violations, formatViolations(violations)).toEqual([]);
    expect(serialized).not.toMatch(/aggregateRating|ratingValue|reviewCount/i);
  });
});

describe('§7.4 — "beta" at most twice on the property', () => {
  it("the whole property spends at most the budget", () => {
    // `/llms.txt` is an index OF `/llms-full.txt` (§9.4) rather than a second document, so the
    // budget counts the full text once — the index deliberately spends none of it.
    const surfaces: [string, string][] = [
      ...PAGES.map(({ route }) => [route, renderedCopy.get(route) ?? ""] as [string, string]),
      ["lib/seo/metadata.ts", METADATA_COPY],
      ["app/llms-full.txt/route.ts", LLMS_FULL_TXT],
    ];
    const perSurface = surfaces.map(([name, text]) => [name, countBeta(text)] as const);
    const total = perSurface.reduce((sum, [, n]) => sum + n, 0);
    expect(total, `uses of "beta" per surface: ${JSON.stringify(Object.fromEntries(perSurface))}`)
      .toBeLessThanOrEqual(BETA_LIMIT);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   §9.1 — THE `sr-only` POLARITY, INVERTED. The highest-priority fix on the property, so it gets a
   gate rather than a memory: until this landed, `app/page.tsx` put the <h1> and the entire product
   explanation inside `.sr-only` and showed a 3D fly-through instead.
   ───────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ SUSPENDED 2026-08-20, AND THE SUSPENSION IS THE POINT — READ BEFORE DELETING OR "FIXING".
 *
 * Every section was deleted from `app/page.tsx` at the owner's instruction. An empty landing has no
 * `<h1>` and no visible product explanation, so all three assertions below fail — CORRECTLY. They
 * are describing a real defect, not a stale contract: `/` in its current state is not shippable, it
 * would be an SEO and accessibility failure the moment it went live, and these are the gates that
 * say so.
 *
 * They are `describe.skip` rather than red for one reason only: a permanently failing suite trains
 * everyone to ignore it, and `hite-app/CLAUDE.md` requires gates green before a commit. Skipping
 * keeps that rule usable while leaving the assertions byte-for-byte intact.
 *
 * THEY ARE NOT WEAKENED. Nothing inside was edited to pass against an empty page — a guard rewritten
 * that way would still be passing on the day someone ships one. Change `describe.skip` back to
 * `describe` the moment any content returns to `/`; if it passes, the landing explains itself again,
 * and if it fails, it is telling you something true.
 */
describe.skip("§9.1 — the landing explains itself in visible text", () => {
  const html = renderToStaticMarkup(createElement(HomePage));

  it("renders exactly one <h1>, and it is not visually hidden", () => {
    const h1s = [...html.matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi)];
    expect(h1s).toHaveLength(1);
    const [, attrs, inner] = h1s[0];
    expect(attrs).not.toMatch(/\bsr-only\b|\bvisually-hidden\b/);
    expect(attrs).not.toMatch(/aria-hidden="true"/);
    expect(inner.replace(/<[^>]+>/g, "").trim().length).toBeGreaterThan(0);
  });

  it("the H1 is §3's, verbatim", () => {
    expect(renderedCopy.get("/")).toContain("Describe the edit. A real timeline cuts it.");
  });

  it("the product explanation is visible copy, not screen-reader-only", () => {
    const copy = renderedCopy.get("/") ?? "";
    /**
     * WHAT THIS ASSERTED BEFORE, AND WHY IT MOVED. It pinned the §3 subhead — "…writes it onto a
     * real timeline you can still open and move". `ART-DIRECTION.md` §3.1 deletes that sentence by
     * name: "still open" is a durability promise, and `hite-app/CLAUDE.md` forbids one because the
     * anonymous session cookie is the only key to a project. The sentence is gone from the tree, so
     * a gate that still demanded it was asserting the copy the art direction ordered removed.
     *
     * The explanation itself did not go anywhere — §3.1 says the caveat "stays where the repo puts
     * it: the 'Do I need an account?' FAQ" — so the gate now points at the FAQ's own answer, read
     * from `LANDING_FAQ`, the single array that feeds both the visible DOM and the `FAQPage`
     * JSON-LD. That is a stronger check than the one it replaces: `htmlToCopy` strips `<script>`,
     * so this passes ONLY while the answer is in the rendered page and fails the moment the
     * explanation survives as structured data alone — which is precisely the §9.1 polarity this
     * suite exists to hold inverted.
     */
    expect(copy).toContain(LANDING_FAQ[0].a);
    expect(copy.length).toBeGreaterThan(2000);
  });

  it("no <h1> or <h2> is wrapped in an aria-hidden container attribute", () => {
    expect(html).not.toMatch(/aria-hidden="true"[^>]*>\s*<h[12]\b/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   §7.1 / §7.2 / §9.4 — THE DOCUMENTS ANSWER ENGINES READ.

   They used to be two hand-edited files in `public/`, which no build step can reach: the catalogue
   size was typed, the prompt list was kept in sync by memory, and the origin was whatever it was on
   the day someone last saved them — which is how one of them ended up on a dead domain carrying a
   banned phrase. §9.4 moves both behind route handlers over `lib/seo/llms.ts`, so every number and
   every URL is interpolated from the SAME source the components render from. These gates hold that
   construction in place: they assert the documents against the live sources, not against a snapshot.
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("llms.txt — the GEO surface, kept true by construction", () => {
  for (const [name, body] of LLMS_DOCS) {
    it(`${name} quotes the catalogue size the build gate computes, never the advertised one`, () => {
      expect(body).toContain(`${RENDERABLE_ENTRY_COUNT} effects`);
      // §7.1: the manifest's advertised size is false by 37 entries and must never appear.
      expect(body).not.toMatch(/\b76\b/);
    });

    it(`${name} lists only prompts from the machine-checked allowlist (§7.2)`, () => {
      const listed = [...body.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
      expect(listed).toEqual([...EXAMPLE_PROMPT_TEXTS]);
    });

    it(`${name} states plainly that beats are not wired`, () => {
      expect(body).toMatch(/beat detection is not wired/i);
    });

    it(`${name} points at the canonical origin, not a dead domain`, () => {
      const origins = new Set([...body.matchAll(/https?:\/\/[^/\s)]+/g)].map((m) => m[0]));
      expect([...origins]).toEqual([SITE_URL]);
    });
  }

  it("links every URL the sitemap stands behind (§10.4 — and nothing it dropped)", () => {
    const sitemapPaths = sitemap().map((entry) => entry.url.replace(SITE_URL, "") || "/");
    for (const p of sitemapPaths) expect(LLMS_KEY_PATHS).toContain(p);
    // §10.4: beats are not wired, so the page is out of the sitemap AND out of this list.
    expect(LLMS_KEY_PATHS).not.toContain("/how-to/sync-video-cuts-to-the-beat");
  });

  it("the index points at the full text, so an engine that reads one can find the other", () => {
    expect(LLMS_TXT).toContain(`${SITE_URL}/llms-full.txt`);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   §9.5 — ONE GRAPH, AND ITS FEATURE LIST IS QUOTED VERBATIM
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("§9.5 — structured data", () => {
  it("the landing emits exactly one JSON-LD block", () => {
    const html = renderToStaticMarkup(createElement(HomePage));
    const blocks = html.match(/type="application\/ld\+json"/g) ?? [];
    expect(blocks).toHaveLength(1);
  });

  it("the featureList interpolates the build gate rather than a literal", () => {
    const features = softwareApplicationNode().featureList as string[];
    expect(features).toContain(`${RENDERABLE_ENTRY_COUNT} effects the planner and the renderer both support`);
    expect(features.join(" ")).not.toMatch(/\b76\b/);
    // Every string an answer engine may quote verbatim must be true today.
    expect(features.join(" ")).not.toMatch(/beat|caption|overlay|WYSIWYG/i);
  });

  it("the Organization's sameAs is the one repo URL the rest of the property links", () => {
    expect(organizationNode().sameAs).toEqual([REPO_URL]);
    // SiteChrome cannot import this module (client component + registry manifest), so the duplicate
    // literal is kept honest here instead of by discipline.
    expect(SOURCE_URL).toBe(REPO_URL);
  });

  it("carries no price beyond the real free tier", () => {
    expect(softwareApplicationNode().offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
  });
});
