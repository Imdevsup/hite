"use client";
import { create } from "zustand";
import type { Edl } from "@/lib/edl/schema";
import { WORKER_IDLE_HINT_MS } from "@/lib/jobs/types";

/**
 * EXPORT JOB — the render you started, held outside the panel that started it.
 *
 * The Export window used to keep `status` / `progress` / `url` in component state and its poll in a
 * `useEffect` cleanup. Closing the panel — a natural thing to do during a multi-minute sandbox
 * render — cleared the interval and threw the export id away, so the render carried on server-side
 * with nothing left in the browser that knew it existed. Reopening showed "RENDER", as if you had
 * never pressed it. The panel is gone (§13 deletes all eleven of them); this store is the half of it
 * that was right, and `ExportControl` is the half that is now one button.
 *
 * The job's real identity has lived in the database the whole time (the `export` row plus its job
 * row; `GET /api/render/[id]` derives an honest status and a real error string from both). All this
 * store adds is the one thing the browser has to remember: WHICH id to ask about. That id is written
 * to localStorage, so the render also survives a reload — the status shown afterwards is read back
 * from the server, never restored from a cached guess.
 *
 * WHAT LEFT WHEN THE PANEL DID. The store used to fire its own completion toast and a chime, because
 * the panel that started the render might be closed by the time it landed. There is no panel any
 * more: `ExportControl` is one always-visible control whose LABEL is the state, and it reads this
 * store directly — so a notice fired from here would be a second, quieter copy of something already
 * on screen. ART-DIRECTION §9 also settles the chime: the property has "no sound design, no UI
 * chirps". Both are deleted; the honest reporting they wrapped is unchanged and is rendered instead.
 */

export type ExportStatus = "idle" | "running" | "done" | "failed";

const POLL_MS = 1500;
/** Give up after this many consecutive unreadable polls, rather than looking hung forever. */
const MAX_CONSECUTIVE_ERRORS = 5;
/**
 * How many consecutive `queued` polls before the control admits nothing has started the render.
 *
 * Not a client-side timeout, and nothing here fails the job: the reaper only moves `running` rows,
 * so a render nobody claims stays "Queued" for as long as the tab is open, and the usual cause is
 * `pnpm worker` not running. Waiting behind another render is also a legitimate `queued`, which is
 * why this only adds a sentence and never changes the status.
 */
const UNCLAIMED_TICKS = Math.ceil(WORKER_IDLE_HINT_MS / POLL_MS);
const LS_KEY = "hite.export.v1";

/**
 * The backend reports a coarse status→progress mapping (queued .05 / running .5 / done 1), not a
 * true per-frame percent. Surface it as a named STAGE with an indeterminate playhead instead of a
 * frozen "50%", which reads as a hung render during the (multi-minute) sandbox job.
 */
export function renderStage(progress: number): string {
  if (progress >= 1) return "Finalizing";
  if (progress >= 0.5) return "Rendering";
  return "Queued";
}

/** What the user is told when a render stops, and the engine's own words underneath it. */
export interface ExportFailure {
  /** One plain sentence. No jargon, no "check logs" — the user has no logs. */
  readonly headline: string;
  /** What HITE can actually do about it, phrased as an action. */
  readonly advice: string;
  /** Verbatim from the render engine, when there is one. Shown as secondary detail, never as THE message. */
  readonly detail: string | null;
}

/**
 * Turn whatever the render reported into something a person can act on.
 *
 * The old copy was "RENDER STOPPED · CHECK LOGS", addressed to an engineer who does not exist: a
 * HITE user has no logs and no way to get them. Everything below is derived from the real failure —
 * the engine's message is kept and shown, it is just no longer the whole explanation.
 */
export function describeExportFailure(raw: string | null): ExportFailure {
  const detail = raw && raw.trim() ? raw.trim() : null;
  const text = (detail ?? "").toLowerCase();

  if (text.includes("timeout") || text.includes("timed out") || text.includes("deadline")) {
    return {
      headline: "The render ran out of time before it finished.",
      advice: "Long or heavy cuts can outlast the render window. Try again, or shorten the timeline first.",
      detail,
    };
  }
  // \boom\b, not includes("oom") — "boom" is not an out-of-memory kill, and mis-attributing a
  // failure sends the user off shortening footage that was never the problem.
  if (text.includes("out of memory") || /\boom\b/.test(text)) {
    return {
      headline: "The render ran out of memory.",
      advice: "This usually means the footage is very large. Try a shorter cut or a smaller source file.",
      detail,
    };
  }
  if (text.includes("no such file") || text.includes("404") || text.includes("not found")) {
    return {
      headline: "The render couldn't reach one of your files.",
      advice: "Drop the clip onto the editor again, then export again.",
      detail,
    };
  }
  return {
    headline: "The render stopped before it finished.",
    advice: "Nothing on your timeline was lost — press render again. If it keeps stopping, the detail below is what the engine reported.",
    detail,
  };
}

