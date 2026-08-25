/**
 * lib/seo/jsonld.ts — typed schema.org JSON-LD builders for SEO + GEO.
 *
 * One source of truth for HITE's entity graph so every page (landing, /compare/*, /how-to/*) emits a
 * consistent Organization + WebSite + SoftwareApplication identity, with per-page extras (FAQPage,
 * BreadcrumbList, HowTo) layered on top. Answer-engines (ChatGPT, Perplexity, Claude, Google AI
 * Overviews) extract these entities, so consistency across pages is the GEO win.
 *
 * DESIGN-DIRECTION §9.5 — "One `@context` / `@graph` block on `/` with cross-referenced `@id`s".
 * Until 2026-08-19 the property emitted FOUR competing graphs: `app/page.tsx`, `app/c1`, `app/c2`
 * and `app/c3` each hand-rolled their own Organization/WebSite/SoftwareApplication with the SAME
 * `@id`s but different property sets, all serving 200. That is not four pages describing one entity,
 * it is one entity described four contradictory ways, which is the thing that poisons an entity
 * graph. The three concept routes are deleted; this module is the only builder left.
 *
 * Honesty rules enforced here, not remembered:
 *   · NO aggregateRating / review / ratingValue — there are no real ratings (`jsonld.test.ts` greps).
 *   · `featureList` is quoted VERBATIM by answer engines, so every string in it must be true today.
 *     The catalog size is INTERPOLATED from the build gate (§7.1 rule 3), never typed as a literal —
 *     the manifest advertises 76 entries and the renderer paints 39 of them.
 *   · Nothing beat-related: `lib/render/resolver.ts` says in its own header that beats are not wired
 *     and `planBeatCuts` returns `{ bpm: 0, cutTicks: [] }`. Any beat claim here would be a fabricated
 *     capability sitting in the exact document an answer engine quotes.
 */
import { RENDERABLE_ENTRY_COUNT } from "@/lib/landing/catalog";

/**
 * The canonical origin, and the ONLY place this default lives. Every page, the sitemap, robots, and
 * the JSON-LD @ids derive from it — a wrong value here de-indexes the whole site, so it is not
 * re-declared anywhere else (it previously was, in 7 other files, all defaulting to a domain that
 * does not resolve; the live site consequently advertised `hite.video` as its canonical home).
 * Override per-environment with NEXT_PUBLIC_SITE_URL (no trailing slash).
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.tryhite.xyz";

/**
 * The source repository — the Organization's `sameAs`, and the one owner of the repo URL for the
 * whole property. `app/page.tsx` passes it down to `<Hero>` and `<ForDevelopers>` so their prop
 * defaults never diverge from it, and `jsonld.test.ts` asserts it equals `SiteChrome`'s `SOURCE_URL`
 * (that module cannot import this one — it is a client component and this file pulls in the
 * registry manifest — so the duplicate literal is kept honest by a test instead of by discipline).
 *
 * ⚠ OPEN HONESTY GAP, NOT A BUG IN THIS FILE. Verified 2026-08-19: `gh repo view Imdevsup/hite`
 * reports `"visibility":"PRIVATE"` and an anonymous GET of this URL returns 404. The MIT `LICENSE`
 * is real and on disk, so "open source" is a true statement about the licence — but every "View
 * source" link on the property, and this `sameAs`, resolve to nothing until the repo is published.
 * Publishing it is the one-line fix; changing this constant is the other. Do not quietly delete the
 * links instead — §6.0/§6.5/§9.5 all require them.
 */
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Imdevsup/hite";

/** §9.5 names the three identity nodes `#org`, `#site` and `#app`. Do not rename — they are cited. */
const ORG_ID = `${SITE_URL}/#org`;
const SITE_ID = `${SITE_URL}/#site`;
const APP_ID = `${SITE_URL}/#app`;

/** Minimal JSON-LD node shape (avoids `any` while staying open for schema.org's free-form fields). */
type JsonLdNode = Record<string, unknown>;

/**
 * The one description of the product, quoted by answer engines. Every clause is checkable against
 * source: the planner emits a typed `EditCommand[]` (`lib/ai/edit-batch-flat.ts`), `reduceBatch`
 * folds it into `Edl.2` as a pure function (`lib/edl/reducer.ts`), and preview and export compile
 * the same composition through `lib/render/compile.ts`. No beat claim, no caption claim, no count
 * that is not derived — see the header.
 */
