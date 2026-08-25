"use client";
import { Sheet } from "@/components/editor/Sheet";
import { useModifierKeys, formatShortcut } from "@/components/editor/platformKeys";

/**
 * THE `?` SHEET — §13: "**Shortcut hints — zero shortcut surfacing in session one.** … Shortcuts live
 * in the `?` sheet, which the user opens."
 *
 * SO IT HAS NO TRIGGER ON SCREEN. Not a button, not a chip, not a hint. The old editor put
 * `Ctrl+K for commands · ? for shortcuts` in a floating pill that appeared on first run and dismissed
 * itself after four seconds, which §13 calls out as "a WCAG 2.2.1 failure inside a document otherwise
 * fastidious about accessibility" — a message a user cannot pause, stop or re-read. This sheet is
 * reached by pressing `?`, and by nothing else, which is why it does not appear in the first screen's
 * count of eight.
 *
 * EVERY ROW IS A BINDING THAT EXISTS. The list is generated from `EditorShell`'s real hotkey strings
 * through `formatShortcut`, so a Windows keyboard is told Ctrl and an Apple one gets the glyph, and a
 * binding that is removed cannot leave a row behind that lies about it.
 */

/**
 * The bindings, as the strings they are actually registered with. Kept next to the shell that
 * registers them; a label built from a re-typed key name is a label that can drift from its binding.
 */
export const SHORTCUTS: readonly { readonly binding: string; readonly what: string }[] = [
  { binding: "space", what: "Play or pause. Clicking the picture does the same thing." },
  { binding: "mod+z", what: "Undo — your edits and HITE's are one list." },
  { binding: "mod+shift+z", what: "Redo." },
  { binding: "s", what: "Split the clip under the playhead in two." },
  { binding: "backspace", what: "Delete the selected clip and close the gap." },
  { binding: "escape", what: "Deselect the clip." },
  { binding: "alt", what: "Hold to see the video as it was before HITE's last edit." },
  { binding: "enter", what: "Send what you typed." },
  { binding: "shift+enter", what: "New line instead of sending." },
];

export function ShortcutSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const keys = useModifierKeys();

  return (
    <Sheet open={open} onClose={onClose} title="Keyboard">
      <dl className="flex flex-col gap-[var(--space-3)]">
        {SHORTCUTS.map((row) => (
          <div key={row.binding} className="flex items-baseline gap-[var(--space-4)]">
            <dt className="w-[13ch] shrink-0 font-mono text-[12px] text-[var(--t-1)]">
              {formatShortcut(row.binding, keys)}
            </dt>
            <dd className="text-[13px] leading-relaxed text-[var(--t-2)]">{row.what}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
        Inside the clip row and on the playhead, the arrow keys move between clips and along the video.
        On a selected clip&rsquo;s handles they trim a frame at a time, or a second at a time with Shift.
      </p>
    </Sheet>
  );
}
