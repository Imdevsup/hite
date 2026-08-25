/**
 * THE EDITOR'S OWN CSS — every rule the editor needs that `app/globals.css` does not already own.
 *
 * WHY IT IS HERE AND NOT THERE. `app/globals.css` carries the property's token layer under an
 * INTEGRATION RULE that names it non-negotiable ("every live token NAME survives… values are
 * re-pointed; names are never renamed"), and this unit does not own that file. Everything below is
 * editor-local behaviour — three keyframes and four component rules — with no token of its own. React
 * 19 hoists a `<style href precedence>` into `<head>` and dedupes it by `href`, so this renders once
 * for the whole editor no matter how many components mount it.
 *
 * THE MOTION BUDGET, §13: "Only `--dur-fast: 140ms`, `--dur-base: 260ms`, `--dur-slow: 420ms`,
 * `--ease-out`, `--ease-apple`. No grade animation, no ripple, no shimmer over footage, no grain over
 * the program monitor." Two sanctioned exceptions live here — the change diff and hold-to-compare —
 * and nothing else. Every animation is authored INSIDE `prefers-reduced-motion: no-preference`, so
 * the reduced-motion state is the resting state rather than a stripped one.
 */
export function EditorStyles() {
  return (
    <style href="hite-editor" precedence="medium">{`
/* ── THE CHANGE DIFF (§13, sanctioned exception 1) ─────────────────────────────
   "every touched clip gets a 1px --color-accent outline holding 400 ms and fading
   over 600 ms". 400 + 600 = 1000ms, and the hold is expressed as the keyframe
   offset (40%) rather than as a second animation. Outside no-preference the clip
   simply does not flash; the strip still says which clips exist, and the history
   line still says what happened. */
@media (prefers-reduced-motion: no-preference) {
  @keyframes hite-touched {
    0%, 40% { box-shadow: inset 0 0 0 1px var(--color-accent); }
    100%    { box-shadow: inset 0 0 0 1px transparent; }
  }
  [data-touched="true"] { animation: hite-touched 1000ms var(--ease-out) 1; }
}

/* ── ARRIVAL — the only entrance in the editor. §6 animation 1's shape (260ms,
   --ease-out, opacity + a 4px rise), reused rather than re-invented. */
@media (prefers-reduced-motion: no-preference) {
  @keyframes hite-editor-arrive {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: none; }
  }
  [data-arrive] { animation: hite-editor-arrive var(--dur-base) var(--ease-out) backwards; }
}

/* ── THE PICTURE ──────────────────────────────────────────────────────────────
   The one luminous object. LAW 1 (specular on the top edge only) and LAW 2 (every
   shadow tinted with the ground, never pure black) both come straight from the
   token layer, so this is a composition of --specular and --ground, not a new one. */
.hite-picture {
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--color-bg-2);
  box-shadow:
    var(--specular),
    0 0 0 1px var(--line-2),
    0 32px 72px -28px rgb(var(--ground) / 0.88);
}
/* The picture IS the transport (§13 item 4), so it carries the focus ring itself.
   --focus-ring's inner rung is the ground colour, which is why one token survives
   on a cyan button, a video frame and a clip block alike. */
.hite-picture:focus-visible { outline: none; box-shadow: var(--specular), var(--focus-ring); }

/* ── HOLD TO COMPARE (§13, sanctioned exception 2) ────────────────────────────
   "the picture reverts to ungraded and uncut for as long as you hold". The badge
   is the only thing that animates, and only to arrive. */
.hite-compare-badge {
  font-size: var(--fs-label);
  color: var(--color-on-accent);
  background: var(--color-accent);
  border-radius: var(--r-pill);
  padding: 4px 10px;
  letter-spacing: 0.01em;
}

/* ── THE SCRUBBER (§13 item 5) — 4px, no numerals, and a 44px hit area, because
   §16 makes every target ≥44px a component obligation and 4px is not one. */
.hite-scrubber {
  position: relative;
  display: block;
  width: 100%;
  height: var(--tap);
  background: none;
  cursor: col-resize;
  touch-action: none;
}
.hite-scrubber::before {
  content: "";
  position: absolute;
  inset-inline: 0;
  top: calc(50% - 2px);
  height: 4px;
  border-radius: var(--r-pill);
  background: var(--line-3);
}
.hite-scrubber:focus-visible { outline: none; }
.hite-scrubber:focus-visible::before { box-shadow: var(--focus-ring); }
@media (pointer: coarse) { .hite-scrubber { cursor: auto; } }

/* ── THE COMPOSER — the one loud control on the screen, and the only place in the
   editor allowed a border as its sole boundary. --line-5 is the ONLY rung that
   measures ≥3:1 (WCAG 1.4.11); every other hairline on this surface sits beside a
   fill or a label that carries the contrast. */
.hite-composer {
  border: 1px solid var(--line-5);
  border-radius: var(--r-md);
  background: var(--s-1);
}
@media (prefers-reduced-motion: no-preference) {
  .hite-composer { transition: border-color var(--dur-fast) var(--ease-apple), box-shadow var(--dur-fast) var(--ease-apple); }
}
.hite-composer:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-faint);
}

/* ── ONE LAYOUT, NOT TWO (§13's "Editor responsive") ──────────────────────────
   "Author once at 1320px, scale down with the inverse-compensated ladder,
   internals responding to the frame's own inline-size as a CSS container rather
   than to the viewport. Below 900px: the picture, the input, and a horizontally
   scrolling strip — the same three things, not a scaled desktop and not a
   second layout."

   The container is on the frame rather than on the document, so an editor inside a
   narrow column behaves like an editor on a narrow phone. It is also why there is
   no viewport branch and no second shell to keep in sync: the 336-line MobileShell
   this replaces was a whole parallel editor whose buttons drove stores its own
   chrome never mounted. */
.hite-frame { container-type: inline-size; container-name: editor-frame; }
@container editor-frame (max-width: 900px) {
  /* The clip row and the record of what HITE did stop competing for one line. The
     strip keeps its own horizontal scroll; nothing is hidden and nothing moves to
     a different component. */
  .hite-record { flex-direction: column; align-items: stretch; gap: var(--space-3); }
  .hite-record > :last-child { justify-content: flex-start; }
}

/* ── CLIP BLOCKS — flat --color-bg-2 with a --line-3 hairline is the SHIPPED state,
   not a fallback: it is what §11's T0 and §17's reduced-data edition both specify,
   and it is what a block shows whenever no frame could honestly be read. */
.hite-clip {
  background: var(--color-bg-2);
  border-radius: var(--r-sm);
  box-shadow: inset 0 0 0 1px var(--line-3);
  background-size: cover;
  background-position: center;
}
.hite-clip[aria-selected="true"] { box-shadow: inset 0 0 0 1px var(--color-accent); }
`}</style>
  );
}
