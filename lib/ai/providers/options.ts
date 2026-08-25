import type { streamText } from "ai";
import { GOOGLE_SAFETY_SETTINGS, googleProviderOptions } from "@/lib/ai/gemini";
import { capabilitiesFor, findProviderModel, providerEntry } from "./registry";
import type { ModelSelection, ProviderId, ThinkingIntent } from "./types";

/**
 * ONE OWNER FOR THE PER-PROVIDER WIRE SHAPES.
 *
 * `providerOptionsWithThinking` used to return a Google-shaped `{ google: { safetySettings,
 * thinkingConfig } }` and hand it to every model. With eight providers that is not a detail — the
 * same lever is spelled a different way by every single vendor, and a table of eight spellings with
 * no owner is how one of them quietly stops being sent.
 *
 * PURE. No network, no provider package import, no `process.env` — a translation from the ladder's
 * normalized `ThinkingIntent` to the provider's own vocabulary, so it is trivially unit-testable and
 * carries no bytes into the browser bundle.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * EVERY VALUE BELOW IS FROM A SHIPPED PROVIDER-OPTIONS SCHEMA, read on 2026-08-20 from the installed
 * package's `dist/index.d.ts`. Nothing here is remembered:
 *
 *   openai      reasoningEffort: none|minimal|low|medium|high|xhigh|max
 *   groq        reasoningEffort: none|default|low|medium|high         ← `default` IS their "you decide"
 *   xai         reasoningEffort: none|low|medium|high|xhigh
 *   anthropic   thinking: {adaptive}|{enabled,budgetTokens}|{disabled};  effort: low|medium|high|xhigh|max
 *   deepseek    thinking: {adaptive|enabled|disabled};                   reasoningEffort: low|…|max
 *   openrouter  reasoning: {effort: none|minimal|low|medium|high|xhigh}
 *   google      thinkingConfig.thinkingBudget (per-family range — lib/ai/gemini.ts)
 *   local       (none at all — @ai-sdk/openai-compatible exposes no reasoning lever)
 *
 * `dynamic` means "spend as much as you decide to". Where a provider has a literal for that
 * (Gemini's `-1`, Groq's `default`, Anthropic's and DeepSeek's `adaptive`) it maps to that. Where it
 * does not, it maps to the TOP of that provider's own enum, which is the closest true statement of
 * the same instruction — not a guess about a value that does not exist.
 *
 * An intent a provider cannot express at all (`local`) produces `{}`. The rung still runs with its
 * other levers, and the settings UI reports the lever as unavailable rather than implying it works.
 */

// The AI SDK doesn't export its ProviderOptions type by name; derive it from streamText's signature
// so this stays correct across SDK versions.
type AiProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

/** The namespace each provider reads its options under. Verified from each shipped bundle's own
 *  `parseProviderOptions({ provider: … })` call — not assumed from the package name. */
export const PROVIDER_OPTION_NAMESPACE: Record<ProviderId, string> = {
  google: "google",
  openai: "openai",
  anthropic: "anthropic",
  groq: "groq",
  xai: "xai",
  deepseek: "deepseek",
  openrouter: "openrouter",
  // @ai-sdk/openai-compatible derives this from the `name` passed to the factory, which factory.ts
  // sets to "local". Both must change together.
  local: "local",
};

/**
 * The parallel-function-calling switch, per vendor, with the exact spelling — including the two that
 * are traps (Anthropic's is INVERTED; xAI's is snake_case).
 *
 * DELIBERATELY NOT SENT. Every provider here defaults to parallel tool calls on, and the planner's
 * `PlannerRun.noteStreamEmit()` hard-fails a turn that emits two batches in one step. It is tempting
 * to pre-emptively disable parallelism everywhere — and it would be wrong: the grounding phase
 * depends on parallel calls to reach "4-6 analysis calls in 2 steps" without burning the step
 * budget, so turning it off would make `high`/`max` slower and shallower to prevent a failure nobody
 * has observed. The harness records `contractViolations` as a first-class outcome instead; a model
 * that trips the guard is graded broken with that reason, and THEN this table is how it gets fixed
 * for that provider only. Measured, not guessed.
 */
export const PARALLEL_TOOL_CALL_OPTION: Record<ProviderId, { key: string; disableValue: boolean } | null> = {
  google: null, // no switch in the provider options at all
  openai: { key: "parallelToolCalls", disableValue: false },
  anthropic: { key: "disableParallelToolUse", disableValue: true }, // inverted
  groq: { key: "parallelToolCalls", disableValue: false },
  xai: { key: "parallel_function_calling", disableValue: false }, // snake_case
  deepseek: null,
  openrouter: { key: "parallelToolCalls", disableValue: false },
  local: null,
};

