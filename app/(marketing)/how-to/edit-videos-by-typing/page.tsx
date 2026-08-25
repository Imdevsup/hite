import type { Metadata } from "next";
import { HowToPage, type HowToPageData } from "@/components/marketing/HowToPage";

const TITLE = "How to edit videos by typing (text-to-edit)";
const DESCRIPTION =
  "How to edit a video by typing: describe the edit in plain language and a real, editable timeline " +
  "executes it — cuts, trims, looks, transitions and effects. A step-by-step guide to text-to-edit " +
  "video with HITE.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/how-to/edit-videos-by-typing" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/how-to/edit-videos-by-typing", type: "article" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const data: HowToPageData = {
  slug: "edit-videos-by-typing",
  eyebrow: "HOW-TO · TEXT TO EDIT",
  title: "How to edit videos by typing",
  howToDescription:
    "Edit a video by typing a plain-language description of the change you want; HITE executes it on a " +
    "real, hand-editable timeline and exports it with the same engine it previews with.",
  bluf:
    "To edit a video by typing, open HITE, drop in your footage, and describe the change you want in " +
    "plain language — “cut the dead air, punch in on the reaction, whip pan into the next clip, crush " +
    "the grade.” HITE turns the sentence into a typed list of edit commands and a pure reducer applies " +
    "them to a real timeline: cuts, trims, reorders, looks, transitions and effects. Every change is a " +
    "discrete, undoable operation, and you can keep refining by typing or by editing the timeline by " +
    "hand. One render engine drives both preview and export.",
  steps: [
    {
      name: "Open HITE and add your footage",
      text:
        "HITE runs in the browser — nothing to install, and no account to create: there is no " +
        "sign-up screen and nothing asks for an email. Drop in your clip (any length, phone " +
        "screen-recording to 4K) and it lands on a real timeline, ready to edit.",
    },
    {
      name: "Type the edit you want",
      text:
        "Describe it the way you'd explain it to an editor: “cut the dead air, remove the ums, punch in " +
        "on the reaction, and make it 9:16 for TikTok.” You can combine several instructions in one " +
        "sentence. HITE does not cut to the beat — beat detection is in the codebase but is not wired to " +
        "the timeline, so the pacing work it does is driven by the transcript instead.",
    },
    {
      name: "Review the changes HITE made",
      text:
        "HITE executes the request on the timeline and shows every change as a discrete, labelled " +
        "operation — one line per edit (split, remove, effect, transition). Nothing happens silently, so " +
        "you always know exactly what changed.",
    },
    {
      name: "Refine by typing or by hand",
      text:
        "Keep going in words (“make the intro 8 seconds,” “stronger glitch on the second cut,” “give it " +
        "the A24 look”) or grab the timeline and edit clips, effects, and transitions directly. Undo any " +
        "AI change with one keystroke — you're always in control.",
    },
    {
      name: "Preview and export the exact result",
      text:
        "Preview the edit, then export an MP4 in 9:16, 16:9, or 1:1. HITE compiles the preview and the " +
        "export from the same edit decision list through the same Remotion composition — there is no " +
        "separate export renderer for the file to disagree with.",
    },
  ],
  // §7.2: every example prompt on the property comes from the allowlist in lib/landing/prompts.ts,
  // which is machine-checked against the real planner and reducer. Do not add one that is not there.
  prompts: [
    "cut the dead air",
    "remove the ums",
    "make the intro 8 seconds",
    "punch in on the reaction",
    "add a whip pan here",
    "give it the A24 look",
  ],
  sections: [
    {
      heading: "What “text-to-edit” actually means in HITE",
      body: [
        "Text-to-edit isn't auto-clipping or a one-click template. In HITE, your sentence becomes real " +
          "operations on a real timeline — the same artifact a manual editor would build — which means you " +
          "can always open the timeline and take over. The AI does the busywork; the creative calls stay with " +
          "you.",
        "That's the key difference from tools that hand you a finished render you can't adjust, or a rough " +
          "cut you have to export to another app to finish. HITE is the editor, so describing and hand-editing " +
          "are the same project, not two tools.",
      ],
    },
    {
      heading: "Why you can trust what you typed",
      body: [
        "Every edit HITE makes is a discrete, described change you can see and undo — so the AI never " +
          "silently rewrites your video. You review the list, keep what works, and revert what doesn't with " +
          "one keystroke.",
        "And because preview and export are the same composition compiled from the same edit decision " +
          "list, there is no second render path on export for timing, colour or effects to drift along.",
      ],
    },
  ],
  faq: [
    {
      q: "Can you really edit a video just by typing?",
      a: "Yes. In HITE you describe the edit in plain language and a real, editable timeline executes it — cuts, trims, reorders, looks, transitions and effects. The model does not draw pixels: it writes a typed list of edit commands and a pure reducer applies them, which is why the result is an ordinary timeline. You don't need timeline or keyframe knowledge to start, and you can always open the timeline to refine the result by hand.",
    },
    {
      q: "Is typing the only way to edit in HITE, or can I use the timeline too?",
      a: "Both. Typing is the fastest way to start and to make broad changes, but HITE is a real editor — the full timeline is always one click away. You can drag clips, retime them, tweak effects, and adjust transitions by hand, then go back to typing whenever it's faster.",
    },
    {
      q: "How do I know what the AI changed?",
      a: "HITE shows every AI edit as a discrete, labelled operation — one line per change. Nothing is applied silently, and any change is undoable with a single keystroke, so you can review, keep, or revert each one.",
    },
    {
      q: "Will the exported video match what I previewed?",
      a: "There is only one renderer, so there is nothing for the export to disagree with. Preview and export are the same Remotion composition, compiled from the same edit decision list — not a fast preview path and a separate export path that drift apart. Most browser editors preview with one engine and re-render on export with another, which is where surprise glitches and timing or colour shifts appear; HITE removes that gap by construction. Export is the newest stretch of the pipeline and the part still being hardened.",
    },
  ],
  ctaLead: "Type the edit. Get the edit.",
  related: [
    { href: "/how-to/edit-a-phonk-video", label: "How to edit a phonk video" },
    { href: "/how-to/sync-video-cuts-to-the-beat", label: "Cutting to the beat: what ships today" },
    { href: "/compare/hite-vs-capcut", label: "HITE vs CapCut" },
    { href: "/compare/best-ai-video-editor-tiktok", label: "Best AI video editor for TikTok" },
  ],
};

export default function Page() {
  return <HowToPage data={data} />;
}
