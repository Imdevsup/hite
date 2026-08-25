"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEditor } from "@/lib/editor/store";
import { usePlanner } from "@/components/editor/planner";
import { EditorStyles } from "@/components/editor/EditorStyles";
import { Chrome } from "@/components/editor/Chrome";
import { Picture, pictureAspect, pictureColumnWidth } from "@/components/editor/Picture";
import { Scrubber } from "@/components/editor/Scrubber";
import { Composer } from "@/components/editor/Composer";
import { Strip } from "@/components/editor/Strip";
import { History } from "@/components/editor/History";
import { EmptyState } from "@/components/editor/EmptyState";
import { ActivityTrace } from "@/components/editor/ActivityTrace";
import { EditorAlerts } from "@/components/editor/EditorAlerts";
import { MediaStatus } from "@/components/editor/MediaStatus";
import { GlobalDropZone } from "@/components/editor/GlobalDropZone";
import {
  SettingsSheet,
  getServerProviderKeySnapshot,
  hasProviderKey,
  subscribeProviderKey,
} from "@/components/settings";
import { ShortcutSheet } from "@/components/editor/ShortcutSheet";
import { AnalyzeProgress } from "@/components/editor/AnalyzeProgress";

/**
 * THE EDITOR.
 *
 * > "Your video, big, with a box under it where you type what you want changed. The clips and what
 * > the AI did are one row underneath." — ART-DIRECTION §13
 *
 * That sentence is the layout, in order, and there is nothing else on the screen:
 *
 *      the picture                       big, 16:9, ~62vh. It IS the transport — no play button.
 *      the scrubber                      4px, no numerals, no ruler, no timecode.
 *      [the tool trace, while running]   what HITE is actually doing, as it does it.
 *      the box                           640px. Enter sends. `/` is where capability lives.
 *      the clips  ·  what HITE did       one row.
 *
 * WHAT WAS HERE BEFORE: 31 components and 7,765 lines of TSX, opening on a WORKSHOP breadcrumb, two
 * timecode readouts, three aspect toggles, SAVED / 1 TO WIRE / RESET / HOW / EXPORT, a "PREVIEW
 * ENGINE · LIVE · 1920x1080 · 30FPS · H.264" strip, a six-icon tool rail with Ctrl+1..9 labels,
 * CHAT/INSPECT tabs, a PATCH LOG, a timeline header reading `S SPLIT · BACKSPACE DELETE · I/O TRIM`,
 * an SMPTE ruler, a shortcuts bar, and eleven `react-rnd` floating windows. §13 kills every one of
 * them by name. None of it is demoted, hidden behind a toggle, or moved into a menu — the previous
 * attempt did exactly that and it was rejected. It is deleted.
 *
 * WHAT IS NOT MISSING, ONLY QUIET. Undo and redo, autosave, the reducer's refusals, an unreadable
 * saved edit, a failed upload and a failed render all still work and all still report — in sentences,
 * where they happen, and only when they are true. The three store fields that carry them
 * (`edlLoadError`, `saveState`, `commandError`) are read by `EditorAlerts`; nothing on this screen
 * reports success, because a readout that is always right is a readout nobody needs.
 *
 * ONE LAYOUT, NOT TWO. §13: "Below 900px: the picture, the input, and a horizontally scrolling strip
 * — the same three things, not a scaled desktop and not a second layout." There is no `MobileShell`
 * any more and no viewport branch; the frame is a container and the record row stacks inside it.
 */
