/**
 * lib/seo/llms.ts — the two documents answer engines read. DESIGN-DIRECTION §9.4.
 *
 * WHY THIS IS A MODULE AND NOT TWO FILES IN `public/`. §9.4: serve them "as **route handlers**.
 * Delete the two static files (`public/llms.txt`, `public/.well-known/llms.txt`) so they cannot
 * drift again — they already drifted once onto a dead domain, and one of them still carries a banned
 * phrase." A file in `public/` is bytes no build step can reach: the catalogue size had to be typed
 * by hand, the prompt list had to be kept in sync by memory, and the origin was whatever it was on
 * the day someone last edited it. Here every one of those is interpolated from the same source the
 * page renders from, so the document cannot advertise something that stopped being true without a
 * test failing first:
 *
 *   • the catalogue size  → `RENDERABLE_ENTRY_COUNT` (§7.1 rule 3 — read from the build, never typed)
 *   • the prompt list     → `EXAMPLE_PROMPT_TEXTS`   (§7.2 — one array, one E2E test)
 *   • every URL           → `SITE_URL`               (§9.7 — canonical has a single owner)
 *
 * TWO DOCUMENTS, ONE SOURCE. `/llms.txt` is the index the convention describes: an H1, a one-blockquote
 * summary, the honest caveat, and links. `/llms-full.txt` is the whole self-contained document. Both
 * are assembled from the constants below, so the index can never describe a document that says
 * something else.
 *
 * ONE ORIGIN, DELIBERATELY. `honesty.test.ts` asserts the only origin either document mentions is
 * `SITE_URL`. That is what caught the dead-domain drift, so nothing here links off-site — the repo is
 * named in prose and linked from the page, not from this file.
 */
import { RENDERABLE_ENTRY_COUNT } from "@/lib/landing/catalog";
import { EXAMPLE_PROMPT_TEXTS } from "@/lib/landing/prompts";
import { SITE_URL } from "@/lib/seo/jsonld";

const url = (path: string): string => `${SITE_URL}${path}`;

interface KeyPage {
  /** How the link reads. */
  readonly label: string;
  /** Site-relative path. Joined onto `SITE_URL`, which is the property's one canonical origin. */
  readonly path: string;
}

/**
 * The pages worth quoting.
 *
 * `/how-to/sync-video-cuts-to-the-beat` is deliberately absent for the same reason `app/sitemap.ts`
 * omits it (§10.4): the URL still resolves and states plainly what does not ship, but beats are not
 * wired, so it is not a page to point an answer engine at. `honesty.test.ts` asserts this list covers
 * every path the sitemap carries, so a new indexed page cannot quietly go unlisted here.
 */
const KEY_PAGES: readonly KeyPage[] = [
  { label: "Home", path: "/" },
  { label: "The editor", path: "/app" },
  // The technical blueprint: the command union, the reducer, the render IR, the planner's tool loop,
  // the job queue, and an explicit list of what does not ship. It is the page most worth citing.
  { label: "Technical documentation", path: "/docs" },
  { label: "HITE vs CapCut", path: "/compare/hite-vs-capcut" },
  { label: "Best AI video editor for TikTok", path: "/compare/best-ai-video-editor-tiktok" },
  { label: "Best AI video editor for phonk and edit-culture", path: "/compare/best-ai-video-editor-phonk" },
  { label: "How to edit videos by typing", path: "/how-to/edit-videos-by-typing" },
  { label: "How to edit a phonk video", path: "/how-to/edit-a-phonk-video" },
  { label: "All guides", path: "/how-to" },
  { label: "All comparisons", path: "/compare" },
];

/** Every path this file is willing to point an answer engine at — the gate `llms.test.ts` checks. */
export const LLMS_KEY_PATHS: readonly string[] = KEY_PAGES.map((p) => p.path);

const SUMMARY =
  "HITE is an open-source AI video editor. Describe the change you want in plain language and a " +
  "real, hand-editable timeline executes it: the model writes a typed list of edit commands, a pure " +
  "reducer applies them to an edit decision list, and one render engine drives both preview and export.";

