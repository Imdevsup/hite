import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans, Martian_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/seo/jsonld";
import {
  SITE_CARD_DESCRIPTION,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_TITLE,
} from "@/lib/seo/metadata";

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   TYPE — DESIGN-DIRECTION §4.3 / §13.2.

   Two families carry the property. Instrument Sans is display + UI + body; Martian Mono is the
   BRAND face — timecodes, command chips, ruler numerals, eyebrows, code.

   BOTH ARE LOADED AS VARIABLE FONTS WITH THE `wdth` AXIS, AND THAT IS THE WHOLE POINT. `app/
   globals.css` writes `font-variation-settings: "wght" 400, "wdth" 88` on `.t-display`, `"wdth" 92`
   on `.t-h3`, `"wdth" 87.5` on `.t-label`, `"wdth" 112.5` on `.t-timecode` and `"wdth" 75` on
   `.t-code`; §1.1 rule 1 makes `wght 400 / wdth 88` at 68px the single largest "this was designed"
   signal on the page. Until 2026-08-19 this file bound `--font-sans`/`--font-display` to Archivo and
   `--font-mono` to JetBrains Mono and requested STATIC weights — neither family exposes a `wdth`
   axis at all, so every one of those declarations was inert and three separate section units filed
   it. Omitting `weight` is what makes `next/font/google` fetch the variable face (the `wght` axis
   arrives as a range automatically); `axes: ["wdth"]` adds the second axis.

   `--font-serif` (Fraunces) SURVIVES UNCHANGED. It is not part of §4.3's two families, but the
   editor consumes it through `.empty-state`, `.empty-state-sm` and `.italic-serif` across ~15 live
   components, and §4/§16's integration rule is that every live token NAME survives a regrade.

   Latin subset only, `display: swap`, woff2 — §9.7. Next's auto-generated metric-matched fallback
   does the CLS elimination for free.

   ⚠ UNRESOLVED GATE (§13.2): "Martian Mono at `wdth 75` for the 40-line JSON `<pre>`. If it fails,
   `.t-code` falls back to JetBrains Mono." That judgement needs a rendered screenshot at DPR 1 and
   2 and has NOT been made. Martian Mono is a wide face and `.t-code` is the densest text on the
   property. If the gate fails, the fix is a separate `--font-code` token bound to JetBrains Mono —
   NOT re-pointing `--font-mono`, which the whole brand voice runs through.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

const instrumentSansDisplay = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["wdth"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  axes: ["wdth"],
  display: "swap",
});

const martianMono = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  axes: ["wdth"],
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   METADATA

   The strings live in `lib/seo/metadata.ts` so §7.4's lint can read them — this module cannot be
   imported outside the Next build (`next/font/google` is an SWC-transformed call), and copy that no
   test can see is copy that drifts. This file still owns the `Metadata` object itself.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

// Single source of truth for metadata (page.tsx must NOT re-export `metadata`). The file-based
// app/opengraph-image.tsx supplies the OG + Twitter image automatically.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s · HITE" },
  description: SITE_DESCRIPTION,
  applicationName: "HITE",
  keywords: [...SITE_KEYWORDS],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "HITE",
    url: "/",
    title: SITE_TITLE,
    description: SITE_CARD_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_CARD_DESCRIPTION,
  },
  icons: {
    icon: [{ url: "/kite.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  // §0: the live canvas is #06080d. The browser chrome should match the page it frames, not the
  // #0A0A0A of a theme that no longer exists.
  themeColor: "#06080d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${instrumentSansDisplay.variable} ${instrumentSans.variable} ${martianMono.variable} ${fraunces.variable}`}
    >
      <body>
        {children}
      </body>
    </html>
  );
}
