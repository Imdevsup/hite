/**
 * components/site/ForDevelopers.tsx — DESIGN-DIRECTION §6.5 (FOR DEVELOPERS), the second audience.
 *
 * "One dense band." A developer arriving from GitHub needs three things and nothing else: what the
 * architecture actually is, how to run it, and what the license really permits. This section is
 * those three, built only out of facts read from disk:
 *
 *   • THE PATH — the five real modules §6.5 names, each linked to the real file, each captioned
 *     with a sentence taken from that file's OWN header. Nothing here is a marketing paraphrase of
 *     the architecture; `ForDevelopers.test.ts` fails the build if any of the five paths stops
 *     existing, so the section cannot outlive a rename.
 *   • THE QUICKSTART — the real clone/install/dev sequence. `pnpm dev` runs `predev`
 *     (`scripts/build-registry.ts`) before `next dev`, so no extra step is invented here.
 *   • THE LICENSE — MIT for HITE's own source, and the Remotion carve-out stated in full. §6.5:
 *     "Remotion is the render engine and cannot be swapped, so an unqualified MIT badge would be a
 *     false statement for any company over three people." The wording below is checked against the
 *     repo's own LICENSE by the co-located test, so the page and the license file cannot drift.
 *
 * WHY THERE IS A GENERATED NUMBER IN A LICENSE BAND. §7.3: "There are no numeric literals in
 * landing components." The one figure this section prints — the command/clip/duration shape of the
 * page's own timeline — is read from `lib/landing/fixture.ts`, and it is here rather than in §6.2
 * because it does a different job: it tells a sceptic WHERE TO CHECK. The full reduction is served
 * as a static artifact, so the claim "the timeline on this page is real" is falsifiable in one
 * click, which is the only form of proof that means anything to this audience.
 *
 * MOTION: NONE, AND THAT IS THE CURRENT DIRECTION RATHER THAN AN OVERSIGHT. This band used to carry
 * `.settle`, a `view()`-timeline arrival with a blur term. `app/globals.css` deleted that class and
 * its keyframes — the blur landed inside the LCP viewport, which §16 budgets at zero — and §6's
 * motion inventory is nine animations with "there is no tenth", none of which is a mid-page arrival.
 * See the note above `PIPELINE` for the full reasoning. The static state is what SSRs, and this file
 * mounts no scroll listener, no observer and no motion library (§12).
 *
 * AND, SINCE 2026-08-19, IT SHIPS NO JAVASCRIPT EITHER. This module used to open with `"use client"`
 * for one `navigator.clipboard.writeText` call, which put all of the above — the pipeline rail, the
 * quickstart, the entire license carve-out — into the landing's client bundle at a measured **2.1KB
 * gzipped** (source-map attribution of `.next/static/chunks/app/page-*.js`, §12's ≤140KB budget).
 * The button is now `./CopyQuickstart.tsx`, a client island, and everything here is a Server
 * Component. Keep it that way: re-adding the directive at the top silently re-bundles the file.
 */

import { LANDING_FIXTURE_URL, MECHANISM_HEADLINE } from "@/lib/landing/fixture";
import { CopyQuickstart } from "./CopyQuickstart";

/* ─────────────────────────────────────────────────────────────────────────────
   THE PATH AN EDIT TAKES — §6.5's flow, verbatim:
   lib/edl/commands.ts → lib/edl/reducer.ts → lib/edl/schema.ts →
   lib/render/compile.ts → lib/remotion/HiteRoot.tsx
   ───────────────────────────────────────────────────────────────────────────── */

export interface PipelineNode {
  /** Ordinal, mono, tabular. The rail is an ordered list because the pipeline is ordered. */
  readonly step: string;
  /** What this stage IS, in HITE's own vocabulary — not a generic "input/process/output" gloss. */
  readonly stage: string;
  /** Repo-relative path. Asserted to exist on disk by ForDevelopers.test.ts. */
  readonly path: string;
  /** One sentence, compressed from that file's own header comment. Never invented here. */
  readonly role: string;
}

export const PIPELINE: readonly PipelineNode[] = [
  {
    step: "01",
    stage: "COMMAND",
    path: "lib/edl/commands.ts",
    // "One vocabulary emitted by BOTH the AI (a batch per turn) and the manual UI (one per gesture)."
    role: "One vocabulary. The planner and the timeline UI both emit it.",
  },
  {
    step: "02",
    stage: "REDUCE",
    path: "lib/edl/reducer.ts",
    // "Layer 0→1, the ONE pure place the EDL mutates."
    role: "Pure. The only place the EDL is allowed to change.",
  },
  {
    step: "03",
    stage: "EDL.2",
    path: "lib/edl/schema.ts",
    // "Integer TICKS (ticksPerSecond=30000) everywhere" · "position is DERIVED from order".
    role: "Integer ticks. A clip's position is derived, never stored.",
  },
  {
    step: "04",
    stage: "COMPILE",
    path: "lib/render/compile.ts",
    // "Same inputs ⇒ byte-identical IR ⇒ equal rootHash."
    role: "Same inputs, byte-identical render IR.",
  },
  {
    step: "05",
    stage: "RENDER",
    path: "lib/remotion/HiteRoot.tsx",
    // "Both surfaces use this exact tree: preview → <Player>, export → <Composition>."
    role: "One composition. Preview and export render this exact tree.",
  },
] as const;

