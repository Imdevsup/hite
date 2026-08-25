import Link from "next/link";
import { KiteMark } from "@/components/editor/KiteMark";
import { SkipLink } from "@/components/marketing/SkipLink";
import {
  graph,
  baseGraphNodes,
  faqPageNode,
  breadcrumbNode,
  howToNode,
  type FaqItem,
  type HowToStep,
  type Crumb,
} from "@/lib/seo/jsonld";

/**
 * HowToPage — the shared, SERVER-RENDERED template for every GEO /how-to/* page.
 *
 * Same GEO contract as ComparePage (deliberately zero client JS, LCP-cheap, fully crawlable), tuned
 * for a step-by-step instructional page that answer-engines (ChatGPT, Perplexity, Claude, Google AI
 * Overviews / how-to surfaces) cite directly:
 *   1. BLUF answer first — a single extractable paragraph that answers the title question standalone.
 *   2. A real ordered <ol> of steps (each step self-contained), mirrored 1:1 into HowTo JSON-LD.
 *   3. Honest prose sections + an FAQ, mirrored into FAQPage JSON-LD, alongside the shared HITE
 *      identity nodes + breadcrumbs in one @graph.
 *
 * Honesty rule: no fabricated metrics, ratings, durations, or testimonials. Steps describe only what
 * the product actually does (natural-language editing, a real timeline, single-engine WYSIWYG export).
 */

export interface HowToSection {
  heading: string;
  /** Each string renders as its own paragraph. */
  body: string[];
}

export interface HowToPageData {
  slug: string; // e.g. "edit-a-phonk-video"
  /** Page <h1>. */
  title: string;
  /** Eyebrow chip text. */
  eyebrow: string;
  /** BLUF — the one-paragraph answer, written to read well quoted on its own. */
  bluf: string;
  /** Plain-language one-liner describing the task, fed to the HowTo schema `description`. */
  howToDescription: string;
  /** The ordered steps (drive both the rendered <ol> and the HowTo schema). */
  steps: HowToStep[];
  /** Optional long-form, honest prose after the steps. */
  sections?: HowToSection[];
  /** Optional example prompts to show the natural-language idiom in context. */
  prompts?: string[];
  /** Page-specific FAQ (drives both rendered list and FAQPage schema). */
  faq: FaqItem[];
  /** Closing line above the CTA. */
  ctaLead: string;
  /** Optional "related" links (e.g. to compare pages or sibling how-tos) for internal linking. */
  related?: { href: string; label: string }[];
}

export function HowToPage({ data }: { data: HowToPageData }) {
  const path = `/how-to/${data.slug}`;
  const crumbs: Crumb[] = [
    { name: "HITE", path: "/" },
    { name: "How-to", path: "/how-to" },
    { name: data.title, path },
  ];

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
      <SkipLink />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: graph(
            ...baseGraphNodes(),
            breadcrumbNode(crumbs),
            howToNode({ name: data.title, description: data.howToDescription, steps: data.steps }),
            faqPageNode(data.faq),
          ),
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
        <h1 className="label-display-tight text-[clamp(32px,6vw,56px)] leading-[1.04] max-w-[20ch]">
          {data.title}
        </h1>

        {/* BLUF — the single quotable answer, first thing after the H1. */}
        <p className="mt-6 text-[clamp(16px,2.4vw,21px)] leading-relaxed text-[var(--color-fg-dim)] max-w-[64ch]">
          <span className="label-mono-sm text-[var(--color-accent-hi)] mr-2">SHORT ANSWER</span>
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

        {/* STEPS — real ordered list, mirrored 1:1 into HowTo JSON-LD. */}
        <section className="mt-14">
          <h2 className="label-display text-[clamp(22px,3.6vw,30px)] mb-6">
            Step by step
          </h2>
          <ol className="space-y-4">
            {data.steps.map((s, i) => (
              <li
                key={s.name}
                className="flex gap-4 rounded-[var(--radius-lg)] border border-[var(--color-line-2)] bg-[rgba(255,255,255,0.02)] p-5"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-accent-dim)] bg-[var(--color-accent-faint)] label-mono text-[var(--color-accent)]"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[16.5px] font-semibold tracking-tight text-[var(--color-fg)]">
                    {s.name}
                  </h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--color-fg-dim)] max-w-[64ch]">
                    {s.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* EXAMPLE PROMPTS — show the natural-language idiom in context. */}
        {data.prompts && data.prompts.length > 0 && (
          <section className="mt-12">
            <h2 className="label-display text-[clamp(20px,3.2vw,26px)] mb-4">Prompts to try</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.prompts.map((p) => (
                <div
                  key={p}
                  className="rounded-[var(--radius-md)] border border-[var(--color-line-2)] bg-[var(--color-panel-hi)] p-4 text-[14.5px] leading-snug text-[var(--color-fg-dim)]"
                >
                  &ldquo;{p}&rdquo;
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PROSE */}
        {data.sections?.map((s) => (
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

        {/* RELATED — internal links for crawl depth + GEO topical clustering. */}
        {data.related && data.related.length > 0 && (
          <section className="mt-14">
            <h2 className="label-display text-[clamp(18px,2.8vw,22px)] mb-4">Keep reading</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.related.map((r) => (
                <Link
                  key={r.href}
                  href={r.href}
                  className="group flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line-2)] bg-[rgba(255,255,255,0.02)] p-4 hover:border-[var(--color-accent-dim)] motion-base"
                >
                  <span className="text-[14.5px] text-[var(--color-fg-dim)] group-hover:text-[var(--color-fg)] motion-base">
                    {r.label}
                  </span>
                  <span aria-hidden className="text-[var(--color-muted)] group-hover:text-[var(--color-accent)] motion-base">
                    →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CLOSING CTA */}
        <section className="mt-16 rounded-[var(--radius-xl)] border border-[var(--color-line-2)] bg-[rgba(255,255,255,0.02)] p-8 md:p-10 text-center">
          <p className="label-display text-[clamp(20px,3.4vw,28px)] max-w-[24ch] mx-auto">{data.ctaLead}</p>
          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
            <Link href="/app" className="btn btn-solid btn-lg btn-pill">
              Make my first edit
            </Link>
            <Link href="/how-to" className="btn btn-lg btn-pill">
              More how-tos
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
            <Link href="/how-to" className="hover:text-[var(--color-fg)] motion-base">How-to</Link>
            <Link href="/compare" className="hover:text-[var(--color-fg)] motion-base">Compare</Link>
            <Link href="/app" className="hover:text-[var(--color-fg)] motion-base">Open the editor</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
