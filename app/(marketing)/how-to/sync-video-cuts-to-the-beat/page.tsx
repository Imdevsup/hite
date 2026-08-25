import type { Metadata } from "next";
import { HowToPage, type HowToPageData } from "@/components/marketing/HowToPage";

/**
 * DESIGN-DIRECTION §10.4 — the beat-sync page, rewritten rather than deleted or left alone.
 *
 * The direction gives three options and rules only one defensible. Deleting the URL loses an indexed
 * page and its history. Leaving it describes a feature that silently does nothing: `lib/render/
 * resolver.ts` says in its own header that beats are not wired, and `lib/ai/tools/generated/
 * planBeatCuts.ts` returns `{ bpm: 0, cutTicks: [] }` when there is no beats row — so a visitor who
 * followed the old instructions got a planner turn that produced no edit and raised no error, which
 * looks exactly like a product that does not work. So: keep the URL, retitle to the technique, state
 * plainly which parts ship today and which do not, link to the prompts that do work, and DROP IT
 * FROM `app/sitemap.ts` until beats are verified in prod (already done — see that file).
 *
 * When beats land, this page goes back to teaching the automatic path and returns to the sitemap in
 * the same change. Until then it is a genuinely useful manual guide with an honest header.
 */

const TITLE = "How to cut video to the beat (and what HITE does today)";
const DESCRIPTION =
  "How to cut a video to the beat: mark the beats, cut on them, and place the treatments across the " +
  "cuts. Plus an honest account of what HITE automates today — transcript-driven pacing and " +
  "described effects — and what it does not: beat detection is not wired to the timeline.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/how-to/sync-video-cuts-to-the-beat" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/how-to/sync-video-cuts-to-the-beat", type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const data: HowToPageData = {
  slug: "sync-video-cuts-to-the-beat",
  eyebrow: "HOW-TO · CUTTING TO MUSIC",
  title: "How to cut video to the beat",
  howToDescription:
    "Cut a video to the beat by finding the beat interval, marking the beats on the timeline, cutting " +
    "on them, and placing effects and transitions across the cuts.",
  bluf:
    "Start with the honest part: HITE does not place cuts on the beats of your track. Beat detection " +
    "exists in the codebase but is not wired to the timeline, so asking for it would produce an edit " +
    "that quietly changed nothing. This guide therefore teaches the technique itself — find the beat " +
    "interval, mark the beats, cut on them, and let the treatments ride the cuts — and then shows the " +
    "two parts HITE does automate today: tightening pacing from the transcript, and placing the " +
    "effects and transitions you describe. When beat detection is wired, this page changes back.",
  steps: [
    {
      name: "Find the beat interval",
      text:
        "Work out the tempo of your track in beats per minute, then divide 60 by it to get the seconds " +
        "between beats — 140 BPM is a beat roughly every 0.43 seconds. Most edits cut on every second " +
        "or fourth beat rather than every one; cutting on every beat at a high tempo reads as noise.",
    },
    {
      name: "Mark the beats on the timeline",
      text:
        "Play the track and drop a marker on the downbeats by ear, or step the playhead by the interval " +
        "you calculated. HITE's timebase is an integer tick at 30000 per second, so a marker lands on a " +
        "frame boundary rather than on a rounded millisecond and repeated cuts do not drift.",
    },
    {
      name: "Cut on the markers",
      text:
        "Split the clip at each marker and delete what you do not want. HITE's delete is a ripple delete " +
        "by default, so removing a span pulls everything downstream back into the gap and the rest of " +
        "your beat grid stays aligned instead of sliding out of phase.",
    },
    {
      name: "Let HITE tighten the pacing it can measure",
      text:
        "Say “cut the dead air” or “remove the ums.” HITE reads the transcript of the speech on your clip, " +
        "finds the silences and filler words, and ripple-deletes them. This is real, wired analysis — it " +
        "is driven by what was said, not by the music, which is why it works while beat detection does not.",
    },
    {
      name: "Describe the treatments across the cuts",
      text:
        "Name what you want and where: “punch in on the reaction,” “add a whip pan here,” “give it the " +
        "A24 look.” HITE places those from its effects catalogue, which is gated on what the renderer " +
        "actually paints. Every placement lands as an ordinary timeline operation you can still move.",
    },
    {
      name: "Preview and export",
      text:
        "Watch it back, then export an MP4 in 9:16, 16:9, or 1:1. The export compiles the same edit " +
        "decision list through the same Remotion composition the preview uses, so there is no second " +
        "renderer for the timing to drift in.",
    },
  ],
  // §7.2: every example prompt on the property comes from the machine-checked allowlist in
  // lib/landing/prompts.ts. Nothing beat-related is on it, and nothing beat-related goes here.
  prompts: [
    "cut the dead air",
    "remove the ums",
    "make the intro 8 seconds",
    "punch in on the reaction",
    "add a whip pan here",
  ],
  sections: [
    {
      heading: "Why this page says no",
      body: [
        "Beat detection is in HITE's repository. It is not connected to the timeline: the render " +
          "resolver states it in its own header, and the beat planner returns an empty cut list when no " +
          "beats row exists. A prompt like “sync the cuts to the beat” therefore runs, reports success, " +
          "and leaves the timeline untouched.",
        "That is the worst outcome a page like this can cause — worse than an error, because it looks " +
          "like the product simply does not work. So no page on this site offers beat-sync, no example " +
          "prompt anywhere includes it, and this guide teaches the manual technique instead. The example " +
          "prompts above come from one list that a build-time test runs through the real planner and the " +
          "real reducer; a prompt that stops changing the timeline fails the build.",
      ],
    },
    {
      heading: "What beat-matching by hand actually costs",
      body: [
        "Cutting to the beat manually means scrubbing the waveform, marking every beat, and slicing at " +
          "each one — then redoing it whenever the music or the footage changes. It is the most tedious " +
          "part of a rhythmic edit and the easiest to get slightly wrong, which is what makes an edit " +
          "feel “off.” Automating it well is worth doing properly, which is why it is not being " +
          "advertised before it works.",
        "In the meantime the split is a reasonable one: you own the timing, which is the part that takes " +
          "taste, and HITE places the treatments across it from a sentence, which is the part that takes " +
          "labour.",
      ],
    },
  ],
  faq: [
    {
      q: "Can HITE cut a video to the beat automatically?",
      a: "No. Beat detection exists in HITE's codebase but is not wired to the timeline, so HITE will not place cuts on the kicks, bass or drop of your track, and no prompt on this site offers to. What HITE automates today is transcript-driven — it finds dead air and filler words in the speech on your clip and ripple-deletes them — plus placing any effect or transition you describe at the point you describe it.",
    },
    {
      q: "How do I cut a video to the beat by hand?",
      a: "Divide 60 by the track's tempo in beats per minute to get the seconds between beats, mark the downbeats on the timeline by ear or by stepping the playhead by that interval, then split the clip at each marker. Cut on every second or fourth beat rather than every one unless the tempo is slow. HITE's timebase is an integer tick at 30000 per second, so the cuts land on frame boundaries and repeated splits do not accumulate drift.",
    },
    {
      q: "Will my cuts stay in place after export?",
      a: "Yes. Preview and export compile the same edit decision list through the same Remotion composition, so there is no separate export render for the timing to shift in. Export is the newest stretch of that pipeline and the part still being hardened; the engine underneath it is the one you were watching the whole time.",
    },
    {
      q: "When will HITE cut to the beat?",
      a: "When the beat analysis is connected to the timeline and verified in production. There is no date to give and inventing one would be the same kind of claim this page exists to remove. When it lands, this guide, the example prompts and the effects catalogue all change together, because each of them reads from a machine-checked source rather than from copy.",
    },
  ],
  ctaLead: "Cut the beats yourself. Describe everything else.",
  related: [
    { href: "/how-to/edit-a-phonk-video", label: "How to edit a phonk video" },
    { href: "/how-to/edit-videos-by-typing", label: "How to edit videos by typing" },
    { href: "/compare/best-ai-video-editor-tiktok", label: "Best AI video editor for TikTok" },
    { href: "/compare/hite-vs-capcut", label: "HITE vs CapCut" },
  ],
};

export default function Page() {
  return <HowToPage data={data} />;
}
