import type { ThinkingIntent } from "@/lib/ai/providers/types";

/**
 * THE GOOGLE TRANSLATOR — the one file allowed to know Gemini's wire shapes.
 *
 * This module used to be the whole provider layer: a key-rotating pool over `GEMINI_API_KEYS`, the
 * model factory, the BYOK header parsing, the redaction, the provider options. All of that was
 * generic dressed as Google-specific, and it now lives in `lib/ai/providers/`:
 *
 *   · the retry-once-on-5xx fetch          → providers/fetch.ts   (rotation deleted — see the note there)
 *   · the key header, shape check, redaction → providers/credential.ts
 *   · the model factory (all 8 providers)   → providers/factory.ts
 *   · the per-provider option translation    → providers/options.ts
 *
 * What is LEFT here is the part that is genuinely Gemini's and nobody else's: the safety settings,
 * and the per-family thinking-budget ranges. Both are Google-only facts, both have scar tissue worth
 * keeping next to the values, and neither belongs in a table shared with seven other vendors.
 *
 * PURE ON PURPOSE — this file imports no SDK, so `options.ts` can stay free of `@ai-sdk/*` and the
 * settings UI keeps its zero-byte provider budget.
 */

/** Default Gemini model. `HITE_GEMINI_MODEL` is a DEVELOPER override, not a product path. */
export const GEMINI_MODEL = process.env.HITE_GEMINI_MODEL ?? "gemini-2.5-flash";

/**
 * safetySettings BLOCK_NONE: HITE is a creative video-editing tool. Prompts routinely ask for
 * "aggressive" grades, horror/skullface overlays, violent drift energy, etc. — legitimate creative
 * direction that Gemini's default safety thresholds would refuse. We disable the filters so edits
 * never get silently blocked. (Output is timeline commands, not generated media.)
 *
 * GOOGLE ONLY. This shape is not portable and must never be sent to another provider, which is why
 * it lives here and `options.ts` reaches for it under the `google` key and nowhere else.
 */
export const GOOGLE_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
] as const;

/**
 * The verified thinking-budget range per model family, from the Gemini docs:
 *   2.5-flash       0-24576, 0 disables, -1 dynamic (dynamic by default)
 *   2.5-flash-lite  512-24576, 0 disables, does not think by default
 *   2.5-pro         128-32768, CANNOT be disabled, -1 dynamic
 *
 * `null` for anything else — a 3.x id, a `-latest` alias, or a typo. An unknown id still TYPECHECKS
 * (the SDK's model union ends in `(string & {})`), so guessing here would ship a request that 400s
 * at runtime or silently costs more for nothing. We send no thinkingConfig instead, and the rung's
 * other levers still apply.
 */
interface ThinkingRange {
  readonly min: number;
  readonly max: number;
  readonly canDisable: boolean;
}

function thinkingRange(model: string): ThinkingRange | null {
  if (model.includes("2.5-pro")) return { min: 128, max: 32_768, canDisable: false };
  if (model.includes("2.5-flash-lite")) return { min: 512, max: 24_576, canDisable: true };
  if (model.includes("2.5-flash")) return { min: 0, max: 24_576, canDisable: true };
  return null;
}

/**
 * Coerce a requested budget into something the CHOSEN model actually accepts.
 *
 * Exported for the test that guards the one failure mode with no runtime symptom: a budget outside
 * the model's range is rejected by the API *after* the turn's tokens are already spent.
 */
export function clampThinkingBudget(model: string, requested: number): number | null {
  const range = thinkingRange(model);
  if (!range) return null;
  if (requested === -1) return -1; // dynamic — legal on every 2.5 model
  if (requested <= 0) return range.canDisable ? 0 : range.min;
  return Math.min(Math.max(requested, range.min), range.max);
}

/**
 * The effort ladder's normalized intent, in Gemini's units.
 *
 * These are the exact numbers the ladder shipped before the ladder became provider-agnostic, so a
 * Gemini run is byte-identical to what it was: off → 0 (NOT absent — `2.5-flash` thinks dynamically
 * when `thinkingConfig` is omitted, so "off" has to be said out loud), and dynamic → -1, which is
 * Gemini's own literal "spend what you decide to".
 */
const GEMINI_THINKING_BUDGET: Record<ThinkingIntent, number> = {
  off: 0,
  low: 4_096,
  medium: 8_192,
  high: 16_384,
  dynamic: -1,
};

/**
 * `providerOptions.google` for one run. Only `thinkingBudget` is ever sent — `thinkingLevel` is a
 * Gemini 3+ field and the 2.5 series rejects it outright.
 *
 * An unrecognised model gets the safety settings and NO thinkingConfig, because a budget whose
 * contract we never verified is a fabrication, not a default.
 */
export function googleProviderOptions(model: string, thinking: ThinkingIntent): Record<string, unknown> {
  const budget = clampThinkingBudget(model, GEMINI_THINKING_BUDGET[thinking]);
  if (budget === null) return { safetySettings: GOOGLE_SAFETY_SETTINGS };
  return { safetySettings: GOOGLE_SAFETY_SETTINGS, thinkingConfig: { thinkingBudget: budget } };
}
