import type { Metadata } from "next";
import Link from "next/link";
import { KiteMark } from "@/components/editor/KiteMark";
import { SkipLink } from "@/components/marketing/SkipLink";
import { graph, baseGraphNodes, breadcrumbNode } from "@/lib/seo/jsonld";
import { ArrowRight } from "lucide-react";

const TITLE = "How to edit video with HITE";
const DESCRIPTION =
  "Step-by-step guides for editing video by describing it — phonk edits, cutting dead air, and " +
  "text-to-edit. Drop a clip into HITE, say what you want changed, and a real, hand-editable timeline " +
  "executes it, on one render engine for preview and export.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/how-to" },
  openGraph: { title: `${TITLE} · HITE`, description: DESCRIPTION, url: "/how-to", type: "website" },
};

const GUIDES = [
  {
    href: "/how-to/edit-videos-by-typing",
    title: "How to edit videos by typing",
    blurb: "Text-to-edit, end to end: describe the edit in plain language and a real timeline executes it.",
  },
  {
    href: "/how-to/sync-video-cuts-to-the-beat",
    title: "How to sync video cuts to the beat",
    blurb: "What ships today, and what does not: beat detection is in the codebase but is not wired to the timeline.",
  },
  {
    href: "/how-to/edit-a-phonk-video",
    title: "How to edit a phonk video",
    blurb: "RGB split, glitch bars, zoom punch, whip pans and a crushed grade — from a sentence.",
  },
];

export default function HowToIndex() {
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
              { name: "How-to", path: "/how-to" },
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
        <span className="chip chip-accent mb-5">HOW-TO</span>
        <h1 className="label-display-tight text-[clamp(32px,6vw,56px)] leading-[1.04] max-w-[16ch]">
          How to edit video with HITE
        </h1>
        <p className="mt-6 text-[clamp(16px,2.4vw,21px)] leading-relaxed text-[var(--color-fg-dim)] max-w-[64ch]">
          You describe the edit in plain language; a real, editable timeline executes it — and one render
          engine drives both the preview and the export. Step-by-step guides for the edits creators
          actually make:
        </p>

        <div className="mt-10 grid gap-4">
          {GUIDES.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="group flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-line-2)] bg-[rgba(255,255,255,0.02)] p-6 hover:border-[var(--color-accent-dim)] motion-base"
            >
              <div>
                <h2 className="label-display text-[clamp(18px,2.8vw,22px)]">{g.title}</h2>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-[var(--color-fg-dim)] max-w-[56ch]">{g.blurb}</p>
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
          <Link href="/compare" className="btn btn-lg btn-pill">
            Compare HITE
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
            <Link href="/compare" className="hover:text-[var(--color-fg)] motion-base">Compare</Link>
            <Link href="/app" className="hover:text-[var(--color-fg)] motion-base">Open the editor</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
