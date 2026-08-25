import type { Metadata } from "next";
import { HowToPage, type HowToPageData } from "@/components/marketing/HowToPage";

/**
 * DESIGN-DIRECTION §10.3 keeps this page and its subject. Its claims are rewritten because, read
 * from source on 2026-08-19, the previous version taught a workflow the product cannot perform:
 * automatic beat placement (`lib/render/resolver.ts` — beats are not wired), skull overlays
 * (`look-skull-face-drop` fails the renderability gate; the overlay asset does not exist), speed
 * ramps (no speed key exists in the registry) and a watermark/upgrade tier (there is no payment
 * path). What survives is the part that is real, and it is still a genuine phonk workflow: the
 * glitch, colour and transition vocabulary all render.
 */

const TITLE = "How to edit a phonk video (the fast way)";
const DESCRIPTION =
  "How to make a phonk drift edit: RGB split and chromatic aberration on the hit, glitch bars, zoom " +
  "punch, whip pans and a crushed grade — described in plain language on a real, hand-editable " +
  "timeline. A step-by-step guide for TikTok, Reels, and Shorts using HITE.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/how-to/edit-a-phonk-video" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/how-to/edit-a-phonk-video", type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const data: HowToPageData = {
  slug: "edit-a-phonk-video",
  eyebrow: "HOW-TO · PHONK",
  title: "How to edit a phonk video",
  howToDescription:
    "Make a phonk drift edit — RGB split and chromatic aberration on the hit, glitch bars, zoom punch, " +
    "whip pan transitions and a crushed grade — by describing it in plain language on a real timeline.",
  bluf:
    "To edit a phonk video, drop your clip into HITE and describe the treatment you want in plain " +
    "language — for example, “RGB split on the hit, glitch bars here, whip pan into the next clip, " +
    "crush the grade.” HITE writes that as a list of ordinary edit commands and applies them to a " +
    "real, hand-editable timeline. One thing it will not do, stated up front so you do not plan " +
    "around it: HITE does not place cuts on the beats of your track — beat detection exists in the " +
    "codebase but is not wired to the timeline. Cut the beats yourself, or let HITE tighten the " +
    "pacing from the transcript, then describe the treatments on top.",
  steps: [
    {
      name: "Drop in your clip",
      text:
        "Upload the footage you want to edit — gameplay, a drift compilation, a character AMV, or your " +
        "own video. Any length works, from a phone screen-recording to 4K. HITE puts it on a real timeline.",
    },
    {
      name: "Get the pacing tight first",
      text:
        "Say “cut the dead air” or “remove the ums.” HITE reads the transcript, finds the silences and " +
        "filler words in what was actually said, and ripple-deletes them, so the timeline shortens " +
        "instead of leaving holes. If your edit is driven by a track rather than by speech, place the " +
        "hard cuts yourself on the timeline — this is the step HITE cannot do for you yet.",
    },
    {
      name: "Describe the phonk treatments",
      text:
        "Name what you want and where: “RGB split on the hit,” “glitch bars over this clip,” “punch in " +
        "on the reaction,” “add a whip pan here,” “push the grade cold.” HITE maps those onto its " +
        "effects catalogue — chromatic aberration and drift, glitch bars, zoom punch, RGB-split and " +
        "flash cuts, burn-to-black, film-emulation LUTs including VHS and Kodachrome, and vignettes.",
    },
    {
      name: "Tune it by word or by hand",
      text:
        "Want a harder glitch or a different cut point? Describe the change, or grab the timeline and " +
        "adjust the clip, effect, or transition yourself. Every AI change is a discrete, labelled " +
        "operation and undoing one is a single keystroke.",
    },
    {
      name: "Export for TikTok, Reels, or Shorts",
      text:
        "Pick your aspect ratio — 9:16 for TikTok, Reels, and Shorts, 16:9, or 1:1 — and export an MP4. " +
        "The export compiles the same edit decision list through the same Remotion composition the " +
        "preview uses, so there is no second renderer for the file to disagree with.",
    },
  ],
  // §7.2: every example prompt on the property comes from the allowlist in lib/landing/prompts.ts,
  // which is machine-checked against the real planner and reducer. Do not add one that is not there.
  prompts: [
    "cut the dead air",
    "punch in on the reaction",
    "add a whip pan here",
    "give it the A24 look",
  ],
  sections: [
    {
      heading: "What makes an edit feel “phonk”",
      body: [
        "Phonk edits live and die on timing and texture. The signatures are hard cuts, hits on the drop " +
          "(RGB split, chromatic aberration, glitch bars, zoom punch), whip pans between clips, and a " +
          "crushed, high-contrast grade — often pushed cold or red. The energy comes from everything " +
          "landing where the music does.",
        "HITE owns the texture half of that outright: every treatment named above is a key its renderer " +
          "actually paints, and you place them by describing them rather than by keyframing them. The " +
          "timing half is still yours — see the next section, because it is the honest limit of this guide.",
      ],
    },
    {
      heading: "The honest limit: HITE does not cut to the beat",
      body: [
        "Beat detection exists in HITE's codebase, but it is not connected to the timeline: the resolver " +
          "says so in its own header and the beat planner returns no cuts. Asking HITE to cut to the beat " +
          "would produce a run that quietly changed nothing, which is worse than a tool that says no. So " +
          "it says no, here and everywhere else on this site.",
        "That leaves a workflow that still saves most of the labour: cut your beat points by hand — the " +
          "part that takes taste — and let HITE place the treatments across them from a sentence. When " +
          "beats are wired, this guide and the site's example prompts change together, because both read " +
          "from one machine-checked list.",
      ],
    },
  ],
  faq: [
    {
      q: "How do I make a phonk edit without editing experience?",
      a: "Drop your clip into HITE and describe the treatment you want in plain language — for example, “RGB split on the hit, glitch bars here, whip pan into the next clip, crush the grade.” HITE writes that as ordinary edit commands and applies them to a real timeline. You don't need to know keyframes or timeline terms, and you can refine anything by describing the next change or by editing the timeline directly. The cut points themselves are still yours to place if your edit is driven by the music.",
    },
    {
      q: "Can HITE sync the cuts and effects to the beat automatically?",
      a: "No. Beat detection exists in HITE's codebase but is not wired to the timeline, so HITE will not place cuts, glitches or effects on the kicks, bass or drop of your track. What it does automatically is transcript-driven: it finds dead air and filler words in the speech on your clip and cuts those. For a music-driven edit, place the cut points yourself and describe the treatments you want on top of them.",
    },
    {
      q: "Does HITE have skull overlays and phonk grades?",
      a: "Grades yes, skull overlays no. The colour and LUT vocabulary is real and renders: crushed contrast, lifted blacks, saturation, harsh and soft vignettes, film grain, and film emulations including VHS worn and fresh, Kodachrome and CineStill. The skull look is declared in the effects registry but has no overlay asset behind it, so the catalogue lists it as planned rather than offering it — applying it would leave your video unchanged.",
    },
    {
      q: "What aspect ratio should I export a phonk edit in?",
      a: "For TikTok, Instagram Reels, and YouTube Shorts, export 9:16 (vertical). HITE also exports 16:9 (landscape) and 1:1 (square). You pick the ratio in the export panel and download an MP4. HITE is free to start and there is no paid tier today.",
    },
  ],
  ctaLead: "Describe the treatment. A real timeline places it.",
  related: [
    { href: "/how-to/sync-video-cuts-to-the-beat", label: "Cutting to the beat: what ships today" },
    { href: "/compare/best-ai-video-editor-phonk", label: "Best AI video editor for phonk" },
    { href: "/how-to/edit-videos-by-typing", label: "How to edit videos by typing" },
    { href: "/compare/best-ai-video-editor-tiktok", label: "Best AI video editor for TikTok" },
  ],
};

export default function Page() {
  return <HowToPage data={data} />;
}
