import type { Metadata } from "next";
import { ComparePage, type ComparePageData } from "@/components/marketing/ComparePage";

/**
 * DESIGN-DIRECTION §7.4 / §7.2. Read from source on 2026-08-19, the previous version of this page
 * advertised automatic beat-synced cuts (beats are NOT wired — `lib/render/resolver.ts`;
 * `planBeatCuts` returns `{ bpm: 0, cutTicks: [] }`), speed ramps (no speed key exists in the
 * registry), styled caption overlays (no `text-*` key has an effect renderer), a preview that
 * matches the export "to the pixel" (a banned phrase — the LUT and colour entries are CSS-filter
 * approximations), and a watermark/upgrade tier for a product with no payment path. All four are
 * corrected below; the page keeps its URL, its subject and its structure (§10.1).
 */

const TITLE = "The best AI video editor for TikTok, Reels & Shorts";
const DESCRIPTION =
  "Looking for the best AI video editor for TikTok? HITE turns a plain-language description into a " +
  "real, hand-editable timeline, cuts dead air and filler words from the transcript, exports natively " +
  "in 9:16, and drives preview and export from one render engine. What to look for, and how HITE compares.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/compare/best-ai-video-editor-tiktok" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/compare/best-ai-video-editor-tiktok", type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const data: ComparePageData = {
  slug: "best-ai-video-editor-tiktok",
  eyebrow: "BEST AI VIDEO EDITOR · TIKTOK",
  title: "The best AI video editor for TikTok",
  otherLabel: "typical AI editors",
  bluf:
    "For TikTok, Reels, and Shorts, the best AI video editor is one that (1) takes a plain-language " +
    "description and builds it on a real, editable timeline, (2) tightens the pacing for you instead " +
    "of leaving you to scrub for dead air, (3) exports natively in 9:16, and (4) previews from the " +
    "same engine it exports from. HITE is built around all four: you describe the change, it writes " +
    "the edit commands, and the timeline stays yours. Many AI editors auto-clip into a black box; " +
    "HITE gives you the timeline and the words. It does not cut to the beat — see the table.",
  rows: [
    {
      feature: "How you edit",
      hite: "Describe the edit in plain language; a real timeline executes it and stays editable by hand.",
      other: "Often one-shot auto-clipping or template fitting, with limited control after generation.",
    },
    {
      feature: "Vertical (9:16) export",
      hite: "Native 9:16 export for TikTok, Reels, and Shorts (also 16:9 and 1:1).",
      other: "Usually supported, sometimes via cropping a landscape edit.",
    },
    {
      feature: "Tightening the pacing",
      hite: "Transcript-driven: HITE finds dead air and filler words in what was actually said and ripple-deletes them, so the timeline shortens instead of leaving holes.",
      other: "Varies; frequently a manual scrub-and-trim pass.",
    },
    {
      feature: "Cuts on the beat",
      hite: "Not today. Beat detection is in the codebase but is not wired to the timeline.",
      other: "Varies; frequently manual or absent in pure auto-editors.",
    },
    {
      feature: "Editability after AI",
      hite: "Full timeline access; every AI change is a discrete operation you can undo with one keystroke.",
      other: "Re-prompt or regenerate; fine-grained manual control is often limited.",
    },
    {
      feature: "Preview vs export",
      hite: "One render engine for both — the same composition compiles the preview and the file.",
      other: "Depends on the tool; mismatches can appear after export.",
    },
    {
      feature: "Effects that actually render",
      hite: "Every effect on the catalogue is checked against the renderer before it is listed; the ones with nothing behind them are shown separately as planned.",
      other: "Rarely stated; a listed effect is usually assumed to work.",
    },
    {
      feature: "Pricing",
      hite: "Free to start, no credit card. There is no paid tier today.",
      other: "Mix of free tiers, credits, and subscriptions.",
    },
  ],
  sections: [
    {
      heading: "What actually makes an AI editor good for TikTok",
      body: [
        "Short-form is unforgiving: the first second decides retention, dead air kills a hook, and the format is vertical. The best AI editor for TikTok isn't the one that does the most automatically — it's the one that gets you to a postable 9:16 edit without taking the creative decisions away from you.",
        "That means four things: natural-language control so you're not hunting menus, a pass that tightens the pacing for you, native vertical export, and a preview you can trust. If any of those is missing, you pay for it in re-dos.",
      ],
    },
    {
      heading: "Where HITE fits",
      body: [
        "HITE is an AI-native editor for exactly this audience. You describe the change — \"cut the dead air, remove the ums, punch in on the reaction, whip pan into the next clip\" — and it writes those as ordinary edit commands and applies them to a real edit decision list. Then it hands you that timeline: drag a clip edge, retime a treatment, restyle an effect, or just describe the next change.",
        "Because one render engine drives both preview and export, there is no second renderer for the exported file to disagree with. You are not exporting twice to find out what changed.",
      ],
    },
    {
      heading: "Auto-clippers vs real-timeline AI",
      body: [
        "Many \"AI video editors\" are auto-clippers: feed a long video, get short cuts back. That's great for repurposing podcasts and webinars. It's the wrong tool for an original edit-culture piece, where the whole point is where the cut and the treatment land.",
        "HITE is in the second category: AI that produces a real, editable timeline you direct in words. If your goal is a crafted phonk, drift or AMV edit rather than chopping a long video into clips, that distinction is the one that matters.",
      ],
    },
  ],
  faq: [
    {
      q: "What is the best AI video editor for TikTok?",
      a: "The best AI video editor for TikTok is one that builds your edit on a real, editable timeline from a plain-language description, tightens the pacing for you, exports natively in 9:16, and previews from the same engine it exports from. HITE is built around all four: the model emits a typed list of edit commands, a pure reducer applies them to a real edit decision list, and one Remotion composition renders both the preview and the file. Tools that only auto-clip long videos are better for repurposing than for original short-form edits.",
    },
    {
      q: "Can an AI editor make beat-synced edits for TikTok automatically?",
      a: "Some can. HITE cannot today — beat detection exists in its codebase but is not wired to the timeline, so it will not place cuts on the kicks of your track, and nothing on this site offers to. What HITE does automatically is transcript-driven: it finds dead air and filler words in the speech on your clip and ripple-deletes them, and it places any treatment you describe at the point you describe it.",
    },
    {
      q: "Does HITE export vertical 9:16 video for TikTok and Reels?",
      a: "Yes. HITE exports MP4 natively in 9:16 (vertical) for TikTok, Reels, and Shorts, as well as 16:9 (landscape) and 1:1 (square). You choose the aspect ratio in the export panel.",
    },
    {
      q: "Is HITE free to use for TikTok edits?",
      a: "Yes. HITE is free to start and no credit card is required. There is no checkout in the product and no paid tier to describe. HITE is an early public build and is not finished; the effects catalogue on the home page lists exactly what renders today and shows the rest separately as planned.",
    },
  ],
  ctaLead: "Make a TikTok-ready edit from a sentence.",
};

export default function Page() {
  return <ComparePage data={data} />;
}
