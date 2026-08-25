/**
 * Shared debounced persister factory. Used by both the window-layout store
 * and the editor (manual-edit) store so the autosave semantics are
 * identical in both places.
 *
 * Contract:
 *   • Call `persist(payload)` any number of times; only the last one within
 *     the debounce window is sent.
 *   • `flush(opts?)` forces any pending payload to send immediately (useful on
 *     unmount / page unload). `keepalive` is forwarded to `send` so an unload
 *     flush can issue a request the browser won't cancel with the document.
 *   • A failed send is RETRIED (`retries` extra attempts, exponential backoff).
 *     If every attempt fails, the payload goes BACK in `pending` — a later
 *     `flush()` or edit can still save it — and `onError` fires. Dropping it (the
 *     original behaviour) lost the user's work with a console line as the only trace.
 *   • `onStatusChange` reports saving/saved/error so a store can expose honest
 *     save state instead of failing invisibly. Both callbacks are handed the
 *     PAYLOAD they are reporting on: a send outlives the state that queued it
 *     (a flush on project switch, a retry after navigation), so the receiver
 *     needs to know whose result this is before writing it anywhere.
 */

/** Lifecycle of the last save: what a UI would render as "Saving…/Saved/Not saved". */
export type PersistStatus = "saved" | "saving" | "error";

export interface SendOptions {
  /** This send is racing a page unload — use `fetch(…, { keepalive: true })` so it survives. */
  keepalive: boolean;
}

export interface DebouncedPersister<T> {
  persist: (payload: T) => void;
  flush: (opts?: Partial<SendOptions>) => Promise<void>;
  cancel: () => void;
}

export function createDebouncedPersister<T>(opts: {
  send: (payload: T, sendOpts: SendOptions) => Promise<void>;
  waitMs?: number;
  /** Extra attempts after the first failure. Default 0 — send once, as before. */
  retries?: number;
  /** Backoff base: retry N waits `retryDelayMs * 2^(N-1)`. */
  retryDelayMs?: number;
  /** `payload` is the send this failure belongs to — see the contract note above. */
  onError?: (err: unknown, payload: T) => void;
  /** `payload` is the send this status belongs to — see the contract note above. */
  onStatusChange?: (status: PersistStatus, payload: T) => void;
}): DebouncedPersister<T> {
  const waitMs = opts.waitMs ?? 400;
  const retries = opts.retries ?? 0;
  const retryDelayMs = opts.retryDelayMs ?? 400;
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function sendWithRetry(payload: T, sendOpts: SendOptions): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        // A newer payload is already queued. Payloads are whole-state snapshots, so it supersedes
        // this one entirely — retrying the stale one would only write an older state.
        if (pending !== undefined) return;
        await sleep(retryDelayMs * 2 ** (attempt - 1));
        if (pending !== undefined) return;
      }
      try {
        await opts.send(payload, sendOpts);
        opts.onStatusChange?.("saved", payload);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    // Out of attempts: keep the payload queued so the next flush (or the unload handler) can still
    // save it, and report the failure. Never drop the user's state on the floor.
    if (pending === undefined) pending = payload;
    opts.onStatusChange?.("error", payload);
    opts.onError?.(lastErr, payload);
  }

  async function flush(flushOpts: Partial<SendOptions> = {}): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === undefined) return;
    const keepalive = flushOpts.keepalive ?? false;
    // Never overlap two sends: they race each other server-side (the edit table's per-project
    // version is unique), so one would be rejected. An unload flush can't wait — the document is
    // going away — so it skips the queue.
    if (inflight && !keepalive) await inflight;
    if (pending === undefined) return;
    const payload = pending;
    pending = undefined;
    opts.onStatusChange?.("saving", payload);
    const run = sendWithRetry(payload, { keepalive }).finally(() => {
      if (inflight === run) inflight = null;
    });
    inflight = run;
    await run;
  }

  function persist(payload: T) {
    pending = payload;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, waitMs);
  }

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = undefined;
  }

  return { persist, flush, cancel };
}