/* ─────────────────────────────────────────────────────────────────────────────
   THE QUICKSTART — the real sequence, not a plausible one.
   ───────────────────────────────────────────────────────────────────────────── */

/** `https://github.com/owner/repo` → `repo`. The directory `git clone` actually creates. */
export function repoDirectory(repoUrl: string): string {
  const trimmed = repoUrl.replace(/\/+$/, "");
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last.replace(/\.git$/, "");
}

/**
 * Every line is a command that works today: pnpm is the package manager (`pnpm-lock.yaml`),
 * `.env.example` is at the repo root, and `pnpm dev` runs `predev` → `scripts/build-registry.ts`
 * before Next starts, so the registry step needs no line of its own.
 */
export function quickstartLines(repoUrl: string): readonly string[] {
  const base = repoUrl.replace(/\/+$/, "").replace(/\.git$/, "");
  return [
    `git clone ${base}.git`,
    `cd ${repoDirectory(base)}`,
    "cp .env.example .env.local",
    "pnpm install",
    "pnpm dev",
  ];
}

/* ─────────────────────────────────────────────────────────────────────────────
   THE LICENSE DISCLOSURE — required and honest (§6.5).

   Exported so the co-located test can hold it against the repo's own LICENSE. If the carve-out in
   LICENSE is ever edited, this copy has to move with it or the build fails.
   ───────────────────────────────────────────────────────────────────────────── */

export const LICENSE_DISCLOSURE = {
  mit: "HITE's own source is MIT. Fork it, ship it, sell it.",
  carveOut:
    "Remotion is not. It is the render engine — it drives the preview and the export alike, so it " +
    "cannot be swapped out. Remotion is free for individuals, for non-profits, and for for-profit " +
    "companies of three people or fewer. Above that threshold it needs a paid company license.",
  footnote: "One package in the tree, @remotion/web-renderer, ships as UNLICENSED.",
  caveat: "Summary only, and it can go out of date — read Remotion's current terms before you deploy.",
} as const;

const REMOTION_LICENSE_URL = "https://www.remotion.dev/docs/license";

/* ─────────────────────────────────────────────────────────────────────────────
   COMPONENT
   ───────────────────────────────────────────────────────────────────────────── */

export interface ForDevelopersProps {
  /**
   * The section's anchor id. The nav links to it; the assembly owns the nav, so it owns the name.
   */
  id?: string;
  /**
   * Base URL of the source repository. Every file link and the clone command are built from it, so
   * there is exactly one place to point this at a different fork or org.
   */
  repoUrl?: string;
  /** The branch the file links resolve against. */
  branch?: string;
}

const DEFAULT_REPO_URL = "https://github.com/Imdevsup/hite";
const DEFAULT_BRANCH = "master";

/**
 * THE ARRIVAL THAT USED TO BE HERE IS GONE, and this note is why it did not come back.
 *
 * Three elements in this file carried `.settle` — a `view()`-timeline arrival — plus a `--settle-blur`
 * override and a per-item `animation-range` stagger. `app/globals.css` deleted the class, the
 * modifier and `@keyframes settle` by name: it "carried `filter: blur(4px)` on the hero console,
 * i.e. a blur inside the LCP viewport, which §16 budgets at zero", and it noted that consumers
 * "lose an animation, not layout" because they were already authored in their resting state.
 *
 * The consumers were never updated, so eleven class names and four overrides shipped pointing at
 * rules that do not exist. Removing them rather than re-authoring the animation is the choice §6
 * forces: its motion inventory is nine items, it says "there is no tenth", and animation 1 (arrival)
 * is scoped to the hero's microline, CTA and prompts. A scroll-entry arrival for a mid-page band is
 * not on that list, and adding one back would be adding a tenth.
 */

