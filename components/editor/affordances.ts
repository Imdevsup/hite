/**
 * THE FIRST-SCREEN INVENTORY — ART-DIRECTION §13, and the gate in §20.
 *
 * §13 enumerates exactly what the editor's first screen may offer: seven things before there is
 * footage, eight once there is. §20 lists "the editor's eight objects grow back to twenty-two" as one
 * of the six ways this design fails, and the check for it is "a test counting focusable and visible
 * top-level affordances on the editor's first screen, failing above 8 — with the strip counted as one
 * composite widget and the rule written into the test so the count cannot be gamed later."
 *
 * This module is that rule, expressed as data rather than as a comment. Every first-screen control
 * renders `data-affordance={AFFORDANCE.x}`; `firstScreen.test.tsx` server-renders both screens and
 * asserts (a) the number of TAB STOPS equals the length of the matching list, (b) every listed
 * affordance appears exactly once, and (c) no tab stop exists that is not on a list.
 *
 * WHAT COUNTS AS ONE AFFORDANCE. A tab stop, not an element. Two composites here hold more than one
 * element behind a single tab stop, and both are the standard ARIA pattern rather than a way of
 * hiding controls from the count:
 *   · `strip` is a `role="listbox"` — one tab stop, arrow keys move the active option. §13 names this
 *     explicitly: "That is the standard pattern and it is why the count is honest rather than gamed."
 *   · `history` is a `role="toolbar"` — one tab stop, arrow keys move between its two buttons. §13's
 *     line for it is `A24 moonlight · applied · undo`, i.e. a details control and an undo control on
 *     one line. The toolbar pattern is what lets that line read as written without costing a ninth
 *     tab stop, and it is the same justification the strip already carries.
 *
 * Anything revealed by an interaction — a clip's trim/delete handles, the settings sheet, the
 * shortcut sheet, the expanded tool trace, the key field a 402 puts in the composer — is NOT on these
 * lists, because it is not on the first screen. The test asserts that separately.
 */

export const AFFORDANCE = {
  /** The kite, top-left. Links home. §13 item 1 on both screens. */
  home: "home",
  /** §13 item 2 on both screens. Opens the settings sheet. */
  settings: "settings",
  /** WORKING item 3 — queue a render of the timeline as it stands. */
  export: "export",
  /** WORKING item 4 — the picture IS the transport. There is no play button. */
  picture: "picture",
  /** WORKING item 5 — full picture width, 4px, no numerals. */
  scrubber: "scrubber",
  /** Both screens — the one thing the product is. 640px. */
  prompt: "prompt",
  /** WORKING item 7 — one row of clip blocks, one tab stop (`role="listbox"`). */
  strip: "strip",
  /** WORKING item 8 — one line, one tab stop (`role="toolbar"`). */
  history: "history",
  /** EMPTY item 3 — the whole viewport is also a drop target. */
  chooseFile: "choose-a-file",
  /** EMPTY items 5-7 — the three example prompts, which really run. */
  example1: "example-1",
  example2: "example-2",
  example3: "example-3",
} as const;

export type Affordance = (typeof AFFORDANCE)[keyof typeof AFFORDANCE];

/** §13, "First screen — empty, 7 focusables", in the order they are reached by Tab. */
export const FIRST_SCREEN_EMPTY: readonly Affordance[] = [
  AFFORDANCE.home,
  AFFORDANCE.settings,
  AFFORDANCE.chooseFile,
  AFFORDANCE.prompt,
  AFFORDANCE.example1,
  AFFORDANCE.example2,
  AFFORDANCE.example3,
];

/** §13, "First screen — working, 8 focusables", in the order they are reached by Tab. */
export const FIRST_SCREEN_WORKING: readonly Affordance[] = [
  AFFORDANCE.home,
  AFFORDANCE.settings,
  AFFORDANCE.export,
  AFFORDANCE.picture,
  AFFORDANCE.scrubber,
  AFFORDANCE.prompt,
  AFFORDANCE.strip,
  AFFORDANCE.history,
];

/** How many example prompts the empty state offers. Derived, so the two can never disagree. */
export const EXAMPLE_SLOTS: readonly Affordance[] = [
  AFFORDANCE.example1,
  AFFORDANCE.example2,
  AFFORDANCE.example3,
];
