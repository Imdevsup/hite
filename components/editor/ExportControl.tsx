"use client";
import { useEffect } from "react";
import { useEditor } from "@/lib/editor/store";
import { useExportJob, renderStage } from "@/components/editor/exportJob";
import { AFFORDANCE } from "@/components/editor/affordances";
import { WORKER_IDLE_HINT } from "@/lib/jobs/types";

/**
 * EXPORT — §13's third focusable on the working screen, and the whole of what used to be a 390-line
 * floating window.
 *
 * ONE CONTROL, FOUR STATES, and the state is the label rather than a badge beside it:
 *   idle     → "Export"          starts a render of the timeline as it stands
 *   running  → the real stage    "Queued" / "Rendering" / "Finalizing", from the server's own status
 *   done     → "Download"        a link to the download route, which re-signs per click
 *   failed   → "Try again"       under a sentence written for a person, not for a log reader
 *
 * WHY `aria-disabled` AND NOT `disabled` WHILE IT RUNS. `disabled` removes the control from the tab
 * order, so the working screen would silently drop from eight tab stops to seven the moment a render
 * started, and a keyboard user who had focus on it would be thrown to the top of the document.
 * `aria-disabled` keeps the control where the user left it and still announces that pressing it will
 * not do anything.
 *
 * WHAT IT WILL NOT DO: claim the file matches the screen. `exportJob` holds the exact EDL object the
 * render was queued from, so when the timeline has moved on the line under the control says so — a
 * download button that quietly hands over a video missing the last ten minutes of work is the failure
 * that store was written to prevent.
 */
export function ExportControl({ projectId }: { readonly projectId: string }) {
  const edl = useEditor((s) => s.edl);
  const job = useExportJob();

  // Re-attach to a render this browser started earlier (a reload mid-render), and drop a job that
  // belongs to a different project. The store is a module singleton across client navigation.
  useEffect(() => {
    useExportJob.getState().resume(projectId);
  }, [projectId]);

  const mine = job.projectId === projectId;
  const status = mine ? job.status : "idle";
  // "Queued" is honest but endless when no worker is draining the queue — the reaper only touches
  // rows that are RUNNING, so nothing server-side will ever contradict it. The store says when the
  // wait has gone on long enough to be worth explaining; the label is left alone.
  const unclaimed = mine && status === "running" && job.waitingForWorker;
  const stale = status === "done" && job.sourceEdl !== edl;

  const label =
    status === "running" ? renderStage(job.progress) : status === "done" ? "Download" : status === "failed" ? "Try again" : "Export";

  const shared =
    "inline-flex h-[var(--tap)] items-center gap-2 rounded-[var(--r-sm)] px-[var(--space-4)] text-[13px] font-medium";

  return (
    <div className="flex flex-col items-end gap-[var(--space-2)]">
      {status === "done" && job.downloadUrl ? (
        <a
          data-affordance={AFFORDANCE.export}
          href={job.downloadUrl}
          className={shared}
          style={{ background: "var(--color-accent-cta)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-cta)" }}
        >
          {label}
        </a>
      ) : (
        <button
          data-affordance={AFFORDANCE.export}
          type="button"
          aria-disabled={status === "running" || !edl}
          onClick={() => {
            if (status === "running" || !edl) return;
            void useExportJob.getState().start(projectId, edl.outputs[0]?.aspect ?? "16:9", edl);
          }}
          className={shared}
          style={
            status === "running" || !edl
              ? { background: "var(--s-2)", color: "var(--t-3)" }
              : { background: "var(--s-2)", color: "var(--t-1)", boxShadow: "inset 0 0 0 1px var(--line-5)" }
          }
        >
          {label}
        </button>
      )}

      {/* Everything the render has to say, announced once and never as a percentage the server does
          not measure. `renderStage` exists precisely because the backend reports a coarse
          queued/running/done and a frozen "50%" reads as a hung job. */}
      <p role="status" aria-live="polite" className="max-w-[36ch] text-right text-[12px] leading-snug text-[var(--t-3)]">
        {status === "running" &&
          (unclaimed ? WORKER_IDLE_HINT : `${renderStage(job.progress)} — you can keep editing; this keeps going.`)}
        {stale && "This file is the cut as it was when you pressed export. The timeline has changed since."}
        {status === "failed" && job.failure && `${job.failure.headline} ${job.failure.advice}`}
      </p>
      {status === "failed" && job.failure?.detail && (
        <p className="max-w-[36ch] truncate text-right font-mono text-[12px] text-[var(--t-4)]" title={job.failure.detail}>
          {job.failure.detail}
        </p>
      )}
    </div>
  );
}
