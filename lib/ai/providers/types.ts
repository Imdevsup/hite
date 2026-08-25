/**
 * Provider types — the vocabulary every other file in `lib/ai/providers/` speaks.
 *
 * THE ONE RULE THAT KEEPS THE BROWSER BUNDLE AT ZERO: this file, `registry.ts` and `verification.ts`
 * must never import an `@ai-sdk/*` or `@openrouter/*` package. They are plain data + types, so the
 * settings UI can render labels, model lists, help links and verification badges without a single
 * byte of provider SDK reaching a client chunk. `factory.ts` is the only module that touches a
 * provider package, it is server-only, and `providers.bundle.test.ts` enforces both halves.
 */

export const PROVIDER_IDS = [
  "google",
  "openai",
  "anthropic",
  "groq",
  "xai",
  "deepseek",
  "openrouter",
  "local",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Which API surface a model is addressed through. OpenAI and xAI expose two, and they behave
 * differently enough across a multi-step tool loop that each is separately verifiable (U8 §6.2).
 * Everything else has one, and stores `null`.
 */
export type ModelSurface = "chat" | "responses";

/**
 * The effort ladder's thinking lever, normalized across providers.
 *
 * Each provider translates it in `options.ts` from its OWN shipped enum — never from a guess. The
 * two ends are the ones worth spelling out:
 *   · `off`     — an explicit "do not think" value (Gemini `thinkingBudget: 0`, OpenAI/Groq/xAI
 *                 `reasoningEffort: "none"`, Anthropic/DeepSeek `thinking: {type:"disabled"}`).
 *                 NOT the same as sending nothing: several models think by default when unset.
 *   · `dynamic` — "spend as much as you decide to". Gemini has a literal value for it (`-1`);
 *                 elsewhere it maps to the provider's own adaptive mode or its top effort value.
 *
 * An intent a provider cannot express is sent as NOTHING, never as a nearby guess, and the rung
 * still runs with its other levers (U8 §3, C7).
 */
export type ThinkingIntent = "off" | "low" | "medium" | "high" | "dynamic";

export const THINKING_INTENTS: readonly ThinkingIntent[] = ["off", "low", "medium", "high", "dynamic"];

/**
 * What a provider can actually do, in terms of the planner's contract (U8 §3). Every field maps to
 * one requirement, and each is a claim about OBSERVED PROVIDER BEHAVIOUR, not about whether the SDK
 * accepts the field — Ollama accepts `tool_choice` and silently ignores it, which is exactly the
 * distinction `toolChoice` exists to record.
 */
export interface ProviderCapabilities {
  /** C1. `false` ⇒ the planner cannot run at all, so the provider is not offerable. */
  readonly toolCalling: boolean;
  /** C2. Tool-call deltas arrive on the stream, which is where both routes count emits. */
  readonly toolStreaming: boolean;
  /**
   * C4 + C5. `toolChoice: "required"` and `{type:"tool"}` are ENFORCED upstream.
   * `false` caps the ladder at the last rung with `groundSteps === 0` — see `rungCeiling`.
   */
  readonly toolChoice: boolean;
  /** C7. Which intents this provider can express as a distinct wire instruction. May be empty. */
  readonly thinking: readonly ThinkingIntent[];
}

/**
 * How a credential reaches the provider.
 *
 * `maxLength` is a BOUND, not a format check. The scar tissue is in `credential.ts`: a regex that
 * encodes a remembered key format silently 400s real users the day a vendor issues a new shape, and
 * the failure reads as "your key is invalid" rather than "our validator is stale".
 */
export type ProviderAuth =
  | {
      readonly kind: "apiKey";
      readonly maxLength: number;
      /** Advisory prefix. `null` unless a PRIMARY SOURCE documents it. Never blocks a paste. */
      readonly keyHint: string | null;
    }
  | {
      readonly kind: "baseUrl";
      readonly defaultBaseUrl: string;
      /** A server-fetched user-supplied URL is an SSRF pivot (U8 §11.1). Always loopback-gated. */
      readonly loopbackOnly: true;
    };

/**
 * The cheapest call that proves a credential works: a metadata read, zero tokens spent. The response
 * BODY is never read — a 4xx body can quote request metadata back at us, and text that is never
 * parsed cannot be forwarded.
 */
export interface ValidationCall {
  /** Absolute for keyed providers; a path appended to the user's baseUrl for `local`. */
  readonly url: string;
  readonly auth: "bearer" | "x-api-key" | "x-goog-api-key" | "none";
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export interface ProviderModel {
  /** The exact wire id. */
  readonly id: string;
  readonly label: string;
  /** `null` for providers with a single surface. */
  readonly surface: ModelSurface | null;
  /** Overrides of the provider defaults; omitted fields inherit. */
  readonly capabilities?: Partial<ProviderCapabilities>;
  /** A FACTUAL note (reachability, price tier). NEVER a reliability claim — that is verification's job. */
  readonly note?: string;
  // ── There is deliberately NO `verified` / `works` / `recommended` field. See verification.ts. ──
}

export interface ProviderEntry {
  readonly id: ProviderId;
  readonly label: string;
  /** `null` ⇒ no dedicated package (`local` rides `@ai-sdk/openai-compatible`). */
  readonly npm: { readonly pkg: string; readonly range: string; readonly firstParty: boolean } | null;
  readonly auth: ProviderAuth;
  readonly capabilities: ProviderCapabilities;
  /** A STARTING SET, never a claim of completeness — free-text ids are first-class (U8 §9.4). */
  readonly models: readonly ProviderModel[];
  /** Where the provider publishes its own live model list, when it has one. */
  readonly catalogue?: { readonly url: string; readonly requiresKey: boolean };
  readonly validation: ValidationCall;
  readonly help: { readonly getKey: string | null; readonly docs: string };
  /** `selfHostOnly` ⇒ rejected server-side unless the deployer opts in (U8 §11.1). */
  readonly availability: "always" | "selfHostOnly";
}

/**
 * Which provider + model THIS run uses. Carries no credential — that is `KeySource` in
 * `credential.ts`, deliberately a separate value so a selection can be logged and this one cannot.
 */
export interface ModelSelection {
  readonly providerId: ProviderId;
  readonly model: string;
  readonly surface: ModelSurface | null;
  /** `local` only; already validated to a loopback host by the time it lives here. */
  readonly baseUrl: string | null;
}
