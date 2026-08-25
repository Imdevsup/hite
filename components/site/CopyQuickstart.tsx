"use client";

/**
 * components/site/CopyQuickstart.tsx — the only interactive control in §6.5's developer band.
 *
 * WHY IT IS ITS OWN FILE (DESIGN-DIRECTION §12). `ForDevelopers.tsx` carried `"use client"` for this
 * one button, which put all 490 lines of it — the five-node pipeline rail, the quickstart, the whole
 * license carve-out — into the landing's client bundle. Source-map attribution of
 * `.next/static/chunks/app/page-*.js` measured that at **2.1KB gzipped** to ship one `writeText`
 * call. The directive lives here now; `ForDevelopers.tsx` is a Server Component and ships nothing.
 *
 * THE STATUS REGION MOVED IN WITH THE BUTTON, ON PURPOSE. `copyState` drives both the label and the
 * `role="status"` text, so keeping them in one component keeps one owner for one piece of state — an
 * `aria-live` region works from anywhere in the document, so its DOM position was never load-bearing.
 *
 * IMPORTS NOTHING BUT REACT. Not `cn` — that would pull tailwind-merge's 6.5KB into the client graph
 * to merge two static strings that never conflict.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Copy failed",
};

const COPY_STATUS: Record<CopyState, string> = {
  idle: "",
  copied: "Quickstart commands copied to the clipboard.",
  failed: "Could not reach the clipboard. Select the commands and copy them manually.",
};

/**
 * Same unlayered-reset problem the rest of the band documents, one element further: globals.css
 * resets `button { font-family: inherit; border: none; background: none; color: inherit; padding: 0 }`
 * outside any cascade layer, which silently eats `.t-label`'s font, the padding and the hover fill —
 * measured, the button collapsed to a 32px box with the label spilling out of it. Rather than five
 * `!important`s, everything visual lives on a child `<span>`, which the `button` selector cannot
 * reach. The `<button>` keeps only the semantics and the focus ring.
 */
const FACE_CLASS =
  "t-label r-xs flex min-h-[44px] min-w-[44px] items-center justify-center px-[var(--space-4)] " +
  "text-[var(--t-2)] shadow-[0_0_0_1px_var(--line-5)] transition-colors duration-[var(--d-tap)] " +
  "ease-[var(--ease-apple)] group-hover:bg-[var(--s-2)] group-hover:text-[var(--t-1)] " +
  "motion-reduce:transition-none";

export interface CopyQuickstartProps {
  /** The exact commands the `<pre>` beside this button renders. Copied verbatim, newline-joined. */
  lines: readonly string[];
}

export function CopyQuickstart({ lines }: CopyQuickstartProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  const flashCopyState = useCallback((next: CopyState) => {
    setCopyState(next);
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2400);
  }, []);

  // The clipboard is unavailable over plain HTTP and can be denied by permission policy. Both are
  // reported to the visitor rather than swallowed — a copy button that silently does nothing is
  // worse than no button.
  const copyQuickstart = useCallback(() => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) {
      flashCopyState("failed");
      return;
    }
    clipboard.writeText(lines.join("\n")).then(
      () => flashCopyState("copied"),
      () => flashCopyState("failed"),
    );
  }, [lines, flashCopyState]);

  return (
    <>
      <button type="button" onClick={copyQuickstart} className="group inline-flex">
        <span className={FACE_CLASS}>{COPY_LABEL[copyState]}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {COPY_STATUS[copyState]}
      </span>
    </>
  );
}
