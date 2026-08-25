"use client";
import { useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { usePlanner, turnIsUndoable } from "@/components/editor/planner";
import { ActivityTrace } from "@/components/editor/ActivityTrace";
import { AFFORDANCE } from "@/components/editor/affordances";

/**
 * WHAT HITE DID — §13 item 8. "The history — right edge, one line: `A24 moonlight · applied · undo`.
 * Expands to the real tool trace."
 *
 * ONE TAB STOP, TWO BUTTONS. It is a `role="toolbar"` with roving tabindex, for exactly the reason
 * §13 gives for making the strip a listbox: "That is the standard pattern and it is why the count is
 * honest rather than gamed." The line as §13 writes it has two verbs in it — see what happened, and
 * undo it — and a toolbar is how two controls share one tab stop without either of them becoming a
 * word that only looks like a control. Left and right arrows move between them.
 *
 * UNDO IS REFERENCE-GUARDED. When the live EDL is still exactly the object the last AI turn applied,
 * the button reverts THAT turn and clears the refine pointer, so the next sentence re-plans from the
 * DB's true latest rather than refining a branch that no longer exists. When it is not — a manual
 * trim happened since — it is an ordinary undo of whatever the last history entry is. Both are the
 * same single undo stack, because the AI and the manual UI emit the same commands through the same
 * reducer.
 *
 * WHAT THE EXPANSION SHOWS IS WHAT HAPPENED, AND ONLY THAT. `ActivityTrace` prints the planner's real
 * tool loop and counts read off each tool's own returned array; the change list is the route's
 * per-command descriptions. A turn that called no analysis tools shows no steps. Nothing is inferred
 * and nothing is embellished.
 */
export function History() {
  const turn = usePlanner((s) => s.turn);
  const streaming = usePlanner((s) => s.streaming);
  const edl = useEditor((s) => s.edl);
  const canUndo = useEditor((s) => s.canUndo);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  const undoesTurn = turnIsUndoable(turn ?? null, edl);
  const canRevert = undoesTurn || canUndo;

  const headline = streaming
    ? "Working"
    : turn?.failed
      ? (turn.message ?? "That didn't run")
      : turn?.undone
        ? "Reverted"
        : turn?.message
          ? turn.message
          : canUndo
            ? "Your last change"
            : "Nothing yet";

  const state = streaming ? "" : turn && !turn.failed && !turn.undone && turn.applied ? " · applied" : "";

  function move(next: number) {
    setActive(next);
    (next === 0 ? detailsRef : undoRef).current?.focus();
  }

  return (
    <div className="relative flex shrink-0 justify-end">
      {/* `data-affordance` sits on BOTH buttons, not on the toolbar: the first-screen gate counts TAB
          STOPS, and roving tabindex means exactly one of these two is reachable with Tab at any
          moment. Putting the name on a wrapper that Tab never lands on would have made the gate count
          something the keyboard cannot reach. */}
      <div
        role="toolbar"
        aria-label="What HITE did"
        aria-orientation="horizontal"
        className="flex items-center gap-[var(--space-2)]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            move(0);
          }
        }}
      >
        <button
          data-affordance={AFFORDANCE.history}
          ref={detailsRef}
          type="button"
          tabIndex={active === 0 ? 0 : -1}
          aria-expanded={open}
          onFocus={() => setActive(0)}
          onClick={() => setOpen((v) => !v)}
          title={turn?.message ?? undefined}
          className="flex h-[var(--tap)] max-w-[34ch] items-center gap-[var(--space-2)] rounded-[var(--r-sm)] px-[var(--space-3)] text-[13px]"
          style={{ color: turn?.failed ? "var(--color-hit)" : "var(--t-2)" }}
        >
          <span className="truncate">
            {headline}
            <span className="text-[var(--t-4)]">{state}</span>
          </span>
        </button>

        <button
          data-affordance={AFFORDANCE.history}
          ref={undoRef}
          type="button"
          tabIndex={active === 1 ? 0 : -1}
          aria-disabled={!canRevert}
          onFocus={() => setActive(1)}
          onClick={() => {
            if (!canRevert) return;
            if (undoesTurn) usePlanner.getState().undoTurn();
            else useEditor.getState().undo();
          }}
          className="h-[var(--tap)] rounded-[var(--r-sm)] px-[var(--space-3)] text-[13px]"
          style={{ color: canRevert ? "var(--t-2)" : "var(--t-4)" }}
        >
          undo
        </button>
      </div>

      {open && (
        <div
          data-arrive
          className="absolute bottom-[calc(100%+var(--space-2))] right-0 z-10 w-[380px] max-w-[86vw] rounded-[var(--r-md)] p-[var(--space-4)]"
          style={{ background: "var(--s-panel)", boxShadow: "var(--specular), 0 0 0 1px var(--line-3), var(--shadow-lift)" }}
        >
          {turn ? (
            <div className="flex flex-col gap-[var(--space-3)]">
              <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
                You asked: <span className="text-[var(--t-1)]">{turn.prompt}</span>
              </p>
              <ActivityTrace steps={turn.steps} startedAt={turn.startedAt} finishedAt={turn.finishedAt} />
              {turn.changes.length > 0 && (
                <ul className="flex flex-col gap-[var(--space-1)]">
                  {turn.changes.map((change, i) => (
                    <li key={`${change}-${i}`} className="text-[12px] leading-relaxed text-[var(--t-2)]">
                      {change}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
              Nothing has been asked for yet. Whatever HITE does to your video gets listed here, with the
              steps it took to work it out.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
