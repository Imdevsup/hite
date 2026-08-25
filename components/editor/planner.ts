"use client";
import { create } from "zustand";
import type { Edl } from "@/lib/edl/schema";
import { flushManualEdits, useEditor } from "@/lib/editor/store";
import { useMediaUpload } from "@/components/editor/mediaUpload";
import { applyActivityEvent, type ActivityStep } from "@/components/editor/ActivityTrace";
import { firstTouchedStartTick, touchedClipIds } from "@/components/editor/changeDiff";
import { providerKeyHeaders, providerSelectionHeaders, readEffortPreference, readProviderPreference } from "@/components/settings";
import { tickToMs } from "@/lib/edl/time";

/**
 * THE AI TURN — everything `ChatWindow` used to do, minus the chat.
 *
 * WHAT MOVED AND WHY. The planning turn was 640 lines inside a floating window titled "THE PATCH
 * LOG", one of the eleven `react-rnd` panels §13 kills by name. The MECHANISM inside it was sound and
 * is preserved here line for line — flush pending manual edits before planning, `/api/plan` for the
 * first turn and `/api/refine` for every turn after, the SSE parse, `applyAiEdl` as ONE undoable
 * history entry, the reference-guarded undo, the staleness guard that stops a turn finishing after a
 * project switch from painting its EDL onto the wrong project. None of that was the problem. The
 * problem was that it lived in a panel behind a tab, and that its output was a transcript.
 *
 * WHAT REPLACES THE TRANSCRIPT. §13 allows exactly two readouts: the streaming tool trace above the
 * input while a turn runs (`aria-live`, not a control), and one history line afterwards
 * (`A24 moonlight · applied · undo`). So this store keeps ONE turn, not a conversation — the last
 * one. A conversation was a record of a chat; the editor's record is the timeline itself.
 *
 * WHAT IS NEW, AND BOTH ARE §13's SANCTIONED EXCEPTIONS:
 *   · `touched` — which clips actually changed, computed by diffing the two real EDLs (changeDiff.ts),
 *     so the strip can outline what the AI touched.
 *   · `before` — the exact EDL the turn started from, held by reference so "hold to compare" can put
 *     the un-edited picture back for as long as the key is down.
 *
 * NO FABRICATED DATA. `changes` and `summary` come off the stream; a turn that reports nothing shows
 * nothing. A step still marked running when the stream closes stays visibly unfinished, because "the
 * stream ended" is not evidence that the tool succeeded.
 */

export interface PlannerTurn {
  readonly id: string;
  /** Exactly what the user typed. Held so a failed turn can be retried verbatim. */
  readonly prompt: string;
  readonly steps: readonly ActivityStep[];
  /** `Date.now()` when the turn was sent, and when the stream closed. Two real instants. */
  readonly startedAt: number;
  readonly finishedAt: number | null;
  /** The planner's own one-line summary, or the failure sentence. Never invented here. */
  readonly message: string | null;
  /** Per-command descriptions from the route. Empty until (and unless) the turn emits an edit. */
  readonly changes: readonly string[];
  /** The EDL this turn applied, held by reference so undo can be guarded on identity. */
  readonly applied: Edl | null;
  /** The EDL that was on screen before it. Powers hold-to-compare. */
  readonly before: Edl | null;
  /** Clip ids this turn actually changed, derived from the two EDLs above. */
  readonly touched: readonly string[];
  readonly undone: boolean;
  readonly failed: boolean;
}

interface PlannerState {
  /** The last turn, or null before anything has been asked. There is no conversation. */
  turn: PlannerTurn | null;
  streaming: boolean;
  /**
   * A prompt held because the turn could not run yet — a 402 with no key, or no footage to cut.
   * §14.3: "the sentence the user typed is held and re-sent verbatim the moment the key validates.
   * The prompt is never lost."
   */
  held: string | null;
  /** Why it is held, so the composer can transform into the right thing. */
  heldReason: "needs-key" | "needs-footage" | null;
  send: (projectId: string, prompt: string) => Promise<void>;
  /** Re-send whatever is held, if anything. Returns false when there was nothing to send. */
  releaseHeld: (projectId: string) => boolean;
  undoTurn: () => void;
  /** Drop everything — a different project's turn is not this project's history. */
  reset: () => void;
}

/** Mirrors `streaming` for closures that outlive a render. */
let streamingNow = false;
/**
 * The saved-edit id the LAST turn produced. Turn 1 plans from the project's latest edit; every turn
 * after refines that specific edit, which uses the refiner prompt (tuned for "make it harder", "undo
 * that") and skips a no-op write when the batch changes nothing.
 */
let lastEditId: string | null = null;
/** The exact EDL object the last AI turn applied, so a manual edit in between can be detected. */
let lastAiEdl: unknown = null;

