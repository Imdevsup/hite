import manifestData from "../../public/registry/manifest.json";
import { RegistryEntry, type RegistryCategory } from "./types";

/**
 * Catalog loader.
 *
 * The pre-built manifest (scripts/build-registry.ts, run by pre(dev|build)) is
 * imported as a MODULE so it's bundled into every serverless function AND the
 * client bundle. No runtime filesystem read, no HTTP fetch, no dependency on
 * output-file tracing — so `searchRegistry` (inside the planner loop) and the
 * editor's effect/look/overlay windows can never ENOENT in production.
 */

let cached: RegistryEntry[] | null = null;

export async function loadCatalog(): Promise<RegistryEntry[]> {
  if (!cached) cached = validateManifest(manifestData);
  return cached;
}

export function validateManifest(raw: unknown): RegistryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RegistryEntry[] = [];
  for (const entry of raw) {
    const parsed = RegistryEntry.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function byCategory(cat: RegistryCategory | RegistryCategory[]): Promise<RegistryEntry[]> {
  const all = await loadCatalog();
  const cats = Array.isArray(cat) ? cat : [cat];
  return all.filter((e) => cats.includes(e.category));
}

export async function byKey(key: string): Promise<RegistryEntry | null> {
  const all = await loadCatalog();
  return all.find((e) => e.key === key) ?? null;
}

/** Test-only: reset the module-level cache. */
export function __resetCatalogCache() {
  cached = null;
}
