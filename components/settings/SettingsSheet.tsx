"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./settings.module.css";
import { DataFlow } from "./DataFlow";
import { ProviderPickerPanel } from "./ProviderPickerPanel";

/**
 * THE SETTINGS SHEET — the component the editor mounts. §14.
 *
 * "So the UI is net-new and the contract is not. The sheet renders `GET /api/settings` and invents
 * nothing." That sentence is the whole contract, and it is why this file no longer holds a fetch, a
 * snapshot or a rung.
 *
 * WHAT CHANGED, AND WHY IT IS A CORRECTION RATHER THAN A REDESIGN. The sheet used to render
 * `SettingsPanel` — a single-provider view over a Gemini-only body with a pool, a payer and a
 * ceiling. The route stopped answering in that shape when the app went BYOK-only and
 * registry-driven, so `parseSettingsSnapshot` returned `null` for every real response and this
 * dialog rendered nothing but "settings this build understands". On a build whose ONLY credential
 * path is the visitor's own key, a sheet that cannot accept one is the whole product broken, and it
 * was invisible because the surface that CAN read the new body — `ProviderPickerPanel`, complete,
 * tested, and reading `lib/ai/providers/registry.ts` directly — was never mounted by any route.
 *
 * §14 is honoured by mounting it rather than by keeping the older panel: §14.1's "one key, not a
 * stack of chips" is about KEY ROTATION (`byokFetch`: "NO ROTATION … there is no next key here"),
 * which the picker also declines — it holds exactly one credential and clears it when the provider
 * changes. What §14 forbids is a UI that advertises a capability the code declines; a Gemini-only
 * field over an eight-provider resolver is the mirror of that, and it would refuse a capability the
 * code offers.
 *
 * The sheet is deliberately controlled (`open` / `onClose`). The editor owns its one Settings
 * affordance — it is focusable #2 of the eight §13 allows on the first screen — and a component
 * that opened itself would be a ninth. Both children own their own read, so nothing is cached
 * across opens: the answer depends on the key this tab is currently holding.
 */

export interface SettingsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Excludes `tabindex="-1"`, so a roving tab stop counts once rather than four times and the Tab
 *  wrap lands on a node Tab can actually reach. */
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"])';

/** The portal needs `document`, which the server render does not have. `useSyncExternalStore` is the
 *  supported way to say "client only" without a state write in an effect: the server snapshot is
 *  `false`, the client snapshot is `true`, and nothing ever changes so the subscriber is inert. */
const NEVER_CHANGES = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const mounted = useSyncExternalStore(NEVER_CHANGES, onClient, onServer);
  const sheetRef = useRef<HTMLDivElement>(null);

  /** Focus moves into the sheet on open and returns to whatever opened it on close (WCAG 2.4.3). */
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    return () => opener?.focus();
  }, [open]);

  /**
   * Escape closes; Tab cycles inside the sheet. A dialog that lets focus walk out into an editor it
   * is covering is a keyboard trap in the other direction — the user can still reach controls they
   * cannot see.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = sheetRef.current;
      if (root === null) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hite-settings-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={styles.head}>
          <h2 className={styles.title} id="hite-settings-title">
            Settings
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close settings">
            {/* §10's drawing rule: straight strokes, 1.6px, square caps, mitered joins, no icon library. */}
            <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
              <path d="M3 3 L13 13" />
              <path d="M13 3 L3 13" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {/* §14.1 + §14.2 — the provider, the one credential, the model and the rung. It owns its
              own read of the route and its own designed states for a route that will not answer, so
              the sheet holds no snapshot to get wrong. */}
          <ProviderPickerPanel />
          <DataFlow />
        </div>
      </div>
    </div>,
    document.body,
  );
}
