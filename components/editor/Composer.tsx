"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { usePlanner } from "@/components/editor/planner";
import { ProviderKeyField } from "@/components/settings";
// A deep import, deliberately: `fetchSettings` is `components/settings`'s own reader of
// `GET /api/settings` and the only honest source of the snapshot `ProviderKeyField` needs. The
// alternative — a second fetch and a second parser here — is the divergence the seam exists to stop.
import { fetchSettings } from "@/components/settings/providerKey";
import type { SettingsSnapshot } from "@/components/settings";
import { AFFORDANCE } from "@/components/editor/affordances";
import { useModifierKeys, formatShortcut } from "@/components/editor/platformKeys";
import { completionsFor, slashTokenAt, applyCompletion, type Completion } from "@/components/editor/completions";
import { loadCatalog } from "@/lib/registry/catalog";
import type { RegistryEntry } from "@/lib/registry/types";

/**
 * THE BOX YOU TYPE IN — §13 item 6, and the whole product.
 *
 * "The prompt input — 640px, pinned bottom-centre, 56px."
 *
 * NO SEND BUTTON. §13: "`Enter` sends; the input's right edge carries a non-focusable `⏎` glyph."
 * The glyph is rendered through `formatShortcut`, so a Windows keyboard is told "Enter" and an Apple
 * one gets the glyph — the editor's own honesty test bans a hardcoded Apple modifier, because the
 * binding was always right and only the sign above it was wrong.
 *
 * NO SHORTCUT HINTS. §13: "zero shortcut surfacing in session one." The line that used to sit under
 * this box ("Enter to start · Shift+Enter for a new line") is gone, along with the 4-second
 * auto-dismissing keyboard tip that was a WCAG 2.2.1 failure. Shift+Enter still makes a new line.
 *
 * CAPABILITY IS BEHIND `/`. Everything the six-icon tool rail and the eleven panels used to offer
 * lives inside the sentence, six at a time, as human phrases — never as registry keys. See
 * `completions.ts` for the two rules and the renderability gate.
 *
 * THE PROMPT IS NEVER LOST. Two things can stop a turn before it starts, and neither throws the
 * sentence away:
 *   · NO FOOTAGE — mirrored EXACTLY from `/api/plan` (`assets.find(a => a.duration_ms > 0)`), because
 *     a stricter rule here would refuse a prompt the server would have accepted and a looser one
 *     would fire a turn into a guaranteed 400. The sentence is held and the file picker opens.
 *   · NO KEY — §14.3's 402 flow. "The prompt input transforms in place. No modal, no redirect, no
 *     toast… and the sentence the user typed is held and re-sent verbatim the moment the key
 *     validates." That is exactly what happens below.
 */

interface Props {
  readonly projectId: string;
  /** Ask the surrounding screen for footage — the file picker, wherever it lives. */
  readonly onNeedsFootage: () => void;
  /** Placeholder copy differs between the empty screen and the working one. */
  readonly placeholder: string;
  /**
   * The landing's `?prompt=` deep link, read on the SERVER by the route and handed down.
   *
   * It used to be `useSearchParams()` here, paired with an effect, a one-shot ref and a lint
   * suppression — all of it working around the fact that a client hook cannot know the URL during the
   * server render. The page is a server component that already has `searchParams`, so the value
   * arrives as the initial state instead: the server HTML and the first client paint are identical by
   * construction, there is no effect, and the composer no longer needs a router in scope to render.
   */
  readonly initialPrompt?: string;
}

