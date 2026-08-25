/**
 * lib/remotion/fonts.ts — central font module (docs/CANONICAL-IR-SPEC.md §11 parity rule).
 *
 * Hardcoded font families (as-built CaptionOverlay.tsx:18 `"JetBrains Mono, monospace"` with no
 * loader) are the single most likely real-world preview≠export break: it resolves in dev Chrome
 * but substitutes a different glyph metric in headless Chromium, shifting wrapping.
 *
 * v1 exposes one family constant routed through every text node. TODO (P4.1): load via
 * `@remotion/fonts` `loadFont().waitUntilDone()` with a content-hashed subset and feed the font
 * hash into the segment cache key (lib/render/hash.ts segmentKey.assetContentHashes).
 */
export const CAPTION_FONT_FAMILY = "JetBrains Mono, ui-monospace, SFMono-Regular, monospace";

/** Brand accent (teal) — kept in sync with the editor's --color-accent so captions read on-brand. */
const ACCENT = "#C6F24E";

/**
 * Resolve a caption style id to concrete CSS. Single source of truth for caption typography, and
 * the WYSIWYG contract for the TextWindow style picker: every style id the UI can emit MUST render
 * distinctly here, or the picker is theater (a user picks "Typewriter" and gets the default look).
 *
 * The recognised ids are: "default", "karaoke", plus the `text` registry keys the TextWindow lists
 * (text-typewriter / text-lower-third-basic / text-hashtag-sticker). An unknown id falls back to
 * `default` so an AI-emitted or legacy style never crashes the render — it just renders plainly.
 */
export function captionStyle(style: string): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: CAPTION_FONT_FAMILY,
    fontWeight: 700,
    color: "#F2EFE9",
    background: "rgba(10,10,10,0.78)",
    padding: "8px 18px",
    lineHeight: 1.1,
    letterSpacing: "0.02em",
    textAlign: "center",
    maxWidth: "80%",
    fontSize: 42,
  };
  switch (style) {
    case "karaoke":
      // Lyric / AMV style: no plate, oversized, toxic-yellow with a punchy stroke for legibility.
      return { ...base, background: "transparent", color: "#FFE600", fontSize: 56, WebkitTextStroke: "2px rgba(0,0,0,0.85)", letterSpacing: "0.01em" };
    case "text-typewriter":
      // Terminal/code aesthetic: tight tracking, teal mono on a near-black plate, slightly smaller.
      return { ...base, color: ACCENT, background: "rgba(6,8,6,0.82)", fontSize: 38, letterSpacing: "0.06em", padding: "7px 14px" };
    case "text-lower-third-basic":
      // Lower third: left-aligned with a left accent rule, no full plate — sits like a subtitle bar.
      return {
        ...base,
        textAlign: "left",
        fontSize: 36,
        fontWeight: 600,
        background: "rgba(10,10,10,0.62)",
        borderLeft: `4px solid ${ACCENT}`,
        padding: "8px 16px",
        maxWidth: "70%",
      };
    case "text-hashtag-sticker":
      // Social sticker: filled accent pill, uppercase, dark ink — reads as a tappable tag.
      return {
        ...base,
        color: "#0A0A0A",
        background: ACCENT,
        fontSize: 34,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "7px 20px",
        borderRadius: 999,
      };
    default:
      return base;
  }
}

/**
 * Where a caption style sits on screen. The OTHER half of the WYSIWYG contract: `captionStyle` makes
 * each style LOOK distinct, but until now `CaptionView` hard-anchored every caption bottom-center, so
 * the picker's "Lower Third" (a left bar) and "Hashtag Sticker" (a corner tag) floated in the same
 * centered bottom box as the default — positioning theater, and overlapping when more than one caption
 * is live. This returns the flex anchor + safe-area inset per style so the placement matches the look:
 *   • default / typewriter → bottom-center subtitle band
 *   • lower-third          → bottom-LEFT (the bar hugs the left safe area, matching its left accent rule)
 *   • hashtag-sticker      → top-RIGHT corner (reads as a tappable social sticker, clear of subtitles)
 *   • karaoke              → centered, lifted toward the middle (lyric/AMV convention, off the lower edge)
 * An unknown id falls back to the default band (parity with captionStyle's fallback).
 *
 * `inset` is a single CSS padding shorthand applied to the AbsoluteFill, so the caption stays inside a
 * resolution-independent safe area on any aspect (9:16/1:1/16:9).
 */
export interface CaptionAnchor {
  justifyContent: "flex-start" | "center" | "flex-end";
  alignItems: "flex-start" | "center" | "flex-end";
  inset: string;
}

export function captionAnchor(style: string): CaptionAnchor {
  switch (style) {
    case "text-lower-third-basic":
      return { justifyContent: "flex-end", alignItems: "flex-start", inset: "0 0 9% 6%" };
    case "text-hashtag-sticker":
      return { justifyContent: "flex-start", alignItems: "flex-end", inset: "7% 6% 0 0" };
    case "karaoke":
      return { justifyContent: "center", alignItems: "center", inset: "0 0 6% 0" };
    default:
      // default + text-typewriter: classic bottom-center subtitle band.
      return { justifyContent: "flex-end", alignItems: "center", inset: "0 0 8% 0" };
  }
}

/**
 * Per-WORD state styling for read-along captions. The IR carries per-word timings (CaptionNode.words,
 * from the transcript) and CaptionView paints them: already-spoken words stay lit, the word being
 * spoken is highlighted, upcoming words sit dim. Without this, "karaoke" was only a font choice —
 * the word timings were compiled and then thrown away.
 *
 * Kept here with the rest of caption typography (single owner) and deliberately colour-only:
 * changing size or weight per word would reflow the line every few frames.
 */
export function captionWordStyle(style: string, state: "spoken" | "active" | "upcoming"): React.CSSProperties {
  if (state === "upcoming") return { opacity: 0.45 };
  if (state === "spoken") return { opacity: 1 };
  // The active word: karaoke already uses the toxic yellow, so accent it with white for contrast;
  // every other style highlights with the brand accent.
  return { opacity: 1, color: style === "karaoke" ? "#FFFFFF" : ACCENT };
}

/** Placeholder until @remotion/fonts is wired; awaited in delayRender() at the composition root. */
export async function ensureFontsLoaded(): Promise<void> {
  /* TODO P4.1: @remotion/fonts loadFont().waitUntilDone() */
}