/**
 * Inline links.
 *
 * The `!` modifiers are load-bearing, not sloppiness. `app/globals.css` resets
 * `a { color: inherit; text-decoration: none }` OUTSIDE any cascade layer, and an unlayered normal
 * declaration outranks every declaration in `@layer utilities` no matter how specific — so a plain
 * `text-[…] underline` on an anchor is silently dropped and the link renders as body copy. Verified
 * by rendering the compiled sheet, not assumed. `!important` on the utility wins that fight while
 * keeping the hover variant working. The clean fix is to move that reset into `@layer base`;
 * globals.css belongs to the token unit, so it is flagged rather than edited here.
 *
 * `--line-5` is the resting underline because §4.2 measures it at 3.22:1 — the underline is the
 * non-colour cue that keeps the link identifiable (WCAG 1.4.1), so it has to clear 3:1 on its own.
 *
 * The same cascade trap costs a FOCUS RING, which is why the hairline below is written as
 * `shadow-[var(--ring-hair)]` and not as globals.css's `.ring-hair` class. `.ring-hair` is declared
 * unlayered at globals.css:583, AFTER the unlayered `:focus-visible { box-shadow: var(--focus-ring) }`
 * at :417, and both are one class/pseudo-class of specificity — so on a focusable element the
 * hairline WINS and the focus ring never paints. Measured with a real Tab press, not assumed. The
 * arbitrary-value utility lands in `@layer utilities`, which the unlayered `:focus-visible` outranks,
 * so the token's value is unchanged and the ring comes back. Also flagged for the token unit.
 */
const LINK_CLASS =
  "text-[var(--color-accent)]! underline! decoration-[var(--line-5)]! underline-offset-4 " +
  "transition-colors duration-[var(--d-tap)] hover:decoration-[var(--color-accent)]! " +
  "motion-reduce:transition-none";

