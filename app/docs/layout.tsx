/**
 * app/docs/layout.tsx — chrome for the documentation route.
 *
 * It carries `#l3d` so the landing's design tokens and fonts resolve here too (they are defined on
 * that id in `components/landing3d/landing.css`), then layers the docs' own sheet on top. The nav is
 * plain links: nothing on this route depends on JavaScript.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { LANDING_FONT_CLASS } from "@/components/landing3d/fonts";
import { PRIMARY_CTA } from "@/lib/site/primaryCta";
import { IDS } from "@/components/landing3d/ui/dom";
import { GithubMark } from "../_landing/GithubMark";
import "@/components/landing3d/landing.css";
import "./docs.css";
import { KiteMark } from "@/components/editor/KiteMark";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "The technical blueprint for Hite: the command union, the reducer, the EDL, the render IR, the planner's tool loop, the job queue and the renderer.",
  alternates: { canonical: "/docs" },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id={IDS.root} className={`l3d doc ${LANDING_FONT_CLASS}`}>
      <header className="doc-nav">
        <Link className="l3d-logo" href="/" aria-label="Hite, home">
          <KiteMark size={20} accent stroke={1.7} />
          Hite
        </Link>
        <nav className="doc-nav-links" aria-label="Documentation">
          <Link href="/">Home</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
        <a className="l3d-btn l3d-btn-primary l3d-btn-sm" href={PRIMARY_CTA.href} rel="noreferrer">
          <GithubMark />
          {PRIMARY_CTA.label}
        </a>
      </header>
      {children}
    </div>
  );
}
