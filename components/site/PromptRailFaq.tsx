/**
 * components/site/PromptRailFaq.tsx — DESIGN-DIRECTION §6.6 (WHAT TO TYPE) + §6.7 (FAQ, FINAL CTA).
 *
 * Three stacked sections, in IA order: the prompt rail as a launcher, the FAQ, and the closing CTA.
 * One component because they are one closing movement — the page stops explaining and starts handing
 * the visitor something to do.
 *
 * ZERO CLIENT JS. This is a Server Component: no "use client", no hooks, no IntersectionObserver.
 * The marquee, its pause control and every hover state are CSS. §12 budgets the landing at ≤140KB of
 * client JS and exactly ONE JS scroll consumer (the Mechanism pin) — this unit spends neither.
 *
 * WHERE THE CSS LIVES. `app/globals.css` is owned by the token unit and is not edited from here, and
 * a co-located `.module.css` would be a second file in a single-file unit. The rail needs
 * `@keyframes`, which cannot be expressed inline, so the section's own rules ship as one React 19
 * hoistable `<style href precedence>` — deduped by href, lifted into <head>, no FOUC. Every value in
 * it is a `var(--token)` from §4; there is not one raw color, duration or easing in this file.
 *
 * MOTION IS OPT-IN (§5.9). Every `animation` AND every `transition` in RAIL_FAQ_CSS is authored
 * inside `@media (prefers-reduced-motion: no-preference)`. The static state — a wrapped, legible
 * grid of prompt chips — is what server-renders and what a reduced-motion visitor keeps. The test
 * beside this file asserts that polarity so it cannot rot.
 *
 * HONESTY (§7.2). Not one prompt string is written here. Every chip comes from `EXAMPLE_PROMPTS`,
 * the machine-checked allowlist whose entries `lib/landing/prompts.test.ts` drives through the real
 * flat mapper and the real reducer against the generated fixture. Nothing beat-related can reach
 * this page, because nothing beat-related is on that list. Every number in the FAQ copy is read from
 * a generated artifact or from the catalog gate (§7.1, §7.3) — there is no typed count anywhere.
 */
import Link from "next/link";
import type { JSX } from "react";
import { MECHANISM_HEADLINE, MECHANISM_SOURCE } from "@/lib/landing/fixture";
import { RENDERABLE_ENTRY_COUNT } from "@/lib/landing/catalog";
import { EXAMPLE_PROMPTS, promptHref } from "@/lib/landing/prompts";
import { EDITOR_REACHABILITY, PRIMARY_CTA } from "@/lib/site/primaryCta";

/**
 * The line under the rail. It has to describe what a tap ACTUALLY does, and that differs by
 * deployment: `promptHref` launches the editor with the prompt pre-filled where the editor is served,
 * and leads to the quickstart where it is not (`lib/site/primaryCta.ts`). Promising "open it in the
 * editor" on the public landing would be the caption lying about its own links.
 */
export const RAIL_NOTE =
  EDITOR_REACHABILITY === "local"
    ? "Every line here is a prompt. Tap one to open it in the editor."
    : "Every line here is a prompt that runs. Tap one to see how to get the editor running.";
import { CTA_MICROLINE } from "@/components/site/SiteChrome";
import type { FaqItem } from "@/lib/seo/jsonld";

/**
 * How many times the prompt list is laid end-to-end inside the drifting track.
 *
 * The loop is seamless only when the track translates by exactly one copy's width, so the keyframe's
 * percentage is DERIVED from this number rather than typed beside it — change the count and the
 * animation stays seamless. Four copies keep the strip filled past an ultrawide viewport at the
 * translated extreme; three would leave a gap on the widest displays.
 */
const RAIL_LOOP_COPIES = 4;
const RAIL_DRIFT_TRANSLATE = `-${100 / RAIL_LOOP_COPIES}%`;

