/**
 * lib/landing/catalog.test.ts — the gate behind §6.4's one number.
 *
 * DESIGN-DIRECTION §7.1 rule 3: the catalog count is read from the build, never typed. This file is
 * what makes that enforceable — it recomputes the answer from the live manifest and the live render
 * layer and asserts the exported constant matches. Two failures it exists to catch:
 *
 *   1. Someone hardcodes the count in a component, or in this module, and it drifts from reality.
 *   2. A renderer is added or removed and the page keeps advertising the old number.
 *
 * The recomputation deliberately walks a different path than `catalog.ts` does (the async
 * `loadCatalog`, and the render layer's own key/stem predicates) so agreement means something.
 */
import { describe, it, expect } from "vitest";
import { loadCatalog } from "@/lib/registry/catalog";
import { isRenderableEntry } from "@/lib/ai/tools/renderableEntry";
import { isRenderableEffectKey, isRenderableTransitionKey } from "@/lib/remotion/renderable";
import { CATEGORY_LABELS, type RegistryCategory } from "@/lib/registry/types";
import {
  CATALOG_CATEGORIES,
  CATALOG_GROUPS,
  PLANNED_ENTRY_COUNT,
  PLANNED_GROUPS,
  RENDERABLE_ENTRY_COUNT,
  RENDERABLE_ENTRY_KEYS,
  catalogEntry,
  isCatalogKey,
} from "./catalog";

describe("landing catalog gate", () => {
  it("the exported count equals a live recomputation over the manifest", async () => {
    const all = await loadCatalog();
    const inScope = all.filter((e) => CATALOG_CATEGORIES.includes(e.category));
    const live = inScope.filter(isRenderableEntry);
    expect(RENDERABLE_ENTRY_COUNT).toBe(live.length);
    expect(PLANNED_ENTRY_COUNT).toBe(inScope.length - live.length);
    expect(RENDERABLE_ENTRY_COUNT + PLANNED_ENTRY_COUNT).toBe(inScope.length);
  });

  it("advertises far fewer entries than the manifest declares", async () => {
    // The whole point of the gate. If these ever converge, the gate has stopped filtering — either
    // because everything really does render (celebrate, then delete this assertion) or because
    // someone bypassed it.
    const all = await loadCatalog();
    expect(RENDERABLE_ENTRY_COUNT).toBeLessThan(all.length);
    expect(PLANNED_ENTRY_COUNT).toBeGreaterThan(0);
  });

  it("every advertised entry passes the render layer's own predicate", async () => {
    // Belt and braces against the grouping code accidentally letting a rejected entry through.
    const all = await loadCatalog();
    const byKey = new Map(all.map((e) => [e.key, e]));
    for (const group of CATALOG_GROUPS) {
      for (const entry of group.entries) {
        const source = byKey.get(entry.key);
        expect(source, entry.key).toBeDefined();
        expect(isRenderableEntry(source!), entry.key).toBe(true);
        if (source!.category === "transitions") expect(isRenderableTransitionKey(entry.key), entry.key).toBe(true);
        if (source!.category === "luts" || source!.category === "color" || source!.category === "glitch") {
          expect(isRenderableEffectKey(entry.key), entry.key).toBe(true);
        }
      }
    }
  });

  it("no key appears in both the advertised and the planned groups", () => {
    // §7.1 rule 2: "Failing entries appear, if at all, in a separately labelled `Planned` group —
    // never mixed in."
    const advertised = new Set(CATALOG_GROUPS.flatMap((g) => g.entries.map((e) => e.key)));
    const planned = new Set(PLANNED_GROUPS.flatMap((g) => g.entries.map((e) => e.key)));
    for (const key of planned) expect(advertised.has(key), key).toBe(false);
    expect(advertised.size).toBe(RENDERABLE_ENTRY_COUNT);
    expect(planned.size).toBe(PLANNED_ENTRY_COUNT);
  });

  it("every planned row states a real reason, not a placeholder", () => {
    for (const group of PLANNED_GROUPS) {
      for (const entry of group.entries) {
        expect(entry.reason.length, entry.key).toBeGreaterThan(20);
        expect(entry).not.toHaveProperty("href"); // §7.1 rule 1: no /effects page for these
      }
    }
  });

  it("groups are non-empty, deterministically ordered, and labelled from the registry", () => {
    const counts = CATALOG_GROUPS.map((g) => g.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    for (const g of [...CATALOG_GROUPS, ...PLANNED_GROUPS]) {
      expect(g.count, g.category).toBeGreaterThan(0);
      expect(g.entries.length, g.category).toBe(g.count);
      expect(g.label).toBe(CATEGORY_LABELS[g.category]);
      expect(g.slug).toBe(`cat-${g.category}`);
      expect(CATALOG_CATEGORIES).toContain(g.category);
    }
  });

  it("scope excludes overlays and text, and says nothing false about them", async () => {
    // They are NOT in the catalog because they are not clip effects — they lower to ADD_OVERLAY /
    // ADD_CAPTION. They are not in `Planned` either, because they do render: all four overlay keys
    // hit a procedural CSS overlay and all three text keys hit a real caption style. This asserts
    // the honest position in both directions, so a later edit cannot quietly relabel them "planned".
    const excluded: RegistryCategory[] = ["overlays", "text"];
    for (const category of excluded) expect(CATALOG_CATEGORIES).not.toContain(category);
    const all = await loadCatalog();
    for (const entry of all.filter((e) => excluded.includes(e.category))) {
      expect(isRenderableEntry(entry), entry.key).toBe(true);
      expect(PLANNED_GROUPS.some((g) => g.entries.some((p) => p.key === entry.key)), entry.key).toBe(false);
    }
  });

  it("lookups only ever resolve advertised keys", () => {
    expect(RENDERABLE_ENTRY_KEYS.length).toBe(RENDERABLE_ENTRY_COUNT);
    expect([...RENDERABLE_ENTRY_KEYS]).toEqual([...RENDERABLE_ENTRY_KEYS].sort());
    for (const key of RENDERABLE_ENTRY_KEYS) {
      expect(isCatalogKey(key), key).toBe(true);
      expect(catalogEntry(key)?.href, key).toBe(`/effects/${key}`);
    }
    for (const group of PLANNED_GROUPS) {
      for (const entry of group.entries) {
        expect(isCatalogKey(entry.key), entry.key).toBe(false);
        expect(catalogEntry(entry.key), entry.key).toBeUndefined();
      }
    }
  });
});