type Wire = Record<string, unknown>;

const OPENAI_EFFORT: Record<ThinkingIntent, string> = {
  off: "none",
  low: "low",
  medium: "medium",
  high: "high",
  dynamic: "max",
};

const GROQ_EFFORT: Record<ThinkingIntent, string> = {
  off: "none",
  low: "low",
  medium: "medium",
  high: "high",
  dynamic: "default",
};

const XAI_EFFORT: Record<ThinkingIntent, string> = {
  off: "none",
  low: "low",
  medium: "medium",
  high: "high",
  dynamic: "xhigh",
};

const OPENROUTER_EFFORT: Record<ThinkingIntent, string> = {
  off: "none",
  low: "low",
  medium: "medium",
  high: "high",
  dynamic: "xhigh",
};

/**
 * Anthropic: `thinking` and `effort` are two different knobs and both are sent for the graded rungs.
 *
 * Caveat worth stating rather than discovering: Anthropic documents that thinking cannot be disabled
 * above `effort: high` on `claude-opus-5`, so an `off` intent may be silently overridden upstream.
 * We still ask for it — asking honestly and being overridden is correct; the harness records what
 * actually happened rather than what we requested.
 */
function anthropicWire(thinking: ThinkingIntent): Wire {
  switch (thinking) {
    case "off":
      return { thinking: { type: "disabled" } };
    case "dynamic":
      return { thinking: { type: "adaptive" } };
    default:
      return { effort: thinking };
  }
}

function deepseekWire(thinking: ThinkingIntent): Wire {
  switch (thinking) {
    case "off":
      return { thinking: { type: "disabled" } };
    case "dynamic":
      return { thinking: { type: "adaptive" } };
    default:
      return { thinking: { type: "enabled" }, reasoningEffort: thinking };
  }
}

/**
 * The provider-namespaced options for one run, as a plain object.
 *
 * Exported separately from `providerOptionsFor` so tests can assert the exact wire shape without
 * casting through the SDK's opaque `ProviderOptions` type.
 */
export function wireOptionsFor(selection: ModelSelection, thinking: ThinkingIntent): Record<string, Wire> {
  const entry = providerEntry(selection.providerId);
  const capabilities = capabilitiesFor(entry, findProviderModel(entry, selection.model, selection.surface));
  const namespace = PROVIDER_OPTION_NAMESPACE[selection.providerId];

  // C7: a provider that cannot express this intent gets NOTHING, never a nearby guess. Google is the
  // exception in one direction only — BLOCK_NONE is not a thinking lever and must survive regardless,
  // because creative edit prompts get refused without it.
  if (!capabilities.thinking.includes(thinking)) {
    return selection.providerId === "google" ? { google: { safetySettings: GOOGLE_SAFETY_SETTINGS } } : {};
  }

  switch (selection.providerId) {
    case "google":
      return { google: googleProviderOptions(selection.model, thinking) };
    case "openai":
      return { [namespace]: { reasoningEffort: OPENAI_EFFORT[thinking] } };
    case "groq":
      return { [namespace]: { reasoningEffort: GROQ_EFFORT[thinking] } };
    case "xai":
      return { [namespace]: { reasoningEffort: XAI_EFFORT[thinking] } };
    case "anthropic":
      return { [namespace]: anthropicWire(thinking) };
    case "deepseek":
      return { [namespace]: deepseekWire(thinking) };
    case "openrouter":
      return { [namespace]: { reasoning: { effort: OPENROUTER_EFFORT[thinking] } } };
    case "local":
      return {};
  }
}

/**
 * What `streamText({ providerOptions })` takes.
 *
 * The cast is the one unavoidable escape hatch in this file and it is narrow: `ProviderOptions` is
 * `Record<string, Record<string, JSONValue>>`, and TypeScript will not infer our literal nested
 * objects (arrays of const objects, discriminated `thinking` shapes) as `JSONValue` without either
 * hand-widening every literal or a cast here. Everything reaching this line is already a plain
 * JSON-serialisable object built above; `options.test.ts` asserts the exact shapes.
 */
export function providerOptionsFor(selection: ModelSelection, thinking: ThinkingIntent): AiProviderOptions {
  return wireOptionsFor(selection, thinking) as unknown as AiProviderOptions;
}
