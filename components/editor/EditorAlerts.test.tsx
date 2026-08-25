import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AlertBanner, EditorAlerts, describeEditorProblem } from "./EditorAlerts";

/**
 * The store has carried honest failure state for a while — `edlLoadError`, `saveState`/`saveError`,
 * `commandError`. What it did not have was a reader:
 *
 *   · `edlLoadError` was rendered NOWHERE, and it is the worst of the three — it means autosave is
 *     switched off and the timeline on screen is not the one on file.
 *   · the other two appeared as a truncated 10px mono fragment in a 28px status strip, reading
 *     "REFUSED" followed by a reducer sentence about ticks.
 *
 * Two properties: the precedence is right (a symptom never hides its cause), and the leading
 * sentence is about the user's work rather than about the machine.
 */

const base = {
  edlLoadError: null,
  saveState: "saved" as const,
  saveError: null,
  uploadError: null,
  commandError: null,
};

describe("precedence", () => {
  test("nothing wrong → no alert at all", () => {
    expect(describeEditorProblem(base)).toBeNull();
  });

  test("a failed LOAD outranks everything, because it is why the others are happening", () => {
    // hydrateProject sets saveState:'error' whenever edlLoadError is set (autosave is blocked), so
    // these two are ALWAYS both true together. Reporting "not saved" would describe the symptom and
    // hide the cause.
    const problem = describeEditorProblem({
      ...base,
      edlLoadError: "couldn't load your last saved edit (v7)",
      saveState: "error",
      saveError: "not saving — couldn't load your last saved edit (v7)",
      commandError: "trim_collapses_clip",
    });
    expect(problem?.kind).toBe("load");
    expect(problem?.tone).toBe("blocking");
  });

  test("a failed SAVE outranks a refused command", () => {
    const problem = describeEditorProblem({
      ...base,
      saveState: "error",
      saveError: "HTTP 503",
      commandError: "clip c0 already ends at its media's last tick",
    });
    expect(problem?.kind).toBe("save");
  });

  /**
   * The regression this case exists for: `useMediaUpload.error` had exactly ONE reader, `EmptyState`,
   * which `EditorFrame` unmounts as soon as an EDL exists. So every file refused or failed by a drop
   * onto the working screen wrote a sentence that nothing on the page rendered — the drop looked
   * ignored rather than failed.
   */
  test("a failed upload is reported, and outranks a refused command", () => {
    const problem = describeEditorProblem({
      ...base,
      uploadError: "clip.mov is 210 MB — the limit is 50 MB.",
      commandError: "trim_collapses_clip",
    });
    expect(problem?.kind).toBe("upload");
    expect(problem?.detail).toContain("clip.mov");
  });

  test("a failed upload does NOT outrank a storage failure — that one risks work already made", () => {
    const problem = describeEditorProblem({
      ...base,
      saveState: "error",
      saveError: "HTTP 503",
      uploadError: "clip.mov is 210 MB — the limit is 50 MB.",
    });
    expect(problem?.kind).toBe("save");
  });

  test("an upload failure says the timeline is untouched, because it is", () => {
    const problem = describeEditorProblem({ ...base, uploadError: "take.avi — HITE can't read that format." });
    expect(problem?.tone).toBe("warning");
    expect(problem?.advice).toMatch(/untouched/i);
  });

  test("a refused command alone is a warning, not a blocker — the timeline is intact", () => {
    const problem = describeEditorProblem({ ...base, commandError: "trim_collapses_clip" });
    expect(problem?.kind).toBe("command");
    expect(problem?.tone).toBe("warning");
  });

  test("'saving' is not a failure", () => {
    expect(describeEditorProblem({ ...base, saveState: "saving" })).toBeNull();
  });
});

/** One of each, described once and reused by both the copy checks and the render checks. */
const cases = [
  describeEditorProblem({ ...base, edlLoadError: "couldn't load your last saved edit (v7)" }),
  describeEditorProblem({ ...base, saveState: "error", saveError: "HTTP 503" }),
  describeEditorProblem({ ...base, commandError: "trim_collapses_clip" }),
];

describe("the words", () => {
  test("every headline is a plain sentence about the user's work", () => {
    for (const problem of cases) {
      expect(problem).not.toBeNull();
      expect(problem!.headline).toMatch(/^[A-Z].*\.$/);
      // No identifiers, no snake_case, no HTTP codes in the sentence a person reads first.
      expect(problem!.headline).not.toMatch(/_|HTTP|edl|null|undefined/i);
    }
  });

  test("every alert says what to do next", () => {
    for (const problem of cases) {
      expect(problem!.advice.length).toBeGreaterThan(20);
    }
  });

  test("the machine's own message is KEPT as detail, not deleted", () => {
    // It is the only thing worth pasting into a bug report; hiding it would trade one dishonesty
    // for another. It is simply no longer the whole explanation.
    expect(cases[0]!.detail).toBe("couldn't load your last saved edit (v7)");
    expect(cases[1]!.detail).toBe("HTTP 503");
    expect(cases[2]!.detail).toBe("trim_collapses_clip");
  });

  test("a save failure warns against asking the AI for more, because it would plan from the old cut", () => {
    expect(cases[1]!.advice).toMatch(/older version/i);
  });
});

describe("rendered output", () => {
  test("a healthy editor renders nothing at all", () => {
    // The store's own default state IS the healthy one, which is also what a server render sees.
    expect(renderToStaticMarkup(<EditorAlerts />)).toBe("");
    expect(describeEditorProblem({ ...base })).toBeNull();
  });

  test("a blocking failure is an alert carrying the sentence, the advice and the detail", () => {
    const html = renderToStaticMarkup(<AlertBanner problem={cases[0]!} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("HITE couldn&#x27;t open your last saved version of this project.");
    expect(html).toContain("Reload the page to try again.");
    expect(html).toContain("couldn&#x27;t load your last saved edit (v7)");
  });

  test("none of the three alerts renders the old status-bar shorthand", () => {
    for (const problem of cases) {
      const html = renderToStaticMarkup(<AlertBanner problem={problem!} />);
      expect(html).not.toContain("REFUSED");
      expect(html).not.toContain("NOT SAVED");
      expect(html).toContain('role="alert"');
    }
  });
});