export interface ExportJobState {
  /**
   * The project this job belongs to, and the gate that keeps it there.
   *
   * The store is a module singleton and survives client-side navigation, so every reader MUST
   * compare this against its own project before rendering any other field — `ExportControl` does.
   * `resume` enforces the same invariant from the writing side: a job belonging to another project
   * is dropped from the store rather than left sitting where the new project's control can read it.
   */
  projectId: string | null;
  exportId: string | null;
  status: ExportStatus;
  /** Coarse, server-derived. Drives the stage name only — never printed as a percentage. */
  progress: number;
  /**
   * The job has been `queued` for long enough that nothing is plausibly working on it. Additive:
   * the status stays `running` and the poll keeps going, so this clears itself the moment a worker
   * claims the job.
   */
  waitingForWorker: boolean;
  /** Same-origin download route; re-signs per click. Only set once the render actually succeeded. */
  downloadUrl: string | null;
  failure: ExportFailure | null;
  /**
   * The exact EDL object this render was queued from, held by reference.
   *
   * A finished download is a file of the cut AS IT WAS. Keeping the timeline it came from lets the
   * control say so when the user has edited since — the alternative is a download button that
   * quietly hands over a video missing the last ten minutes of work.
   *
   * `null` when the render was resumed after a reload: the object that was rendered from died with
   * the old page, and `null` never matches the live EDL.
   */
  sourceEdl: Edl | null;

  /** Queue a render. Resolves once the request is answered (the poll continues in the background). */
  start: (projectId: string, aspect: "16:9" | "9:16" | "1:1", sourceEdl: Edl | null) => Promise<void>;
  /**
   * Re-attach to a render this browser started earlier (editor remounted, or page reloaded), and drop
   * any job that belongs to a DIFFERENT project. Reads the job's CURRENT state from the server; it
   * restores nothing from local storage but the id.
   */
  resume: (projectId: string) => void;
  /** Clear a finished/failed job so the control offers a fresh render. */
  reset: () => void;
}

interface StoredJob {
  projectId: string;
  exportId: string;
}

function readStored(): StoredJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredJob>;
    if (typeof parsed.projectId !== "string" || typeof parsed.exportId !== "string") return null;
    return { projectId: parsed.projectId, exportId: parsed.exportId };
  } catch {
    return null;
  }
}

function writeStored(job: StoredJob | null) {
  if (typeof window === "undefined") return;
  try {
    if (job) window.localStorage.setItem(LS_KEY, JSON.stringify(job));
    else window.localStorage.removeItem(LS_KEY);
  } catch {
    /* private mode / quota — the render still runs, it just won't survive a reload */
  }
}

/** The single live interval. Module scope so it outlives every component that looks at it. */
let pollTimer: ReturnType<typeof setInterval> | null = null;
/**
 * Bumped every time polling starts or stops. An in-flight `fetch` from a superseded poll resolves
 * after its interval is gone; comparing generations is what stops that late answer from writing a
 * dead job's status over the live one.
 */
let pollGeneration = 0;

