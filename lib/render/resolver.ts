import type { MediaKind, MediaResolver, RecipeTime, RegistryRecipe, RegistryRecipeStep } from "./ir";
import type { Placement } from "@/lib/edl/schema";
import type { RegistryEntry } from "@/lib/registry/types";
import { msToTicks } from "@/lib/edl/time";

/**
 * The ONE MediaResolver used by BOTH the in-browser preview and the server export render. Sharing
 * it is what makes preview pixel-identical to export: identical asset URLs, identical look-recipe
 * expansion, identical engine routing. Pure data mapping — safe on client and server.
 *
 * What it deliberately does NOT do: invent analysis data. `faceTrack` returns an EMPTY track and
 * `recipeVars` is not implemented at all, because no face/beat analysis exists in this build (the
 * face pipeline was cut; beats are not wired). The compiler treats both as "unavailable" and either
 * falls back visibly (centered placement) or drops the step and records a diagnostic — it never
 * silently resolves a missing var to 0. See CANONICAL-IR-SPEC §6.1.
 */
export interface ResolverInput {
  assetUrls: Map<string, string> | Record<string, string>;
  /** Optional asset kinds (the `asset.kind` column). Absent entries fall back to URL sniffing. */
  assetKinds?: Map<string, MediaKind> | Record<string, MediaKind>;
  catalog: RegistryEntry[];
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|aac|m4a|ogg|flac)(\?|#|$)/i;

/**
 * Media kind from the URL when the caller did not pass `assetKinds`. Upload paths keep the original
 * filename (and therefore its extension), so this is accurate for our own storage; an unknown
 * extension stays "video", which is the pre-existing behaviour and the common case.
 */
function kindFromUrl(url: string): MediaKind {
  if (IMAGE_EXT.test(url)) return "image";
  if (AUDIO_EXT.test(url)) return "audio";
  return "video";
}

const asMap = <V>(v: Map<string, V> | Record<string, V> | undefined): Map<string, V> =>
  v instanceof Map ? v : new Map(Object.entries(v ?? {}));

/** `{{expr}}` → a template RecipeTime; a numeric ms literal → ticks. Anything else ⇒ unusable. */
function recipeTime(raw: unknown): RecipeTime | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return { kind: "ticks", ticks: msToTicks(raw) };
  if (typeof raw === "string") {
    const m = raw.match(/^\{\{(.+)\}\}$/);
    if (m) return { kind: "template", expr: m[1] };
    const n = Number(raw);
    if (Number.isFinite(n)) return { kind: "ticks", ticks: msToTicks(n) };
  }
  return undefined;
}

/**
 * `target` in a recipe step is either the string "all" or `{range: {startMs, endMs}}`. A range whose
 * bounds we cannot read at all is returned as undefined so the compiler drops the step — a range
 * effect silently widened to the whole timeline is exactly the "permanent chromatic flash" bug.
 */
function recipeTarget(raw: unknown): RegistryRecipeStep["target"] {
  if (raw === undefined || raw === "all") return { kind: "all" };
  if (typeof raw === "object" && raw !== null && "range" in raw) {
    const range = (raw as { range?: { startMs?: unknown; endMs?: unknown } }).range ?? {};
    const start = recipeTime(range.startMs);
    const end = recipeTime(range.endMs);
    if (start && end) return { kind: "range", start, end };
  }
  return { kind: "unreadable", raw: JSON.stringify(raw) };
}

/** Placement is already the EDL's own union; only structurally-valid modes survive. */
const PLACEMENT_MODES = new Set(["center", "xy", "face", "topLeft", "topRight", "bottomLeft", "bottomRight"]);
function recipePlacement(raw: unknown): Placement | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const mode = (raw as { mode?: unknown }).mode;
  if (typeof mode !== "string" || !PLACEMENT_MODES.has(mode)) return undefined;
  return raw as Placement;
}

export function makeMediaResolver({ assetUrls, assetKinds, catalog }: ResolverInput): MediaResolver {
  const urlMap = asMap(assetUrls);
  const kindMap = asMap<MediaKind>(assetKinds);
  const byKey = new Map(catalog.map((e) => [e.key, e]));
  return {
    urlForAsset: (id) => urlMap.get(id) ?? "",
    assetKind: (id) => kindMap.get(id) ?? kindFromUrl(urlMap.get(id) ?? ""),
    // No face analysis exists in this build. An empty track is the HONEST answer; the compiler turns
    // it into a visible centered placement rather than the 0×0 box it used to render.
    faceTrack: (_assetId, trackFaceId) => ({ trackId: trackFaceId, keyframes: [] }),
    lookRecipe: (key): RegistryRecipe => ({
      steps: ((byKey.get(key)?.recipe ?? []) as Array<Record<string, unknown>>).map((s): RegistryRecipeStep => {
        const start = recipeTime(s.startMs);
        const end = recipeTime(s.endMs);
        return {
          kind: s.type === "applyOverlay" ? "overlay" : "effect",
          effectKey: s.effectKey as string | undefined,
          overlayKey: s.overlayKey as string | undefined,
          params: (s.params as Record<string, unknown>) ?? {},
          target: recipeTarget(s.target),
          window: start && end ? { start, end } : undefined,
          placement: recipePlacement(s.placement),
        };
      }),
    }),
    registryEntry: (key) => {
      const e = byKey.get(key);
      return { engine: e?.engine ?? "remotion", lutFile: e?.lutFile };
    },
  };
}
