"use client";
import Link from "next/link";
import { KiteMark } from "@/components/editor/KiteMark";
import { AFFORDANCE } from "@/components/editor/affordances";
import { ExportControl } from "@/components/editor/ExportControl";

/**
 * THE TOP ROW — two things before there is footage, three after. Nothing else.
 *
 * §13's kill list is mostly this strip: "WORKSHOP · THE PATCH LOG · 1 TO WIRE · PREVIEW ENGINE ·
 * `1920×1080 · 30FPS · SOURCE-A.MP4 · 16:9 · H.264` · SMPTE anywhere · … · `Ctrl+K for commands · ?
 * for shortcuts` · the six-icon tool rail · CHAT/INSPECT tabs · the project title in chrome · the
 * aspect toggles · SAVED/RESET/HOW · the status bar". All of it was here. All of it is gone.
 *
 * WHAT IS NOT MISSING, ONLY MOVED. Autosave still runs, and its ONE reportable state — a save that
 * failed, which means the database is behind the screen — is a sentence in `EditorAlerts` rather
 * than a green "SAVED" chip. §13's rule about timecode applies to the same instinct: a readout that
 * is always right is a readout nobody needs, and a readout that is sometimes wrong has to say so in
 * words. There is nothing here that reports success.
 *
 * THE KITE IS THE MARK (§10). Four straight strokes, square caps, mitered joins, 1.6px — logo,
 * favicon, focus indicator and loading state, all one mark. It links home, which is the landing.
 */
export function Chrome({
  projectId,
  showExport,
  onOpenSettings,
}: {
  readonly projectId: string;
  readonly showExport: boolean;
  /** The sheet itself belongs to `components/settings` (§14); this owns only the way in. */
  readonly onOpenSettings: () => void;
}) {
  return (
    <header
      className="flex shrink-0 items-start justify-between px-[var(--gutter)]"
      style={{ minHeight: "var(--nav-h)", paddingBlock: "var(--space-3)" }}
    >
      <Link
        data-affordance={AFFORDANCE.home}
        href="/"
        aria-label="HITE — back to the home page"
        className="inline-flex h-[var(--tap)] items-center rounded-[var(--r-xs)] pr-[var(--space-3)]"
      >
        <KiteMark size={22} stroke={1.6} accent />
      </Link>

      <div className="flex items-start gap-[var(--space-4)]">
        {showExport && <ExportControl projectId={projectId} />}
        <button
          data-affordance={AFFORDANCE.settings}
          type="button"
          onClick={onOpenSettings}
          className="inline-flex h-[var(--tap)] items-center rounded-[var(--r-sm)] px-[var(--space-3)] text-[13px] text-[var(--t-2)]"
        >
          Settings
        </button>
      </div>
    </header>
  );
}