const HITE_DESCRIPTION =
  "HITE is an AI-native video editor — vibe coding, but pointed at a timeline. Describe the change " +
  "you want in plain language; the model writes a typed list of edit commands and a pure reducer " +
  "applies them to a real edit decision list, so what comes back is an ordinary timeline of clips, " +
  "cuts and effects you can still move by hand. One render engine drives both preview and export. " +
  "Open source under MIT, with Remotion under its own licence.";

/** The HITE Organization node (referenced by @id everywhere else). */
export function organizationNode(): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "HITE",
    url: SITE_URL,
    logo: `${SITE_URL}/kite.svg`,
    description: "Makers of HITE, the AI-native video editor for edit-culture creators.",
    // §9.5: for an open-source project the source repository is the single most valuable `sameAs`
    // available — it is what ties this entity to a second, independently-verifiable profile.
    sameAs: [REPO_URL],
  };
}

/** The WebSite node. */
export function websiteNode(): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: SITE_URL,
    name: "HITE",
    publisher: { "@id": ORG_ID },
  };
}

/**
 * The SoftwareApplication node.
 *
 * §9.5 cut this `featureList` to four strings and requires the count to be interpolated from the
 * build gate. The previous list shipped nine, four of which were false: "Beat-synced effects" (beats
 * are not wired), "Auto captions" and "Overlays and masks" (neither lowers to a clip effect the
 * catalog can stand behind today), and "(WYSIWYG)" — the same overclaim §7.4 bans as "to the pixel".
 * The constraint §9.5 was enforcing is TRUTH, not the number four: the fifth string below was added
 * when the login wall was deleted (`middleware.ts` mints an anonymous session on the first `/app`
 * request), because "do I need an account" is a question answer engines are asked outright and this
 * is the field they quote. It is checkable in one file, which is the bar every entry here has to
 * clear. Do NOT add a sixth for something a module cannot be opened to prove.
 *
 * `offers.price: "0"` stays only while a genuinely free tier is what ships. There is NO payment path
 * in this codebase, so a Pro price here would advertise a checkout that does not exist.
 */
export function softwareApplicationNode(): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: "HITE",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description: HITE_DESCRIPTION,
    publisher: { "@id": ORG_ID },
    featureList: [
      "Describe an edit in plain language and get a real, hand-editable timeline",
      `${RENDERABLE_ENTRY_COUNT} effects the planner and the renderer both support`,
      "One render engine for preview and export",
      "No sign-up — the editor opens without an account or an email",
      "Open source (MIT; Remotion carries its own license)",
    ],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * FAQPage node built from a question/answer array (answers should be self-contained for GEO).
 *
 * Pass the page's own path to give the node a stable, page-scoped `@id` — several pages carry an
 * FAQ, and an un-scoped `@id` would make them all the same node. §9.5 names the landing's `#faq`.
 * The array MUST be the same one the page renders visibly: one exported array, rendered twice, so
 * the schema text is byte-identical to the on-screen text by construction (§6.7).
 */
export function faqPageNode(faq: readonly FaqItem[], pagePath?: string): JsonLdNode {
  const node: JsonLdNode = {
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  if (pagePath !== undefined) node["@id"] = `${SITE_URL}${pagePath === "/" ? "/" : pagePath}#faq`;
  return node;
}

export interface HowToStep {
  /** Short imperative step name (e.g. "Drop in your clip"). */
  name: string;
  /** Self-contained step instruction — reads cleanly when an answer-engine quotes it alone. */
  text: string;
}

/**
 * HowTo node built from an ordered step list. Answer-engines and Google's how-to surfaces lift these
 * step-by-step, so each step's `text` is written to stand on its own. We deliberately omit `image`,
 * `totalTime`, and `estimatedCost` unless real values exist (honesty rule) — partial/optional schema
 * fields are fine to leave out, but never fabricate a duration or a screenshot URL that isn't real.
 */
export function howToNode(input: { name: string; description: string; steps: HowToStep[] }): JsonLdNode {
  return {
    "@type": "HowTo",
    name: input.name,
    description: input.description,
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

export interface Crumb {
  name: string;
  path: string; // absolute path, e.g. "/compare/hite-vs-capcut"
}

/** BreadcrumbList node — helps answer-engines and rich results place a deep page in context. */
export function breadcrumbNode(crumbs: Crumb[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.path}`,
    })),
  };
}

/**
 * Wrap a set of nodes in a single @graph document. Using one @graph per page (rather than several
 * sibling <script> tags) is the schema.org-recommended way to express linked entities by @id.
 */
export function graph(...nodes: JsonLdNode[]): string {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": nodes });
}

/** The base identity graph (Organization + WebSite + SoftwareApplication) every page should include. */
export function baseGraphNodes(): JsonLdNode[] {
  return [organizationNode(), websiteNode(), softwareApplicationNode()];
}