function stopPolling() {
  pollGeneration += 1;
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export const useExportJob = create<ExportJobState>((set, get) => {
  /**
   * Poll one export id until it settles. A single status fetch can blip (network, a 5xx, a
   * non-JSON error page after the session expires), so a few consecutive failures are tolerated
   * before the job is called lost — but it is always eventually called something.
   */
  function poll(exportId: string) {
    stopPolling();
    const generation = pollGeneration;
    let consecutiveErrors = 0;
    let consecutiveQueued = 0;

    const settle = (next: Partial<ExportJobState>) => {
      stopPolling();
      writeStored(null);
      set(next);
    };

    const tick = async () => {
      if (generation !== pollGeneration) return; // superseded before this tick even ran
      try {
        const res = await fetch(`/api/render/${exportId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { status?: string; progress?: number; error?: string | null };
        if (generation !== pollGeneration) return; // a late answer from a job that has been replaced
        consecutiveErrors = 0;
        consecutiveQueued = body.status === "queued" ? consecutiveQueued + 1 : 0;
        set({
          progress: typeof body.progress === "number" ? body.progress : 0,
          waitingForWorker: consecutiveQueued >= UNCLAIMED_TICKS,
        });

        if (body.status === "succeeded") {
          // The download route, not a stored signed url. It re-signs the object per click, so the
          // credential the browser holds lives ten minutes instead of the week the worker's own url
          // was minted for — and the link keeps working after that url has expired.
          settle({ status: "done", progress: 1, downloadUrl: `/api/export/${exportId}`, failure: null, waitingForWorker: false });
        } else if (body.status === "failed") {
          settle({ status: "failed", progress: 0, failure: describeExportFailure(body.error ?? null), waitingForWorker: false });
        }
      } catch {
        if (generation !== pollGeneration) return;
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          settle({
            status: "failed",
            waitingForWorker: false,
            failure: {
              headline: "HITE lost contact with your render.",
              advice: "It may still be running. Check your connection and reload the page to pick it back up.",
              detail: null,
            },
          });
        }
      }
    };

    // One immediate read, so reopening the panel (or reloading) shows the job's REAL state now
    // rather than a manufactured "Queued" for the first poll interval.
    void tick();
    pollTimer = setInterval(() => void tick(), POLL_MS);
  }

  return {
    projectId: null,
    exportId: null,
    status: "idle",
    progress: 0,
    waitingForWorker: false,
    downloadUrl: null,
    failure: null,
    sourceEdl: null,

    start: async (projectId, aspect, sourceEdl) => {
      // Only THIS project's in-flight render blocks a new one. Guarding on `status` alone made the
      // Export control in project B dead while project A's job was still in the store —
      // the press returned here and nothing happened. A leftover job from another project is
      // superseded instead: its id is still in localStorage, so reopening that project re-attaches.
      const current = get();
      if (current.status === "running" && current.projectId === projectId) return;
      stopPolling();
      set({ projectId, exportId: null, status: "running", progress: 0, waitingForWorker: false, downloadUrl: null, failure: null, sourceEdl });
      try {
        const res = await fetch("/api/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, aspect }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `HTTP ${res.status}`);
        }
        const { exportId } = (await res.json()) as { exportId?: string };
        if (typeof exportId !== "string") throw new Error("the render was queued without an id");
        set({ exportId });
        writeStored({ projectId, exportId });
        poll(exportId);
      } catch (e) {
        set({ status: "failed", waitingForWorker: false, failure: describeExportFailure(e instanceof Error ? e.message : String(e)) });
      }
    },

    resume: (projectId) => {
      const current = get();
      // Already tracking something for this project (the panel just remounted) — leave it alone.
      if (current.projectId === projectId && current.status !== "idle") return;
      // Otherwise the store may still be holding ANOTHER project's job. Returning early here (the
      // old behaviour) left it in place, and this project's control then read someone else's render:
      // a running strip over an untouched timeline, a dead Export control, and finally a download
      // link for a different project's video. Drop it. The render itself is unaffected — it
      // lives on the server and its id is still in localStorage, so opening that project re-attaches
      // and reads its real state back.
      //
      // THE TRADE, STATED SO IT IS NOT RE-LITIGATED BY ACCIDENT: this is belt-and-braces on top of
      // the control's own `projectId` gate, and it costs the abandoned job its live status (the poll
      // stops; the render itself is untouched). It is kept because the store holds exactly ONE job, and "the job in the store
      // belongs to the project whose panel is open, or to nobody" is an invariant a future reader
      // cannot forget — whereas "remember to compare projectId" is an obligation they can. A store
      // that tracks a job PER project is the redesign that would give up nothing; it is not this.
      if (current.projectId !== null && current.projectId !== projectId) {
        stopPolling();
        set({ projectId: null, exportId: null, status: "idle", progress: 0, waitingForWorker: false, downloadUrl: null, failure: null, sourceEdl: null });
      }
      const stored = readStored();
      if (!stored || stored.projectId !== projectId) return;
      set({
        projectId,
        exportId: stored.exportId,
        status: "running",
        progress: 0,
        waitingForWorker: false,
        downloadUrl: null,
        failure: null,
        // Unknown after a reload — the EDL object that was rendered from is gone with the old page.
        // `null` never matches the live EDL, so the control errs toward warning that the file may be
        // out of date rather than toward implying it is current.
        sourceEdl: null,
      });
      poll(stored.exportId);
    },

    reset: () => {
      stopPolling();
      writeStored(null);
      set({ projectId: null, exportId: null, status: "idle", progress: 0, waitingForWorker: false, downloadUrl: null, failure: null, sourceEdl: null });
    },
  };
});
