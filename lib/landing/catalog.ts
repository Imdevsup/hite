/**
 * lib/landing/catalog.ts — what the property is allowed to advertise.
 *
 * ⚠ THE SECTION THAT DISPLAYED THIS IS GONE; THE GATE IS NOT. §6.4's catalog section was deleted on
 * 2026-08-19 (595 words of effect names, the largest block on the page, and the opposite of "type a
 * sentence, get an edit"). This module stayed, because the section was its smallest consumer. What
 * still depends on it, all live: `RENDERABLE_ENTRY_COUNT` is the number the FAQ, the JSON-LD
 * `featureList` and both llms.txt documents print; `isCatalogKey` is what `lib/landing/prompts.ts`'s
 * allowlist is checked against. `CATALOG_GROUPS`, `PLANNED_GROUPS`, `catalogEntry` and
 * `RENDERABLE_ENTRY_KEYS` now have no production caller — they are the grouped form `catalog.test.ts`
 * holds the count against, and the `generateStaticParams` source for the `/effects/[key]` route §7.1
 * rule 1 permits but nobody has built. Do NOT delete them as unused: the count is derived from the
 * same filtered array, so the test that proves it is right is the only thing standing between the
 * copy and a number nothing checks.
 *
 * DESIGN-DIRECTION §7.1 (THE CATALOG GATE). The manifest advertises 76 registry entries. `ClipFx`
 * silently skips an effect with no renderer (`if (!R) continue`), the reducer accepts any key, and
 * the manifest's own `stability` field calls 73 of the 76 "stable" — so a catalog built from the
 * manifest would list rows that change nothing when applied. The page prints only what paints.
 *
 * ONE GATE, REUSED. Renderability is decided entirely by `isRenderableEntry` /
 * `unrenderableReason` in `lib/ai/tools/renderableEntry.ts`, which is itself composed from
 * `lib/remotion/renderable.ts` (the render layer's own derived answer: the live effect-renderer map
 * and the transition-treatment classifier). Nothing here re-implements a renderability check — a
 * third gate is exactly how "the model can suggest it" and "the renderer can draw it" drift apart.
 * When the WebGL LUT sampler or real blended transitions land, this file widens by itself.
 *
 * WHAT "CATALOG OF EFFECTS" COVERS. §6.4's H2 is "One catalog of effects." An effect here is an
 * entry applied TO the footage: it lowers to `ADD_EFFECT`, `COMPOSE_LOOK`, or `ADD_TRANSITION`.
 * That is `color`, `luts`, `glitch`, `looks`, `transitions`, `audio` and `procedural` —
 * `CATALOG_CATEGORIES` below, and the scope the counts are taken over.
 *
 * `overlays` and `text` are deliberately OUT OF SCOPE, and the reason is not that they are broken:
 * read from source on 2026-08-19, all four overlay keys resolve to a procedural CSS overlay
 * (`lib/remotion/fx/OverlayProcedural.tsx` `overlayFamily` matches scan/leak/lightning/skull) and
 * all three `text-*` keys are handled by `captionStyle`/`captionAnchor` (`lib/remotion/fonts.ts`).
 * They render. They are simply not clip effects — they lower to `ADD_OVERLAY` / `ADD_CAPTION` — so
 * they belong to a different surface than a catalog of effects. Do NOT move them into the `Planned`
 * group; that would be a false statement about working capability. If a future section wants them,
 * add a scope, do not weaken the gate.
 */
import manifestData from "@/public/registry/manifest.json";
import { validateManifest } from "@/lib/registry/catalog";
import { CATEGORY_LABELS, type RegistryCategory, type RegistryEntry } from "@/lib/registry/types";
import { isRenderableEntry, unrenderableReason } from "@/lib/ai/tools/renderableEntry";

/**
 * The manifest, parsed once at module scope.
 *
 * `lib/registry/catalog.ts` exposes only an async loader, and §7.1 requires a plain exported
 * constant the copy can interpolate (`RENDERABLE_ENTRY_COUNT`), so the entries are read here
 * synchronously — through that module's own `validateManifest`, and from the same MODULE import of
 * the manifest, so there is still one parser and no runtime filesystem read or fetch.
 */
const ALL_ENTRIES: readonly RegistryEntry[] = validateManifest(manifestData);

/** The categories §6.4 covers — see the header. Order is not display order; `catalogGroups` sorts. */
export const CATALOG_CATEGORIES: readonly RegistryCategory[] = [
  "looks",
  "luts",
  "color",
  "glitch",
  "transitions",
  "audio",
  "procedural",
] as const;

