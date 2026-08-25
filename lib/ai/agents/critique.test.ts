import { describe, expect, test } from "vitest";
import { emptyEdl2, type Edl } from "@/lib/edl/schema";
import { reduceBatch } from "@/lib/edl/reducer";
import { summarizeEdl } from "@/lib/ai/timeline";
import { flatBatchToEditBatch } from "@/lib/ai/edit-batch-flat";
import { EFFORT } from "@/lib/ai/effort";
import { PlannerRun, PlannerContractError, computeChecks, parseTargetTicks, reviewSummary } from "./critique";
import type { EditBatch, EditCommand } from "@/lib/edl/commands";

/**
 * The critique pass is the whole quality argument for high effort, so these tests are about what it
 * MEASURES and when it FIRES — not about the loop being wired up.
 *
 * The parent timeline is 10s of a 30s asset, matching the route tests' fixture.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";
const parent = (): Edl => emptyEdl2(ASSET, 300_000, "https://blob/clip.mp4");
const DURATIONS = { [ASSET]: 900_000 };

function makeRun(level: keyof typeof EFFORT, prompt = "do the thing", now?: () => number) {
  return new PlannerRun({
    effort: EFFORT[level],
    parentEdl: parent(),
    assetDurationsTicks: DURATIONS,
    prompt,
    now,
  });
}

const marker = (title: string) => ({ commands: [{ type: "ADD_MARKER", atTick: 0, title }], summary: title });
const firstClipId = (edl: Edl): string => {
  const item = edl.tracks[0].items[0];
  if (item.schema !== "Clip.1") throw new Error("fixture has no clip");
  return item.id;
};

describe("the dry run applies the batch for real", () => {
  test("a valid batch reports the timeline it ACTUALLY produced, in the prompt's own format", () => {
    const run = makeRun("high");
    const result = run.dryRun(marker("beat"));
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;

    // Built the way the ROUTE used to: map the flat emit, then reduce. The dry run must land on
    // byte-identical output, because it replaced that code path rather than sitting beside it.
    const expected = reduceBatch(parent(), flatBatchToEditBatch(marker("beat")).commands as EditCommand[], {
      assetDurationsTicks: DURATIONS,
    }).edl;
    expect(result.resultingTimeline).toBe(summarizeEdl(expected));
    expect(result.applied).toEqual(["Marker · beat"]);
    expect(result.deltas.clipsBefore).toBe(1);
    expect(result.deltas.clipsAfter).toBe(1);
    // The route persists THIS, not the raw emit — it has been proven to apply.
    expect(run.lastValid?.edl.contentHash).toBe(expected.contentHash);
  });

  test("a batch the reducer rejects yields the field-named problem and persists nothing", () => {
    const run = makeRun("high");
    const result = run.dryRun({ commands: [{ type: "REMOVE_CLIP", clipId: "does-not-exist" }], summary: "x" });
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.problems[0]).toMatch(/does-not-exist|clip/i);
    expect(result.instruction).toContain("call emitEditBatch again");
    expect(run.lastValid).toBeNull();
  });

  test("a malformed emit reports field-named lines, never a raw ZodError blob", () => {
    const run = makeRun("high");
    const result = run.dryRun({ commands: [{ type: "ADD_MARKER", atTick: 0 }], summary: "no title" });
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.problems[0]).not.toContain('[{"');
    expect(result.problems[0]).toContain("ADD_MARKER");
  });

  test("a zero-command emit is a no-op turn and is NEVER critiqued into an edit", () => {
    const run = makeRun("max");
    const result = run.dryRun({ commands: [], summary: "Nothing to cut." });
    expect(result.kind).toBe("no-op");
    expect(run.noOp).toEqual({ summary: "Nothing to cut." });
    expect(run.lastValid).toBeNull();
    expect(run.settled).toBe(true); // the loop stops immediately, even at max effort
  });
});

describe("when the loop stops — the difference between the levels", () => {
  test("draft settles on the first emit: one shot, exactly today's behaviour", () => {
    const run = makeRun("draft");
    expect(run.settled).toBe(false);
    run.dryRun(marker("a"));
    expect(run.settled).toBe(true);
  });

  test("standard settles a VALID batch immediately — auto-repair costs nothing when nothing failed", () => {
    const run = makeRun("standard");
    run.dryRun(marker("a"));
    expect(run.emitCount).toBe(1);
    expect(run.settled).toBe(true);
  });

  test("standard repairs a REJECTED batch exactly once, then stops", () => {
    const run = makeRun("standard");
    run.dryRun({ commands: [{ type: "REMOVE_CLIP", clipId: "ghost" }], summary: "x" });
    expect(run.settled).toBe(false); // the repair round is the point
    run.dryRun(marker("fixed"));
    expect(run.settled).toBe(true);
    expect(run.lastValid).not.toBeNull();
  });

  test("high does NOT settle a valid first batch — it critiques it, which is the quality", () => {
    const run = makeRun("high");
    run.dryRun(marker("a"));
    expect(run.settled).toBe(false); // ← the whole difference between standard and high
    run.dryRun(marker("a")); // the model re-emits the IDENTICAL batch: that is how it confirms
    expect(run.settled).toBe(true);
  });

  test("a CORRECTION is checked too — a revision nobody looked at is not a revision", () => {
    const run = makeRun("max");
    run.dryRun(marker("a"));
    expect(run.settled).toBe(false);
    run.dryRun(marker("b")); // different result → never been reviewed → review it
    expect(run.settled).toBe(false);
    run.dryRun(marker("b")); // now confirmed
    expect(run.settled).toBe(true);
    expect(run.emitCount).toBe(3);
  });

  test("max buys one more correct-and-check round than high", () => {
    const high = makeRun("high");
    const max = makeRun("max");
    for (const [i, title] of ["a", "b", "c"].entries()) {
      high.dryRun(marker(title));
      max.dryRun(marker(title));
      if (i < 2) expect(max.settled, `max after ${i + 1}`).toBe(false);
    }
    expect(high.settled).toBe(true); // budget spent after 3 emits
    expect(max.settled).toBe(false); // still has a round for the third correction
  });

  test("the confirming round is told it is final, so it does not wait for a reply that never comes", () => {
    const run = makeRun("high");
    run.dryRun(marker("a"));
    const confirm = run.dryRun(marker("a"));
    expect(confirm.kind).toBe("applied");
    if (confirm.kind !== "applied") return;
    expect(confirm.instruction).toContain("do not call emitEditBatch again");
  });

  test("a model that keeps emitting garbage terminates and persists the last VALID batch", () => {
    const run = makeRun("high");
    run.dryRun(marker("good"));
    const good = run.lastValid?.edl.contentHash;
    run.dryRun({ commands: [{ type: "REMOVE_CLIP", clipId: "ghost" }], summary: "bad" });
    expect(run.settled).toBe(false);
    run.dryRun({ commands: [{ type: "REMOVE_CLIP", clipId: "ghost" }], summary: "bad again" });
    expect(run.settled).toBe(true); // revisions spent
    expect(run.lastValid?.edl.contentHash).toBe(good); // a failed revision cannot destroy a good batch
  });

  test("max allows one more revision round than high", () => {
    const run = makeRun("max");
    for (let i = 0; i < 3; i++) {
      run.dryRun({ commands: [{ type: "REMOVE_CLIP", clipId: "ghost" }], summary: "bad" });
      expect(run.settled).toBe(false);
    }
    run.dryRun({ commands: [{ type: "REMOVE_CLIP", clipId: "ghost" }], summary: "bad" });
    expect(run.settled).toBe(true);
  });

  test("the final round is told there are no attempts left, so it does not wait for a reply", () => {
    const run = makeRun("standard");
    run.dryRun(marker("a"));
    const second = run.dryRun(marker("b"));
    expect(second.kind).toBe("applied");
    if (second.kind !== "applied") return;
    expect(second.instruction).toContain("do not call emitEditBatch again");
  });
});

describe("the wall-clock deadline", () => {
  test("past the deadline the run settles rather than starting another revision", () => {
    let clock = 1_000;
    const run = makeRun("high", "do the thing", () => clock);
    run.dryRun(marker("a"));
    expect(run.settled).toBe(false);
    clock += EFFORT.high.wallClockMs; // burned the whole budget
    expect(run.pastDeadline).toBe(true);
    expect(run.settled).toBe(true);
  });

  test("the reserve fires BEFORE the budget is gone, leaving room for the emit and the insert", () => {
    let clock = 1_000;
    const run = makeRun("high", "do the thing", () => clock);
    expect(run.pastDeadline).toBe(false);
    clock += EFFORT.high.wallClockMs - 11_000; // inside the 12s reserve
    expect(run.pastDeadline).toBe(true);
  });
});

describe("parallel emits in ONE step still fail the turn", () => {
  test("a second emit inside the same step is a contract violation, never a revision", () => {
    const run = makeRun("high");
    run.beginStreamStep();
    run.noteStreamEmit();
    expect(() => run.noteStreamEmit()).toThrow(PlannerContractError);
  });

  test("emits across steps are the revise loop and are fine", () => {
    const run = makeRun("high");
    run.beginStreamStep();
    run.noteStreamEmit();
    run.beginStreamStep();
    expect(() => run.noteStreamEmit()).not.toThrow();
  });
});

describe("the checks carry measured facts, not opinions", () => {
  test("a batch that changes nothing says so", () => {
    const before = parent();
    const checks = computeChecks("make it pop", before, before, { commands: [], summary: "" } as unknown as EditBatch);
    expect(checks.some((c) => c.includes("did not change the timeline"))).toBe(true);
  });

  test("an over-length cut-down is reported against the target parsed from the request", () => {
    const run = makeRun("high", "cut this down to a 5 second version");
    const result = run.dryRun(marker("a")); // leaves the 10s timeline at 10s
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    const line = result.checks.find((c) => c.includes("Length target"));
    expect(line).toBeDefined();
    expect(line).toContain("150000t"); // 5s
    expect(line).toContain("100% OVER"); // produced 10s
  });

  test("no length cue in the request means NO length check — a guessed target steers a worse revision", () => {
    const run = makeRun("high", "cut the first 5 seconds of dead air");
    const result = run.dryRun(marker("a"));
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.checks.some((c) => c.includes("Length target"))).toBe(false);
  });

  test("a transition the reducer silently pruned is reported as dropped", () => {
    // The reducer's `recompute` quietly removes a transition whose pair stopped being adjacent —
    // AFTER the command "succeeded" — so the turn reports a bridge that is not in the timeline.
    const clip = firstClipId(parent());
    const twoClips = reduceBatch(parent(), [{ type: "SPLIT_CLIP", clipId: clip, atTick: 150_000 }] as EditCommand[], {
      assetDurationsTicks: DURATIONS,
    }).edl;
    const [a, b] = twoClips.tracks[0].items.filter((i) => i.schema === "Clip.1").map((i) => i.id);

    const run = new PlannerRun({
      effort: EFFORT.high,
      parentEdl: twoClips,
      assetDurationsTicks: DURATIONS,
      prompt: "bridge them and drop the first shot",
    });
    const result = run.dryRun({
      commands: [
        { type: "ADD_TRANSITION", betweenClipIds: [a, b], transitionKey: "transitions/fade", durationTicks: 9000 },
        { type: "REMOVE_CLIP", clipId: a, ripple: true },
      ],
      summary: "bridged and trimmed",
    });
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;
    expect(result.checks.some((c) => c.includes("was DROPPED"))).toBe(true);
  });

  test("an emptied timeline is called out", () => {
    const clip = firstClipId(parent());
    const after = reduceBatch(parent(), [{ type: "REMOVE_CLIP", clipId: clip, ripple: true }] as EditCommand[], {
      assetDurationsTicks: DURATIONS,
    }).edl;
    const checks = computeChecks("remove it", parent(), after, { commands: [], summary: "" } as unknown as EditBatch);
    expect(checks.some((c) => c.includes("NO clips left"))).toBe(true);
  });

  test("partial effect coverage is reported only when the batch touched effects", () => {
    const run = makeRun("high");
    const applied = run.dryRun({
      commands: [{ type: "ADD_EFFECT", effectKey: "looks/vhs", targetMode: "all" }],
      summary: "graded",
    });
    expect(applied.kind).toBe("applied");
    if (applied.kind !== "applied") return;
    // One clip, effect applied to all of it → full coverage → no coverage line.
    expect(applied.checks.some((c) => c.startsWith("Effect coverage"))).toBe(false);
  });
});

describe("parseTargetTicks only asserts a target the request actually stated", () => {
  test.each([
    ["cut it down to 60 seconds", 60],
    ["make it under a minute", 60],
    ["keep it under 90s", 90],
    ["give me a 30-second version", 30],
    ["90 seconds or less please", 90],
    ["trim it to 2 minutes", 120],
    ["cut this down to 1:30", 90],
    ["turn this into a 15 second reel", 15],
  ])("%s → %ss", (prompt, seconds) => {
    expect(parseTargetTicks(prompt)).toBe(seconds * 30_000);
  });

  test.each([
    "cut the first 5 seconds",
    "zoom in at 14 seconds",
    "add a 2 second fade between the clips",
    "the drop is 30 seconds in",
    "make it pop",
    "remove the ums",
  ])("%s → no target", (prompt) => {
    expect(parseTargetTicks(prompt)).toBeNull();
  });
});

describe("what the activity log sees", () => {
  test("an applied round streams its checks; a rejected one streams its problems", () => {
    const run = makeRun("high");
    expect(reviewSummary(run.dryRun(marker("a")))).toMatchObject({ kind: "applied" });
    expect(reviewSummary(run.dryRun({ commands: [{ type: "REMOVE_CLIP", clipId: "ghost" }], summary: "x" }))).toMatchObject({
      kind: "rejected",
    });
    expect(reviewSummary(undefined)).toEqual({ kind: "unknown" });
  });
});
