import {
  PROVIDER_IDS,
  type ProviderCapabilities,
  type ProviderEntry,
  type ProviderId,
  type ProviderModel,
} from "./types";

/**
 * THE PROVIDER REGISTRY — the single owner of which providers exist and what they can do.
 *
 * CLIENT-SAFE BY CONSTRUCTION: this file imports no provider package, so the settings UI can render
 * every label, model list, help link and capability badge with zero bytes of SDK in the browser
 * chunk. `factory.ts` does the importing, lazily and server-side only.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT IN HERE, AND WHY THAT IS THE WHOLE POINT
 *
 * There is no `verified`, `works`, `reliable` or `recommended` field on `ProviderModel`, so there is
 * nowhere to hand-assert one. Whether a model actually drives HITE's planner is DERIVED from
 * `public/providers/verified.json`, which only `scripts/verify-provider.ts` writes, and only by
 * running the real planner against the real reducer. A contributor who wants a green badge has
 * exactly one path: run the harness and commit its output. `registry.test.ts` fails the build if a
 * reliability-shaped key ever appears in this file's data.
 *
 * Everything below therefore ships UNTESTED, Gemini included. Gemini is the only provider running in
 * production today, and a hand-written "verified" for the incumbent would be precisely the assertion
 * this design exists to prevent.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * PROVENANCE OF THE FACTS BELOW (all read on 2026-08-20 from the INSTALLED packages, not from memory)
 *
 * · model ids  — each package's shipped `dist/index.d.ts` model-id union
 * · thinking   — each package's shipped provider-options schema (the exact enum members)
 * · endpoints  — each package's shipped default `baseURL` + the vendor's own docs
 * · capabilities — U8 §3/§6. Every `toolChoice: true` is a capability inference from the provider's
 *   documented `tool_choice` support, NOT a HITE measurement; the measurement is verification.json.
 *   The one `false` (local) is grounded in Ollama's published `ChatRequest` schema, which has no
 *   `tool_choice` field at all, and its OpenAI-compatibility page listing it as unsupported.
 *
 * Model lists go stale — `gemini-2.5-pro` was once pinned as the top rung and 404s for new accounts.
 * That is why every list here is documented as a STARTING SET and the picker also takes a free-text
 * id, which is `untested` by definition and rendered as such.
 */

/** Bound for a pasted key. Generous on purpose (U8 §6.9/§11.3): modern project keys are long, and a
 *  tight bound turns "this vendor lengthened its keys" into "your key is invalid". */
export const DEFAULT_KEY_MAX_LENGTH = 512;

/** Every provider with a real reasoning lever can express all five intents; see options.ts for the
 *  exact per-provider mapping. Named so the entries below read as data rather than repetition. */
const FULL_THINKING = ["off", "low", "medium", "high", "dynamic"] as const;

const KEYED_TOOL_CALLER: ProviderCapabilities = {
  toolCalling: true,
  toolStreaming: true,
  toolChoice: true,
  thinking: FULL_THINKING,
};

const apiKeyAuth = (keyHint: string | null = null) =>
  ({ kind: "apiKey", maxLength: DEFAULT_KEY_MAX_LENGTH, keyHint }) as const;

const model = (id: string, label: string, extra: Partial<ProviderModel> = {}): ProviderModel => ({
  id,
  label,
  surface: null,
  ...extra,
});

