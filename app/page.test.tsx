/**
 * app/page.test.tsx — the gates on the assembly itself.
 *
 * WHAT THIS FILE USED TO BE. It gated six mounted sections: their IA order, the derived numbers they
 * printed, and the FAQ schema built from the array the FAQ section rendered. Every one of those
 * sections was deleted from `app/page.tsx` on 2026-08-20 at the owner's instruction, so those
 * assertions now describe a page that does not exist and have been removed with what they tested.
 * They are not lost — branch `landing-before-strip` (`3ee8f15`) holds the file as it stood.
 *
 * WHAT SURVIVED, AND WHY IT MATTERS MORE NOW THAN IT DID BEFORE. The anchor and internal-link gates
 * are kept in full. The old header said it exactly: "removing a section is exactly the change that
 * strands an anchor in persistent chrome, and this is the gate that turns that from something a
 * reviewer has to notice into something the build refuses." Emptying the whole page is that change at
 * maximum scale — it orphaned every in-page anchor in the header and the footer at once, on chrome
 * that renders on EVERY route — so this is the run where those gates earn their keep. They caught it.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE. That the page says anything. An empty landing has no `<h1>`
 * and no visible product explanation, which violates §9.1 — and `lib/seo/honesty.test.ts` fails on
 * exactly that, by design. Those failures are the correct signal that the page is in an interim
 * state, and they were left red rather than weakened: a guard edited to pass against an empty page
 * would still be passing on the day someone ships one.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import HomePage from "./page";
import { SITE_FOOTER_COLUMNS, SITE_NAV_LINKS } from "@/components/site/SiteChrome";
import { LANDING_FAQ } from "./_landing/faq";

const HTML = renderToStaticMarkup(<HomePage />);
const APP_DIR = path.resolve(__dirname);

/** Every `id="…"` the assembled page renders. */
const IDS = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

