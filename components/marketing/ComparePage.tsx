import Link from "next/link";
import { KiteMark } from "@/components/editor/KiteMark";
import { SkipLink } from "@/components/marketing/SkipLink";
import {
  graph,
  baseGraphNodes,
  faqPageNode,
  breadcrumbNode,
  type FaqItem,
  type Crumb,
} from "@/lib/seo/jsonld";

/**
 * ComparePage — the shared, SERVER-RENDERED template for every GEO /compare/* page.
 *
 * Deliberately zero client JS: answer-engines (ChatGPT, Perplexity, Claude, Google AI Overviews)
 * and search crawlers read the raw HTML, and this is also the LCP-cheapest possible page. The
 * structure is the GEO contract:
 *   1. BLUF verdict first (a single extractable paragraph an LLM can quote standalone).
 *   2. A real HTML <table> (LLMs lift comparison tables near-verbatim; div-grids do not extract).
 *   3. Honest prose sections + an FAQ, all mirrored into a JSON-LD @graph (FAQPage + breadcrumbs
 *      + the shared HITE identity nodes).
 *
 * Honesty rule: no fabricated metrics, ratings, or testimonials. Comparative claims are limited to
 * verifiable product facts (HITE's single-engine WYSIWYG, natural-language editing, real timeline).
 */

export interface CompareRow {
  /** Capability / dimension being compared. */
  feature: string;
  /** HITE's position — short, factual. */
  hite: string;
  /** The alternative's position — fair, non-disparaging, generic where appropriate. */
  other: string;
}

export interface CompareSection {
  heading: string;
  /** Each string renders as its own paragraph. */
  body: string[];
}

export interface ComparePageData {
  slug: string; // e.g. "hite-vs-capcut"
  /** Page <h1>. */
  title: string;
  /** Eyebrow chip text. */
  eyebrow: string;
  /** BLUF — the one-paragraph verdict, written to read well quoted on its own. */
  bluf: string;
  /** Name of the "other" column header (e.g. "CapCut", "Typical AI editors"). */
  otherLabel: string;
  /** The comparison table rows. */
  rows: CompareRow[];
  /** Long-form, honest prose. */
  sections: CompareSection[];
  /** Page-specific FAQ (drives both rendered list and FAQPage schema). */
  faq: FaqItem[];
  /** Closing line above the CTA. */
  ctaLead: string;
}

