import { describe, expect, test, afterEach, vi } from "vitest";
import { BadRequestError, HttpError } from "@/lib/api/errors";
import { EFFORT_LEVELS } from "@/lib/ai/effort";
import {
  PROVIDER_BASE_URL_HEADER,
  PROVIDER_ID_HEADER,
  PROVIDER_KEY_HEADER,
  PROVIDER_MODEL_HEADER,
  PROVIDER_SURFACE_HEADER,
} from "./credential";
import { DEFAULT_PROVIDER_ID, NO_KEY_MESSAGE, resolveProviderRun } from "./request";

/**
 * The one call an expensive route makes. What is pinned here is the BYOK-only contract: there is no
 * deployer key pool, so a keyless request cannot fall through to anything — it is a 402, always.
 */

const SENTINEL = "AIzaSySENTINELdoNOTleak0123456789abcdef";

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/plan", { method: "POST", headers });

const withKey = (extra: Record<string, string> = {}) => request({ [PROVIDER_KEY_HEADER]: SENTINEL, ...extra });

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BYOK is the only path", () => {
  test("no key is a 402 that points at settings and quotes nothing the caller sent", async () => {
    const err = thrownBy(() => resolveProviderRun(request(), undefined));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(402);
    expect(await (err as HttpError).response.json()).toEqual({ error: NO_KEY_MESSAGE });
  });

  test("no env variable can restore a fallback — the pool concept does not exist here", async () => {
    // The old shape read GEMINI_API_KEYS at module load and quietly ran on it. Setting it must now
    // change nothing at all on a request path.
    vi.stubEnv("GEMINI_API_KEYS", "deployer-key-a,deployer-key-b");
    vi.stubEnv("HITE_BYOK_MODE", "optional");
    const err = thrownBy(() => resolveProviderRun(request(), undefined));
    expect((err as HttpError).status).toBe(402);
  });

  test("a malformed key is a 400 whose message does NOT echo the value", async () => {
    const err = thrownBy(() => resolveProviderRun(request({ [PROVIDER_KEY_HEADER]: `${SENTINEL} leaked` }), undefined));
    expect((err as HttpError).status).toBe(400);
    expect(JSON.stringify(await (err as HttpError).response.json())).not.toContain(SENTINEL);
  });

  test("a valid key resolves a runnable selection", () => {
    const run = resolveProviderRun(withKey(), undefined);
    expect(run.credential).toEqual({ kind: "byok", key: SENTINEL });
    expect(run.entry.id).toBe(DEFAULT_PROVIDER_ID);
    expect(run.selection.model).toBe("gemini-2.5-flash");
  });
});

describe("provider and model selection", () => {
  test("the provider header picks the provider; the body wins over the header", () => {
    expect(resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "anthropic" }), undefined).entry.id).toBe("anthropic");
    expect(
      resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "anthropic" }), undefined, { provider: "openai" }).entry.id,
    ).toBe("openai");
  });

  test("an unknown provider is a 400 naming the field, never a silent default", () => {
    // Silently defaulting would send a user's Anthropic key to Google — the worst possible outcome
    // of a typo.
    const err = thrownBy(() => resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "gemini" }), undefined));
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as Error).message).toBe(`${PROVIDER_ID_HEADER}: unknown provider`);
  });

  test("a free-text model id is accepted — hardcoded lists go stale, and this one already did", () => {
    const run = resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "openrouter" }), undefined, {
      model: "moonshotai/kimi-k2",
    });
    expect(run.selection.model).toBe("moonshotai/kimi-k2");
  });

  test("the surface comes from the registry row when the caller does not state one", () => {
    const run = resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "openai" }), undefined);
    expect(run.selection.surface).toBe("chat");
    expect(
      resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "openai", [PROVIDER_SURFACE_HEADER]: "responses" }), undefined)
        .selection.surface,
    ).toBe("responses");
  });

  test("a model id with whitespace or absurd length is a 400", () => {
    expect(() => resolveProviderRun(withKey(), undefined, { model: "gpt 5" })).toThrow(BadRequestError);
    expect(() => resolveProviderRun(withKey(), undefined, { model: "m".repeat(250) })).toThrow(BadRequestError);
  });
});

describe("the self-hosted provider", () => {
  test("is refused server-side when the deployer has not opted in", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "");
    const err = thrownBy(() => resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "local" }), undefined));
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as Error).message).toContain("HITE_ALLOW_LOCAL_PROVIDER=1");
  });

  test("even when enabled, a non-loopback base URL is refused BEFORE any fetch", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "1");
    const err = thrownBy(() =>
      resolveProviderRun(withKey({ [PROVIDER_ID_HEADER]: "local", [PROVIDER_MODEL_HEADER]: "qwen3:8b" }), undefined, {
        baseUrl: "http://169.254.169.254/latest/meta-data/",
      }),
    );
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as Error).message).toContain("only an address on this machine");
  });

  test("with a loopback URL it runs, and it needs no credential at all", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "1");
    const run = resolveProviderRun(
      request({ [PROVIDER_ID_HEADER]: "local", [PROVIDER_MODEL_HEADER]: "qwen3:8b", [PROVIDER_BASE_URL_HEADER]: "http://localhost:11434/v1" }),
      undefined,
    );
    expect(run.credential).toEqual({ kind: "none" });
    expect(run.selection.baseUrl).toBe("http://localhost:11434/v1");
  });

  test("it has no default model, so naming one is required rather than invented", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "1");
    const err = thrownBy(() => resolveProviderRun(request({ [PROVIDER_ID_HEADER]: "local" }), undefined));
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as Error).message).toContain("no default model");
  });

  test("its ceiling is the last ungrounded rung, whatever the client asked for", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "1");
    const run = resolveProviderRun(
      request({ [PROVIDER_ID_HEADER]: "local", [PROVIDER_MODEL_HEADER]: "qwen3:8b" }),
      "max",
    );
    expect(run.effort.level).toBe("standard");
    expect(run.effort.groundSteps).toBe(0);
  });
});

describe("the rung", () => {
  test("a keyed provider honours `max`", () => {
    expect(resolveProviderRun(withKey(), "max").effort.level).toBe("max");
  });

  test("an absent level falls back to the ladder's one default", () => {
    expect(resolveProviderRun(withKey(), undefined).effort.level).toBe("high");
  });

  test("the deployer's brake clamps every provider", () => {
    vi.stubEnv("HITE_BYOK_EFFORT_CEILING", "standard");
    expect(resolveProviderRun(withKey(), "max").effort.level).toBe("standard");
  });

  test("every level the ladder ships is resolvable", () => {
    for (const level of EFFORT_LEVELS) {
      expect(resolveProviderRun(withKey(), level).effort.level).toBe(level);
    }
  });
});
