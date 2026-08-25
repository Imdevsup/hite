/**
 * lib/edl/ids.ts — deterministic id minting (docs/DECISIONS.md §1.9, docs/CANONICAL-IR-SPEC.md §7.3).
 *
 * Random/time-based ids (`Math.random`, `Date.now`) poison content hashes and make renders
 * non-reproducible, which kills the segment cache before it can exist. So every entity id is
 * derived deterministically:
 *   • content-addressed where identity follows content (effects, overlays, looks, …)
 *   • lineage/sequence-addressed where structurally-identical entities must stay distinct
 *     (split children, freshly-inserted clips)
 *
 * The ONE allowed source of randomness in the whole system is the per-command envelope ULID,
 * minted once at author time and frozen in the append-only command log (so replay is
 * byte-identical). That lives in the command layer, never here.
 *
 * The hash is a fast, dependency-free, isomorphic (browser + node) NON-crypto hash — ids only
 * need determinism + low collision, not cryptographic strength. The cryptographic SHA-256 used
 * for the IR segment-cache key is separate (lib/render/hash.ts, server-side, P3).
 */

/** Stable, key-sorted JSON so `{a,b}` and `{b,a}` serialize identically (recursively). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

/** cyrb53 — fast 53-bit string hash. Deterministic; no Math.random / Date.now. */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Deterministic hash of any JSON-serializable value, as a base36 string. */
export function stableHash(value: unknown): string {
  return cyrb53(stableStringify(value)).toString(36);
}

const short = (v: unknown): string => stableHash(v).slice(0, 12);

/**
 * Effect id — content-addressed. `salt` distinguishes effects that are deliberately
 * duplicated (e.g. the same primitive applied twice while expanding a composed look).
 */
export const effectId = (effectKey: string, params: unknown, target?: unknown, salt?: unknown): string =>
  `fx_${short({ effectKey, params, target, salt })}`;

export const overlayId = (overlayKey: string, window: unknown, placement: unknown, salt?: unknown): string =>
  `ov_${short({ overlayKey, window, placement, salt })}`;

export const lookId = (lookKey: string, targetClipIds?: unknown): string =>
  `look_${short({ lookKey, targetClipIds })}`;

export const transitionId = (betweenClipIds: readonly [string, string], transitionKey: string): string =>
  `xf_${short({ betweenClipIds, transitionKey })}`;

export const captionId = (window: unknown, text: string): string =>
  `cap_${short({ window, text })}`;

export const audioBedId = (assetId: string, window: unknown): string =>
  `ab_${short({ assetId, window })}`;

export const markerId = (atTick: number, title: string): string =>
  `mk_${short({ atTick, title })}`;

/**
 * New-clip id — lineage/sequence-addressed. Distinctness is the CALLER's contract: the lineage must
 * carry something that separates structurally-identical mints, or two identical ADD_CLIPs collapse
 * onto one id and every later REMOVE/MOVE/SPLIT binds to whichever one it finds first. The reducer
 * feeds it the base revision + a per-batch ordinal (see `mintClipLineage`), and asserts uniqueness
 * over the whole EDL after every batch.
 */
export const clipId = (lineage: string | number): string =>
  `c_${short(`clip:${lineage}`)}`;

/**
 * Split produces two children: the left keeps the parent id; the right is lineage-derived.
 * Pass a `parentLineage` that is unique per split operation (e.g. `${clipId}:${splitTick}`)
 * so splitting the same parent at two points yields distinct ids.
 */
export const splitChildId = (parentLineage: string, ordinal: number): string =>
  `c_${short(`${parentLineage}:split:${ordinal}`)}`;
