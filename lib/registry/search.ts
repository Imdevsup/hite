import type { RegistryCategory, RegistryEntry, Stability } from "./types";

/**
 * Tiny fuzzy search over label/tags/key. Zero dependencies; fast enough to run
 * over the whole catalog in a web worker or main thread. Scores:
 *   +4 exact label match
 *   +3 prefix label match
 *   +2 substring in label
 *   +2 substring in key
 *   +1 per tag substring match
 */
export function search(
  entries: RegistryEntry[],
  query: string,
  opts: {
    category?: RegistryCategory;
    stability?: Stability | Stability[];
    limit?: number;
  } = {},
): RegistryEntry[] {
  const { category, stability, limit = 100 } = opts;
  const stabilities = Array.isArray(stability) ? stability : stability ? [stability] : undefined;

  const filtered = entries.filter((e) => {
    if (category && e.category !== category) return false;
    if (stabilities && !stabilities.includes(e.stability)) return false;
    return true;
  });

  const q = query.trim().toLowerCase();
  if (!q) return filtered.slice(0, limit);

  const scored = filtered
    .map((e) => ({ e, s: score(e, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);

  return scored;
}

function score(e: RegistryEntry, q: string): number {
  const label = e.label.toLowerCase();
  const key = e.key.toLowerCase();
  let s = 0;
  if (label === q) s += 4;
  else if (label.startsWith(q)) s += 3;
  else if (label.includes(q)) s += 2;
  if (key.includes(q)) s += 2;
  for (const t of e.tags) if (t.toLowerCase().includes(q)) s += 1;
  return s;
}
