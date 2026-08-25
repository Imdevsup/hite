/**
 * lib/landing/prompts.ts — the ONLY source of example prompts on the property.
 *
 * DESIGN-DIRECTION §7.2: "every example prompt anywhere on the property — hero, rail, editor empty
 * state, marketing pages, OG image — comes from one array." Import from here. Never write an example
 * prompt inline; a second list is how the page starts advertising something that no longer runs.
 *
 * WHY THIS IS A HONESTY GATE AND NOT A COPY DECK. Every item is a live `<a href="/app?prompt=…">`
 * (§6.6), and `app/app/_components/DeepLinkPrompt.tsx` really does forward that param into the
 * editor's composer. So a prompt on this page is not an illustration — it is a button that runs.
 * The old rail advertised beat-sync while beats are NOT wired (`lib/render/resolver.ts` says so in
 * its own header; `planBeatCuts` returns `{ bpm: 0, cutTicks: [] }`), so one click produced a
 * planner turn that made no edit and raised no error: the worst outcome this page can produce,
 * because it looks like the product simply does not work.
 *
 * THE GATE. `prompts.test.ts` runs every entry below through the REAL flat mapper
 * (`flatBatchToEditBatch`) and the REAL reducer (`reduceBatch`) against the generated fixture, and
 * requires at least one command that actually changes the EDL. A prompt that stops working fails the
 * build. Adding a prompt without evidence fails the build.
 *
 * OUT UNTIL THE CAPABILITY IS VERIFIED IN PROD (§7.2): anything beat-related, anything face-related,
 * anything needing an overlay asset that `public/overlays/` does not ship, and captions.
 */

import { EDITOR_REACHABILITY } from "@/lib/site/primaryCta";

export interface ExamplePrompt {
  /** What the visitor reads, and exactly what is typed into the composer. */
  readonly text: string;
  /**
   * What makes it work, in one clause. Sourced from a real tool or a real registry key — this is
   * the sentence that has to stay true, so it names the mechanism rather than the benefit.
   */
  readonly why: string;
  /**
   * The registry key this prompt lowers to, when it lowers to one. Gated against
   * `lib/landing/catalog.ts` by the test, so an example can never name something that stops
   * rendering. Absent for the transcript-driven prompts, which are structural edits with no key.
   */
  readonly registryKey?: string;
}

/**
 * The allowlist, verbatim from §7.2.
 *
 * Three transcript-driven structural edits (the analysis behind each is wired and reads a real
 * transcript) and three registry edits whose keys are in the renderable set.
 */
export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = [
  { text: "cut the dead air", why: "findSilences reads the transcript for leading, mid and trailing dead air." },
  { text: "remove the ums", why: "findFillerWords marks real filler tokens in the transcript." },
  { text: "make the intro 8 seconds", why: "planCutDown proposes keep-ranges from the real analysis." },
  { text: "punch in on the reaction", why: "the zoom-punch effect, painted by the renderer.", registryKey: "zoom-punch" },
  { text: "add a whip pan here", why: "the whip-pan transition treatment, painted at the cut.", registryKey: "trans-whip-pan-l" },
  { text: "give it the A24 look", why: "the A24 look, every recipe step of which renders.", registryKey: "look-a24" },
] as const;

/** Just the sentences — for the one `sr-only` list under the rail (§6.6) and for OG/meta copy. */
export const EXAMPLE_PROMPT_TEXTS: readonly string[] = EXAMPLE_PROMPTS.map((p) => p.text);

/**
 * The deep link a prompt opens. `/app` forwards `?prompt=` into a new cut and pre-fills the composer
 * (`app/app/_components/DeepLinkPrompt.tsx`), so on a machine that serves the editor this is a working
 * launcher, not a demo — which is the whole premise of the gate above.
 *
 * ON THE PUBLIC LANDING IT IS NOT, and that is the one case the premise did not cover. www.tryhite.xyz
 * serves the landing only (`lib/site/primaryCta.ts`), so a `/app?prompt=…` chip there is exactly the
 * failure this file's header calls "the worst outcome this page can produce" — a click that looks like
 * the product and does nothing — just arriving via a missing route instead of an unwired capability.
 *
 * So the chip leads to the honest next step instead: the quickstart band, whose commands really do end
 * with a running editor. The prompt text stays on screen either way, so nothing about WHAT to type is
 * lost; only the destination changes, and only where the old one was a dead end.
 */
export function promptHref(text: string): string {
  return EDITOR_REACHABILITY === "local"
    ? `/app?prompt=${encodeURIComponent(text)}`
    : "#for-developers";
}