export function ComparePage({ data }: { data: ComparePageData }) {
  const path = `/compare/${data.slug}`;
  const crumbs: Crumb[] = [
    { name: "HITE", path: "/" },
    { name: "Compare", path: "/compare" },
    { name: data.title, path },
  ];

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
      <SkipLink />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: graph(...baseGraphNodes(), breadcrumbNode(crumbs), faqPageNode(data.faq)),
        }}
      />

      {/* NAV — same identity as the landing page, server-rendered. */}
      <header className="sticky top-0 z-50 border-b border-[var(--color-line)] bg-[var(--material-thin)] backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <KiteMark size={22} accent stroke={1.6} />
            <span className="label-display text-[17px] tracking-tight">HITE</span>
          </Link>
          <Link href="/app" className="btn btn-solid btn-sm btn-pill">
            Start free
          </Link>
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="relative z-10 mx-auto max-w-[860px] px-5 sm:px-6 py-14 md:py-20 outline-none">
        {/* Breadcrumb (visible + semantic) */}
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex flex-wrap items-center gap-2 label-mono-sm text-[var(--color-muted)]">
            {crumbs.map((c, i) => (
              <li key={c.path} className="flex items-center gap-2">
                {i < crumbs.length - 1 ? (
                  <Link href={c.path} className="hover:text-[var(--color-fg)] motion-base">
                    {c.name}
                  </Link>
                ) : (
                  <span className="text-[var(--color-fg-soft)]">{c.name}</span>
                )}
                {i < crumbs.length - 1 && <span className="text-[var(--color-subtle)]">/</span>}
              </li>
            ))}
          </ol>
        </nav>

        {/* HERO */}
        <span className="chip chip-accent mb-5">{data.eyebrow}</span>
        <h1 className="label-display-tight text-[clamp(32px,6vw,56px)] leading-[1.04] max-w-[18ch]">
          {data.title}
        </h1>

        {/* BLUF — the single quotable verdict, first thing after the H1. */}
        <p className="mt-6 text-[clamp(16px,2.4vw,21px)] leading-relaxed text-[var(--color-fg-dim)] max-w-[64ch]">
          <span className="label-mono-sm text-[var(--color-accent-hi)] mr-2">VERDICT</span>
          {data.bluf}
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Link href="/app" className="btn btn-solid btn-lg btn-pill">
            Make my first edit
          </Link>
          <Link href="/" className="btn btn-lg btn-pill">
            See how HITE works
          </Link>
        </div>

        {/* COMPARISON TABLE — real <table>, extracted verbatim by answer-engines. */}
        <section className="mt-14">
          <h2 className="label-display text-[clamp(22px,3.6vw,30px)] mb-5">
            HITE vs {data.otherLabel}, side by side
          </h2>
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-line-2)]">
            <table className="w-full border-collapse text-[14.5px]">
              <caption className="sr-only">
                Feature-by-feature comparison of HITE and {data.otherLabel}.
              </caption>
              <thead>
                <tr className="bg-[rgba(255,255,255,0.03)]">
                  <th scope="col" className="text-left font-semibold p-3.5 border-b border-[var(--color-line-2)] text-[var(--color-fg-soft)]">
                    Capability
                  </th>
                  <th scope="col" className="text-left font-semibold p-3.5 border-b border-[var(--color-line-2)] text-[var(--color-accent-hi)]">
                    HITE
                  </th>
                  <th scope="col" className="text-left font-semibold p-3.5 border-b border-[var(--color-line-2)] text-[var(--color-fg-soft)]">
                    {data.otherLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.feature} className="align-top">
                    <th scope="row" className="text-left font-medium p-3.5 border-b border-[var(--color-line)] text-[var(--color-fg)]">
                      {r.feature}
                    </th>
                    <td className="p-3.5 border-b border-[var(--color-line)] text-[var(--color-fg-dim)]">
                      {r.hite}
                    </td>
                    <td className="p-3.5 border-b border-[var(--color-line)] text-[var(--color-muted)]">
                      {r.other}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* PROSE */}
        {data.sections.map((s) => (
          <section key={s.heading} className="mt-12">
            <h2 className="label-display text-[clamp(20px,3.2vw,26px)] mb-3">{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-3 text-[15.5px] leading-relaxed text-[var(--color-fg-dim)] max-w-[68ch]">
                {p}
              </p>
            ))}
          </section>
        ))}

        {/* FAQ — answer-first, mirrored to FAQPage JSON-LD above. */}
        <section className="mt-14">
          <h2 className="label-display text-[clamp(22px,3.6vw,30px)] mb-5">Frequently asked</h2>
          <div className="divide-y divide-[var(--color-line)]">
            {data.faq.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="cursor-pointer list-none flex items-start justify-between gap-4 text-[var(--color-fg)] font-medium">
                  <span>{f.q}</span>
                  <span className="text-[var(--color-accent)] shrink-0 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-fg-dim)] max-w-[68ch]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CLOSING CTA */}
        <section className="mt-16 rounded-[var(--radius-xl)] border border-[var(--color-line-2)] bg-[rgba(255,255,255,0.02)] p-8 md:p-10 text-center">
          <p className="label-display text-[clamp(20px,3.4vw,28px)] max-w-[24ch] mx-auto">{data.ctaLead}</p>
          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
            <Link href="/app" className="btn btn-solid btn-lg btn-pill">
              Make my first edit
            </Link>
            <Link href="/compare" className="btn btn-lg btn-pill">
              Compare more
            </Link>
          </div>
          {/* "YOU KEEP YOUR EDITS" was the third clause until the login wall was deleted. `/app`
              mints an anonymous session (middleware.ts) and that cookie is the only key to a
              project, so a durability promise here would outrun the product. The landing's FAQ
              carries the full answer; this line states only what is checkable. */}
          <p className="mt-5 label-mono-sm text-[var(--color-muted)]">FREE TO START · NO SIGN-UP · NO CREDIT CARD</p>
        </section>
      </main>

      <footer className="relative z-10 border-t border-[var(--color-line)] mt-10">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-6 py-8 flex flex-wrap items-center justify-between gap-4 label-mono-sm text-[var(--color-muted)]">
          <div className="flex items-center gap-2.5">
            <KiteMark size={16} muted stroke={1.5} />
            <span>HITE — vibe editing for video</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/" className="hover:text-[var(--color-fg)] motion-base">Home</Link>
            <Link href="/compare" className="hover:text-[var(--color-fg)] motion-base">Compare</Link>
            <Link href="/app" className="hover:text-[var(--color-fg)] motion-base">Open the editor</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
