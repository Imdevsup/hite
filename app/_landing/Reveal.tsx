"use client";

/**
 * app/_landing/Reveal.tsx — scroll-in reveals for the sections below the piece.
 *
 * Every `.l3d-reveal` element rises in once it is 18% into the viewport. The CSS only hides
 * elements while `html[data-l3d-mode]` is set (i.e. JS has booted), so a visitor without JS
 * sees everything immediately, and reduced motion gets the static state through the global
 * kill switch. Native `animation-timeline: view()` was tried first and reported zero progress in
 * a headless run — an IntersectionObserver is boring and works everywhere.
 */
import { useEffect } from "react";

export function Reveal() {
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>("#l3d .l3d-reveal");
    if (nodes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute("data-in", "true");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return null;
}