const IN_SCOPE: readonly RegistryEntry[] = ALL_ENTRIES.filter((e) => CATALOG_CATEGORIES.includes(e.category));

/** A row the catalog is allowed to show: this entry demonstrably changes the picture. */
export interface CatalogEntry {
  key: string;
  label: string;
  category: RegistryCategory;
  tags: readonly string[];
  description?: string;
  /** §7.1 rule 1: an `/effects/[key]` page exists ONLY for gated entries, so only these carry one. */
  href: string;
}

/** A row that is honest about not being here yet. Never mixed into a `CatalogGroup` (§7.1 rule 2). */
export interface PlannedEntry {
  key: string;
  label: string;
  category: RegistryCategory;
  /** Why it changes nothing today, in the render layer's own words. Never invented here. */
  reason: string;
}

export interface CatalogGroup<T> {
  category: RegistryCategory;
  /** The manifest's own label for the category ("LUTS", "TRANSITIONS"). */
  label: string;
  /** Stable, URL-safe id for the CSS-only `:has()` + radio filter §6.4 specifies. */
  slug: string;
  entries: readonly T[];
  count: number;
}

const byLabel = (a: RegistryEntry, b: RegistryEntry): number => a.label.localeCompare(b.label, "en");

function group<T>(entries: readonly RegistryEntry[], map: (e: RegistryEntry) => T): CatalogGroup<T>[] {
  const out: CatalogGroup<T>[] = [];
  for (const category of CATALOG_CATEGORIES) {
    const members = entries.filter((e) => e.category === category).sort(byLabel);
    if (members.length === 0) continue;
    out.push({
      category,
      label: CATEGORY_LABELS[category],
      slug: `cat-${category}`,
      entries: members.map(map),
      count: members.length,
    });
  }
  // Biggest proof first, ties alphabetical — deterministic, and it opens the section on the
  // categories that most clearly survive the gate rather than on whichever the manifest emitted first.
  return out.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, "en"));
}

const RENDERABLE_ENTRIES: readonly RegistryEntry[] = IN_SCOPE.filter(isRenderableEntry);
const PLANNED_ENTRIES: readonly RegistryEntry[] = IN_SCOPE.filter((e) => !isRenderableEntry(e));

/** The catalog §6.4 renders: every in-scope entry that actually paints, grouped for display. */
export const CATALOG_GROUPS: readonly CatalogGroup<CatalogEntry>[] = group(RENDERABLE_ENTRIES, (e) => ({
  key: e.key,
  label: e.label,
  category: e.category,
  tags: e.tags,
  description: e.description,
  href: `/effects/${e.key}`,
}));

/**
 * The separately-labelled `Planned` group (§7.1 rule 2). Each row carries the render layer's real
 * reason, so the page can say *why* rather than implying a roadmap it does not have.
 */
export const PLANNED_GROUPS: readonly CatalogGroup<PlannedEntry>[] = group(PLANNED_ENTRIES, (e) => ({
  key: e.key,
  label: e.label,
  category: e.category,
  // Non-null: `PLANNED_ENTRIES` is exactly the set `isRenderableEntry` rejected, and that predicate
  // is defined as `unrenderableReason(e) === null`.
  reason: unrenderableReason(e) ?? "this build cannot render it",
}));

/**
 * §7.1 rule 3: "The number in the copy is read from the build, never typed as a literal." Interpolate
 * this; never write the digits. `catalog.test.ts` asserts it against a live recomputation, so it can
 * never silently drift back to advertising the manifest's full advertised size.
 */
export const RENDERABLE_ENTRY_COUNT: number = RENDERABLE_ENTRIES.length;

/** How many in-scope entries the `Planned` group holds. Also derived, also never a literal. */
export const PLANNED_ENTRY_COUNT: number = PLANNED_ENTRIES.length;

/** Every renderable key, flat and sorted — for the `/effects/[key]` route's `generateStaticParams`. */
export const RENDERABLE_ENTRY_KEYS: readonly string[] = RENDERABLE_ENTRIES.map((e) => e.key).sort();

const RENDERABLE_KEY_SET: ReadonlySet<string> = new Set(RENDERABLE_ENTRY_KEYS);

/** Is this key one the catalog advertises? The gate for `/effects/[key]` (§7.1 rule 1). */
export function isCatalogKey(key: string): boolean {
  return RENDERABLE_KEY_SET.has(key);
}

/** One advertised entry by key, or `undefined`. Never returns something that does not render. */
export function catalogEntry(key: string): CatalogEntry | undefined {
  for (const g of CATALOG_GROUPS) {
    const hit = g.entries.find((e) => e.key === key);
    if (hit) return hit;
  }
  return undefined;
}
