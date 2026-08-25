"use client";
import { useEffect, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { EditorFrame } from "@/components/editor/EditorFrame";
import { ErrorBoundary } from "@/components/editor/ErrorBoundary";
import { usePlanner } from "@/components/editor/planner";
import { useEditor, hydrateProject, flushManualEdits, type Asset } from "@/lib/editor/store";
import type { Edl } from "@/lib/edl/schema";

type Props = {
  project: { id: string; title: string };
  initialAssets: Asset[];
  initialEdl: Edl | null;
  /** Why the saved edit couldn't be loaded, when that's why `initialEdl` is null (blocks autosave). */
  initialEdlError: string | null;
  /** The landing's `?prompt=` deep link, read on the server. */
  initialPrompt?: string;
};

/**
 * THE SHELL — hydration, keys, and one surface.
 *
 * WHAT IS NOT HERE ANY MORE. There were three surfaces (a prompt screen, a desktop workspace, a
 * separate 336-line mobile shell), a viewport branch that chose between two of them, a floating
 * window manager with a persisted layout, a dock store, a command palette, an intent bus that existed
 * only because those shells rendered different chrome, and a one-time keyboard hint that told the
 * user about `Ctrl+K` four seconds after they arrived. §13 deletes all of it. There is one surface,
 * so there is nothing to route an intent between — `components/editor/intents.ts` and both stores are
 * gone with the shells that needed them.
 *
 * THE TWO INVARIANTS THAT SURVIVE UNCHANGED, because both were bugs before they were rules:
 *   1. HYDRATION IS KEYED ON THE PROJECT ID, not a boolean. The store is a module singleton that
 *      survives client-side navigation, so a boolean guard skipped hydration when the router swapped
 *      projects in place and left project A's timeline, undo history and pending autosave live on
 *      project B. `hydrateProject` owns that reset.
 *   2. HOTKEY HANDLERS READ STATE THROUGH `getState()` rather than capturing reactive values, so
 *      their identity is stable and react-hotkeys-hook is not resubscribing every render.
 *
 * THE BINDINGS ARE DELIBERATELY FEW. §13 allows shortcuts to exist but forbids surfacing them in
 * session one, and every binding here is one a person could press by accident: `j`/`k`/`l`, `i`/`o`
 * and the `Ctrl+1..9` panel keys are gone with the panels and the NLE vocabulary they came from.
 * What is left is play/pause, undo/redo, split, delete and deselect — each undoable, each listed in
 * the `?` sheet the user opens, and none of them announced on screen.
 */
export function EditorShell({ project, initialAssets, initialEdl, initialEdlError, initialPrompt }: Props) {
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (hydratedFor.current === project.id) return;
    hydratedFor.current = project.id;
    // A different project's AI turn is not this project's history — and its `editId` would make the
    // next sentence refine an edit belonging to somewhere else.
    usePlanner.getState().reset();
    hydrateProject({
      projectId: project.id,
      assets: initialAssets,
      edl: initialEdl,
      edlLoadError: initialEdlError,
    });
  }, [project.id, initialEdl, initialAssets, initialEdlError]);

  useEffect(() => {
    const handler = () => {
      // keepalive: an ordinary fetch started in beforeunload is cancelled with the document, which
      // silently lost every edit still inside the 500ms autosave debounce.
      void flushManualEdits({ keepalive: true });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Transport. The picture is the primary control; space is the one binding everybody already knows.
  useHotkeys("space", (e) => {
    e.preventDefault();
    useEditor.getState().togglePlay();
  });

  // Manual editing. Both go through the store's command helpers, so a refusal is reported by
  // `EditorAlerts` in plain English rather than swallowed into a console warning.
  useHotkeys("s", (e) => {
    e.preventDefault();
    useEditor.getState().splitAtPlayhead();
  });
  useHotkeys("backspace,delete", (e) => {
    e.preventDefault();
    useEditor.getState().rippleDelete();
  });
  useHotkeys("escape", () => useEditor.getState().selectClip(null));

  // ONE history, shared by the manual UI and the planner, because both emit the same commands
  // through the same reducer.
  useHotkeys("mod+z", (e) => {
    e.preventDefault();
    useEditor.getState().undo();
  });
  useHotkeys("mod+shift+z,mod+y", (e) => {
    e.preventDefault();
    useEditor.getState().redo();
  });

  return (
    <ErrorBoundary>
      <EditorFrame projectId={project.id} initialPrompt={initialPrompt} />
    </ErrorBoundary>
  );
}