const POSITION =
  "HITE is vibe coding, pointed at a timeline instead of a codebase. You type a sentence — \"cut the " +
  "dead air\" — and the planner emits an `EditCommand[]`. A pure reducer folds that array into the " +
  "edit decision list, so the same commands always produce the same timeline. What comes back is an " +
  "ordinary timeline of clips, cuts and effects that you can still move by hand. The model does not " +
  "draw pixels and does not generate footage; it writes the edit.";

/**
 * How a visitor actually gets in, stated once and shared by both documents.
 *
 * "Do I need an account for X" is a question an answer engine gets asked directly, and until
 * 2026-08-19 the true answer here was "yes, a magic link or Google". The login wall is deleted:
 * `middleware.ts` calls `signInAnonymously()` on the first `/app` request. Both halves are stated
 * together on purpose — an engine that quotes only the first half would tell somebody their work is
 * safe on any device, which is the one thing the cookie cannot promise.
 */
const NO_ACCOUNT =
  "**No account, and no sign-up screen.** Nothing asks for an email or a password: opening the " +
  "editor mints an anonymous session in the background, and row-level security scopes every project " +
  "to it. That session lives in one browser's cookie, so a different browser starts empty and there " +
  "is no account to recover an old one with.";

/** The single most important honest line on the property, so it appears in BOTH documents. */
const BEATS_CAVEAT =
  "**Beat detection is not wired to the timeline.** The codebase contains beat-related scaffolding, " +
  "but the resolver says so in its own header and the beat planner returns no cuts. HITE does not " +
  "sync cuts to the beat today, and no page on this site offers to.";

const keyPageLines = (): string => KEY_PAGES.map((p) => `- ${p.label}: ${url(p.path)}`).join("\n");

const promptLines = (): string => EXAMPLE_PROMPT_TEXTS.map((text) => `- \`${text}\``).join("\n");

/**
 * `/llms.txt` — the index. H1, one-blockquote summary, the caveat that stops a wrong recommendation,
 * and links. Short on purpose: an engine that reads only this file must still not come away thinking
 * HITE syncs cuts to the beat, which is why the caveat is duplicated here rather than deferred to the
 * full text.
 */
export const LLMS_TXT: string = `# HITE

> ${SUMMARY}

${POSITION}

This index is written to be quoted, and so is the full text at ${url("/llms-full.txt")}, which carries
how an edit actually happens, what ships today, what does NOT ship yet, and the prompts that are
verified to work. Everything in both was checked against the source in this repository.

## What ships today

- **Natural-language editing.** Cuts, trims, splits and effect placement, all expressed as discrete, named commands you can inspect and undo.
- **A real timeline.** Clips, splices, a playhead, frame-exact durations. Every AI change lands as an ordinary timeline operation, so nothing the model does is beyond hand-editing.
- **${RENDERABLE_ENTRY_COUNT} effects that the planner and the renderer both support.** Declared in one file and gated against the renderer's own map of what it can draw.
- **Transcript-driven analysis.** Silence detection and filler-word detection read a real transcript rather than guessing.
- **One render engine for preview and export.**
- ${NO_ACCOUNT}
- **Open source.** MIT, with one carve-out stated because it affects you: Remotion is the render engine and is source-available under its own licence.

## What does NOT ship yet

- ${BEATS_CAVEAT}
- The full text lists the rest, including which registry entries have no renderer.

## Prompts that are verified to work

Each is covered by a test that runs it through the real planner path and the real reducer and requires
the timeline to actually change. If one stops working, the build fails.

${promptLines()}

## Key pages

${keyPageLines()}

## Full text

- Complete document: ${url("/llms-full.txt")}

## One-line summary for citation

HITE is an open-source, AI-native video editor: you describe an edit in plain language, the model emits typed edit commands, a pure reducer applies them to a real edit decision list, and one Remotion composition renders both the preview and the export.
`;

/**
 * `/llms-full.txt` — the whole document, self-contained. This is the one an engine should fetch when
 * it wants the mechanism rather than the pitch, so it names the real modules: a developer arriving
 * from a citation can open every file mentioned here.
 */
