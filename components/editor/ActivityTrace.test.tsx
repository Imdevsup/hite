import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActivityTrace,
  applyActivityEvent,
  formatElapsed,
  humanizeToolName,
  summarizeToolResult,
  type ActivityStep,
} from "./ActivityTrace";

/**
 * The plan wait was a black box: 10–60 seconds of three bouncing dots while `/api/plan` streamed
 * `tool-call` / `tool-result` events that `ChatWindow` parsed and discarded.
 *
 * These tests pin the two things that make showing them SAFE rather than just prettier:
 *   1. ordering — a planner may call the same tool twice in one turn, and the wrong match leaves a
 *      row spinning forever;
 *   2. honesty — a summary line may only ever state something the tool's own result proves.
 * Plus §5.6: the running label is legible with the animation switched off.
 */

const call = (name: string) => ({ type: "tool-call", name }) as const;
const result = (name: string, value: unknown) => ({ type: "tool-result", name, result: value }) as const;

describe("applyActivityEvent", () => {
  test("a call opens a running step and a result closes it", () => {
    let steps: ActivityStep[] = [];
    steps = applyActivityEvent(steps, call("findSilences"));
    expect(steps).toHaveLength(1);
    expect(steps[0].state).toBe("running");

    steps = applyActivityEvent(steps, result("findSilences", { silences: [1, 2, 3] }));
    expect(steps[0].state).toBe("done");
    expect(steps[0].note).toBe("3 silences");
  });

  test("the SAME tool called twice closes the OLDEST open step first", () => {
    // The real case: two assets, or two queries. Matching on name alone ticks whichever row the
    // find happens to hit; matching newest-first strands the first call as a permanent spinner.
    let steps: ActivityStep[] = [];
    steps = applyActivityEvent(steps, call("searchRegistry"));
    steps = applyActivityEvent(steps, call("searchRegistry"));
    steps = applyActivityEvent(steps, result("searchRegistry", { entries: [1] }));

    expect(steps.map((s) => s.state)).toEqual(["done", "running"]);
    expect(steps[0].note).toBe("1 entries");

    steps = applyActivityEvent(steps, result("searchRegistry", { entries: [1, 2] }));
    expect(steps.map((s) => s.state)).toEqual(["done", "done"]);
    expect(steps[1].note).toBe("2 entries");
  });

  test("every step gets a distinct React key even when the tool name repeats", () => {
    let steps: ActivityStep[] = [];
    steps = applyActivityEvent(steps, call("findSilences"));
    steps = applyActivityEvent(steps, call("findSilences"));
    expect(new Set(steps.map((s) => s.id)).size).toBe(2);
  });

  test("a result with no matching call is recorded as done, not discarded", () => {
    // A dropped stream part must not erase evidence of work that demonstrably happened.
    const steps = applyActivityEvent([], result("analyzeTranscript", { segments: [1, 2] }));
    expect(steps).toHaveLength(1);
    expect(steps[0].state).toBe("done");
    expect(steps[0].note).toBe("2 segments");
  });

  test("the input list is never mutated", () => {
    const before: ActivityStep[] = [{ id: "a:0", name: "findSilences", state: "running", note: null }];
    const after = applyActivityEvent(before, result("findSilences", null));
    expect(before[0].state).toBe("running");
    expect(after[0].state).toBe("done");
  });
});

describe("summarizeToolResult — only ever a count the tool really returned", () => {
  test("counts the first list a result object carries", () => {
    expect(summarizeToolResult({ silences: [1, 2, 3, 4], transcribed: true })).toBe("4 silences");
    expect(summarizeToolResult({ fillers: [] })).toBe("0 fillers");
  });

  test("counts a bare array", () => {
    expect(summarizeToolResult([1, 2])).toBe("2 results");
    expect(summarizeToolResult([1])).toBe("1 result");
  });

  test("says NOTHING when there is no list to count", () => {
    // The alternative is inventing a reassuring "done ✓" for a result nobody inspected, which is
    // exactly the confident filler this product is built not to ship.
    expect(summarizeToolResult({ note: "No transcript exists for this clip." })).toBeNull();
    expect(summarizeToolResult("ok")).toBeNull();
    expect(summarizeToolResult(null)).toBeNull();
    expect(summarizeToolResult(undefined)).toBeNull();
    expect(summarizeToolResult(42)).toBeNull();
  });

  test("a real findSilences shape — the empty answer reports zero rather than claiming success", () => {
    const empty = { silences: [], transcribed: false, note: "No transcript exists for this clip." };
    expect(summarizeToolResult(empty)).toBe("0 silences");
  });
});

