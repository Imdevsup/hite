import type { Metadata } from "next";

// The editor is a private, anonymous-session workspace — keep it out of search indexes entirely.
// robots.txt `disallow` only blocks crawling; a discovered /app/* URL can still be indexed
// (snippet-less) without this. `index: false` is the authoritative signal, and it cascades to
// every route nested under /app (the project list + /app/[projectId]).
export const metadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

/**
 * THE EDITOR'S GROUND — and three layers that are no longer over it.
 *
 *   · `GrainOverlay` — film grain, mix-blended over the whole app INCLUDING the program monitor.
 *     Grain over the preview is a lie about what the render looks like: the exported MP4 has none.
 *     ART-DIRECTION §13 says it in one line — "no grain over the program monitor". It is a
 *     landing-only device and `app/globals.css` scopes it there.
 *   · `CursorLayer` — a custom cursor. It fights every native affordance it crosses: the text caret
 *     in the composer, the col-resize on the scrubber and on a clip's trim handles.
 *   · `<MotionConfig>` and `<Toaster>` — both are gone with what they served. Every `motion/react`
 *     consumer in this app was an editor surface (the timeline, the floating windows, the chat
 *     window, the mobile shell) and §13 deletes all of them, so the provider was configuring
 *     animations nothing runs — 38.3KB gz of runtime for that. The toasts went the same way: §13
 *     gives the editor exactly one place to report an AI edit (the history line) and one place to
 *     report a failure (`EditorAlerts`), and a toast is a third that fades before it can be read.
 *     `EditorAlerts` exists precisely because `saveState: "error"` and `edlLoadError` are CONDITIONS,
 *     not events — a toast that has already faded cannot tell you your work still is not saved.
 *
 * `overflow-hidden` is load-bearing: the editor is one screen and must not scroll as a document.
 * `app/globals.css` deliberately does not set it globally (the landing scrolls).
 */
export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return <div className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg)]">{children}</div>;
}
