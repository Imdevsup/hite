/**
 * Make an abort reach work that does not take an AbortSignal.
 *
 * `runWithDeadline` ABANDONS its handler when the deadline expires — that is deliberate, because a
 * wedged render is exactly what a deadline is for and a wedged promise cannot be made to settle. The
 * consequence is that anything the handler started keeps running unless something else stops it.
 * `renderMedia` is the case that matters: it takes Remotion's own `CancelSignal` rather than an
 * `AbortSignal`, so before this existed a timed-out render left headless Chrome rendering the same
 * composition forever. Observed 2026-08-24 — a render stalled on one frame, the job was correctly
 * failed at its deadline and retried, and the abandoned Chrome was still burning ~7 cores and had to
 * be killed by hand. That leak compounds with every timeout and starves the retry meant to save the
 * job.
 *
 * Returns the disposer, which the caller must run on the success path so a finished job does not
 * leave a listener on a signal that outlives it.
 */
export function cancelOnAbort(signal: AbortSignal, cancel: () => void): () => void {
  // An ALREADY-aborted signal never fires again, so a plain addEventListener here would attach a
  // listener that can only wait forever — the work would run to completion under a signal that had
  // already said stop. This is the branch a shutdown mid-claim actually takes.
  if (signal.aborted) {
    cancel();
    return () => {};
  }
  const onAbort = () => cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