export function EditorFrame({ projectId, initialPrompt }: { readonly projectId: string; readonly initialPrompt?: string }) {
  const edl = useEditor((s) => s.edl);
  const assets = useEditor((s) => s.assets);
  const primaryAsset = useEditor((s) => s.primaryAsset);
  const turn = usePlanner((s) => s.turn);
  const heldReason = usePlanner((s) => s.heldReason);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The sheet is `components/settings`' and it is deliberately controlled, so the editor keeps the
  // one boolean: §13 gives this screen exactly one Settings affordance and a sheet that opened itself
  // would be a ninth.
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * Whether a key is stored, read the way React wants an external store read. sessionStorage cannot
   * be touched during a server render, and `getServerProviderKeySnapshot` is the settings module's
   * answer for exactly that — it reports false, so the markup the server produces is the markup a
   * visitor with no key would get.
   */
  const hasKey = useSyncExternalStore(subscribeProviderKey, hasProviderKey, getServerProviderKeySnapshot);
  /** Set once the first-run sheet has been closed, so it asks once and never nags. */
  const [firstRunAsked, setFirstRunAsked] = useState(false);

  /**
   * FIRST RUN: ask for the key before anything needs it.
   *
   * HITE is bring-your-own-key and there is no deployer pool to fall back on — a planning request
   * with no key is a 402, full stop. Until now the only way to learn that was to type a sentence,
   * wait, and be refused, with the fix behind a Settings control you had no reason to have opened.
   * Someone who has just cloned the repo and run it for the first time meets that on their first
   * prompt, which is the worst possible moment.
   *
   * So the sheet opens itself once, on entry, when nothing is stored. It is closeable and it does
   * not come back: the manual timeline is completely usable without a key, and this must not become
   * a wall in front of an editor that works. `hasProviderKey` reads sessionStorage, so it can only
   * be asked after mount — which also keeps the server render (and §13's affordance count, taken
   * from that render) exactly as it was.
   *
   * DERIVED, not an effect. Opening it by calling setState from a mount effect is a cascading
   * render and the lint rule says so; the sheet is simply open when the editor has been entered
   * without a key and that has not yet been acknowledged.
   */
  // The sheet does close as soon as a key is written, which is while the check that validates it is
  // still in flight. That is survivable BECAUSE the panel no longer discards a key on a quota or
  // network failure: the only thing that clears it now is the provider actually refusing it, and
  // that flips `hasKey` back to false, which re-opens this sheet on the spot. Latching it open
  // instead would mean either a ref read during render or setState from an effect, both of which
  // the hooks lint rejects, for the same reason: they are renders that fight themselves.
  const showSettings = settingsOpen || (!hasKey && !firstRunAsked);
  const closeSettings = () => {
    setSettingsOpen(false);
    setFirstRunAsked(true);
  };

  /**
   * The held sentence runs by itself the moment there is something to run it on.
   *
   * This is the other half of "the prompt is never lost": pressing an example (or sending before
   * there was footage) holds the sentence rather than firing a turn `/api/plan` is certain to refuse,
   * and footage arriving is the event that makes it sendable. §14.3 states the same contract for the
   * 402 path, where the trigger is a key rather than a video.
   *
   * TWO GUARDS, AND BOTH ARE LOAD-BEARING. The trigger is `ready` — an asset with a READABLE length,
   * the same test `/api/plan` applies — and not merely "a timeline exists": a project can hold a
   * saved EDL whose asset was never probed, and releasing against that answers 400 "no usable asset",
   * which re-holds the sentence and asks again. `releasedFor` closes the same loop from the other
   * side: one sentence is auto-sent once. Without either, a held prompt is an infinite retry.
   */
  const ready = assets.some((a) => (a.duration_ms ?? 0) > 0);
  const releasedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || heldReason !== "needs-footage") return;
    const held = usePlanner.getState().held;
    if (!held || releasedFor.current === held) return;
    releasedFor.current = held;
    usePlanner.getState().releaseHeld(projectId);
  }, [ready, heldReason, projectId]);

  // The `?` sheet, and the only way into it. Bound here rather than through the hotkey library so it
  // can be ignored while the user is typing — `?` inside a sentence is a question mark.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const columnWidth = pictureColumnWidth(pictureAspect(edl));

  return (
    <div className="flex h-full w-full flex-col">
      <EditorStyles />
      <Chrome projectId={projectId} showExport={Boolean(edl)} onOpenSettings={() => setSettingsOpen(true)} />

      {edl ? (
        <main className="hite-frame flex min-h-0 flex-1 flex-col items-center justify-center px-[var(--gutter)] pb-[var(--space-5)]">
          <div className="flex w-full flex-col" style={{ width: columnWidth, maxWidth: "100%" }}>
            <Picture />
            <Scrubber />

            {/* §13: "the streaming tool trace appears DURING a run, above the input, and is
                aria-live text, not a control. Not a first-screen affordance." */}
            {turn && turn.finishedAt === null && (
              <div className="mt-[var(--space-4)] flex justify-center">
                <ActivityTrace steps={turn.steps} startedAt={turn.startedAt} finishedAt={turn.finishedAt} />
              </div>
            )}

            <div className="mt-[var(--space-5)] flex justify-center">
              <Composer
                projectId={projectId}
                initialPrompt={initialPrompt}
                onNeedsFootage={() => undefined}
                placeholder="what do you want changed?"
              />
            </div>

            {/* "The clips and what the AI did are one row underneath." */}
            <div className="hite-record mt-[var(--space-5)] flex w-full items-center gap-[var(--space-4)]">
              <Strip />
              <History />
            </div>

            {/* Analysis is what makes "cut the dead air" possible, and it takes a while. One line, no
                pills, no percentage the worker does not measure — and it disappears the moment it has
                an answer. A readout, never a control. */}
            <AnalyzeProgress assetId={primaryAsset?.id ?? null} kind={primaryAsset?.kind ?? "video"} />
          </div>
        </main>
      ) : (
        <EmptyState projectId={projectId} initialPrompt={initialPrompt} />
      )}

      <GlobalDropZone projectId={projectId} />
      {/* Only on the working screen: `EmptyState` reports its own uploads, and two readouts of the
          same store at once would say the same thing twice. */}
      {edl && <MediaStatus />}
      <EditorAlerts />
      <SettingsSheet open={showSettings} onClose={closeSettings} />
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