/**
 * A manual edit, an undo, a redo or a re-hydrate makes `lastEditId` stale: the timeline is no longer
 * the edit that id names, so the next turn must re-plan from the DB's true latest rather than refine
 * a branch that no longer reflects what is on screen.
 */
useEditor.subscribe((state) => {
  if (lastEditId !== null && state.edl !== lastAiEdl) {
    lastEditId = null;
    lastAiEdl = null;
  }
});

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Every failure branch answers "what do I do now", because the raw server string never does.
 * Preserved verbatim from the surface this replaces — these sentences were written against the real
 * routes and each one names an action the user can actually take.
 */
function httpFailure(status: number, detail: string): { message: string; hold: PlannerState["heldReason"] } {
  if (status === 402) {
    return { message: detail, hold: "needs-key" };
  }
  if (status === 401) {
    return { message: "Your session expired. Reload the page to continue.", hold: null };
  }
  if (status === 429) {
    return {
      message: "You've used today's edits. The count resets tomorrow — your timeline is saved.",
      hold: null,
    };
  }
  if (status === 400 && detail.includes("no usable asset")) {
    return {
      message: "There's no footage to cut yet. Drop a video anywhere on this page, then try again.",
      hold: "needs-footage",
    };
  }
  const lower = detail.toLowerCase();
  if (lower.includes("gateway") || lower.includes("api_key")) {
    return {
      message: "HITE's AI isn't reachable right now. This one is on us, not on you — try again shortly.",
      hold: null,
    };
  }
  return { message: detail, hold: null };
}