export function ForDevelopers({
  id = "developers",
  repoUrl = DEFAULT_REPO_URL,
  branch = DEFAULT_BRANCH,
}: ForDevelopersProps) {
  const base = repoUrl.replace(/\/+$/, "").replace(/\.git$/, "");
  const fileHref = (path: string): string => `${base}/blob/${branch}/${path}`;

  // No `useMemo`: this renders once, on the server. Memoising a pure call across a render that never
  // repeats costs a hook and buys nothing.
  const lines = quickstartLines(base);

  const headingId = `${id}-h`;
  const railId = `${id}-rail`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="section tex-hatch relative"
    >
      <div className="container">
        {/* LUXURY RULE #5 (§1.1): the space below the heading block is one third of the space above. */}
        <div className="heading-gap">
          <p className="t-label">For developers</p>
          <h2 id={headingId} className="t-h2 mt-[var(--space-4)]">
            Open source. The whole pipeline is in the repo.
          </h2>
          <p className="t-lead mt-[var(--space-5)]">
            Five files carry an edit from a sentence to a frame. HITE&rsquo;s own source is MIT
            &mdash; <strong className="t-strong">the render engine underneath it is not</strong>, and
            that is stated here rather than buried in a footer.
          </p>
        </div>

        {/* ── THE PATH ─────────────────────────────────────────────────────── */}
        <h3 id={railId} className="t-label">
          The path an edit takes
        </h3>
        <ol
          aria-labelledby={railId}
          className="mt-[var(--space-5)] grid grid-cols-1 gap-[var(--space-7)] sm:grid-cols-2 lg:grid-cols-5 lg:gap-[var(--space-5)]"
        >
          {PIPELINE.map((node, index) => (
            <li
              key={node.path}
              className={`relative${index === PIPELINE.length - 1 ? " sm:col-span-2 lg:col-span-1" : ""}`}
            >
              <a
                href={fileHref(node.path)}
                target="_blank"
                rel="noreferrer"
                className="shadow-[var(--ring-hair)] r-sm group block h-full bg-[var(--s-1)] p-[var(--space-5)] transition-colors duration-[var(--d-tap)] ease-[var(--ease-apple)] hover:bg-[var(--s-2)] motion-reduce:transition-none"
              >
                <span className="t-label flex items-center justify-between gap-[var(--space-2)]">
                  <span>
                    {node.step} &middot; {node.stage}
                  </span>
                  <ArrowOut className="text-[var(--t-4)] transition-colors duration-[var(--d-tap)] group-hover:text-[var(--color-accent)] motion-reduce:transition-none" />
                </span>
                <span className="t-code mt-[var(--space-3)] block break-words">
                  {node.path
                    .split("/")
                    .flatMap((segment, i, all) =>
                      i < all.length - 1 ? [`${segment}/`, <wbr key={i} />] : [segment],
                    )}
                </span>
                <span className="mt-[var(--space-3)] block text-[length:var(--fs-sm)] leading-[1.5] text-[var(--t-3)]">
                  {node.role}
                </span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {index < PIPELINE.length - 1 ? <Connector /> : null}
            </li>
          ))}
        </ol>

        {/* ── WHERE TO CHECK IT (§7.3 — every number is generated) ──────────── */}
        <p className="mt-[var(--space-6)] flex flex-wrap items-baseline gap-x-[var(--space-4)] gap-y-[var(--space-2)]">
          <span className="t-label">Generated</span>
          <span className="text-[length:var(--fs-sm)] leading-[1.5] text-[var(--t-3)]">
            The timeline this page draws is {MECHANISM_HEADLINE.commandCount} EditCommands reduced
            to a {MECHANISM_HEADLINE.clipCount}-clip, {MECHANISM_HEADLINE.timecode} cut &mdash; a
            recorded example, produced by the reducer above, not written by hand.{" "}
            <a
              href={LANDING_FIXTURE_URL}
              className={LINK_CLASS}
            >
              Read the whole reduction
            </a>
            .
          </span>
        </p>

        {/* ── THE DENSE BAND: quickstart · license ──────────────────────────── */}
        <div className="mt-[var(--space-8)] grid grid-cols-1 items-start gap-[var(--space-6)] lg:grid-cols-12">
          {/* QUICKSTART */}
          <div
            className="shadow-[var(--ring-hair)] r-md bg-[var(--s-1)] p-[var(--space-6)] lg:col-span-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-[var(--space-4)]">
              <h3 className="t-label">Run it locally</h3>
              {/* The band's one client island. It takes the SAME `lines` array the <pre> below
                  renders, so what the button copies cannot drift from what the reader sees. */}
              <CopyQuickstart lines={lines} />
            </div>

            <div
              role="group"
              aria-label="Quickstart commands"
              tabIndex={0}
              className="mt-[var(--space-5)] overflow-x-auto"
            >
              <pre className="t-code leading-[1.9] whitespace-pre">
                {lines.map((line) => (
                  <span key={line} className="block">
                    <span aria-hidden="true" className="text-[var(--t-4)] select-none">
                      {"$ "}
                    </span>
                    {line}
                  </span>
                ))}
              </pre>
            </div>

            <p className="mt-[var(--space-5)] text-[length:var(--fs-sm)] leading-[1.5] text-[var(--t-3)]">
              <code className="t-code">.env.example</code> lists every variable real code reads. The
              app needs a Supabase project and a model key before an edit will run.
            </p>
          </div>

          {/* LICENSE */}
          <div
            className="shadow-[var(--ring-hair)] r-md bg-[var(--s-1)] p-[var(--space-6)] lg:col-span-5"
          >
            <h3 className="t-label">License</h3>
            <p className="t-body mt-[var(--space-5)] text-[var(--t-1)]">
              {LICENSE_DISCLOSURE.mit}{" "}
              <a
                href={fileHref("LICENSE")}
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                Read LICENSE
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
            <p className="t-body mt-[var(--space-4)] text-[var(--t-2)]">
              {LICENSE_DISCLOSURE.carveOut}
            </p>
            <p className="t-code mt-[var(--space-4)] text-[var(--t-3)]">
              {LICENSE_DISCLOSURE.footnote}
            </p>
            <p className="mt-[var(--space-4)] text-[length:var(--fs-sm)] leading-[1.5] text-[var(--t-3)]">
              {LICENSE_DISCLOSURE.caveat}{" "}
              <a
                href={REMOTION_LICENSE_URL}
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                remotion.dev/docs/license
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ForDevelopers;

/* ─────────────────────────────────────────────────────────────────────────────
   DECORATION — aria-hidden, per §9.1 ("aria-hidden goes on gradients, rulers and
   decorative layers"). Drawn as SVG rather than as a glyph so the arrow renders
   identically whatever the mono fallback resolves to.
   ───────────────────────────────────────────────────────────────────────────── */

function ArrowOut({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12 12"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="square"
      className={className}
    >
      <path d="M3.5 8.5 8.5 3.5" />
      <path d="M4.25 3.5H8.5V7.75" />
    </svg>
  );
}

/**
 * The join between two stages. It points down while the rail is stacked and right once the rail is
 * five across, so the reading order and the arrow always agree.
 */
function Connector() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-full left-1/2 flex h-[var(--space-7)] w-[var(--space-7)] -translate-x-1/2 items-center justify-center text-[var(--t-4)] sm:hidden lg:flex lg:top-1/2 lg:left-full lg:h-[var(--space-5)] lg:w-[var(--space-5)] lg:translate-x-0 lg:-translate-y-1/2"
    >
      <svg
        viewBox="0 0 12 12"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="square"
        className="rotate-90 lg:rotate-0"
      >
        <path d="M2 6h8" />
        <path d="M6.75 2.75 10 6l-3.25 3.25" />
      </svg>
    </span>
  );
}
