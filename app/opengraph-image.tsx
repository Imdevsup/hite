import { ImageResponse } from "next/og";

export const alt = "HITE — describe the edit, a real timeline cuts it";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * File-based OpenGraph + Twitter image for `/` (re-exported by `app/twitter-image.tsx`).
 *
 * DESIGN-DIRECTION §3 retires the previous card's `Vibe editing.` headline — §16 lists it as
 * obsolete — and §7.4 puts the OG image copy inside the banned-phrase lint. This card carries the
 * real H1 and nothing that is not true: no metric, no rating, no price, no time claim.
 *
 * §0's verified tokens are hard-coded here because satori resolves no CSS custom properties: canvas
 * `#06080d`, cyan `#5fe6ff`, ink `#eaf2ff` at the §1.1 rule 4 ceiling of 0.96 alpha (pure white on
 * near-black is the tell of a cheap dark theme). Keep these in step with `app/globals.css`.
 *
 * The frame-square after the wordmark is the playhead motif §16 keeps — the same 6px cyan square the
 * nav's wordmark renders, scaled to this canvas.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#06080d",
          color: "rgba(234,242,255,0.96)",
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark + the playhead square. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40 }}>
          <div style={{ fontSize: 26, letterSpacing: "0.18em", fontWeight: 600 }}>HITE</div>
          <div style={{ width: 10, height: 10, background: "#5fe6ff" }} />
        </div>

        <div style={{ fontSize: 84, fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 1.04, maxWidth: 940 }}>
          Describe the edit. A real timeline cuts it.
        </div>

        <div
          style={{
            fontSize: 32,
            color: "rgba(234,242,255,0.74)",
            marginTop: 32,
            maxWidth: 860,
            lineHeight: 1.35,
          }}
        >
          Type the change you want — &ldquo;cut the dead air&rdquo; — and HITE writes it onto a real
          timeline you can still open and move.
        </div>

        {/* The frame ruler (§2.1): one tick every six frames, a longer mark every second. Decoration
            drawn from the page's own unit, not a stock flourish. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginTop: 56, height: 18 }}>
          {Array.from({ length: 60 }, (_, i) => (
            <div
              key={i}
              style={{
                width: 2,
                height: i % 5 === 0 ? 18 : 8,
                background: i % 5 === 0 ? "rgba(234,242,255,0.24)" : "rgba(234,242,255,0.10)",
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
