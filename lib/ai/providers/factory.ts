import type { streamText } from "ai";
import { providerFetch } from "./fetch";
import { PROVIDER_OPTION_NAMESPACE } from "./options";
import type { KeySource } from "./credential";
import type { ModelSelection } from "./types";

/**
 * THE MODEL FACTORY — the only module in the repo that imports a provider package.
 *
 * SERVER ONLY. Nothing in a client component may reach this file, and nothing else in
 * `lib/ai/providers/` imports it. That single rule is what keeps the browser bundle at zero bytes of
 * provider SDK while the settings UI still renders eight providers, their models, their help links
 * and their verification badges — all of that comes from `registry.ts`, which imports no SDK.
 * `providers.bundle.test.ts` asserts the rule at the source level so it cannot rot quietly.
 *
 * WHY `await import()` PER REQUEST, stated honestly. Next traces static specifiers into the function
 * bundle whether or not the import is dynamic, so this does NOT shrink the deployment — the eight
 * packages are ~11.8 MiB on disk and ~1.13 MiB of ESM either way. What it buys is COLD-START
 * EVALUATION TIME: only the selected provider's module is parsed and evaluated. Measured on this
 * machine (Node 24.16.0, warm FS cache — an indicator, not a Vercel number), one 219 KiB provider
 * costs ~75-80 ms to import; eagerly importing all eight would add roughly 350-500 ms of pure module
 * evaluation to every cold invocation. Lazy import pays for one. That is the entire justification,
 * and it is sufficient.
 *
 * PER-REQUEST CONSTRUCTION, NEVER CACHED BY KEY. Building a provider is a config object plus a
 * closure, so it is cheap — and caching it keyed by the key would put a user's secret in a
 * module-level map that outlives their request. Don't.
 *
 * The credential is passed to each factory's own `apiKey` option, so it rides whichever header that
 * vendor uses (`x-goog-api-key`, `Authorization: Bearer`, `x-api-key` — all read from the shipped
 * `dist/index.d.ts`). `providerFetch` therefore never sees, attaches or rewrites a credential.
 */

/** What `streamText({ model })` accepts. Derived from the SDK's own signature rather than importing
 *  `LanguageModelV3` from `@ai-sdk/provider`, whose exact copy differs between `ai` and the providers. */
export type PlannerModel = Parameters<typeof streamText>[0]["model"];

/** `apiKey` for a keyed provider. `none` reaches here only for `local`, which needs no credential. */
function apiKeyOf(credential: KeySource): string | undefined {
  return credential.kind === "byok" ? credential.key : undefined;
}

/**
 * Build the language model for this run.
 *
 * Async because of the dynamic import; every caller is already inside an async route handler.
 * A `local` selection without a base URL is a programming error rather than a user error — the
 * request layer (`request.ts`) has already validated and defaulted it — so it throws rather than
 * inventing `http://localhost`, which would be a silent fetch at an address nobody asked for.
 */
export async function modelForSelection(selection: ModelSelection, credential: KeySource): Promise<PlannerModel> {
  const apiKey = apiKeyOf(credential);
  const fetch = providerFetch as typeof globalThis.fetch;

  switch (selection.providerId) {
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey, fetch })(selection.model);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openai = createOpenAI({ apiKey, fetch });
      // `openai(id)` is the RESPONSES model in 3.x; the chat surface has to be asked for by name.
      return selection.surface === "responses" ? openai.responses(selection.model) : openai.chat(selection.model);
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey, fetch })(selection.model);
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq({ apiKey, fetch })(selection.model);
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      const xai = createXai({ apiKey, fetch });
      // In 3.x `xai(id)` is already the CHAT model; `.responses` is opt-in. (The AI SDK page's
      // "Responses API by default" note describes the 4.x line and is wrong for this repo.)
      return selection.surface === "responses" ? xai.responses(selection.model) : xai.chat(selection.model);
    }
    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({ apiKey, fetch })(selection.model);
    }
    case "openrouter": {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      // `appName`/`appUrl` set X-OpenRouter-Title / HTTP-Referer for dashboard attribution — a
      // courtesy to the user reading their own OpenRouter activity, not telemetry to us.
      const openrouter = createOpenRouter({ apiKey, fetch, appName: "HITE", appUrl: "https://www.tryhite.xyz" });
      return openrouter.chat(selection.model);
    }
    case "local": {
      if (!selection.baseUrl) {
        throw new Error("[providers] the local provider needs a baseUrl; request.ts must supply one");
      }
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      // `name` decides the providerOptions namespace this model reads — keep it in step with the
      // registry's own table rather than repeating the literal.
      return createOpenAICompatible({
        name: PROVIDER_OPTION_NAMESPACE.local,
        baseURL: selection.baseUrl,
        // Ollama's own docs say the key is "required but ignored"; a user who supplied nothing gets a
        // constant rather than an undefined that some servers reject outright.
        apiKey: apiKey ?? "local",
        fetch,
      })(selection.model);
    }
  }
}