/** Every `href="…"` the assembled page renders. */
const HREFS = [...HTML.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]);

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   THE SHELL — what is left, and the landmarks that must still be exactly right
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("the page", () => {
  it("renders one visible <h1> with the spec's headline, outside any sr-only wrapper", () => {
    const h1s = [...HTML.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
    expect(h1s).toHaveLength(1);
    expect(h1s[0][1].replace(/<[^>]+>/g, "").trim()).toBe("Edit by saying so.");
    expect(h1s[0][0]).not.toMatch(/sr-only|aria-hidden="true"/);
  });

  it("mounts the demo, the sections and the close, with the anchors the nav names", () => {
    for (const id of ["l3d-scroll", "demo", "how-it-works", "under-the-hood", "faq", "start"]) {
      expect(IDS.has(id), `#${id} should be on the page`).toBe(true);
    }
  });

  it("renders every FAQ answer visibly, in page order", () => {
    let cursor = 0;
    for (const item of LANDING_FAQ) {
      const at = HTML.indexOf(item.a, cursor);
      expect(at, `answer not on the page: ${item.q}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("declares the demo as staged and derives its numbers", () => {
    expect(HTML).toContain("staged project");
    expect(HTML).toContain("synthetic footage");
    // No testimonial, no email capture, no hosted-editor promise.
    expect(HTML).not.toMatch(/<blockquote|<input[^>]*type="email"|href="\/app"/);
  });

  it("has exactly one <main>, and it is still the skip link's target", () => {
    expect([...HTML.matchAll(/<main\b/g)]).toHaveLength(1);
    // The empty landmark is kept ON PURPOSE. The header's skip link points at `#main`, and a skip
    // link whose target does not exist is a worse failure than a landmark with nothing in it.
    expect(IDS.has("main")).toBe(true);
    expect(HTML).toMatch(/<main[^>]*\btabindex="-1"/i);
  });

  it("puts the skip link before the <main> it targets", () => {
    const skip = HTML.indexOf('href="#main"');
    expect(skip).toBeGreaterThanOrEqual(0);
    expect(skip).toBeLessThan(HTML.indexOf("<main"));
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   ANCHORS — the gate that caught the strip
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("in-page anchors", () => {
  const fragments = [...new Set(HREFS.filter((h) => h.startsWith("#")).map((h) => h.slice(1)))];

  it("every #fragment on the page resolves to an element this page renders", () => {
    const dead = fragments.filter((f) => !IDS.has(f));
    expect(dead, `dead in-page anchors: ${dead.join(", ")}`).toEqual([]);
  });

  it("neither the nav nor the footer names an anchor the page does not render", () => {
    // Both arrays are rendered by chrome on EVERY route, so a stranded anchor here is sitewide.
    const chrome = [...SITE_NAV_LINKS, ...SITE_FOOTER_COLUMNS.flatMap((c) => c.links)];
    const dead = chrome.filter((l) => l.href.startsWith("#") && !IDS.has(l.href.slice(1)));
    expect(dead.map((l) => `${l.label} → ${l.href}`)).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   INTERNAL ROUTES — a link on the property's most-visited page that 404s is expensive and quiet
   ───────────────────────────────────────────────────────────────────────────────────────── */

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

/**
 * Does this pathname resolve — either to a page in `app/` (allowing `(group)` and `[dynamic]`
 * directories) or to a static file under `public/`?
 */
function routeExists(pathname: string): boolean {
  const asset = path.join(PUBLIC_DIR, ...pathname.split("/").filter(Boolean));
  if (existsSync(asset) && statSync(asset).isFile()) return true;

  const segments = pathname.split("/").filter(Boolean);
  const walk = (dir: string, rest: readonly string[]): boolean => {
    if (rest.length === 0) {
      return ["page.tsx", "page.ts", "route.ts"].some((f) => existsSync(path.join(dir, f)));
    }
    const [head, ...tail] = rest;
    const direct = path.join(dir, head);
    if (existsSync(direct) && statSync(direct).isDirectory() && walk(direct, tail)) return true;
    // Dynamic segment, e.g. app/app/[projectId].
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("(") && walk(path.join(dir, entry.name), rest)) return true;
      if (entry.name.startsWith("[") && walk(path.join(dir, entry.name), tail)) return true;
    }
    return false;
  };
  return walk(APP_DIR, segments);
}

describe("internal links", () => {
  const internal = [...new Set(HREFS.filter((h) => h.startsWith("/")))];

  it("resolves every internal href to a real route on disk", () => {
    const dead = internal.filter((href) => !routeExists(href.split(/[?#]/)[0]));
    expect(dead, `hrefs with no route in app/: ${dead.join(", ")}`).toEqual([]);
  });

  it("still reaches the marketing content layer from the homepage", () => {
    // The GEO pages had no inbound link from `/` at all, which is the cheapest internal-linking fix
    // on the property. The footer is now the ONLY thing carrying that link equity — the body used to
    // help and no longer exists — so this gate matters more after the strip, not less.
    for (const href of ["/compare", "/how-to", "/compare/hite-vs-capcut", "/how-to/edit-videos-by-typing"]) {
      expect(internal, `homepage should link ${href}`).toContain(href);
    }
  });

  it("does not link the beat-sync guide (§10.4 — beats are not wired)", () => {
    expect(internal).not.toContain("/how-to/sync-video-cuts-to-the-beat");
  });

  it("does not link /effects/[key] while that route does not exist (§7.1 rule 1)", () => {
    expect(existsSync(path.join(APP_DIR, "effects"))).toBe(false);
    expect(internal.filter((h) => h.startsWith("/effects/"))).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
   §9.5 — the structured-data graph, minus the node whose section is gone
   ───────────────────────────────────────────────────────────────────────────────────────── */

describe("structured data", () => {
  const raw = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(HTML)?.[1] ?? "";
  const parsed = JSON.parse(raw) as { "@graph": { "@type": string }[] };

  it("emits a parseable @graph with the three nodes that describe the property", () => {
    const types = parsed["@graph"].map((n) => n["@type"]);
    expect(types).toEqual(
      expect.arrayContaining(["Organization", "WebSite", "SoftwareApplication"]),
    );
  });

  it("emits a FAQPage built from the same array the visible FAQ renders", () => {
    // Both come from `app/_landing/faq.ts`, so the schema text is byte-identical to the on-screen
    // text by construction rather than by discipline. An answer engine quotes this node verbatim.
    expect(parsed["@graph"].map((n) => n["@type"])).toContain("FAQPage");
    expect((raw.match(/acceptedAnswer/g) ?? []).length).toBe(LANDING_FAQ.length);
    for (const item of LANDING_FAQ) expect(raw).toContain(JSON.stringify(item.q).slice(1, -1));
  });
});
