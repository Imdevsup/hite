/**
 * lib/seo/metadata.ts — the site's default `<title>`, description and card copy.
 *
 * WHY THESE STRINGS ARE NOT IN `app/layout.tsx`. They are copy, so §7.4's lint has to be able to
 * read them — and `app/layout.tsx` cannot be imported outside the Next build, because
 * `next/font/google` is an SWC-transformed call that throws `Instrument_Sans is not a function` in a
 * plain module context. Verified by running it. Keeping the copy in an ordinary module means the
 * layout still owns the `Metadata` object (one owner for metadata, unchanged) while the sentences
 * themselves sit somewhere `lib/seo/honesty.test.ts` can scan.
 *
 * They are also the same claims `jsonld.ts` makes in `HITE_DESCRIPTION`, phrased for a different
 * audience, so keeping them adjacent is what stops the two drifting.
 *
 * DESIGN-DIRECTION §3 retires the previous `Vibe editing.` title — §16 lists it as obsolete. A
 * brand-word title requires brand equity the product does not have; a cold visitor referred from
 * TikTok or GitHub learns nothing from it. "Vibe editing" earns its SEO on a category pillar page,
 * not in the one string every search result shows.
 */

export const SITE_TITLE = "HITE — describe the edit, a real timeline cuts it";

/** The meta description. No beat claim, no caption claim, no WYSIWYG guarantee (§7.4). */
export const SITE_DESCRIPTION =
  "HITE is an open-source AI video editor. Describe the change you want in plain language — " +
  "“cut the dead air” — and the model writes edit commands a reducer applies to a real, " +
  "hand-editable timeline. One render engine drives preview and export.";

/** Shorter, for the OpenGraph and Twitter cards, where the description is truncated hard. */
export const SITE_CARD_DESCRIPTION =
  "Type the change you want; a real, hand-editable timeline cuts it. One render engine for preview and export.";

export const SITE_KEYWORDS: readonly string[] = [
  "AI video editor",
  "natural language video editing",
  "text to video edit",
  "open source video editor",
  "AI timeline editor",
  "vibe editing",
  "short-form video editor",
  "TikTok editor",
  "Reels editor",
];
