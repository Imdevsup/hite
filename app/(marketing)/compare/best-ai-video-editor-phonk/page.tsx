import type { Metadata } from "next";
import { ComparePage, type ComparePageData } from "@/components/marketing/ComparePage";

/**
 * DESIGN-DIRECTION §10.3 keeps this page and its subject: phonk is a content vertical with real
 * search demand and the product genuinely does edit-culture treatments. What was wrong was the
 * claims. Read from source on 2026-08-19, the previous version of this page advertised three
 * capabilities that do not exist: automatic beat placement (`lib/render/resolver.ts` says beats are
 * not wired; `planBeatCuts` returns `{ bpm: 0, cutTicks: [] }`), skull overlays (`look-skull-face-drop`
 * fails the renderability gate — the overlay asset does not exist and the face tracking was cut),
 * and speed ramps (there is no speed key in the registry at all). Everything that survives below is
 * a key the renderer actually paints.
 */

const TITLE = "The best AI video editor for phonk & edit-culture videos";
const DESCRIPTION =
  "Making phonk, drift, or AMV edits? HITE is an AI-native editor built for edit-culture: describe " +
  "the treatment — RGB split, chromatic aberration, glitch bars, zoom punch, whip pan, a crushed " +
  "grade — and a real, hand-editable timeline places it. One render engine drives preview and export.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/compare/best-ai-video-editor-phonk" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/compare/best-ai-video-editor-phonk", type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const data: ComparePageData = {
  slug: "best-ai-video-editor-phonk",
  eyebrow: "BEST AI EDITOR · PHONK & EDIT-CULTURE",
  title: "The best AI video editor for phonk edits",
  otherLabel: "general editors",
  bluf:
    "For phonk, drift and AMV edits, the best AI editor is one that already speaks the vocabulary — " +
    "RGB split, chromatic aberration, glitch bars, zoom punch, whip pan, hard flash cuts, VHS and " +
    "crushed grades — and lets you call each one by name instead of keyframing it. HITE does that: " +
    "you describe the treatment and a real, hand-editable timeline places it, with one render engine " +
    "behind both the preview and the export. Two honest gaps before you commit: HITE does not place " +
    "cuts on the beats of your track, and it has no skull-overlay asset. Both are covered below.",
  rows: [
    {
      feature: "Edit-culture treatments",
      hite: "RGB split, chromatic aberration and drift, glitch bars, zoom punch, film-emulation LUTs (VHS worn and fresh, Kodachrome, CineStill) and crushed grades — applied by name, or stacked yourself.",
      other: "Possible by manually combining filters, effects, and assets.",
    },
    {
      feature: "Cuts on the beat",
      hite: "Not today. Beat detection is in the codebase but is not wired to the timeline, so HITE will not place cuts on the kicks of your track.",
      other: "Manual beat markers and keyframing; syncing is hand work.",
    },
    {
      feature: "Skull masks & overlays",
      hite: "Not today. The skull look is declared in the registry but has no overlay asset behind it, so it is listed as planned rather than offered.",
      other: "Requires sourcing assets and compositing them yourself.",
    },
    {
      feature: "Hard cuts and transitions",
      hite: "Whip pan, glitch cut, RGB-split cut, flash cut and burn-to-black or white, placed where you describe them.",
      other: "Available, placed and timed by hand.",
    },
    {
      feature: "Control",
      hite: "Full real timeline; every AI change is a discrete, undoable operation.",
      other: "Full manual control — which is also all the work.",
    },
    {
      feature: "Preview vs export",
      hite: "One render engine for both. The grade and glitch you preview and the ones that export come from the same composition.",
      other: "Varies; color and effect rendering can shift on export.",
    },
    {
      feature: "Output",
      hite: "MP4 in 9:16, 16:9, and 1:1, sized for TikTok, Reels, and Shorts.",
      other: "Broad export options.",
    },
    {
      feature: "Pricing",
      hite: "Free to start, no credit card. There is no paid tier today.",
      other: "Varies by tool.",
    },
  ],
  sections: [
    {
      heading: "Phonk editing is a specific craft",
      body: [
        "Phonk and the wider edit-culture family — drift, velocity, AMV — aren't generic \"effects.\" They're a vocabulary: RGB split and chromatic aberration on the hit, glitch bars tearing across a frame, a zoom punch into a reaction, a whip pan between clips, a VHS or crushed-red grade over the whole thing. Getting it right is mostly placement, and placement is mostly tedious manual work in a general editor.",
        "An AI editor earns the label \"best for phonk\" if it knows that vocabulary and can place it from a sentence. Otherwise you're back to keyframing every treatment by hand.",
      ],
    },
    {
      heading: "How HITE is built for this",
      body: [
        "You describe the treatment — \"RGB split on the hit, glitch bars here, whip pan into the next clip, push the grade cold\" — and HITE writes it as a list of ordinary timeline commands and applies them to a real edit decision list. Then it gives you that timeline to push and pull: move a treatment, swap a look, dial an effect, or describe the next change.",
        "Because one render engine drives preview and export, the grade and the glitch come from the same composition either way. For an aesthetic where the timing and the colour ARE the edit, that matters more than it sounds.",
      ],
    },
    {
      heading: "The two gaps, stated plainly",
      body: [
        "HITE does not cut to the beat. Beat detection exists in the repository but is not connected to the timeline, so asking for it would produce an edit that quietly did nothing — which is worse than a tool that says no. What HITE does read is the transcript: it finds dead air and filler words in what was actually said, and cuts those. If your edit is driven by a track rather than by speech, place the hard cuts yourself and let HITE do the treatments.",
        "There is no skull overlay. The look is declared in the effects registry, but the asset behind it does not ship, so the catalogue lists it as planned instead of offering it. Nothing on this site will apply an effect that leaves your video unchanged.",
      ],
    },
    {
      heading: "When a general editor still wins",
      body: [
        "If you want frame-by-frame manual control over a one-off motion-graphics piece, or you've already built a personal preset library you love, a general editor's depth is hard to beat. HITE's advantage is fluency in the edit-culture idiom: it gets you from a sentence to a real, hand-editable timeline carrying the treatments you named.",
      ],
    },
  ],
  faq: [
    {
      q: "What is the best AI video editor for phonk edits?",
      a: "The best AI video editor for phonk is one that natively understands edit-culture treatments — RGB split, chromatic aberration, glitch bars, zoom punch, whip pans, VHS and crushed grades — and can place them from a plain-language description onto a timeline you can still edit by hand. HITE is built for that: you describe the treatment and a real edit decision list executes it, with one render engine behind both the preview and the export. General editors can produce the same looks but require manual assembly and keyframing.",
    },
    {
      q: "Can HITE put a skull mask on the drop automatically?",
      a: "No. The skull look is declared in HITE's effects registry but there is no overlay asset behind it, so it is listed as planned rather than offered — applying it would leave your video unchanged. The glitch vocabulary around it is real: RGB split, chromatic aberration and drift, glitch bars, zoom punch and flash cuts all render, and you can place them by describing where they go.",
    },
    {
      q: "Does HITE sync cuts to the music?",
      a: "Not today. Beat detection exists in the codebase but is not wired to the timeline, so HITE will not place cuts on the kicks, bass or drop of your track. What is wired is transcript-driven: HITE finds dead air and filler words in the speech on your clip and cuts those, and it places any treatment you describe at the point you describe it. If beats are the spine of your edit, cut them yourself and use HITE for the treatments.",
    },
    {
      q: "Is HITE free for making phonk and AMV edits?",
      a: "Yes. HITE is free to start and no credit card is required. There is no checkout in the product and no paid tier to describe. HITE is an early public build and is not finished — the effects catalogue on the home page lists exactly what renders today and shows the rest separately as planned.",
    },
  ],
  ctaLead: "Describe the treatment. A real timeline places it.",
};

export default function Page() {
  return <ComparePage data={data} />;
}
