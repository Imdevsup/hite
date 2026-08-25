"use client";
import { useShallow } from "zustand/react/shallow";
import { useEditor } from "@/lib/editor/store";
import { useMediaUpload } from "@/components/editor/mediaUpload";
import type { PersistStatus } from "@/lib/persist/debounce";

/**
 * EDITOR ALERTS — the three ways an edit can fail to stick, said in English.
 *
 * The store already carries all of this honestly (`edlLoadError`, `saveState`/`saveError`,
 * `commandError`). What it did not have was a reader. `edlLoadError` — the worst of the three,
 * because it means autosave is switched off and the timeline on screen is NOT the one on file — was
 * rendered nowhere at all. The other two were a truncated 10px mono fragment in a 28px status strip
 * that said "REFUSED" and then a reducer sentence about tick counts.
 *
 * Every string below leads with what happened to the USER'S work and what to do about it. The
 * machine's own words are kept as secondary detail rather than deleted: they are the only thing
 * worth pasting into a bug report, and hiding them would trade one dishonesty for another.
 */

export type AlertTone = "blocking" | "warning";

export interface EditorProblem {
  /** Which failure this is. Drives the glyph, and lets a test assert the precedence rule by name. */
  readonly kind: "load" | "save" | "upload" | "command";
  readonly tone: AlertTone;
  /** What happened, in one sentence, about the user's work. */
  readonly headline: string;
  /** What to do now. */
  readonly advice: string;
  /** The system's verbatim message, shown small. Null when there is nothing more to say. */
  readonly detail: string | null;
}

interface ProblemInput {
  readonly edlLoadError: string | null;
  readonly saveState: PersistStatus;
  readonly saveError: string | null;
  /** Files refused or failed in the last drop/pick, from `useMediaUpload`. */
  readonly uploadError: string | null;
  readonly commandError: string | null;
}

/**
 * The one problem worth interrupting for, most severe first.
 *
 * Order is not cosmetic. A failed LOAD means every later save is disabled, so reporting a "not
 * saved" warning on top of it would describe a symptom while hiding its cause. A refused command is
 * last because the timeline is intact and the next successful edit clears it.
 *
 * UPLOAD sits between save and command: the work already on the timeline is safe, so it is not as
 * grave as either storage failure, but a file that never arrived is more than a refused edit — the
 * user is waiting on something that is never coming. Before this case existed, `useMediaUpload.error`
 * had exactly one reader, `EmptyState`, which is unmounted as soon as an EDL exists; every failed
 * drop onto the working screen therefore wrote a sentence nothing rendered.
 */
export function describeEditorProblem(state: ProblemInput): EditorProblem | null {
  if (state.edlLoadError) {
    return {
      kind: "load",
      tone: "blocking",
      headline: "HITE couldn't open your last saved version of this project.",
      advice:
        "Nothing has been overwritten — saving is switched off until this is resolved, so your old version is safe. Reload the page to try again.",
      detail: state.edlLoadError,
    };
  }
  if (state.saveState === "error") {
    return {
      kind: "save",
      tone: "blocking",
      headline: "Your recent changes aren't saved.",
      advice:
        "They're still on screen and HITE keeps retrying, but don't close this tab yet — and don't ask for a new edit, because HITE would plan from the older version.",
      detail: state.saveError,
    };
  }
  if (state.uploadError) {
    return {
      kind: "upload",
      tone: "warning",
      headline: "Some files weren't added.",
      advice:
        "Your timeline is untouched. Drop them again, or convert them first if HITE named the format as the reason.",
      detail: state.uploadError,
    };
  }
  if (state.commandError) {
    return {
      kind: "command",
      tone: "warning",
      headline: "That change wasn't made.",
      advice: "The timeline is exactly as it was. Try a different value, or ask for it in chat.",
      detail: state.commandError,
    };
  }
  return null;
}

/**
 * §10's drawing rule, applied: "Every icon on the landing and in the editor is built from straight
 * strokes at 1.6px with square caps and mitered joins, on a 24-unit grid. No rounded caps anywhere.
 * No filled icons. NO ICON LIBRARY."
 *
 * These three were `lucide-react`'s FileWarning, CloudOff and AlertTriangle — rounded caps, a library
 * import, and three glyphs that all mean "something is wrong". One mark for all three states is also
 * more honest than three: the SENTENCE says which failure it is, and a glyph that tries to say it too
 * only competes with the words.
 */
const ALERT_PATHS: Record<EditorProblem["kind"], string> = {
  // A bar and a dot, on the 24-unit grid — the one shape the property uses to mean "read this".
  load: "M12 4 L12 14 M12 18 L12 19",
  save: "M12 4 L12 14 M12 18 L12 19",
  upload: "M12 4 L12 14 M12 18 L12 19",
  command: "M12 4 L12 14 M12 18 L12 19",
};

/**
 * The store wiring. All the judgement is in `describeEditorProblem`; all the markup is in
 * `AlertBanner`. Split so both halves are testable without a browser — a zustand-driven component
 * server-renders from the store's INITIAL state, so a test can only see what it passes in.
 */
export function EditorAlerts() {
  // Two stores, one banner. The alternative — a second banner owned by the upload store — would put
  // two `position: fixed` panels at the same coordinates, and the whole point of this component is
  // that there is ONE place a failure is reported.
  const uploadError = useMediaUpload((s) => s.error);
  const problem = useEditor(
    useShallow((s) => ({
      edlLoadError: s.edlLoadError,
      saveState: s.saveState,
      saveError: s.saveError,
      commandError: s.commandError,
    })),
  );

  const described = describeEditorProblem({ ...problem, uploadError });
  if (!described) return null;
  return <AlertBanner problem={described} />;
}

/**
 * ONE ALERT, PINNED UNDER THE CHROME. Deliberately not a toast: `saveState: "error"` and
 * `edlLoadError` are CONDITIONS, not events — they persist until fixed, and a toast that has already
 * faded cannot tell you that your work still isn't saved. The editor mounts no `Toaster` at all now,
 * so this is the ONE place a failure is reported, which is why it is a banner and why it holds.
 *
 * It sits at the TOP rather than above the timeline: the bottom of the screen is the composer and the
 * clip row, and a banner over either of them would cover the two controls the user needs in order to
 * do anything about what it says.
 */
export function AlertBanner({ problem }: { problem: EditorProblem }) {
  const blocking = problem.tone === "blocking";

  return (
    <div
      role="alert"
      data-arrive
      className="pointer-events-none fixed inset-x-0 top-[var(--nav-h)] z-[70] flex justify-center px-[var(--space-4)]"
    >
      <div
        className="pointer-events-auto flex max-w-[62ch] items-start gap-[var(--space-3)] rounded-[var(--r-md)] px-[var(--space-4)] py-[var(--space-3)]"
        style={{
          background: "var(--s-panel)",
          boxShadow: `var(--specular), 0 0 0 1px ${blocking ? "var(--color-hit)" : "var(--color-warning)"}, var(--shadow-lift)`,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="square"
          strokeLinejoin="miter"
          aria-hidden
          className="mt-px shrink-0"
          style={{ color: blocking ? "var(--color-hit)" : "var(--color-warning)" }}
        >
          <path d={ALERT_PATHS[problem.kind]} />
        </svg>
        <div className="min-w-0">
          <p className="text-[13px] leading-snug text-[var(--t-1)]">{problem.headline}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--t-3)]">{problem.advice}</p>
          {problem.detail && (
            <p className="mt-1.5 truncate font-mono text-[12px] leading-relaxed text-[var(--t-4)]" title={problem.detail}>
              {problem.detail}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
