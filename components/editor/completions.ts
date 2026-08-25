import type { RegistryEntry } from "@/lib/registry/types";
import { isRenderableEntry } from "@/lib/ai/tools/renderableEntry";
import { search } from "@/lib/registry/search";

/**
 * WHERE CAPABILITY WENT: `/` — ART-DIRECTION §13.
 *
 * The rejected editor put capability on screen: a six-icon tool rail, eleven floating panels and a
 * catalog of 76 registry rows. §13 deletes all of it and moves the whole surface inside the sentence,
 * behind one keystroke, under two hard rules:
 *
 *   1. MAXIMUM SIX. "Ranked by the router's own match against what has been typed." The ranking is
 *      `lib/registry/search.ts` — the same scorer `searchRegistry` hands the planner — so the list a
 *      human sees is ordered by the same function that orders the list the model sees. There is no
 *      second ranking to drift.
 *   2. A RAW REGISTRY KEY NEVER APPEARS IN THE UI. EVER. Completions read `A24`, `Whip Pan · L`,
 *      `Zoom Punch` — the manifest's own `label`, which its schema defines as the "human-facing
 *      name". `lut-a24-moonlight` is what the planner emits; it is not what anybody reads. §13: "A
 *      typeahead of 46 keys like `lut-cinestill-800t` and `curve-lift-blacks` *is* the complexity,
 *      rendered as a menu."
 *
 * AND THE GATE THAT MAKES IT HONEST: only `isRenderableEntry()` entries are offered, so the menu can
 * never advertise something the renderer would silently skip — the same failure `renderableEntry.ts`
 * exists to prevent, which would otherwise reappear here as a suggestion the user typed themselves.
 */

/** §13: "Maximum six." */
export const MAX_COMPLETIONS = 6;

export interface Completion {
  /** What the user reads and what is inserted into their sentence. Never a registry key. */
  readonly phrase: string;
  /**
   * The registry key this phrase resolves to. Held for the ranking gate's tests and for nothing that
   * renders — no component may put this on screen.
   */
  readonly key: string;
  /** The manifest category, used only to group visually ("look", "effect", "transition"). */
  readonly kind: string;
}

/**
 * The manifest's human name for an entry.
 *
 * Deliberately the label verbatim rather than a re-worded one: a label map is a second copy of the
 * catalog that rots the moment an entry is renamed, and §13's rule is about not showing KEYS, not
 * about inventing prose. `label` is documented in `lib/registry/types.ts` as the human-facing name.
 */
function phraseFor(entry: RegistryEntry): string {
  return entry.label;
}

/** How the completion is described in one word — the manifest's own category, humanised. */
const KIND_WORDS: Record<string, string> = {
  looks: "look",
  luts: "grade",
  color: "grade",
  glitch: "effect",
  procedural: "effect",
  audio: "audio",
  transitions: "transition",
  overlays: "overlay",
  text: "caption",
};

/**
 * The `/` menu for a query, ranked and capped.
 *
 * `query` is whatever the user has typed after the slash, which is very often nothing — an empty
 * query is the moment `/` is first pressed, and it must still answer with something usable. It
 * answers with the first six renderable entries in manifest order, which is stable and therefore
 * predictable across sessions.
 */
export function completionsFor(entries: readonly RegistryEntry[], query: string): Completion[] {
  const renderable = entries.filter(isRenderableEntry);
  // `search` takes a mutable array; it never mutates it, but the signature is not readonly.
  const ranked = search([...renderable], query, { limit: MAX_COMPLETIONS });
  return ranked.map((entry) => ({
    phrase: phraseFor(entry),
    key: entry.key,
    kind: KIND_WORDS[entry.category] ?? entry.category,
  }));
}

export interface SlashToken {
  /** Index of the `/` in the source string. */
  readonly start: number;
  /** Index one past the last character of the token (the caret). */
  readonly end: number;
  /** What has been typed after the slash. */
  readonly query: string;
}

/**
 * Is the caret inside a `/…` token, and what is it?
 *
 * The slash only opens completions at a WORD BOUNDARY — the start of the sentence or after
 * whitespace. Without that rule, `24fps` and any URL a user pastes would open a menu over their
 * typing. A token also ends at the first whitespace, so `/whip pan` stops being a completion the
 * moment a space is typed and the sentence carries on as ordinary prose.
 */
export function slashTokenAt(text: string, caret: number): SlashToken | null {
  const at = Math.max(0, Math.min(caret, text.length));
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (/\s/.test(ch)) return null;
    if (ch !== "/") continue;
    if (i > 0 && !/\s/.test(text[i - 1])) return null; // mid-word slash — not a trigger
    return { start: i, end: at, query: text.slice(i + 1, at) };
  }
  return null;
}

/** Replace a `/…` token with the chosen phrase, and report where the caret lands. */
export function applyCompletion(
  text: string,
  token: SlashToken,
  phrase: string,
): { readonly text: string; readonly caret: number } {
  const head = text.slice(0, token.start);
  const tail = text.slice(token.end);
  // One trailing space so the sentence keeps flowing; never two.
  const spacer = tail.startsWith(" ") ? "" : " ";
  return { text: `${head}${phrase}${spacer}${tail}`, caret: head.length + phrase.length + spacer.length };
}
