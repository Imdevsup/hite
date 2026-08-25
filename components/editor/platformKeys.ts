"use client";
import { useSyncExternalStore } from "react";

/**
 * PLATFORM KEY LABELS — say the key the user actually has to press.
 *
 * Every shortcut in the editor is bound with react-hotkeys-hook's `mod`, which resolves to ⌘ on
 * Apple and Ctrl everywhere else. Every LABEL was hardcoded to the Apple glyphs (`⌘K`, `⌘⇧Z`,
 * `⌫`), so on Windows and Linux — where this app is most used, and where it was built — the entire
 * keyboard model told the user to press a key their keyboard does not have. The binding was right;
 * only the sign above it was wrong.
 *
 * `formatShortcut` is pure and takes the platform explicitly so it is testable without a browser;
 * `useModifierKeys` is the SSR-safe hook every component should use.
 */

/** The glyph set for one platform. */
export interface ModifierKeys {
  /** `mod` — ⌘ on Apple, Ctrl elsewhere. */
  readonly mod: string;
  readonly shift: string;
  readonly alt: string;
  readonly enter: string;
  readonly backspace: string;
  /** Joins modifiers to the key. Apple stacks glyphs (⌘⇧Z); PC keyboards read as Ctrl+Shift+Z. */
  readonly join: string;
}

const APPLE_KEYS: ModifierKeys = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  enter: "⏎",
  backspace: "⌫",
  join: "",
};

const PC_KEYS: ModifierKeys = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  enter: "Enter",
  backspace: "Backspace",
  join: "+",
};

/**
 * The SSR + first-client-paint answer. PC, deliberately: the server has no platform, so both
 * renders must agree on ONE value, and Apple is the minority of web sessions. Apple users get the
 * correct glyphs one tick after mount (see `useModifierKeys`), which is a swap, never a mismatch.
 */
export const DEFAULT_MODIFIER_KEYS: ModifierKeys = PC_KEYS;

/** Just the fields of `navigator` this module reads, so no `any` is needed to look at them. */
interface PlatformSource {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
}

/**
 * Is this an Apple keyboard layout? `navigator.platform` is deprecated but is still the only field
 * every current browser fills in with something usable ("MacIntel", "iPhone"); `userAgentData` is
 * checked first where it exists, and the UA string is the last resort.
 */
export function isApplePlatform(nav: PlatformSource | undefined): boolean {
  if (!nav) return false;
  const hint = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? "";
  return /mac|iphone|ipad|ipod/i.test(hint);
}

/** The glyph set for a platform. Pure — the whole point is that it can be tested both ways. */
export function modifierKeysFor(apple: boolean): ModifierKeys {
  return apple ? APPLE_KEYS : PC_KEYS;
}

/**
 * Render a react-hotkeys-hook binding string as a label.
 *
 * Takes the SAME string the hotkey is bound with (`"mod+shift+z"`), so a label cannot drift from
 * its binding by being retyped. Unknown segments are upper-cased as-is.
 */
export function formatShortcut(binding: string, keys: ModifierKeys): string {
  const parts = binding
    .split("+")
    .map((raw) => raw.trim().toLowerCase())
    .filter(Boolean)
    .map((segment) => {
      switch (segment) {
        case "mod":
          return keys.mod;
        case "shift":
          return keys.shift;
        case "alt":
        case "option":
          return keys.alt;
        case "enter":
        case "return":
          return keys.enter;
        case "backspace":
        case "delete":
          return keys.backspace;
        case "escape":
        case "esc":
          return "Esc";
        case "space":
          return "Space";
        case "home":
          return "Home";
        default:
          return segment.length === 1 ? segment.toUpperCase() : segment[0].toUpperCase() + segment.slice(1);
      }
    });
  return parts.join(keys.join);
}

/**
 * The platform's glyph set, SSR-safe.
 *
 * `useSyncExternalStore` rather than an effect + setState, because the platform IS an external,
 * never-changing store: the server snapshot is `DEFAULT_MODIFIER_KEYS` (so server HTML and the first
 * client paint are identical), the client snapshot is the real answer, and React reconciles the two
 * without a cascading render. Nothing here is layout-affecting, so the swap is a one-character
 * repaint, not a shift.
 */
const NEVER_CHANGES = () => () => {};
const clientSnapshot = (): ModifierKeys =>
  modifierKeysFor(isApplePlatform(typeof navigator === "undefined" ? undefined : navigator));
const serverSnapshot = (): ModifierKeys => DEFAULT_MODIFIER_KEYS;

export function useModifierKeys(): ModifierKeys {
  return useSyncExternalStore(NEVER_CHANGES, clientSnapshot, serverSnapshot);
}
