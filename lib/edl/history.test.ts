import { describe, expect, test } from "vitest";
import { EditHistory } from "./history";
import { emptyEdl2 } from "./schema";
import type { EditCommand } from "./commands";

const SEED = () => emptyEdl2("00000000-0000-0000-0000-000000000001", 900_000, "https://blob/x");

describe("EditHistory.pushSnapshot (AI-turn undo)", () => {
  test("records a precomputed next EDL as an undoable entry without re-running the reducer", () => {
    const h = new EditHistory(SEED());
    expect(h.canUndo()).toBe(false);

    const base = h.current;
    const next = { ...base, durationTicks: base.durationTicks + 30_000, revision: base.revision + 1 };
    const out = h.pushSnapshot(next, { summary: "ai edit" });

    // Shows exactly the server EDL (no client re-reduce / divergence).
    expect(out.durationTicks).toBe(base.durationTicks + 30_000);
    expect(h.canUndo()).toBe(true);
  });

  test("undo restores the prior EDL; redo re-applies the snapshot", () => {
    const h = new EditHistory(SEED());
    const original = h.current.durationTicks;
    h.pushSnapshot({ ...h.current, durationTicks: original + 60_000, revision: h.current.revision + 1 });

    const afterUndo = h.undo();
    expect(afterUndo.durationTicks).toBe(original);
    expect(h.canRedo()).toBe(true);

    const afterRedo = h.redo();
    expect(afterRedo.durationTicks).toBe(original + 60_000);
  });

  test("a new command after a snapshot clears the redo stack", () => {
    const h = new EditHistory(SEED());
    h.pushSnapshot({ ...h.current, revision: h.current.revision + 1 });
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.apply([{ type: "ADD_EFFECT", target: "all", effectKey: "x", params: {} }] as EditCommand[]);
    expect(h.canRedo()).toBe(false); // redo invalidated by the new branch
  });

  /**
   * THE REGRESSION: a COALESCING apply did not clear redo.
   *
   * `this.future = []` sat at the end of the non-coalescing path, and the coalescing branch returns
   * early — so resuming a gesture left a redo stack pointing at patches computed against an EDL that
   * no longer existed. Undo an edit, then resume a gesture that coalesces with whatever is now on
   * top (same clip, same edge, so the key matches), and redo replayed the undone edit onto the new
   * state: the undone edit came back and the edit just made was thrown away.
   */
  test("a coalescing apply also clears redo — it is a new branch like any other", () => {
    const h = new EditHistory(SEED());
    h.apply([{ type: "ADD_EFFECT", target: "all", effectKey: "a", params: {} }] as EditCommand[], {
      coalesceKey: "gesture:1",
    });
    h.pushSnapshot({ ...h.current, revision: h.current.revision + 1, durationTicks: h.current.durationTicks + 30_000 });
    h.undo();
    expect(h.canRedo()).toBe(true);

    // Resuming the gesture: the key matches the entry now on top, so this coalesces.
    h.apply([{ type: "ADD_EFFECT", target: "all", effectKey: "b", params: {} }] as EditCommand[], {
      coalesceKey: "gesture:1",
    });
    expect(h.canRedo()).toBe(false);
  });
});

// A timeline drag fires one command per pointermove. Without coalescing each becomes its own undo
// entry, so reverting a single drag takes dozens of ⌘Z. These lock in that a shared coalesceKey
// folds the whole gesture into ONE undo step that returns to the pre-drag state (DECISIONS.md F3).
describe("EditHistory — gesture coalescing", () => {
  // SEED here gives one clip c0 spanning 0..300000 (the reducer fixture default).
  const SEED1 = () => emptyEdl2("a", 300_000);
  const trimOut = (toTick: number): EditCommand[] =>
    [{ type: "TRIM_CLIP", clipId: "c0", edge: "out", toTick }] as EditCommand[];
  const outTick = (e: ReturnType<typeof SEED1>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e.tracks[0].items.find((i: any) => i.schema === "Clip.1") as any).outTick;

  test("same coalesceKey across many applies = ONE undo entry back to the start state", () => {
    const h = new EditHistory(SEED1());
    const start = outTick(h.current);
    expect(start).toBe(300_000);

    // Stream a drag: out edge 300000 → 250000 → 220000 → 200000.
    h.apply(trimOut(250_000), { coalesceKey: "trim:out:c0" });
    h.apply(trimOut(220_000), { coalesceKey: "trim:out:c0" });
    const afterDrag = h.apply(trimOut(200_000), { coalesceKey: "trim:out:c0" });
    expect(outTick(afterDrag)).toBe(200_000); // live EDL reflects the final move

    // A single undo reverts the ENTIRE drag, not one step of it.
    const afterUndo = h.undo();
    expect(outTick(afterUndo)).toBe(start);
    expect(h.canUndo()).toBe(false); // the whole gesture was one entry
  });

  test("redo replays the whole coalesced gesture to its final state", () => {
    const h = new EditHistory(SEED1());
    h.apply(trimOut(250_000), { coalesceKey: "trim:out:c0" });
    h.apply(trimOut(200_000), { coalesceKey: "trim:out:c0" });
    h.undo();
    const afterRedo = h.redo();
    expect(outTick(afterRedo)).toBe(200_000);
  });

  test("endCoalescing() closes the run so the next same-key apply is a fresh undo step", () => {
    const h = new EditHistory(SEED1());
    h.apply(trimOut(250_000), { coalesceKey: "trim:out:c0" });
    h.apply(trimOut(200_000), { coalesceKey: "trim:out:c0" });
    h.endCoalescing(); // pointerup

    // A second, separate drag with the SAME key must not fold into the finished one.
    h.apply(trimOut(150_000), { coalesceKey: "trim:out:c0" });
    expect(outTick(h.current)).toBe(150_000);

    // Now two undo steps exist: first reverts drag-2 (→200000), second reverts drag-1 (→300000).
    expect(outTick(h.undo())).toBe(200_000);
    expect(outTick(h.undo())).toBe(300_000);
    expect(h.canUndo()).toBe(false);
  });

  test("different coalesceKeys never merge", () => {
    const h = new EditHistory(SEED1());
    h.apply(trimOut(250_000), { coalesceKey: "trim:out:c0" });
    h.apply(trimOut(200_000), { coalesceKey: "trim:in:c0" }); // different key → new entry
    expect(outTick(h.undo())).toBe(250_000); // only the 2nd entry reverts
    expect(h.canUndo()).toBe(true);
  });

  test("an apply with no coalesceKey is always its own entry", () => {
    const h = new EditHistory(SEED1());
    h.apply(trimOut(250_000)); // no key
    h.apply(trimOut(200_000)); // no key
    expect(outTick(h.undo())).toBe(250_000);
    expect(outTick(h.undo())).toBe(300_000);
  });

  test("undo mid-gesture closes the run (a later same-key apply starts fresh)", () => {
    const h = new EditHistory(SEED1());
    h.apply(trimOut(250_000), { coalesceKey: "trim:out:c0" });
    h.undo(); // reverts the in-progress gesture; closes the run
    expect(outTick(h.current)).toBe(300_000);
    // A new move with the same key must NOT resurrect/merge into the popped entry.
    h.apply(trimOut(220_000), { coalesceKey: "trim:out:c0" });
    expect(outTick(h.undo())).toBe(300_000);
    expect(h.canUndo()).toBe(false);
  });
});
