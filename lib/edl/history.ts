/**
 * lib/edl/history.ts — undo/redo + replay over the command log (docs/CANONICAL-IR-SPEC.md §9).
 *
 * Undo/redo use Immer inverse/forward patches (correct + cheap). The semantic forward command
 * batch is also retained per entry so the whole session is replayable from the seed EDL and the
 * log doubles as the audit trail. contentHash is derived (recomputed after every transition).
 */
import { applyPatches, produceWithPatches, type Patch } from "immer";
import type { Edl } from "./schema";
import type { EditCommand } from "./commands";
import { reduceBatch, withContentHash, type ReduceOptions } from "./reducer";

export interface HistoryEntry {
  batchId: string;
  batch: EditCommand[];
  forwardPatches: Patch[];
  inversePatches: Patch[];
  summary?: string;
  /**
   * Set while a continuous gesture (a timeline drag-trim / drag-move) is still coalescing into
   * THIS entry: the EDL as it was the instant the gesture began. Held so each subsequent move can
   * recompute forward patches from the gesture's baseline (one redo replays the whole drag) while
   * the entry keeps its original `inversePatches` (one undo reverts the whole drag). Cleared — and
   * irrelevant — once the gesture ends or any other entry is pushed.
   */
  coalesceKey?: string;
  coalesceBase?: Edl;
}

export class EditHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  constructor(private edl: Edl) {}

  get current(): Edl {
    return this.edl;
  }
  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Apply a batch (one AI turn / one UI gesture). Clears the redo stack.
   *
   * `coalesceKey` collapses a continuous gesture into a single undo step: while consecutive
   * `apply` calls share the same key (e.g. `trim:in:<clipId>` emitted on every pointermove of a
   * drag), they amend the top entry instead of stacking new ones — so one ⌘Z reverts the whole
   * drag to where it started, not one pixel of it (DECISIONS.md F3: "UI … coalesces per batchId").
   * Any apply with a different/absent key, or an undo/redo, ends the run.
   *
   * `reduceOptions` carries the external facts the pure reducer cannot look up — today the real
   * media length per asset, which decides how far a clip minted by this batch may later be trimmed
   * outwards. The caller owns those facts (the editor store reads them off its loaded assets), so
   * they are passed per batch rather than captured at construction.
   */
  apply(
    batch: EditCommand[],
    opts: { batchId?: string; summary?: string; coalesceKey?: string; reduceOptions?: ReduceOptions } = {},
  ): Edl {
    const top = this.past[this.past.length - 1];
    const coalescing =
      opts.coalesceKey !== undefined && top !== undefined && top.coalesceKey === opts.coalesceKey;

    // CLEARED FOR EVERY APPLY, INCLUDING A COALESCING ONE. This used to sit at the end of the
    // non-coalescing path only, so the early return below skipped it and left a stale redo stack
    // pointing at patches computed against an EDL that no longer exists. Undo an edit, then resume a
    // gesture that coalesces with the entry now on top (same clip, same edge — the key matches), and
    // redo would replay the undone edit's forward patches onto the new state: the undone edit comes
    // back and the edit just made is discarded. A redo stack survives undo/redo, never a new edit.
    this.future = [];

    if (coalescing) {
      // Continue the gesture: advance the live EDL, but rewrite the top entry so its patches span
      // the gesture's ORIGINAL baseline → now. Inverse patches are recomputed from the same base,
      // so a single undo returns to pre-gesture state regardless of how many moves fired.
      const base = top.coalesceBase ?? this.edl;
      const { edl } = reduceBatch(this.edl, batch, opts.reduceOptions);
      const [, forwardPatches, inversePatches] = produceWithPatches(base, () => edl);
      this.edl = edl;
      top.batch = [...top.batch, ...batch];
      top.forwardPatches = forwardPatches;
      top.inversePatches = inversePatches;
      return edl;
    }

    const { edl, forwardPatches, inversePatches } = reduceBatch(this.edl, batch, opts.reduceOptions);
    const base = this.edl;
    this.edl = edl;
    this.past.push({
      batchId: opts.batchId ?? `b${this.past.length}`,
      batch,
      forwardPatches,
      inversePatches,
      summary: opts.summary,
      coalesceKey: opts.coalesceKey,
      coalesceBase: opts.coalesceKey !== undefined ? base : undefined,
    });
    return edl;
  }

  /**
   * End any in-progress coalescing run (call on pointerup). After this, the next `apply` with the
   * same key starts a fresh undo entry rather than amending the finished gesture. Also drops the
   * retained baseline snapshot so it can be GC'd.
   */
  endCoalescing(): void {
    const top = this.past[this.past.length - 1];
    if (top?.coalesceKey !== undefined) {
      top.coalesceKey = undefined;
      top.coalesceBase = undefined;
    }
  }

  /**
   * Record an already-computed next EDL as an undoable entry, deriving the patches by diffing
   * current→next (no reducer re-run). Used for AI turns: the server reduced the command batch and
   * persisted the result, so the client must show *exactly* that EDL (no risk of a client-side
   * re-reduce diverging from what was saved) while still making the turn undoable. Clears redo.
   */
  pushSnapshot(next: Edl, opts: { batchId?: string; summary?: string } = {}): Edl {
    this.endCoalescing(); // a server/AI turn is its own discrete entry — never fold a drag into it
    const [, forwardPatches, inversePatches] = produceWithPatches(this.edl, () => next);
    this.edl = next;
    this.past.push({
      batchId: opts.batchId ?? `b${this.past.length}`,
      batch: [],
      forwardPatches,
      inversePatches,
      summary: opts.summary,
    });
    this.future = [];
    return this.edl;
  }

  undo(): Edl {
    const entry = this.past.pop();
    if (!entry) return this.edl;
    // Undoing the entry that a gesture was folding into closes that run; a later move must start anew.
    entry.coalesceKey = undefined;
    entry.coalesceBase = undefined;
    this.edl = withContentHash(applyPatches(this.edl, entry.inversePatches) as Edl);
    this.future.push(entry);
    return this.edl;
  }

  redo(): Edl {
    const entry = this.future.pop();
    if (!entry) return this.edl;
    this.edl = withContentHash(applyPatches(this.edl, entry.forwardPatches) as Edl);
    this.past.push(entry);
    return this.edl;
  }

  /** Deterministic replay from a seed EDL + the ordered command log. */
  static replay(seed: Edl, batches: EditCommand[][]): Edl {
    let edl = seed;
    for (const batch of batches) edl = reduceBatch(edl, batch).edl;
    return edl;
  }
}