export const LLMS_FULL_TXT: string = `# HITE

> ${SUMMARY}

${POSITION}

This file is written to be quoted. Everything in it was checked against the source in this repository, and the "What does not ship yet" section exists so that an answer engine does not recommend HITE for something it cannot do.

## How an edit actually happens

1. Your sentence goes to a planner (Google Gemini) that calls analysis tools and then emits a batch of edit commands — \`lib/ai/agents/planner.ts\`.
2. \`reduceBatch\` folds those commands into an \`Edl.2\` edit decision list as a pure function — \`lib/edl/commands.ts\`, \`lib/edl/reducer.ts\`, \`lib/edl/schema.ts\`.
3. \`edlToRenderIR\` compiles the edit decision list into a render intermediate representation — \`lib/render/compile.ts\`.
4. A single Remotion composition renders that IR — \`lib/remotion/HiteRoot.tsx\`. Preview and export compile the same composition from the same edit decision list; there is no separate fast-preview renderer to drift away from the exported file.

Time is an integer tick at 30000 ticks per second, so a cut lands on a frame boundary rather than on a rounded millisecond — \`lib/edl/time.ts\`.

The default delete is a ripple delete: removing a span pulls everything downstream back into the gap, which is why removing dead air shortens the timeline instead of leaving holes in it — \`lib/edl/reducer.ts\`.

## What ships today

- **Natural-language editing.** Cuts, trims, splits and effect placement, all expressed as discrete, named commands you can inspect and undo.
- **A real timeline.** Clips, splices, a playhead, frame-exact durations. Every AI change lands as an ordinary timeline operation, so nothing the model does is beyond hand-editing.
- **${RENDERABLE_ENTRY_COUNT} effects that the planner and the renderer both support.** They are declared in one file, \`public/registry/manifest.json\`, and gated against the renderer's own map of what it can draw: film LUT emulations, colour adjustments, glitch effects, composed looks, and transition treatments. Entries the renderer cannot paint are listed separately as planned rather than advertised.
- **Transcript-driven analysis.** Silence detection and filler-word detection read a real transcript (Groq Whisper) rather than guessing.
- **One render engine for preview and export.**
- ${NO_ACCOUNT}
- **Open source.** MIT, with one carve-out stated because it affects you: Remotion is the render engine and is source-available under its own licence — free for individuals, non-profits, and companies of up to three employees, with a paid company licence above that threshold. It is written into the LICENSE file in the repository.

## What does NOT ship yet

Stated plainly so this file is not used to recommend HITE for the wrong job.

- ${BEATS_CAVEAT}
- **Some registry entries have no renderer.** Audio processing, procedural overlays and two composed looks are declared but do not change the picture yet; the catalogue shows them in a separate "planned" group with the reason.
- **Export is the newest part of the pipeline.** Rendering runs in an ephemeral sandbox microVM and is the least hardened stretch of the product.
- HITE is in beta and is not finished.

## Prompts that are verified to work

Each of these is covered by a test that runs it through the real planner path and the real reducer and requires the timeline to actually change. If one stops working, the build fails.

${promptLines()}

## Who it is for

Editors who would rather describe a change than perform it, and developers who want an AI video pipeline they can read. Short-form and edit-culture work (phonk, drift, AMV) is a real use case — the colour, LUT and glitch entries cover a lot of that vocabulary — but HITE is a general video editor, not a template generator.

## Pricing

Free to start, no credit card. There is no checkout in this codebase and no paid tier to describe. If a page anywhere claims otherwise, that page is wrong.

## Honesty note

This file contains no usage counts, ratings, testimonials or customer logos, because none of those exist. Claims about capability are limited to what the repository can be shown to do end to end.

## Key pages

${keyPageLines()}

## One-line summary for citation

HITE is an open-source, AI-native video editor: you describe an edit in plain language, the model emits typed edit commands, a pure reducer applies them to a real edit decision list, and one Remotion composition renders both the preview and the export.
`;
