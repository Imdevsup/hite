/**
 * app/_landing/faq.ts — the landing's FAQ, the one array both the visible section and the
 * FAQPage JSON-LD are built from, so the schema can never say something the page does not.
 *
 * Every answer is checked against the code it describes (see hite-app/CLAUDE.md): no account,
 * one renderer, BYOK providers, MIT plus Remotion's own licence, beats wired, faces not. No em
 * dashes (spec §15). "beta" appears once on the property: here.
 */
import type { FaqItem } from "@/lib/seo/jsonld";

export const LANDING_FAQ: readonly FaqItem[] = [
  {
    q: "Was Hite going to raise?",
    a:
      "It was on the table. We chose to open-source the whole thing instead: the planner, the tool library, " +
      "the reducer, the renderer and the worker are all in one MIT-licensed repository. You bring your own " +
      "model key, you run it where you like, and nothing about the editor depends on us staying in business.",
  },
  {
    q: "What does it actually do to my timeline?",
    a:
      "The model never touches pixels. It calls analysis and advisor tools against your footage, then emits a " +
      "typed batch of edit commands: trim, split, add transition, add overlay, set speed, add captions, add an " +
      "audio bed, add markers. A pure reducer applies them to a real edit decision list. The same commands " +
      "always produce the same timeline, and every one of them is an ordinary edit you can undo or move by hand.",
  },
  {
    q: "Which models can I use?",
    a:
      "Google, OpenAI, Anthropic, Groq, xAI, DeepSeek, OpenRouter, or any self-hosted OpenAI-compatible " +
      "endpoint. It is bring-your-own-key: the key goes in a header on each request, there is no pool on our " +
      "side, and a request without a key is refused rather than silently routed somewhere else.",
  },
  {
    q: "Do I need an account?",
    a:
      "No. There is no sign-up screen and nothing asks for an email. Opening the editor creates a session in " +
      "the background and row-level security scopes every project to it. The trade: that session lives in " +
      "your browser's cookie, so a different browser or cleared cookies starts you on an empty workbench. " +
      "Export what you want to keep.",
  },
  {
    q: "Does the export match the preview?",
    a:
      "There is one renderer, so there is nothing for the export to disagree with. Preview and export are the " +
      "same Remotion composition compiled from the same edit decision list. Export is 1920 by 1080 H.264 today, " +
      "rendered by a worker process that drains a Postgres job queue.",
  },
  {
    q: "What is not there yet?",
    a:
      "Hite is in beta. Face detection is not wired, so nothing anchors to a person. Transitions that need two " +
      "clips' pixels blended, like a true cross dissolve, are withheld rather than faked. LUTs and overlays " +
      "render as approximations. Anything the renderer cannot paint is kept away from the model so it can " +
      "never report a change it did not make.",
  },
];
