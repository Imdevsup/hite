import { describe, expect, test } from "vitest";
import { completionsFor, slashTokenAt, applyCompletion, MAX_COMPLETIONS } from "./completions";
import { loadCatalog } from "@/lib/registry/catalog";
import { isRenderableEntry } from "@/lib/ai/tools/renderableEntry";

/**
 * §13's TWO HARD RULES FOR `/`, asserted against the REAL manifest.
 *
 *   1. "Maximum six."
 *   2. "A raw registry key never appears in the UI. Ever."
 *
 * Plus the gate that makes the menu honest at all: "only `isRenderableEntry()` keys are offered, so
 * the list cannot advertise something that will not paint." That one matters more than it looks —
 * the reducer accepts any key and `ClipFx` silently skips one it cannot draw, so an ungated menu
 * would let a user type their way to a success message over an unchanged video.
 */

const catalog = await loadCatalog();

test("the manifest actually loaded — a silent empty list would pass everything below", () => {
  expect(catalog.length).toBeGreaterThan(50);
});

describe("the menu", () => {
  test("never offers more than six", () => {
    for (const query of ["", "a", "e", "look", "punch", "whip", "grade"]) {
      expect(completionsFor(catalog, query).length, `"${query}"`).toBeLessThanOrEqual(MAX_COMPLETIONS);
    }
  });

  test("never shows a registry key — only the manifest's human name", () => {
    const keys = new Set(catalog.map((e) => e.key));
    for (const query of ["", "a", "e", "look", "lut", "trans", "curve"]) {
      for (const completion of completionsFor(catalog, query)) {
        expect(keys.has(completion.phrase), `"${completion.phrase}" is a registry key`).toBe(false);
        // The shape of a key, not just an exact match: `lut-a24-moonlight`, `curve-lift-blacks`.
        expect(completion.phrase).not.toMatch(/^[a-z0-9]+-[a-z0-9-]+$/);
      }
    }
  });

  test("only offers entries this build can actually render", () => {
    const unrenderable = new Set(catalog.filter((e) => !isRenderableEntry(e)).map((e) => e.key));
    expect(unrenderable.size, "the manifest advertises more than the renderer paints").toBeGreaterThan(0);
    for (const query of ["", "a", "e", "reverb", "flare", "cube", "wipe", "skull"]) {
      for (const completion of completionsFor(catalog, query)) {
        expect(unrenderable.has(completion.key), `${completion.key} would not paint`).toBe(false);
      }
    }
  });

  test("ranks by the same scorer the planner's own registry search uses", () => {
    // "Ranked by the router's own match against what has been typed." `lib/registry/search.ts` scores
    // an exact label match above a prefix above a substring, so the best match leads.
    const results = completionsFor(catalog, "a24");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].key).toBe("look-a24");
  });

  test("an empty query still answers — pressing / has to show something", () => {
    expect(completionsFor(catalog, "").length).toBe(MAX_COMPLETIONS);
  });

  test("a query nothing matches is empty rather than a fallback list", () => {
    expect(completionsFor(catalog, "zzzzzznope")).toEqual([]);
  });
});

describe("the slash token", () => {
  test("opens at the start of the sentence and after whitespace", () => {
    expect(slashTokenAt("/", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(slashTokenAt("give it /a2", 11)).toEqual({ start: 8, end: 11, query: "a2" });
  });

  test("does NOT open mid-word — a URL or a fraction is not a menu", () => {
    expect(slashTokenAt("24/7", 4)).toBeNull();
    expect(slashTokenAt("https://x.test", 14)).toBeNull();
  });

  test("closes at the first space, so the sentence carries on as prose", () => {
    expect(slashTokenAt("/whip pan", 9)).toBeNull();
  });

  test("follows the caret, not the end of the string", () => {
    expect(slashTokenAt("/a24 and more", 4)).toEqual({ start: 0, end: 4, query: "a24" });
    expect(slashTokenAt("/a24 and more", 13)).toBeNull();
  });
});

describe("inserting a completion", () => {
  test("replaces the token with the phrase and leaves one space", () => {
    const token = slashTokenAt("give it /a2", 11)!;
    expect(applyCompletion("give it /a2", token, "A24")).toEqual({ text: "give it A24 ", caret: 12 });
  });

  test("does not double a space that is already there", () => {
    const text = "give it /a2 please";
    const token = slashTokenAt(text, 11)!;
    const next = applyCompletion(text, token, "A24");
    expect(next.text).toBe("give it A24 please");
    expect(next.text).not.toContain("  ");
  });
});
