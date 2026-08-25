import type { Metadata } from "next";
import Link from "next/link";
import { KiteMark } from "@/components/editor/KiteMark";
import { SkipLink } from "@/components/marketing/SkipLink";
import { graph, baseGraphNodes, breadcrumbNode } from "@/lib/seo/jsonld";
import { ArrowRight } from "lucide-react";

const TITLE = "Compare HITE";
const DESCRIPTION =
  "Compare HITE — the AI-native video editor where you describe the edit and a real, hand-editable " +
  "timeline executes it, on one render engine for preview and export. See how HITE stacks up for " +
  "TikTok, phonk, and against CapCut.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/compare" },
  openGraph: { title: `${TITLE} · HITE`, description: DESCRIPTION, url: "/compare", type: "website" },
};

const COMPARISONS = [
  {
    href: "/compare/hite-vs-capcut",
    title: "HITE vs CapCut",
    blurb: "Describe-the-edit AI on a real timeline vs a mature manual editor. Where each wins.",
  },
  {
    href: "/compare/best-ai-video-editor-tiktok",
    title: "Best AI video editor for TikTok",
    blurb: "What actually makes an AI editor good for 9:16 short-form — and how HITE fits.",
  },
  {
    href: "/compare/best-ai-video-editor-phonk",
    title: "Best AI video editor for phonk",
    blurb: "RGB split, glitch bars, whip pans and crushed grades — the edit-culture idiom, from a sentence.",
  },
];

export default function CompareIndex() {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
      <SkipLink />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: graph(
            ...baseGraphNodes(),
            breadcrumbNode([
              { name: "HITE", path: "/" },
              { name: "Compare", path: "/compare" },
            ]),
          ),
        }}
      />

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
        <span className="chip chip-accent mb-5">COMPARE</span>
        <h1 className="label-display-tight text-[clamp(32px,6vw,56px)] leading-[1.04] max-w-[16ch]">
          How HITE compares
        </h1>
        <p className="mt-6 text-[clamp(16px,2.4vw,21px)] leading-relaxed text-[var(--color-fg-dim)] max-w-[64ch]">
          HITE turns a plain-language description into a real, editable timeline — and uses one render
          engine for both the preview and the export, so there is no second renderer for the file to
          disagree with. Honest, side-by-side breakdowns:
        </p>

        <div className="mt-10 grid gap-4">
          {COMPARISONS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-line-2)] bg-[rgba(255,255,255,0.02)] p-6 hover:border-[var(--color-accent-dim)] motion-base"
            >
              <div>
                <h2 className="label-display text-[clamp(18px,2.8vw,22px)]">{c.title}</h2>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-[var(--color-fg-dim)] max-w-[56ch]">{c.blurb}</p>
              </div>
              <ArrowRight
                size={18}
                className="shrink-0 text-[var(--color-muted)] group-hover:text-[var(--color-accent)] group-hover:translate-x-0.5 motion-base"
              />
            </Link>
          ))}
        </div>

        <div className="mt-14 flex flex-col sm:flex-row gap-3">
          <Link href="/app" className="btn btn-solid btn-lg btn-pill">
            Make my first edit
          </Link>
          <Link href="/how-to" className="btn btn-lg btn-pill">
            See the how-to guides
          </Link>
        </div>
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
            <Link href="/app" className="hover:text-[var(--color-fg)] motion-base">Open the editor</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
