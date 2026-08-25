"use client";
import { useMediaUpload } from "@/components/editor/mediaUpload";

/**
 * WHAT IS HAPPENING TO A FILE YOU JUST DROPPED — on the WORKING screen only.
 *
 * `EmptyState` reports uploads on the first screen and is unmounted the moment an EDL exists, so
 * after the first file every subsequent drop was completely silent: no progress while the bytes went
 * up, no line when the asset registered, and — because a new asset does not join the timeline by
 * itself — no change anywhere on screen. Dropping a second take was indistinguishable from dropping
 * it on a page that ignores drops. (Failures had the same problem and are fixed separately, in
 * `EditorAlerts`, which owns the one banner.)
 *
 * WHY IT SAYS "name it in a prompt". Because that is the mechanism, and it is not guessable. Every
 * asset on the project is listed to the model as `id :: filename :: length` (`assetContextLines` in
 * lib/ai/agents/planner.ts), so naming the file in a sentence is exactly how a second take reaches
 * the timeline. Without that sentence the honest report of a successful upload — a filename and
 * nothing else — leaves the user holding a file with no way to use it.
 *
 * NOT A SUCCESS CHIP. The chrome deliberately reports nothing that went right (`Chrome.tsx`), and
 * this does not break that rule: an upload is a user-initiated operation with a duration and no
 * other visible outcome, which is the one case where silence is a failure of its own. It carries no
 * focusable element, so the first-screen affordance count (`affordances.ts`) is unchanged.
 */
export interface MediaStatusInput {
  /** The file currently going up, or null when nothing is in flight. */
  readonly uploadingName: string | null;
  /** "2/4" during a multi-file drop; null for a single file. */
  readonly queueLabel: string | null;
  /** 0-1, real bytes-sent. */
  readonly progress: number;
  /** The newest file that finished, or null before the first one. */
  readonly lastLoadedName: string | null;
}

/**
 * The store wiring. All the markup is in `MediaStatusView`, split for the same reason
 * `EditorAlerts` is: a zustand-driven component server-renders from the store's INITIAL state, so a
 * test that renders THIS one can only ever see the defaults.
 */
export function MediaStatus() {
  return (
    <MediaStatusView
      uploadingName={useMediaUpload((s) => s.uploadingName)}
      queueLabel={useMediaUpload((s) => s.queueLabel)}
      progress={useMediaUpload((s) => s.progress)}
      lastLoadedName={useMediaUpload((s) => s.lastLoadedName)}
    />
  );
}

export function MediaStatusView({ uploadingName, queueLabel, progress, lastLoadedName }: MediaStatusInput) {
  const busy = uploadingName !== null;
  if (!busy && !lastLoadedName) return null;

  return (
    <div
      data-arrive
      className="pointer-events-none fixed inset-x-0 bottom-[var(--space-3)] z-[69] flex justify-center px-[var(--space-4)]"
    >
      <div
        className="flex max-w-[52ch] items-center gap-[var(--space-3)] rounded-[var(--r-pill)] px-[var(--space-4)] py-[var(--space-2)]"
        style={{ background: "var(--s-panel)", boxShadow: `var(--specular), 0 0 0 1px var(--line-3)` }}
      >
        {busy ? (
          <>
            <span className="truncate text-[12px] text-[var(--t-2)]">
              {uploadingName}
              {queueLabel && <span className="ml-[var(--space-2)] text-[var(--t-4)]">{queueLabel}</span>}
            </span>
            {/* Real bytes-sent fraction from the storage upload. `useMediaUpload` never synthesises it. */}
            <span className="h-[3px] w-[80px] shrink-0 overflow-hidden rounded-[var(--r-pill)]" style={{ background: "var(--s-2)" }}>
              <span
                className="block h-full"
                style={{ width: `${progress * 100}%`, background: "var(--color-accent)" }}
              />
            </span>
            <span className="shrink-0 tabular-nums text-[12px] text-[var(--t-3)]">{Math.round(progress * 100)}%</span>
          </>
        ) : (
          <span className="truncate text-[12px] text-[var(--t-2)]">
            {lastLoadedName}
            <span className="ml-[var(--space-2)] text-[var(--t-3)]">loaded — name it in a prompt to use it</span>
          </span>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {busy
          ? `Adding ${uploadingName}, ${Math.round(progress * 100)} percent`
          : `${lastLoadedName} is loaded. Name it in a prompt to use it.`}
      </p>
    </div>
  );
}