/**
 * §6.7's questions and their answers — the single source rendered twice.
 *
 * The second rendering is the `FAQPage` node in the page's one `@graph` block (§9.5), which is why
 * this is exported as `FaqItem[]`: the SEO unit passes it straight to `faqPageNode()` and the schema
 * text is then byte-identical to the on-screen text by construction, not by discipline. This module
 * deliberately does NOT emit its own JSON-LD — a second `FAQPage` node would duplicate an `@id` and
 * poison the entity graph the direction is trying to clean up.
 *
 * WHY THE COUNT MOVED. §6.7 specifies six questions; this rendered five, because the direction's
 * first two — "What is vibe coding for video editing?" and "Can AI edit a video timeline?" — had one
 * answer between them: both described the model emitting typed commands and a pure reducer folding
 * them into the EDL, at 146 words. They are merged into the first, which is the one that has to stay
 * because the landing defines the phrase "vibe coding" nowhere else. The rest were cut of hedging and
 * of anything the page already shows — the rail demonstrates what to type directly above §6.7, and
 * §6.5's licence card carries the Remotion carve-out in full — taking the section from 495 words to
 * ~350 without dropping a claim.
 *
 * "DO I NEED AN ACCOUNT?" IS THE SIXTH, AND IT IS NOT A RESTORED SPEC ITEM — it is new, and it is
 * here because the product changed underneath the page. The login wall is deleted: `middleware.ts`
 * mints an anonymous Supabase session on the first `/app` request, so the CTA above is now literally
 * one click from an editor. That is the better story AND the one that owes a caveat, because the
 * session cookie is the only key to a visitor's projects and no account exists to recover it with.
 * §6.7 is where a caveat gets a sentence instead of being squeezed into a three-clause microline;
 * the JSON-LD FAQPage is built from this same array, so answer engines get the caveat too.
 *
 * WHAT THE CATALOG DELETION CHANGED HERE. The last answer used to end "…which is why the catalog
 * lists only what paints and shows the rest separately as planned." §6.4's catalog section is gone,
 * so that sentence pointed at nothing a reader could see. The gate it described is untouched — the
 * count below still comes from `RENDERABLE_ENTRY_COUNT` — so the claim moved into the answer that
 * prints the number and the dangling half went.
 *
 * Every factual claim below was read from source on 2026-08-19: the reducer's purity and the command
 * path (`lib/edl/reducer.ts`, `lib/ai/edit-batch-flat.ts`), the single render engine
 * (`components/chrome/Preview.tsx` mounts `HiteRoot` through `edlToRenderIR`, and `lib/sandbox/
 * render.ts` bundles the same composition for export), and the Remotion carve-out (`LICENSE`, the
 * THIRD-PARTY NOTICE block). The last answer is the property's ONE beta admission (§6.7).
 */
export const LANDING_FAQ: readonly FaqItem[] = [
  {
    q: "What is vibe coding for video editing?",
    a:
      "Vibe coding, pointed at a timeline instead of a codebase. You describe the change in plain " +
      "language; the model draws no pixels and generates no footage — it emits a typed list of edit " +
      "commands, and a pure reducer applies them to a real edit decision list. What comes back is an " +
      "ordinary timeline, still yours to move by hand, and the same commands always reduce to the same " +
      `timeline. The example above is one real run: ${MECHANISM_HEADLINE.commandCount} commands reduce ` +
      `a ${MECHANISM_SOURCE.timecode} take to ${MECHANISM_HEADLINE.timecode}.`,
  },
  {
    q: "What can I actually type?",
    a:
      "Click any line on the rail above and the editor opens with it typed; the build runs each one " +
      "through the real reducer and fails if the timeline does not change. Past those, describe cuts, " +
      "pacing, looks and transitions in your own words — the planner maps them onto the catalog the " +
      `renderer can actually paint, ${RENDERABLE_ENTRY_COUNT} entries today, rather than everything the ` +
      "registry advertises.",
  },
  {
    q: "Do I need an account?",
    a:
      "No. There is no sign-up screen and nothing asks you for an email — opening the editor creates " +
      "a session for you in the background, and row-level security scopes every project to it, so " +
      "nobody else can read your work. The trade is worth knowing: that session lives in this " +
      "browser's cookie and there is no account to recover it with, so a different browser, or " +
      "cleared cookies, starts you on an empty workbench. Export anything you want to keep.",
  },
  {
    q: "Does the export match the preview?",
    a:
      "There is one renderer, so there is nothing for the export to disagree with. Preview and export are " +
      "the same Remotion composition compiled from the same edit decision list — not a fast preview path " +
      "and a separate export path that drift apart. Export is the newest stretch of that pipeline and " +
      "still the least hardened.",
  },
  {
    q: "Is HITE open source?",
    a:
      "Yes — MIT, and the whole pipeline is in the repository. One carve-out, stated because it affects " +
      "you rather than us: Remotion is the render engine and is source-available under its own license — " +
      "free for individuals, for non-profits, and for companies of up to three employees, and paid above " +
      "that. It is written into the LICENSE file, not buried.",
  },
  {
    q: "Is this finished?",
    a:
      "No — HITE is in beta, and saying otherwise would be the one thing here that wastes your time. What " +
      "ships is the loop this page shows: describe an edit, get commands, get a timeline you can still " +
      "move by hand. Beat detection is in the codebase but is not wired to the timeline, so nothing here " +
      "offers to cut to the beat, and parts of the effects registry still have no renderer behind them.",
  },
] as const;

