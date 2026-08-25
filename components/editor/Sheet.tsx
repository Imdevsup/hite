"use client";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * THE ONE SHEET — the editor's only overlay, and the only thing in it that is shared.
 *
 * Two surfaces open over the editor: Settings (§14) and the `?` shortcut sheet (§13, "Shortcuts live
 * in the `?` sheet, which the user opens"). They are different content with identical behaviour —
 * a plane above the editor at `--s-panel`, Escape closes, the backdrop closes, focus moves in on open
 * and back to whatever opened it on close — so the behaviour is written once. Eleven floating windows
 * each reimplementing their own chrome is what §13 deleted; two dialogs sharing one is the opposite
 * mistake to avoid making.
 *
 * FOCUS IS RETURNED, NOT DROPPED. `document.activeElement` at open time is where focus goes back to,
 * because a dialog that closes onto `<body>` sends a keyboard user to the top of the document — which
 * on this screen means starting the Tab order again from the kite.
 *
 * AND IT IS KEPT INSIDE. `aria-modal="true"` is a PROMISE to assistive technology that nothing behind
 * the dialog is reachable; without a Tab wrap it is a promise the DOM does not keep, and a keyboard
 * user tabs out of a "modal" into an editor they cannot see. The wrap excludes `tabindex="-1"` so a
 * roving group inside the sheet counts once rather than once per member.
 */
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), [tabindex="0"]';

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && (active === last || active === panel)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex justify-end">
      {/* LAW 2: every scrim on the property is the ground colour, never pure black. */}
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: "var(--s-scrim)" }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-arrive
        className="relative flex h-full w-[520px] max-w-full flex-col gap-[var(--space-5)] overflow-y-auto p-[var(--space-6)] outline-none"
        style={{ background: "var(--s-panel)", boxShadow: "var(--specular), -1px 0 0 var(--line-3)" }}
      >
        <div className="flex items-start justify-between gap-[var(--space-4)]">
          <h2 className="text-[19px] font-medium text-[var(--t-1)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="-mr-[var(--space-2)] -mt-[var(--space-2)] flex h-[var(--tap)] w-[var(--tap)] items-center justify-center rounded-[var(--r-sm)] text-[var(--t-3)]"
          >
            {/* §10's drawing rule: straight strokes, square caps, mitered joins, 1.6px, 24-unit grid. */}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
              <path d="M5 5 L19 19" />
              <path d="M19 5 L5 19" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
