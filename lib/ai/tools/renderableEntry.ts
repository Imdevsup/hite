import type { RegistryEntry } from "@/lib/registry/types";
import { isRenderableEffectKey, isRenderableTransitionKey } from "@/lib/remotion/renderable";

/**
 * "If the model emits this registry key, will the video actually change?"
 *
 * The manifest advertises more than the renderer can paint. `ClipFx` skips an effect with no
 * renderer, the reducer accepts any key, and the compiler drops a look step it cannot resolve — all
 * silently. So an advisor that hands the model `reverb-plate` or `look-skull-face-drop` produces a
 * success message over a pixel-identical video: the worst failure this product has.
 *
 * Every answer here is COMPOSED from `lib/remotion/renderable.ts` (the render layer's own derived
 * source of truth for effect keys and transition keys) — nothing is hand-listed, so a newly
 * registered renderer widens this gate automatically. This module lives in `lib/ai/tools` rather
 * than inside `renderable.ts` because it adds a REGISTRY-level question (a whole entry, including a
 * look recipe's steps) on top of that module's key-level primitives.
 *
 * Categories deliberately NOT gated: `overlays` and `text`. They are not effect keys — they lower to
 * `ADD_OVERLAY` / `ADD_CAPTION`, which HiteRoot paints through `OverlayView` (procedural CSS for
 * every overlay key in the manifest) and `CaptionView` (style-aware). `renderable.ts` models neither,
 * and filtering them on an effect-renderer predicate would delete capability that demonstrably works.
 */

/**
 * The only `{{var}}` a look recipe can count on. `compile.ts` supplies `durationMs` from the EDL
 * itself; every other var (`dropMs`, `faceId`, …) comes from `resolver.recipeVars`, which
 * `lib/render/resolver.ts` does not implement — no beat or face analysis is wired into the render
 * path in this build, and `COMPOSE_LOOK` carries no params for the model to fill them in with.
 * A step referencing anything else is dropped at compile time with a diagnostic.
 */
const COMPILER_SUPPLIED_RECIPE_VARS: ReadonlySet<string> = new Set(["durationMs"]);

/** Keep the "here is what you cannot have" note short enough to stay cheap in the model's context. */
const MAX_WITHHELD_KEYS_LISTED = 8;

/** Matches compile.ts's own `evalExpr` offset form (`dropMs_minus_1600` → base var `dropMs`). */
const OFFSET_EXPR = /^(\w+?)_(?:plus|minus|times)_\d+(?:\.\d+)?$/;
const TEMPLATE_ANYWHERE = /\{\{(.+?)\}\}/g;

/** The variable a `{{…}}` expression needs, or null when it is a bare numeric literal. */
function templateVar(expr: string): string | null {
  const trimmed = expr.trim();
  const offset = trimmed.match(OFFSET_EXPR);
  const name = offset ? offset[1] : trimmed;
  return Number.isFinite(Number(name)) ? null : name;
}

/** Every recipe var a step references that nothing in this build can supply. */
function unsatisfiableVars(step: unknown): string[] {
  const out: string[] = [];
  for (const [, expr] of JSON.stringify(step ?? null).matchAll(TEMPLATE_ANYWHERE)) {
    const name = templateVar(expr);
    if (name && !COMPILER_SUPPLIED_RECIPE_VARS.has(name)) out.push(name);
  }
  return [...new Set(out)];
}

interface RecipeStep {
  type?: unknown;
  effectKey?: unknown;
  overlayKey?: unknown;
}

/** Why this look is a no-op today, or null if every step of its recipe lands. */
function unrenderableLookReason(entry: RegistryEntry): string | null {
  const recipe = entry.recipe ?? [];
  if (recipe.length === 0) return "its recipe is empty";
  for (const raw of recipe) {
    const step = (raw ?? {}) as RecipeStep;
    const effectKey = typeof step.effectKey === "string" ? step.effectKey : null;
    const overlayKey = typeof step.overlayKey === "string" ? step.overlayKey : null;
    if (!effectKey && !overlayKey) return "one of its recipe steps names no key";
    if (effectKey && !isRenderableEffectKey(effectKey)) {
      return `its recipe step "${effectKey}" has no renderer, so the look would only half-apply`;
    }
    const missing = unsatisfiableVars(raw);
    if (missing.length > 0) {
      return `its recipe needs analysis this build does not produce ({{${missing.join("}}, {{")}}}), so every step that uses it is dropped`;
    }
  }
  return null;
}

/**
 * Why emitting this entry would change nothing, or `null` when it really renders.
 * The string is model-facing: it explains the gap rather than pretending the key does not exist.
 */
export function unrenderableReason(entry: RegistryEntry): string | null {
  switch (entry.category) {
    case "color":
    case "luts":
    case "glitch":
    case "procedural":
    case "audio":
      // These lower to ADD_EFFECT → HiteRoot's effect renderer map.
      return isRenderableEffectKey(entry.key) ? null : "no renderer exists for this effect in this build";
    case "transitions":
      // v1 paints a boundary treatment; keys naming a pixel blend of two clips over-promise.
      return isRenderableTransitionKey(entry.key)
        ? null
        : "v1 cannot blend or move the two clips' pixels, so this transition would not look like its name";
    case "looks":
      return unrenderableLookReason(entry);
    case "overlays":
    case "text":
      return null;
  }
  // Unreachable while the switch covers RegistryCategory. If a category is ever added without a
  // case here, withhold it rather than advertise something no one has checked can render.
  return "no renderability gate is defined for this registry category yet";
}

/** Will emitting this entry actually change the video? */
export function isRenderableEntry(entry: RegistryEntry): boolean {
  return unrenderableReason(entry) === null;
}

/** Drop everything the render pipeline would silently ignore. The advisors' one gate. */
export function filterRenderable(entries: readonly RegistryEntry[]): RegistryEntry[] {
  return entries.filter(isRenderableEntry);
}

/** Split a category into what the model may be offered and what this build would ignore. */
export function partitionRenderableEntries(entries: readonly RegistryEntry[]): {
  renderable: RegistryEntry[];
  unrenderable: RegistryEntry[];
} {
  const renderable: RegistryEntry[] = [];
  const unrenderable: RegistryEntry[] = [];
  for (const e of entries) (isRenderableEntry(e) ? renderable : unrenderable).push(e);
  return { renderable, unrenderable };
}

/**
 * Why an advisor came back empty when the GATE — not the query — emptied it.
 *
 * Without this the model sees a bare `[]` for "make the vocals punchier" or "add a crossfade" and
 * has no way to tell "nothing matched your words" from "this build cannot do that at all"; the first
 * invites another guess, the second needs to be told to the user. Returns undefined when nothing was
 * withheld (a genuinely unmatched query is just an empty list).
 */
export function withheldNote(unrenderable: readonly RegistryEntry[]): string | undefined {
  if (unrenderable.length === 0) return undefined;
  const many = unrenderable.length > 1;
  const reasons = [...new Set(unrenderable.map((e) => unrenderableReason(e) ?? ""))];
  const shown = unrenderable.slice(0, MAX_WITHHELD_KEYS_LISTED).map((e) => e.key);
  const rest = unrenderable.length - shown.length;
  return (
    `${unrenderable.length} matching registry entr${many ? "ies were" : "y was"} withheld because this build cannot render ` +
    `${many ? "them" : "it"} — ${reasons.join("; ")}. Withheld: ${shown.join(", ")}${rest > 0 ? ` (+${rest} more)` : ""}. ` +
    `Emitting one would report success over an unchanged video, so do NOT use ${many ? "them" : "it"}: pick from the returned list, or tell the user this build does not support it yet.`
  );
}
