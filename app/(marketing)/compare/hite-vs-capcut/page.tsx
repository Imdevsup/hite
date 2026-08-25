import type { Metadata } from "next";
import { ComparePage, type ComparePageData } from "@/components/marketing/ComparePage";

const TITLE = "HITE vs CapCut: the AI-native video editor comparison";
const DESCRIPTION =
  "HITE vs CapCut for short-form editing. HITE turns a plain-language description into a real, " +
  "editable timeline, and uses one render engine for both preview and export. An honest, " +
  "feature-by-feature comparison for TikTok, Reels, and Shorts creators.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/compare/hite-vs-capcut" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/compare/hite-vs-capcut", type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const data: ComparePageData = {
  slug: "hite-vs-capcut",
  eyebrow: "HITE VS CAPCUT",
  title: "HITE vs CapCut",
  otherLabel: "CapCut",
  bluf:
    "Choose HITE if you want to describe an edit in plain language and have a real, editable timeline " +
    "build it, on one render engine that drives both the preview and the export. Choose CapCut if you " +
    "want a mature, manual mobile/desktop editor with a large template library and you're comfortable " +
    "doing the cutting yourself. HITE leads with natural-language editing on a real timeline; CapCut " +
    "leads with a deep manual toolset and templates.",
  rows: [
    {
      feature: "Core editing model",
      hite: "Describe the edit in words; a real timeline executes it. The full timeline is always there to edit by hand.",
      other: "Manual timeline editing, plus templates and some AI-assist tools you apply yourself.",
    },
    {
      feature: "Preview vs export fidelity",
      hite: "One render engine drives both preview and export — there is no second, faster preview renderer to disagree with the file.",
      other: "Preview and export are generally consistent within the app; fidelity depends on the export settings you choose.",
    },
    {
      feature: "Cutting to the music",
      hite: "Not yet. Beat detection is in the codebase but is not wired to the timeline, so HITE will not place cuts on the beats of your track today.",
      other: "Beat markers and manual placement are available; syncing is largely a manual or template-driven step.",
    },
    {
      feature: "Edit-culture looks",
      hite: "Film-emulation LUTs, colour grades, glitch treatments and composed looks applied by name, or stacked yourself.",
      other: "Achievable via effects, filters, and community templates assembled manually.",
    },
    {
      feature: "Reviewing AI changes",
      hite: "Every AI edit is a discrete, described operation you can undo with one keystroke.",
      other: "Manual edits use standard undo; template results are applied as a whole.",
    },
    {
      feature: "Platform",
      hite: "Browser-based; nothing to install. Currently an early public build.",
      other: "Mature mobile and desktop apps with a large existing user base.",
    },
    {
      feature: "Export aspect ratios",
      hite: "MP4 in 16:9, 9:16, and 1:1.",
      other: "Wide range of export resolutions and aspect ratios.",
    },
    {
      feature: "Pricing",
      hite: "Free to start, no credit card. There is no paid tier today.",
      other: "Free tier with a paid Pro subscription for advanced features and assets.",
    },
  ],
  sections: [
    {
      heading: "The core difference: describe vs do",
      body: [
        "CapCut is a manual editor with AI features bolted on — you open a timeline and do the cutting, then reach for templates or assist tools when they help. HITE inverts that: you describe the edit you want (\"phonk drift edit, skull on the drop, cuts on the beat\") and a real timeline executes it, then hands you that timeline to refine. The result is the same kind of artifact — a real, editable timeline — but the starting point is a sentence, not an empty track.",
        "If you already think in keyframes and enjoy manual control, CapCut's depth is a genuine strength. If you'd rather move at the speed of your ideas and only get hands-on when you want to, HITE is built for that.",
      ],
    },
    {
      heading: "Why \"preview equals export\" matters",
      body: [
        "A recurring frustration in browser-based editors is that the preview is rendered by one engine and the final export by another, so the file you download can differ from what you approved — shifted timing, changed color, or glitches that only appear after export. HITE uses a single render engine for both preview and export, so the frame you sign off on is the frame you ship.",
        "This is the property HITE is built around, and it's the clearest reason to pick it over a tool where you re-check the output after every export.",
      ],
    },
    {
      heading: "Who should pick which",
      body: [
        "Pick HITE if you're a short-form, edit-culture creator who wants speed, natural-language control, and a preview that comes from the same engine as the export, and you value seeing every AI change as something you can undo. Pick CapCut if you want a battle-tested manual editor with the widest template and asset library and you're happy to drive the edit yourself.",
        "They're not mutually exclusive — many creators prototype fast in one and finish in another. HITE's bet is that describing the edit, on a real timeline, with one render engine behind both the preview and the export, is the faster path for the kind of edits this audience makes.",
      ],
    },
  ],
  faq: [
    {
      q: "Is HITE a CapCut alternative?",
      a: "Yes — HITE is an AI-native alternative for short-form creators. Instead of editing a timeline manually, you describe the edit in plain language and a real, editable timeline executes it. HITE's distinguishing feature is that one render engine powers both preview and export, so there is no separate export renderer for the file to disagree with. CapCut remains a strong choice if you prefer a mature manual editor with a large template library.",
    },
    {
      q: "Can HITE cut to the music like a CapCut template?",
      a: "Not today, and it is worth being direct about that. Beat detection exists in the codebase but is not wired to the timeline, so HITE will not place cuts on the kicks of your track. What it does do instead is transcript-driven: it finds dead air and filler words in what was actually said and cuts those, and it places the effects and transitions you describe at the points you describe them. Every one of those lands as an ordinary timeline operation you can move by hand.",
    },
    {
      q: "Does HITE run on mobile?",
      a: "HITE is browser-based, so it runs wherever you have a modern browser, with nothing to install. CapCut offers dedicated mobile and desktop apps. HITE is an early public build and is not finished.",
    },
    {
      q: "Is HITE free?",
      a: "HITE is free to start and no credit card is required. There is no checkout in the product and no paid tier to describe; if that changes, this page changes with it.",
    },
  ],
  ctaLead: "Describe your edit. Watch a real timeline build it.",
};

export default function Page() {
  return <ComparePage data={data} />;
}