const ENTRIES: readonly ProviderEntry[] = [
  {
    id: "google",
    label: "Google Gemini",
    npm: { pkg: "@ai-sdk/google", range: "^3.0.83", firstParty: true },
    auth: apiKeyAuth(),
    capabilities: KEYED_TOOL_CALLER,
    models: [
      model("gemini-2.5-flash", "Gemini 2.5 Flash", { note: "Available on the free tier." }),
      model("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", { note: "Cheapest Gemini; smallest context." }),
      model("gemini-2.5-pro", "Gemini 2.5 Pro", {
        // Factual, and the reason the top rung is no longer hardcoded to a vendor id.
        note: "Not reachable on free-tier keys or new accounts — those get a 404.",
      }),
    ],
    // A keyless request answers 403 here rather than 401; the check route maps both to "invalid".
    validation: { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", auth: "x-goog-api-key" },
    help: { getKey: "https://aistudio.google.com/apikey", docs: "https://ai.google.dev/gemini-api/docs" },
    availability: "always",
  },
  {
    id: "openai",
    label: "OpenAI",
    npm: { pkg: "@ai-sdk/openai", range: "^3.0.98", firstParty: true },
    auth: apiKeyAuth(),
    capabilities: KEYED_TOOL_CALLER,
    /**
     * `surface: "chat"` on purpose. HITE's contract is a plain multi-step CLIENT function-tool loop,
     * which is the shape shared with Groq/xAI/DeepSeek/OpenRouter/local — one code path, one set of
     * surprises. The Responses API adds stateful semantics and server-side-tool rules HITE does not
     * use. The counter-argument is real (reasoning items round-trip better across tool steps on
     * Responses, which is exactly what the top rungs buy) and the registry supports it natively:
     * add the same id with `surface: "responses"` and it becomes a second, separately verified row.
     * That is a harness question, not an armchair one.
     */
    models: [
      model("gpt-5.4-mini", "GPT-5.4 mini", { surface: "chat", note: "Cheap tier." }),
      model("gpt-5.4", "GPT-5.4", { surface: "chat" }),
      model("gpt-5.5", "GPT-5.5", { surface: "chat" }),
      model("gpt-5.6", "GPT-5.6", { surface: "chat" }),
      model("gpt-5.4-nano", "GPT-5.4 nano", { surface: "chat", note: "Cheapest tier." }),
    ],
    validation: { url: "https://api.openai.com/v1/models", auth: "bearer" },
    help: { getKey: "https://platform.openai.com/api-keys", docs: "https://platform.openai.com/docs/api-reference" },
    availability: "always",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    npm: { pkg: "@ai-sdk/anthropic", range: "^3.0.111", firstParty: true },
    auth: apiKeyAuth(),
    capabilities: KEYED_TOOL_CALLER,
    models: [
      model("claude-sonnet-5", "Claude Sonnet 5"),
      model("claude-opus-5", "Claude Opus 5"),
      model("claude-haiku-4-5", "Claude Haiku 4.5", { note: "Cheap tier." }),
      model("claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ],
    validation: {
      url: "https://api.anthropic.com/v1/models",
      auth: "x-api-key",
      extraHeaders: { "anthropic-version": "2023-06-01" },
    },
    help: { getKey: "https://console.anthropic.com/settings/keys", docs: "https://docs.anthropic.com/en/api" },
    availability: "always",
  },
  {
    id: "groq",
    label: "Groq",
    npm: { pkg: "@ai-sdk/groq", range: "^3.0.60", firstParty: true },
    auth: apiKeyAuth(),
    // Groq's enum is none|default|low|medium|high — `default` IS its "let the model decide" value.
    capabilities: KEYED_TOOL_CALLER,
    models: [
      model("moonshotai/kimi-k2-instruct-0905", "Kimi K2 Instruct"),
      model("llama-3.3-70b-versatile", "Llama 3.3 70B Versatile"),
      model("openai/gpt-oss-120b", "GPT-OSS 120B"),
      model("openai/gpt-oss-20b", "GPT-OSS 20B"),
      model("qwen/qwen3-32b", "Qwen3 32B"),
      model("meta-llama/llama-4-maverick-17b-128e-instruct", "Llama 4 Maverick 17B"),
    ],
    validation: { url: "https://api.groq.com/openai/v1/models", auth: "bearer" },
    help: { getKey: "https://console.groq.com/keys", docs: "https://console.groq.com/docs" },
    availability: "always",
  },
  {
    id: "xai",
    label: "xAI",
    npm: { pkg: "@ai-sdk/xai", range: "^3.0.123", firstParty: true },
    auth: apiKeyAuth(),
    capabilities: KEYED_TOOL_CALLER,
    /**
     * In the 3.x line `xai(id)` IS the chat model and `.responses(id)` is opt-in — the AI SDK page's
     * "Responses API by default" note describes the 4.x / AI-SDK-7 line and would mislead anyone
     * reading it against this repo. Pinning `chat` also sidesteps the documented Responses-API rule
     * that server-side tools cannot be mixed with client function tools; HITE is 100% the latter.
     */
    models: [
      model("grok-4.6", "Grok 4.6", { surface: "chat" }),
      model("grok-4.5", "Grok 4.5", { surface: "chat" }),
      model("grok-4.3", "Grok 4.3", { surface: "chat" }),
    ],
    validation: { url: "https://api.x.ai/v1/models", auth: "bearer" },
    help: { getKey: "https://console.x.ai", docs: "https://docs.x.ai/docs/api-reference" },
    availability: "always",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    npm: { pkg: "@ai-sdk/deepseek", range: "^2.0.56", firstParty: true },
    auth: apiKeyAuth(),
    capabilities: KEYED_TOOL_CALLER,
    // The shipped union has exactly these two.
    models: [
      model("deepseek-chat", "DeepSeek Chat"),
      model("deepseek-reasoner", "DeepSeek Reasoner"),
    ],
    validation: { url: "https://api.deepseek.com/models", auth: "bearer" },
    help: { getKey: "https://platform.deepseek.com/api_keys", docs: "https://api-docs.deepseek.com" },
    availability: "always",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    npm: { pkg: "@openrouter/ai-sdk-provider", range: "^2.10.0", firstParty: false },
    auth: apiKeyAuth(),
    capabilities: KEYED_TOOL_CALLER,
    /**
     * A deliberately tiny starting set. OpenRouter's whole value is that its catalogue is live and
     * machine-readable: each model carries a `supported_parameters` array, so the picker can filter
     * to models advertising BOTH `tools` and `tool_choice` without hardcoding a single id. That is an
     * advertisement about their upstreams, not a HITE measurement — every one of them is `untested`.
     */
    models: [
      model("openai/gpt-5.4-mini", "OpenAI GPT-5.4 mini (via OpenRouter)"),
      model("anthropic/claude-sonnet-5", "Anthropic Claude Sonnet 5 (via OpenRouter)"),
      model("google/gemini-2.5-flash", "Google Gemini 2.5 Flash (via OpenRouter)"),
    ],
    catalogue: { url: "https://openrouter.ai/api/v1/models", requiresKey: false },
    validation: { url: "https://openrouter.ai/api/v1/key", auth: "bearer" },
    help: { getKey: "https://openrouter.ai/keys", docs: "https://openrouter.ai/docs" },
    availability: "always",
  },
  {
    id: "local",
    label: "Local / OpenAI-compatible",
    // Rides @ai-sdk/openai-compatible, which @ai-sdk/xai also depends on. If xAI is ever dropped the
    // package must be promoted to a direct dependency — a transitive dependency is not a contract.
    npm: { pkg: "@ai-sdk/openai-compatible", range: "^2.0.69", firstParty: true },
    auth: { kind: "baseUrl", defaultBaseUrl: "http://localhost:11434/v1", loopbackOnly: true },
    /**
     * `toolChoice: false` is the load-bearing entry in this whole file, and it is the reason
     * `rungCeiling` is a derivation rather than a config value.
     *
     * Ollama's published `ChatRequest` has no `tool_choice` property, and its OpenAI-compatibility
     * page lists `tool_choice` as unsupported. Its decoder ignores unknown fields, so a provider that
     * sends it anyway gets a SILENT no-op — worse than an error. The planner's grounding phase
     * withholds the emit tool and sets `toolChoice: "required"`; the SDK loop only continues after a
     * step that made a tool call, so a grounding step answered with prose ends the turn with NO
     * BATCH. `high` and `max` therefore cannot be offered here, and `standard` (groundSteps 0) can.
     *
     * `thinking: []` because `@ai-sdk/openai-compatible` exposes no reasoning lever at all. The rungs
     * still run; the UI must say the lever is inert rather than imply it is working.
     */
    capabilities: { toolCalling: true, toolStreaming: true, toolChoice: false, thinking: [] },
    // Which models exist is a property of the USER'S machine. A hardcoded list would be a fabricated
    // claim about someone else's disk; `GET {baseUrl}/models` is the only truthful source.
    models: [],
    catalogue: { url: "/models", requiresKey: false },
    validation: { url: "/models", auth: "none" },
    help: { getKey: null, docs: "https://docs.ollama.com/api/openai-compatibility" },
    availability: "selfHostOnly",
  },
];

/** Indexed once at module load; the array order is the display order. */
const BY_ID: ReadonlyMap<ProviderId, ProviderEntry> = new Map(ENTRIES.map((e) => [e.id, e]));

export const PROVIDERS: readonly ProviderEntry[] = ENTRIES;

export function providerEntry(id: ProviderId): ProviderEntry {
  const entry = BY_ID.get(id);
  // Unreachable while `ProviderId` and ENTRIES agree, and `registry.test.ts` proves they do. Throwing
  // beats a non-null assertion: if the two ever drift, this names the drift instead of NPE-ing later.
  if (!entry) throw new Error(`[providers] no registry entry for '${id}'`);
  return entry;
}

/** `undefined` rather than a throw — this is the lookup a REQUEST does, and a bad id is a 400. */
export function findProviderEntry(id: string): ProviderEntry | undefined {
  return (PROVIDER_IDS as readonly string[]).includes(id) ? BY_ID.get(id as ProviderId) : undefined;
}

/**
 * The registry's own model row for an id, if it has one. A free-text id returns `undefined` and is
 * treated as a valid-but-untested selection — that is the feature, not a gap (U8 §9.4).
 */
export function findProviderModel(
  entry: ProviderEntry,
  id: string,
  surface: string | null = null,
): ProviderModel | undefined {
  return entry.models.find((m) => m.id === id && (surface === null || m.surface === surface));
}

/** Capabilities for a specific selection: the provider's, with any per-model override applied. */
export function capabilitiesFor(entry: ProviderEntry, model: ProviderModel | undefined): ProviderCapabilities {
  return model?.capabilities ? { ...entry.capabilities, ...model.capabilities } : entry.capabilities;
}

/**
 * Is a `selfHostOnly` provider allowed on THIS deployment?
 *
 * Off unless the deployer opts in, because a user-supplied `baseUrl` that the SERVER fetches is an
 * SSRF pivot (cloud metadata, internal VPC addresses), and on a hosted deployment `localhost` means
 * the SERVER'S localhost, so the feature could not work there anyway. Read per call, not at module
 * load, so flipping the env var does not need a rebuilt module graph to be observable.
 */
export function localProviderEnabled(): boolean {
  return process.env.HITE_ALLOW_LOCAL_PROVIDER?.trim() === "1";
}

export function providerAvailable(entry: ProviderEntry): boolean {
  return entry.availability === "always" || localProviderEnabled();
}

/** Why a provider is greyed out, for the UI to render verbatim. `null` when it is available. */
export function unavailableReason(entry: ProviderEntry): string | null {
  if (providerAvailable(entry)) return null;
  return (
    "Self-host only. This server would be the one making the request, so a local address here would " +
    "either fail or point at the server's own network. Set HITE_ALLOW_LOCAL_PROVIDER=1 when running HITE yourself."
  );
}
