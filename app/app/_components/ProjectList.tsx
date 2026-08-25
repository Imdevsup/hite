"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Project {
  id: string;
  title: string;
  updated_at: string;
}

/**
 * WHAT YOU HAVE CUT.
 *
 * The two-step delete is kept — arm, then confirm within three seconds — because it is the only
 * destructive control in the product and there is no undo behind it. What is not kept is how it
 * spoke: `DELETE` → `CONFIRM ✕` → `DELETING`, in uppercase mono, next to `JUST NOW` and `3H AGO`.
 *
 * THE FAILURE PATH CHANGED, NOT JUST THE COPY. A failed delete used to restore the row and fire a
 * toast; the editor no longer mounts a `Toaster` (see `app/app/layout.tsx`), so that would now be a
 * silent failure with the row mysteriously back. The reason is rendered on the row itself.
 */
export function ProjectList({ initialProjects }: { initialProjects: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [arming, setArming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  async function onDelete(id: string) {
    if (arming !== id) {
      setArming(id);
      setTimeout(() => setArming((cur) => (cur === id ? null : cur)), 3000);
      return;
    }
    setArming(null);
    setDeleting(id);
    setFailure(null);

    const previous = projects;
    setProjects((ps) => ps.filter((p) => p.id !== id));
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      // Put it back AND say why, so the row reappearing is an answer rather than a glitch.
      setProjects(previous);
      setFailure({ id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <ul className="flex w-full flex-col gap-[var(--space-1)]">
      {projects.map((p) => {
        const armed = arming === p.id;
        const busy = deleting === p.id;
        return (
          <li key={p.id} className="flex flex-col">
            <div
              className="flex items-center gap-[var(--space-3)] rounded-[var(--r-md)] pr-[var(--space-2)]"
              style={{ background: "var(--s-1)", boxShadow: "inset 0 0 0 1px var(--line-2)" }}
            >
              <Link
                href={`/app/${p.id}`}
                className="flex min-w-0 flex-1 items-baseline gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-4)]"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--t-1)]">{p.title}</span>
                <span className="shrink-0 text-[12px] text-[var(--t-3)]">{lastTouched(p.updated_at)}</span>
              </Link>
              <button
                type="button"
                onClick={() => void onDelete(p.id)}
                aria-disabled={busy}
                aria-label={armed ? `Delete ${p.title} — press again to confirm` : `Delete ${p.title}`}
                className="h-[var(--tap)] shrink-0 rounded-[var(--r-sm)] px-[var(--space-3)] text-[13px]"
                style={{ color: armed ? "var(--color-hit)" : "var(--t-3)" }}
              >
                {busy ? "Deleting" : armed ? "Really delete?" : "Delete"}
              </button>
            </div>
            {failure?.id === p.id && (
              <p role="alert" className="px-[var(--space-4)] pt-[var(--space-2)] text-[13px] leading-relaxed" style={{ color: "var(--color-hit)" }}>
                HITE couldn&rsquo;t delete this — {failure.message}. It is still here.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "3 hours ago". Plain language, because this is a list of videos, not a log. */
function lastTouched(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
