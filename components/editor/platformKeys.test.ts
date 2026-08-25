import { describe, expect, test } from "vitest";
import {
  DEFAULT_MODIFIER_KEYS,
  formatShortcut,
  isApplePlatform,
  modifierKeysFor,
} from "./platformKeys";

/**
 * The bug this closes: every shortcut LABEL in the editor was a hardcoded Apple glyph (⌘K, ⌘⇧Z, ⌫)
 * while every BINDING uses react-hotkeys-hook's `mod`, which resolves to Ctrl on Windows and Linux.
 * On the platform this app was built on, the keyboard reference told users to press keys their
 * keyboard does not have.
 *
 * The property under test is that a label is DERIVED from the binding string, so the two cannot
 * drift, and that it is correct on both platforms.
 */

const apple = modifierKeysFor(true);
const pc = modifierKeysFor(false);

describe("platform detection", () => {
  test("Apple platforms are recognised from every field a browser might fill in", () => {
    expect(isApplePlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "iPhone" })).toBe(true);
    expect(isApplePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe(true);
  });

  test("everything else is not Apple — including the platform this repo is built on", () => {
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform({ userAgentData: { platform: "Windows" } })).toBe(false);
    expect(isApplePlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });

  test("userAgentData wins over the deprecated platform field when both exist", () => {
    expect(isApplePlatform({ userAgentData: { platform: "Windows" }, platform: "MacIntel" })).toBe(false);
  });

  test("the SSR default is the PC set, so server HTML and first client paint agree", () => {
    // Not a preference — a hydration requirement. The server has no platform, so both renders must
    // resolve to ONE value; Apple users get the swap in an effect.
    expect(DEFAULT_MODIFIER_KEYS).toEqual(pc);
  });
});

describe("formatShortcut", () => {
  test("mod becomes the platform's own modifier", () => {
    expect(formatShortcut("mod+k", apple)).toBe("⌘K");
    expect(formatShortcut("mod+k", pc)).toBe("Ctrl+K");
  });

  test("stacked modifiers read as glyphs on Apple and as words elsewhere", () => {
    expect(formatShortcut("mod+shift+z", apple)).toBe("⌘⇧Z");
    expect(formatShortcut("mod+shift+z", pc)).toBe("Ctrl+Shift+Z");
  });

  test("the delete key is ⌫ only where that key is actually labelled ⌫", () => {
    expect(formatShortcut("backspace", apple)).toBe("⌫");
    expect(formatShortcut("backspace", pc)).toBe("Backspace");
    // The editor binds "backspace,delete" together; both spellings must render the same key.
    expect(formatShortcut("delete", pc)).toBe("Backspace");
  });

  test("enter and shift+enter — the chat composer's two hints", () => {
    expect(formatShortcut("enter", apple)).toBe("⏎");
    expect(formatShortcut("enter", pc)).toBe("Enter");
    expect(formatShortcut("shift+enter", pc)).toBe("Shift+Enter");
  });

  test("named non-modifier keys keep a readable spelling on both platforms", () => {
    expect(formatShortcut("space", pc)).toBe("Space");
    expect(formatShortcut("home", apple)).toBe("Home");
    expect(formatShortcut("escape", pc)).toBe("Esc");
  });

  test("the ⌘-number panel bindings render from the same strings the hotkeys use", () => {
    for (let i = 1; i <= 9; i++) {
      expect(formatShortcut(`mod+${i}`, apple)).toBe(`⌘${i}`);
      expect(formatShortcut(`mod+${i}`, pc)).toBe(`Ctrl+${i}`);
    }
  });

  test("an unrecognised segment is passed through rather than dropped", () => {
    // Silently dropping a segment would print a shortcut that is missing a key — worse than an
    // ugly one, because it looks correct.
    expect(formatShortcut("mod+\\", pc)).toBe("Ctrl+\\");
    expect(formatShortcut("mod+e", apple)).toBe("⌘E");
  });
});