describe("humanizeToolName", () => {
  test("the tool's real name, made readable — never re-worded", () => {
    expect(humanizeToolName("findSilences")).toBe("Find silences");
    expect(humanizeToolName("searchRegistry")).toBe("Search registry");
    expect(humanizeToolName("analyzeTranscript")).toBe("Analyze transcript");
    expect(humanizeToolName("planCutDown")).toBe("Plan cut down");
  });

  test("snake and kebab names survive, and an unknown name is still shown", () => {
    expect(humanizeToolName("find_filler_words")).toBe("Find filler words");
    expect(humanizeToolName("brand-new-tool")).toBe("Brand new tool");
    expect(humanizeToolName("x")).toBe("X");
  });
});

describe("formatElapsed", () => {
  test("whole seconds, m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7.9)).toBe("0:07");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(-3)).toBe("0:00");
  });
});

describe("rendered output", () => {
  const steps: ActivityStep[] = [
    { id: "a:0", name: "findSilences", state: "done", note: "14 silences" },
    { id: "b:1", name: "emitEditBatch", state: "running", note: null },
  ];
  const html = renderToStaticMarkup(<ActivityTrace steps={steps} startedAt={Date.now()} finishedAt={null} />);

  test("the running label is REAL TEXT, legible with zero animation (§5.6)", () => {
    // The shimmer is additive: base text at --t-2 (9.72:1) plus a plus-lighter highlight layer that
    // disappears under reduced motion and forced colors. A previous draft put the label at 5%
    // opacity and let a moving gradient supply the glyphs — unreadable in a background tab.
    expect(html).toContain("Emit edit batch");
    expect(html).toContain('class="shimmer"');
    expect(html).toContain('data-label="Emit edit batch"');
  });

  test("a finished step shows the tool and its real count", () => {
    expect(html).toContain("Find silences");
    expect(html).toContain("14 silences");
  });

  /** The one polite live region's text — the only thing a screen reader is interrupted with. */
  const liveRegionOf = (markup: string): string | undefined =>
    /<p class="sr-only" role="status" aria-live="polite">([^<]*)<\/p>/.exec(markup)?.[1];

  test("the ticking clock is announced by NOTHING — the live region carries the step", () => {
    // The whole card used to be the live region with the elapsed seconds inside it, so a screen
    // reader read "WORKING FOR 0:07 / 0:08 / 0:09…" once a second for the entire 10–60s turn and
    // the steps were buried under it. The clock is visual now; this string changes per STEP.
    expect(html).toContain("WORKING FOR 0:00");
    expect(html).toContain('aria-hidden="true" class="flex items-center gap-2"');
    expect(liveRegionOf(html)).toBe("Emit edit batch");
  });

  test("a finished turn stops claiming to be working", () => {
    const done = renderToStaticMarkup(
      <ActivityTrace steps={[steps[0]]} startedAt={0} finishedAt={9000} />,
    );
    expect(done).toContain("TOOK 0:09");
    expect(done).not.toContain("WORKING FOR");
    // The measured duration is the one number worth announcing, and it is announced once.
    expect(liveRegionOf(done)).toBe("HITE finished in 0:09.");
    // The live pip is the one thing that must not outlive the turn.
    expect(done).not.toContain("signal-flicker");
  });

  test("no steps yet is still an honest screen — the clock, and no invented step", () => {
    const bare = renderToStaticMarkup(<ActivityTrace steps={[]} startedAt={Date.now()} finishedAt={null} />);
    expect(bare).toContain("WORKING FOR");
    expect(bare).not.toContain("<li");
    expect(liveRegionOf(bare)).toBe("HITE is working.");
  });
});
