/**
 * components/landing3d/fonts.ts — the landing's two faces (spec §9): Inter Tight for display and
 * UI, JetBrains Mono for clip name tags, chips, timecodes and HUD counters.
 *
 * Loaded as variable faces through `next/font/google` and exposed as CSS variables on the landing
 * root, so the DOM and the canvas atlases use the same families. The editor keeps its own faces
 * (`app/layout.tsx`); nothing here touches them.
 */
import { Inter_Tight, JetBrains_Mono } from "next/font/google";

export const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--l3d-font-sans",
  display: "swap",
});

export const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--l3d-font-mono",
  display: "swap",
});

export const LANDING_FONT_CLASS = `${interTight.variable} ${jetBrainsMono.variable}`;
