"use client";
import { useEffect } from "react";
import { KiteMark } from "./KiteMark";
import { useMediaUpload } from "./mediaUpload";

/**
 * GLOBAL DROP ZONE — the one window-level drop handler in the editor.
 *
 * It used to be a picture of one. It listened for `dragenter`/`dragleave` to paint a full-viewport
 * "Drop to load" overlay, and handled the `drop` itself nowhere: the real listener lived inside
 * `MediaWindow`, so dropping a file worked only while that particular floating panel happened to be
 * open, and did nothing at all on the first screen or on a phone. The overlay promised a capability
 * that was conditional on a window the user could not see.
 *
 * Now the upload pipeline is shared (`components/editor/mediaUpload.ts`) and this component owns the
 * single `drop` listener for the whole editor. `MediaWindow` itself is gone; the same store is read
 * by `EmptyState` on the first screen, by `MediaStatus` on the working screen, and by `EditorAlerts`
 * for failures — three readers, one listener, so a drop can never be handled twice.
 */
export function GlobalDropZone({ projectId }: { projectId: string }) {
  const active = useMediaUpload((s) => s.dragActive);

  useEffect(() => {
    const { setDragActive } = useMediaUpload.getState();
    // Nested elements fire enter/leave as the pointer crosses them; count depth so the overlay does
    // not flicker off while the file is still over the window.
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    // preventDefault on dragover is what makes the window a valid drop target at all; without it the
    // browser navigates to the file instead.
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) void useMediaUpload.getState().uploadFiles(projectId, files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      setDragActive(false);
    };
  }, [projectId]);

  if (!active) return null;

  return (
    <div data-arrive className="pointer-events-none fixed inset-0 z-[9996] flex items-center justify-center p-[var(--space-5)]">
      <div
        className="absolute inset-[var(--space-4)] flex flex-col items-center justify-center gap-[var(--space-5)] overflow-hidden rounded-[var(--r-lg)] border-2 border-dashed"
        style={{
          borderColor: "var(--color-accent-dim)",
          background: "var(--s-scrim)",
          backdropFilter: "blur(var(--blur-sm))",
        }}
      >
        <KiteMark size={48} accent stroke={1.6} />
        <p className="italic-serif text-center" style={{ fontSize: "44px", lineHeight: 1.05, color: "var(--t-2)" }}>
          Let go
        </p>
      </div>
    </div>
  );
}