export function Composer({ projectId, onNeedsFootage, placeholder, initialPrompt }: Props) {
  const assets = useEditor((s) => s.assets);
  const streaming = usePlanner((s) => s.streaming);
  const heldReason = usePlanner((s) => s.heldReason);
  const keys = useModifierKeys();

  const [text, setText] = useState(initialPrompt ?? "");
  const [menu, setMenu] = useState<{ items: Completion[]; active: number } | null>(null);
  const [catalog, setCatalog] = useState<readonly RegistryEntry[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  // A sentence that arrived from the landing is put where the caret is, so Enter is the only thing
  // left to do. Nothing else on either screen takes focus on mount: the empty screen's first job is
  // to get a video, and stealing focus from "Choose a file" would fight it.
  useEffect(() => {
    if (initialPrompt) inputRef.current?.focus();
  }, [initialPrompt]);

  /** Mirrors `/api/plan` route line 72 exactly. An asset with no readable length cannot be cut. */
  const ready = assets.some((a) => (a.duration_ms ?? 0) > 0);

  function refreshMenu(value: string, caret: number) {
    const token = slashTokenAt(value, caret);
    if (!token) {
      setMenu(null);
      return;
    }
    setMenu({ items: completionsFor(catalog, token.query), active: 0 });
  }

  function choose(index: number) {
    const el = inputRef.current;
    const items = menu?.items;
    if (!el || !items || !items[index]) return;
    const token = slashTokenAt(text, el.selectionStart ?? text.length);
    if (!token) return;
    const next = applyCompletion(text, token, items[index].phrase);
    setText(next.text);
    setMenu(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function submit() {
    const value = text.trim();
    if (!value || streaming) return;
    if (!ready) {
      // Hold it rather than firing a turn the server is certain to refuse, and ask for the one
      // missing thing. `EditorFrame` re-sends it the moment a timeline exists.
      usePlanner.setState({ held: value, heldReason: "needs-footage" });
      setText("");
      onNeedsFootage();
      return;
    }
    setText("");
    setMenu(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    void usePlanner.getState().send(projectId, value);
  }

  if (heldReason === "needs-key") return <KeyRequest projectId={projectId} />;

  const listId = "hite-completions";
  const activeId = menu ? `${listId}-${menu.active}` : undefined;

  return (
    <div className="relative w-full" style={{ maxWidth: "640px" }}>
      {/* THE `/` MENU. A combobox popup, so it costs NO tab stop: the textarea keeps focus and moves
          the selection with the arrow keys, which is the pattern every completion menu that is not a
          second thing to Tab into uses. */}
      {menu && menu.items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Things HITE can do"
          data-arrive
          className="absolute bottom-[calc(100%+var(--space-2))] left-0 z-10 w-full overflow-hidden rounded-[var(--r-md)] py-[var(--space-1)]"
          style={{ background: "var(--s-panel)", boxShadow: "var(--specular), 0 0 0 1px var(--line-3), var(--shadow-lift)" }}
        >
          {menu.items.map((item, i) => (
            <li
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === menu.active}
              onMouseDown={(e) => {
                // mousedown, not click: click fires after blur, and blur closes the menu.
                e.preventDefault();
                choose(i);
              }}
              className="flex cursor-pointer items-baseline justify-between gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-2)] text-[13px]"
              style={{
                background: i === menu.active ? "var(--s-2)" : "transparent",
                color: i === menu.active ? "var(--t-1)" : "var(--t-2)",
              }}
            >
              <span>{item.phrase}</span>
              <span className="text-[12px] text-[var(--t-4)]">{item.kind}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="hite-composer relative flex w-full items-stretch">
        <textarea
          data-affordance={AFFORDANCE.prompt}
          ref={inputRef}
          value={text}
          rows={1}
          maxLength={4000}
          aria-label="Say what you want changed"
          placeholder={placeholder}
          role="combobox"
          aria-expanded={Boolean(menu && menu.items.length > 0)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onChange={(e) => {
            const el = e.currentTarget;
            setText(el.value);
            el.style.height = "auto";
            el.style.height = `${Math.min(160, el.scrollHeight)}px`;
            refreshMenu(el.value, el.selectionStart ?? el.value.length);
          }}
          onKeyUp={(e) => {
            // Arrow keys and clicks move the caret without changing the value, and the menu has to
            // follow the caret or it starts completing a token the user has left.
            if (e.key.startsWith("Arrow") && !menu) refreshMenu(text, e.currentTarget.selectionStart ?? 0);
          }}
          onBlur={() => setMenu(null)}
          onKeyDown={(e) => {
            if (menu && menu.items.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMenu({ ...menu, active: (menu.active + 1) % menu.items.length });
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMenu({ ...menu, active: (menu.active - 1 + menu.items.length) % menu.items.length });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(menu.active);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="w-full resize-none bg-transparent px-[var(--space-4)] py-[var(--space-4)] pr-[var(--space-8)] text-[15px] leading-[1.45] text-[var(--t-1)] outline-none placeholder:text-[var(--t-4)]"
          style={{ minHeight: "56px" }}
        />
        {/* §13: "the input's right edge carries a non-focusable ⏎ glyph". Not a button — there is
            nothing to press, and a control that duplicates a key is a control to explain. */}
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-[var(--space-3)] right-[var(--space-3)] select-none text-[12px] text-[var(--t-4)]"
        >
          {text.trim() ? formatShortcut("enter", keys) : ""}
        </span>
      </div>

      {/* A held sentence has to SAY it is held, on whichever screen it happened. Without this the
          text vanished from the box and nothing on the working screen explained where it went — the
          same dead-end as a button that does nothing, one step further along. */}
      {heldReason === "needs-footage" && (
        <p className="mt-[var(--space-2)] text-[13px] leading-relaxed text-[var(--t-3)]">
          HITE kept what you typed. It needs a video whose length it can read before it can run it.
        </p>
      )}

      {/* Said once, in words, only when it is true. */}
      <p className="sr-only" role="status" aria-live="polite">
        {streaming ? "HITE is working on your edit." : ""}
      </p>
    </div>
  );
}

/**
 * §14.3 — THE 402 STATE, DESIGNED.
 *
 * `resolveByokMode()` returns "required" whenever `GEMINI_API_KEYS` is unset, which is the PRIMARY
 * flow for anyone who cloned this repo and ran it — the editor is not hosted, so that is most people.
 * The box the user just typed into becomes the key field, in place. No modal, no redirect, no toast.
 *
 * THE FIELD IS `components/settings`' OWN, not a copy of it. §14.1's contract — no reveal affordance,
 * an uncontrolled input so the secret never reaches React state, the fingerprint instead of a last-4
 * chip, `BYOK_DISCLOSURE` verbatim, `BYOK_HELP.getKey` as the link — is enforced structurally inside
 * that component. Reimplementing the same field here would be two places to get a credential wrong.
 * Its own header says as much: "Exported on its own as well as through the sheet, because §14.3 puts
 * the same field inline in the editor's prompt input for the 402 flow."
 *
 * WHAT THIS FILE ADDS is the one thing that is the editor's: the sentence. It was typed, it was
 * refused for want of a key, and it is re-sent verbatim the moment a key lands. It is never lost.
 */
function KeyRequest({ projectId }: { readonly projectId: string }) {
  const held = usePlanner((s) => s.held);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  /**
   * Read the deployment once on arrival, and again whenever the key changes.
   *
   * The read is an EXTERNAL system, which is what an effect is for; the state writes happen in the
   * promise's callback rather than in the effect body, so nothing cascades. `live` drops an answer
   * that lands after the 402 has cleared and this component has gone.
   */
  useEffect(() => {
    let live = true;
    void fetchSettings()
      .then((next) => {
        if (!live) return;
        if (next === null) setUnavailable(true);
        else {
          setUnavailable(false);
          setSnapshot(next);
        }
      })
      .catch(() => {
        if (live) setUnavailable(true);
      });
    return () => {
      live = false;
    };
  }, []);

  /** The same read, run from an event handler after `ProviderKeyField` stores or clears a key. */
  const reload = useCallback(async () => {
    const next = await fetchSettings().catch(() => null);
    if (next === null) {
      setUnavailable(true);
      return null;
    }
    setUnavailable(false);
    setSnapshot(next);
    return next;
  }, []);

  return (
    <div className="flex w-full flex-col gap-[var(--space-3)]" style={{ maxWidth: "640px" }}>
      {unavailable && (
        <p role="alert" className="text-[13px] leading-relaxed" style={{ color: "var(--color-hit)" }}>
          HITE couldn&rsquo;t read what this deployment does with a key, so it will not ask you for one.
        </p>
      )}

      {snapshot && (
        <ProviderKeyField
          snapshot={snapshot}
          showHeading={false}
          onKeyChanged={() => {
            void (async () => {
              const next = await reload();
              // Only re-send once the server agrees it can read the key. Firing on the write alone
              // would spend a turn on a key that is about to come back 402 again.
              if (next?.key.usable) usePlanner.getState().releaseHeld(projectId);
            })();
          }}
        />
      )}

      {held && (
        <p className="text-[12px] leading-relaxed text-[var(--t-3)]">
          HITE kept what you typed — it runs the moment the key works.
        </p>
      )}
    </div>
  );
}