export const usePlanner = create<PlannerState>((set, get) => {
  /** Fold one turn-scoped update into the live turn, ignoring events from a turn that has been replaced. */
  function patch(id: string, next: (turn: PlannerTurn) => PlannerTurn) {
    const turn = get().turn;
    if (!turn || turn.id !== id) return;
    set({ turn: next(turn) });
  }

  function applyStreamEvent(evt: { type: string; data?: unknown }, id: string, projectId: string) {
    if (evt.type === "summary" && typeof evt.data === "string") {
      const summary = evt.data;
      patch(id, (t) => ({ ...t, message: summary }));
    } else if (evt.type === "no-op" || evt.type === "warning") {
      const text = typeof evt.data === "string" ? evt.data : (evt.data as { message?: string })?.message;
      if (typeof text === "string") patch(id, (t) => ({ ...t, message: text }));
    } else if (evt.type === "changes" && Array.isArray(evt.data)) {
      const changes = (evt.data as unknown[]).filter((c): c is string => typeof c === "string");
      patch(id, (t) => ({ ...t, changes }));
    } else if (evt.type === "edl") {
      const next = evt.data as Edl;
      // A turn that finishes AFTER the user navigated away must not paint this EDL onto another
      // project: the fetch outlives the component, and the editor store is a module singleton.
      if (useEditor.getState().projectId !== projectId) return;
      const before = useEditor.getState().edl;
      const touched = touchedClipIds(before, next);
      lastAiEdl = next;
      useEditor.getState().applyAiEdl(next);
      // Land the playhead on the first thing that changed, so the picture's hard cut is a cut the
      // user can see. Nothing touched ⇒ nothing moves; implying an edit that did not happen is the
      // one thing this must not do.
      const at = firstTouchedStartTick(next, touched);
      if (at !== null) useEditor.getState().seekTo(tickToMs(at));
      patch(id, (t) => ({ ...t, applied: next, before, touched }));
    } else if (evt.type === "tool-call" || evt.type === "tool-result") {
      const name = (evt.data as { name?: unknown })?.name;
      if (typeof name !== "string") return;
      const event =
        evt.type === "tool-call"
          ? ({ type: "tool-call", name } as const)
          : ({ type: "tool-result", name, result: (evt.data as { result?: unknown })?.result } as const);
      patch(id, (t) => ({ ...t, steps: applyActivityEvent(t.steps, event) }));
    } else if (evt.type === "edit-saved") {
      const editId = (evt.data as { editId?: string })?.editId;
      if (typeof editId === "string") lastEditId = editId;
    } else if (evt.type === "error") {
      const message = (evt.data as { message?: string })?.message ?? "Something broke.";
      patch(id, (t) => ({ ...t, message, failed: true }));
    }
  }

  return {
    turn: null,
    streaming: false,
    held: null,
    heldReason: null,

    send: async (projectId, prompt) => {
      const text = prompt.trim();
      // The guard reads the module flag, not the store: a compose that fires from a closure
      // established at mount would otherwise start a concurrent turn on top of a live one.
      if (!text || streamingNow) return;

      const id = crypto.randomUUID();
      // "take-2.mp4 loaded — name it in a prompt to use it" is an instruction, and this is the user
      // carrying it out. Leaving it on screen through the turn and after it would make a one-time
      // hint into permanent furniture.
      useMediaUpload.getState().clearLastLoaded();
      streamingNow = true;
      set({
        streaming: true,
        held: null,
        heldReason: null,
        turn: {
          id,
          prompt: text,
          steps: [],
          startedAt: Date.now(),
          finishedAt: null,
          message: null,
          changes: [],
          applied: null,
          before: null,
          touched: [],
          undone: false,
          failed: false,
        },
      });

      try {
        // Land any manual edit still inside the 500ms autosave debounce BEFORE planning: the server
        // plans from the project's latest SAVED edit, so an unflushed trim means the AI builds on the
        // pre-trim timeline and `applyAiEdl` then wipes the trim off the visible cut.
        await flushManualEdits();
        const { saveState, saveError } = useEditor.getState();
        if (saveState === "error") {
          throw new Error(
            `Your timeline changes aren't saved (${saveError ?? "save failed"}), so HITE would plan from an older cut. Try again once they save.`,
          );
        }

        const refining = lastEditId !== null;
        /**
         * All three come from `components/settings`, which owns the visitor's credential, the
         * provider they chose and the rung they picked. `providerKeyHeaders()` is the ONLY exported
         * reader of key material and it hands it straight to `fetch` — never a body, never a query
         * string, never through this module.
         *
         * THE SELECTION HAS TO TRAVEL WITH THE KEY. `resolveProviderRun` falls back to
         * `DEFAULT_PROVIDER_ID` ("google") for a request that names no provider, and its own note
         * says the settings UI "always sends the field". It did not: the key went alone, so a
         * visitor who picked Anthropic in the picker had their Anthropic key sent to Google and got
         * back "your key is invalid" — a lie about the key, and the exact failure
         * `providerHeaders.ts` exists to make unrepeatable. A browser with no remembered choice
         * still sends nothing, which is what keeps the documented default a real default.
         */
        const effort = readEffortPreference();
        const provider = readProviderPreference();
        const res = await fetch(refining ? "/api/refine" : "/api/plan", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Scoped: a key entered for another provider is withheld rather than misdirected.
            ...providerKeyHeaders(provider?.providerId),
            ...(provider
              ? providerSelectionHeaders({
                  providerId: provider.providerId,
                  modelId: provider.modelId,
                  baseUrl: provider.baseUrl,
                })
              : {}),
          },
          body: JSON.stringify(
            refining
              ? { editId: lastEditId, prompt: text, ...(effort ? { effort } : {}) }
              : { projectId, prompt: text, ...(effort ? { effort } : {}) },
          ),
        });

        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (typeof body?.error === "string") detail = body.error;
          } catch {
            /* a non-JSON error body is still a failure; the status is what we have */
          }
          const { message, hold } = httpFailure(res.status, detail);
          if (hold) {
            // The sentence is not lost. The composer transforms in place and re-sends it verbatim
            // once the missing thing arrives (§14.3).
            set({ held: text, heldReason: hold });
          }
          throw new Error(message);
        }
        if (!res.body) throw new Error("HITE answered without a response stream.");

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              applyStreamEvent(JSON.parse(payload), id, projectId);
            } catch {
              // One unparseable frame must not abort a turn that is otherwise streaming fine.
            }
          }
        }
      } catch (e) {
        patch(id, (t) => ({ ...t, message: errorText(e), failed: true }));
      } finally {
        streamingNow = false;
        // Stamp the turn's real end, however it ended.
        const finishedAt = Date.now();
        patch(id, (t) => ({ ...t, finishedAt }));
        set({ streaming: false });
      }
    },

    releaseHeld: (projectId) => {
      const held = get().held;
      if (!held) return false;
      set({ held: null, heldReason: null });
      void get().send(projectId, held);
      return true;
    },

    undoTurn: () => {
      const turn = get().turn;
      if (!turn?.applied || turn.undone) return;
      // Reference-guarded: only revert if the LIVE edl is still the one this turn applied, so a later
      // manual edit, refine or turn that has superseded it is never silently thrown away.
      if (useEditor.getState().edl !== turn.applied) return;
      useEditor.getState().undo();
      lastEditId = null;
      lastAiEdl = null;
      set({ turn: { ...turn, undone: true } });
    },

    reset: () => {
      lastEditId = null;
      lastAiEdl = null;
      set({ turn: null, held: null, heldReason: null });
    },
  };
});

/**
 * Can this turn still be undone by pressing its own control?
 *
 * The store's `canUndo` is not the same question: it is true whenever ANY history entry exists. This
 * is specifically "is the timeline still exactly what this turn produced", which is what makes the
 * history line's undo safe to offer at all.
 */
export function turnIsUndoable(turn: PlannerTurn | null, edl: Edl | null): boolean {
  return Boolean(turn && !turn.undone && turn.applied !== null && turn.applied === edl);
}
