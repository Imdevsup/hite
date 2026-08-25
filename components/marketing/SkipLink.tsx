/**
 * SkipLink — "skip to main content" bypass link (WCAG 2.2 AA · SC 2.4.1 Bypass Blocks).
 *
 * Server component, zero client JS. Visually hidden until keyboard-focused (see `.skip-link` in
 * globals.css), then lands as an on-brand pill that jumps focus past the repeated sticky nav header
 * to the page's <main>. Render it as the FIRST child of the page so it's the first thing a keyboard
 * or screen-reader user reaches; the target element must carry the matching id (default "main").
 */
export function SkipLink({ targetId = "main" }: { targetId?: string }) {
  return (
    <a href={`#${targetId}`} className="skip-link">
      Skip to content
    </a>
  );
}
