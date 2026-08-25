"use client";

/**
 * components/landing3d/Landing3D.tsx — the client boundary between the server-rendered page and
 * the WebGL island.
 *
 * `next/dynamic(..., { ssr: false })` is only legal inside a Client Component, so this wrapper
 * exists to host it. It decides the mode once, after mount:
 *   · scroll   — the full scroll-driven piece (≥ 900px, motion allowed).
 *   · mobile   — the same scene in its simplified form (< 900px): curl, grain, vignette, the panel
 *                above the timeline instead of behind it.
 *   · stills   — `prefers-reduced-motion`: the scene is rendered once per act into five images and
 *                shown as a cross-fading contact sheet; subtitles are already body copy.
 *   · none     — no WebGL2: the page stays as served. Nothing about its meaning depends on this file.
 *
 * The font family strings are read from the CSS variables `fonts.ts` sets so the canvas rasterises
 * the exact faces the DOM uses.
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { IDS } from "./ui/dom";
import { STILL_FRAMES, type SceneFonts } from "./Scene";

const Scene = dynamic(() => import("./Scene"), { ssr: false });

type Mode = "pending" | "scroll" | "mobile" | "stills" | "none";

function readFonts(): SceneFonts {
  // The font variables live on the landing root (fonts.ts), not on <html>.
  const style = getComputedStyle(document.getElementById(IDS.root) ?? document.documentElement);
  const sans = style.getPropertyValue("--l3d-font-sans").trim() || "Inter Tight, system-ui, sans-serif";
  const mono = style.getPropertyValue("--l3d-font-mono").trim() || "JetBrains Mono, ui-monospace, monospace";
  return { sans, mono };
}

function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export default function Landing3D() {
  const [mode, setMode] = useState<Mode>("pending");
  const [fonts, setFonts] = useState<SceneFonts | null>(null);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 899px)").matches;
    const webgl = hasWebGL2();
    const wantsDebug = new URLSearchParams(window.location.search).has("debug");
    const f = readFonts();
    // Wait for the faces so the atlases never rasterise a fallback.
    const loads = [document.fonts.load(`500 20px ${f.mono}`), document.fonts.load(`600 20px ${f.sans}`)];
    Promise.allSettled(loads).then(() => {
      setDebug(wantsDebug);
      setFonts(f);
      if (!webgl) setMode("none");
      else if (reduced) setMode("stills");
      else setMode(mobile ? "mobile" : "scroll");
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.l3dMode = mode;
  }, [mode]);

  if (mode === "pending" || mode === "none" || !fonts) return null;
  if (mode === "stills") return <Stills fonts={fonts} />;
  return <Scene fonts={fonts} mobile={mode === "mobile"} debug={debug} />;
}

/** Reduced motion: five well-composed frames, cross-fading as they scroll into view. */
function Stills({ fonts }: { fonts: SceneFonts }) {
  const [frames, setFrames] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1600, window.innerWidth * Math.min(2, window.devicePixelRatio));
    canvas.height = Math.round(canvas.width * 9 / 16);
    import("./Scene").then(({ bootScene }) => {
      if (cancelled) return;
      const world = bootScene({ canvas, fonts, mobile: false, debug: false, mode: "stills" });
      const urls = STILL_FRAMES.map((p) => world.still(p));
      world.dispose();
      if (!cancelled) setFrames(urls);
    });
    return () => {
      cancelled = true;
    };
  }, [fonts]);

  useEffect(() => {
    if (!frames) return;
    const figures = document.querySelectorAll<HTMLElement>(`#${IDS.root} .l3d-still`);
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.toggleAttribute("data-in", e.isIntersecting)),
      { threshold: 0.35 },
    );
    figures.forEach((f) => io.observe(f));
    return () => io.disconnect();
  }, [frames]);

  if (!frames) return null;
  const captions = [
    "Act 1. The timeline as a sculptural object: the curl, the overlap, the rim light.",
    "Act 2. Laid flat. Ruler, tracks, playhead, clip names.",
    "Act 3. The chat panel arrives behind the timeline and unpacks into six planes.",
    "Act 4. The conversation: tool calls land on the exact clips they change.",
    "Act 5. The finished, shorter cut.",
  ];
  return (
    <div className="l3d-stills" aria-label="The demo, as stills">
      {frames.map((src, i) => (
        <figure className="l3d-still" key={i}>
          {/* A data URL rendered moments ago by this page; next/image has nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={captions[i]} />
          <figcaption>{captions[i]}</figcaption>
        </figure>
      ))}
    </div>
  );
}
