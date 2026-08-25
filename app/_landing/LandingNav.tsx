"use client";

/**
 * app/_landing/LandingNav.tsx — fixed glass nav (spec §11): appears on scroll-up only, and only
 * after 60vh. Logo left, three links centre, the CTA right. The skip link is its first child so it
 * is the first focusable node on the page.
 *
 * It listens to native scroll: Lenis scrolls the window, so this needs no coupling to the island.
 */
import { useEffect, useRef, useState } from "react";
import { PRIMARY_CTA } from "@/lib/site/primaryCta";
import { GithubMark } from "./GithubMark";
import { KiteMark } from "@/components/editor/KiteMark";

export const LANDING_NAV_LINKS = [
  { label: "Demo", href: "#demo" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Docs", href: "/docs" },
] as const;

export function LandingNav() {
  const [show, setShow] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const up = y < lastY.current - 2;
        const past = y > window.innerHeight * 0.6;
        setShow(past && up);
        lastY.current = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header className="l3d-nav" data-show={show ? "true" : "false"}>
      <a className="l3d-skip" href="#main">
        Skip to content
      </a>
      <a className="l3d-logo" href="#l3d" aria-label="Hite, back to top">
        <KiteMark size={20} accent stroke={1.7} />
        Hite
      </a>
      <nav className="l3d-nav-links" aria-label="Primary">
        {LANDING_NAV_LINKS.map((l) => (
          <a key={l.href} href={l.href} {...(l.href.startsWith("http") ? { rel: "noreferrer" } : {})}>
            {l.label}
          </a>
        ))}
      </nav>
      <a className="l3d-btn l3d-btn-primary l3d-btn-sm" href={PRIMARY_CTA.href} {...(PRIMARY_CTA.href.startsWith("http") ? { rel: "noreferrer" } : {})}>
        <GithubMark />
        {PRIMARY_CTA.label}
      </a>
    </header>
  );
}