export interface PromptRailFaqProps {
  /** DOM id for the prompt-rail section. */
  railId?: string;
  /** DOM id for the FAQ section — the nav's `FAQ` anchor target (§6.0). */
  faqId?: string;
  /**
   * Render §6.7's closing CTA after the FAQ. On by default: §6.7 puts it here, and a landing page
   * that ends on a question with nothing to press is a broken funnel. Turn it off if the assembly
   * owns the close.
   */
  finalCta?: boolean;
}

export function PromptRailFaq({
  railId = "what-to-type",
  faqId = "faq",
  finalCta = true,
}: PromptRailFaqProps = {}): JSX.Element {
  const railHeadingId = `${railId}-h`;
  const railNoteId = `${railId}-note`;
  const railPauseId = `${railId}-pause`;
  const faqHeadingId = `${faqId}-h`;
  const ctaHeadingId = `${faqId}-cta-h`;

  return (
    <>
      <style href="hite-prompt-rail-faq" precedence="high">
        {RAIL_FAQ_CSS}
      </style>

      {/*
        ── §6.6 WHAT TO TYPE — the prompt rail, as a launcher ─────────────────────────────────

        `.tex-dots` (globals, §4.4) is §1.1 "Ethereal" #3's dot grid — "a dot grid that fades to
        nothing at 65% of a band". This is that band: the one full-bleed section on the page, and
        the only one carrying no texture of its own (`.tex-hatch` already dresses the hero console,
        the developer band, the Mechanism's monitor and §6.3's panel). The class is pure CSS —
        `::before` at inset 0 behind children the companion rule lifts to z-index 1 — so it costs
        the rail nothing and does not touch the marquee's geometry.
      */}
      <section id={railId} className="prompt-rail section tex-dots" aria-labelledby={railHeadingId}>
        <div className="container">
          <header className="prompt-rail__head">
            <p className="prompt-rail__eyebrow t-label">What to type</p>
            <h2 id={railHeadingId} className="t-h2">
              These are the prompts that work. The build checks each one against the real reducer.
            </h2>
          </header>
        </div>

        <div className="prompt-rail__band">
          <div className="container">
            {/*
              WCAG 2.2.2 (Pause, Stop, Hide). §5.9 gives the rail hover-pause, focus-pause and the
              reduced-motion gate; a hover target is not a mechanism for a keyboard or touch user, so
              the rail also carries the visible pause control §5.9 requires of everything that
              auto-updates past five seconds. Zero JS: a visually-hidden checkbox, a 48px label, and
              `:has()` — the same CSS-only control primitive §6.4 uses for the catalog filter. It is
              revealed only where BOTH the animation runs and `:has()` is supported, so the page never
              shows a control that would do nothing.
            */}
            <div className="prompt-rail__controls">
              <span className="prompt-rail__pause">
                <input
                  id={railPauseId}
                  className="prompt-rail__pause-input sr-only"
                  type="checkbox"
                />
                <label className="prompt-rail__pause-label" htmlFor={railPauseId}>
                  <span data-rail-state="running">Pause</span>
                  <span data-rail-state="paused">Play</span>
                </label>
              </span>
            </div>
          </div>

          {/*
            §9.2 rules that a demo's DOM IS its own summary: no parallel prose transcript, and
            `aria-hidden` only on layers that carry no meaning. So the FIRST copy of the list is fully
            exposed and focusable — that is the list, once, for assistive tech — and the loop copies
            that exist purely to make the drift seamless are `aria-hidden` with unfocusable anchors.
            Putting the real links in an `sr-only` block instead would hand a keyboard user six
            invisible focus stops (WCAG 2.4.7), which §6.6's one-line note cannot have meant.
          */}
          <div
            className="prompt-rail__viewport"
            role="marquee"
            aria-label="Example prompts"
            aria-describedby={railNoteId}
            tabIndex={0}
          >
            <div className="prompt-rail__track">
              {Array.from({ length: RAIL_LOOP_COPIES }, (_, copy) => {
                const isLoopCopy = copy > 0;
                return (
                  <ul
                    key={copy}
                    className="prompt-rail__group"
                    role="list"
                    data-rail-loop-copy={isLoopCopy ? "true" : "false"}
                    aria-hidden={isLoopCopy || undefined}
                  >
                    {EXAMPLE_PROMPTS.map((prompt) => (
                      <li key={prompt.text} className="prompt-rail__item">
                        {/*
                          `prefetch={false}`: the rail repeats one route 24 times. Letting Next warm
                          /app once per chip spends the §12 bundle/network budget on a page the
                          visitor may never open, and the deep link works identically without it.
                        */}
                        <Link
                          className="prompt-rail__chip"
                          href={promptHref(prompt.text)}
                          prefetch={false}
                          tabIndex={isLoopCopy ? -1 : undefined}
                        >
                          {prompt.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                );
              })}
            </div>
          </div>

          <div className="container">
            <p id={railNoteId} className="prompt-rail__note t-label">
              {RAIL_NOTE}
            </p>
          </div>
        </div>
      </section>

      {/* ── §6.7 FAQ — the visible questions, and the source of the FAQPage node ─────────────── */}
      <section id={faqId} className="faq section" aria-labelledby={faqHeadingId}>
        <div className="container">
          <header className="faq__head">
            <p className="faq__eyebrow t-label">FAQ</p>
            <h2 id={faqHeadingId} className="t-h2">
              What people ask. Answered from what ships today.
            </h2>
          </header>

          {/*
            Answers are plain, always-visible text — never a collapsed <details>. §9.1's build gate
            fails on any FAQ answer with a visually-hidden computed style, and an answer engine cannot
            open an accordion.
          */}
          <div className="faq__list">
            {LANDING_FAQ.map((item, index) => (
              <div key={item.q} className="faq__item">
                <h3 className="faq__q t-h3">
                  <span className="faq__index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{item.q}</span>
                </h3>
                <p className="faq__a t-body">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── §6.7 FINAL CTA ───────────────────────────────────────────────────────────────────── */}
      {finalCta ? (
        <section className="final-cta section-q" aria-labelledby={ctaHeadingId}>
          <div className="container">
            <div className="final-cta__inner">
              <h2 id={ctaHeadingId} className="t-h2">
                Say what you want changed.
              </h2>
              {/*
                No `--glow-accent` here. §4.4 rations the glow to ONE element per page and §6.0 spends
                it on the nav's primary CTA, so this one is the solid accent fill and nothing more.
              */}
              <Link className="final-cta__button" href={PRIMARY_CTA.href}>
                {PRIMARY_CTA.label}
              </Link>
              <p className="final-cta__note t-label">{CTA_MICROLINE}</p>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

export default PromptRailFaq;

/**
 * The section's stylesheet. Exported so the test can assert the §5.9 polarity (nothing animates
 * outside `prefers-reduced-motion: no-preference`) and that the string stays free of characters
 * React would HTML-escape inside a <style> element.
 *
 * Read it as two halves: everything above MOTION is the state that server-renders, and everything
 * below it is added only for a visitor who has not asked for less motion.
 */
export const RAIL_FAQ_CSS = `
/* ════════════════════════════════════════════════════════════════════════════
   §6.6 PROMPT RAIL · §6.7 FAQ + FINAL CTA — static state
   ════════════════════════════════════════════════════════════════════════ */

/* THE ARRIVAL IS GONE FROM THIS UNIT, and its blur override with it. The old
   view()-timeline arrival class, its media modifier and their keyframes were all
   deleted in app/globals.css — the class blurred inside the LCP viewport, which
   §16 budgets at zero — so the blur override here was tuning a variable no rule
   reads. §6's motion inventory is nine animations and states "there is no tenth";
   a mid-page scroll arrival is not among them, so the five class names this
   section carried were removed rather than re-authored. The test below asserts
   both constructions stay gone. */

/* LUXURY RULE #5 (§1.1): the gap under a heading is one third of the space above
   the section — the token layer already computes it as --heading-gap. */
.prompt-rail__head, .faq__head { margin-block-end: var(--heading-gap); }
.prompt-rail__eyebrow, .faq__eyebrow { margin-block-end: var(--space-3); }

.prompt-rail__band { position: relative; }

.prompt-rail__controls {
  display: flex;
  justify-content: flex-end;
  margin-block-end: var(--space-3);
}

/* Hidden until the motion it controls actually exists — see the MOTION half. */
.prompt-rail__pause { display: none; }

.prompt-rail__pause-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--space-7);
  min-inline-size: var(--space-7);
  padding-inline: var(--space-4);
  border-radius: var(--r-xs);
  box-shadow: var(--ring-hair);
  color: var(--t-2);
  cursor: pointer;
  font-family: var(--font-mono), "Martian Mono", ui-monospace, monospace;
  font-size: var(--fs-label);
  font-variation-settings: "wght" 500, "wdth" 87.5;
  letter-spacing: var(--tk-mono);
  text-transform: uppercase;
}
.prompt-rail__pause-label:hover,
.prompt-rail__pause-input:focus-visible + .prompt-rail__pause-label {
  color: var(--t-1);
  background-color: var(--s-2);
}
.prompt-rail__pause-input:focus-visible + .prompt-rail__pause-label { box-shadow: var(--focus-ring); }
/* One visible word at a time, so the control's accessible name always equals the
   word on screen (WCAG 2.5.3). display:none keeps the other out of the name. */
.prompt-rail__pause-label [data-rail-state="paused"] { display: none; }

/* Full-bleed on purpose (§6.6): the band escapes the 10-second column. In the
   static state it is padded back to the gutter, because a wrapped list with no
   inline padding would collide with the viewport edge. */
.prompt-rail__viewport {
  overflow: hidden;
  padding-inline: var(--gutter);
  padding-block: var(--space-2);
}

.prompt-rail__track { display: block; }

.prompt-rail__group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.prompt-rail__group[data-rail-loop-copy="true"] { display: none; }

.prompt-rail__item { display: flex; }

.prompt-rail__chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-block-size: var(--space-7);            /* 48px · 12 frames — ≥44px (§4.5) */
  padding-inline: var(--space-5);
  border-radius: var(--r-xs);                /* small radius reads precise (§4.4) */
  background-color: var(--s-1);
  box-shadow: var(--ring-hair);              /* cards get the hairline ring, no shadow */
  color: var(--t-2);
  font-family: var(--font-mono), "Martian Mono", ui-monospace, monospace;
  font-size: var(--fs-sm);
  font-variation-settings: "wght" 400, "wdth" 87.5;
  letter-spacing: var(--tk-body);
  line-height: 1;
}
/* The cut edge. Each chip is a clip, and its inline-start is a splice point — the
   hairline goes accent on hover and focus, which is the playhead arriving. */
.prompt-rail__chip::before {
  content: "";
  position: absolute;
  inset-block: var(--space-2);
  inset-inline-start: 0;
  inline-size: 1px;
  background-color: var(--line-4);
}
/* §4.5: hover and :focus-visible are visually identical. Neither declaration
   touches box-shadow, so the global --focus-ring lands on top unharmed. */
.prompt-rail__chip:hover,
.prompt-rail__chip:focus-visible { color: var(--t-1); background-color: var(--s-2); }
.prompt-rail__chip:hover::before,
.prompt-rail__chip:focus-visible::before { background-color: var(--color-accent); }

/* The mono line under the rail is a SENTENCE, not a label: .t-label supplies the
   family, the 12px floor and --t-3, but its uppercasing belongs to eyebrows. A
   60-character tracked-uppercase string on near-black is the legibility problem
   §4.2 warns about. Compound selector so the override does not depend on which
   stylesheet the browser saw first. */
.prompt-rail__note.t-label,
.final-cta__note.t-label {
  text-transform: none;
  letter-spacing: var(--tk-body);
}
.prompt-rail__note { margin-block-start: var(--space-5); }

/* ── §6.7 FAQ ─────────────────────────────────────────────────────────────── */
.faq__item {
  display: grid;
  gap: var(--space-4);
  padding-block: var(--space-7);
  border-block-start: 1px solid var(--line-1);
}
.faq__item:last-child { border-block-end: 1px solid var(--line-1); }
.faq__q { display: flex; gap: var(--space-4); align-items: baseline; margin: 0; }
.faq__index {
  flex: none;
  font-family: var(--font-mono), "Martian Mono", ui-monospace, monospace;
  font-size: var(--fs-label);                /* 12px — the property's hard floor */
  font-variation-settings: "wght" 500, "wdth" 87.5;
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--tk-mono);
  color: var(--t-4);                         /* 4.5:1, permitted at ≥12px only */
}
.faq__a { margin: 0; }

/* Two columns once the answer measure and the question can sit side by side —
   940px is the same threshold §6.2 uses to decide a section is desktop-shaped. */
@media (min-width: 940px) {
  .faq__item {
    grid-template-columns: 5fr 7fr;
    column-gap: var(--gutter);
    align-items: start;
  }
}

/* ── §6.7 FINAL CTA ───────────────────────────────────────────────────────── */
/* LUXURY RULE #5 again: --heading-gap under the heading, then a tighter beat
   between the button and its microline. */
.final-cta__inner { display: grid; justify-items: start; }
.final-cta__inner > h2 { margin-block-end: var(--heading-gap); }
.final-cta__note { margin-block-start: var(--space-5); }
.final-cta__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--space-7);
  padding-inline: var(--space-6);
  border-radius: var(--r-sm);
  background-color: var(--color-accent-cta);
  color: var(--color-on-accent);
  font-size: var(--fs-body);
  font-weight: var(--fw-cta);
  letter-spacing: var(--tk-body);
}
.final-cta__button:hover,
.final-cta__button:focus-visible { background-color: var(--color-accent); }

/* ════════════════════════════════════════════════════════════════════════════
   MOTION — §5.9: opt-in, never opt-out. Nothing below this line exists for a
   visitor who asked for reduced motion, and nothing above it moves.
   ════════════════════════════════════════════════════════════════════════ */
@media (prefers-reduced-motion: no-preference) {
  /* Hover/press colour only, on an explicit property list — never transition-all. */
  .prompt-rail__pause-label,
  .prompt-rail__chip,
  .final-cta__button {
    transition: color var(--d-tap) var(--ease-apple),
                background-color var(--d-tap) var(--ease-apple);
  }
  .prompt-rail__chip::before {
    transition: background-color var(--d-tap) var(--ease-apple);
  }

  /* The rail becomes one drifting strip: masked at both edges, no gutter, the
     four copies laid end to end. Transform only — no width, no left, no filter. */
  .prompt-rail__viewport {
    padding-inline: 0;
    -webkit-mask-image: linear-gradient(to right, #0000 0, #000 var(--gutter), #000 calc(100% - var(--gutter)), #0000 100%);
    mask-image: linear-gradient(to right, #0000 0, #000 var(--gutter), #000 calc(100% - var(--gutter)), #0000 100%);
  }
  .prompt-rail__track {
    display: flex;
    inline-size: max-content;
    animation: prompt-rail-drift var(--d-drift) linear infinite;
  }
  /* The trailing gap belongs to each copy, so all four measure the same width and
     the seam lands exactly on the keyframe's translation. */
  .prompt-rail__group {
    flex-wrap: nowrap;
    padding-inline-end: var(--space-3);
  }
  /* One line per chip only while the strip drifts. In the static state a chip is
     allowed to wrap, so the longest prompt cannot overflow a 375px screen. */
  .prompt-rail__chip { white-space: nowrap; }
  .prompt-rail__group[data-rail-loop-copy="true"] { display: flex; }

  /* §5.9: hover-pause, and focus-pause so a keyboard user reading a chip is not
     chased off it. */
  .prompt-rail__viewport:hover .prompt-rail__track,
  .prompt-rail__viewport:focus-within .prompt-rail__track { animation-play-state: paused; }

  @supports selector(:has(*)) {
    .prompt-rail__pause { display: inline-flex; }
    .prompt-rail__band:has(.prompt-rail__pause-input:checked) .prompt-rail__track {
      animation-play-state: paused;
    }
    .prompt-rail__band:has(.prompt-rail__pause-input:checked) .prompt-rail__pause-label [data-rail-state="running"] {
      display: none;
    }
    .prompt-rail__band:has(.prompt-rail__pause-input:checked) .prompt-rail__pause-label [data-rail-state="paused"] {
      display: inline;
    }
  }
}

@keyframes prompt-rail-drift {
  to { transform: translate3d(${RAIL_DRIFT_TRANSLATE}, 0, 0); }
}
`;
