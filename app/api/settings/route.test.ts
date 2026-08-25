import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

/**
 * GET /api/settings — what the settings UI reads to render itself.
 *
 * Three things are being pinned. First, the response is DERIVED from the registry, the verification
 * file and deployer config, so a self-hoster's choices actually reach the UI instead of being
 * hard-coded in it. Second, and non-negotiably: no key material of any kind is in the body — the
 * caller's own key appears only as a non-reversible fingerprint, and there is no deployer key pool
 * left to describe. Third, the body carries the two DEPLOYER facts a client cannot derive for itself
 * — the effort brake and whether the self-hosted provider is switched on — because both are
 * `process.env` reads that resolve to "unset" in a browser and would otherwise offer a rung or a
 * provider this server will refuse.
 */

const SENTINEL = "AIzaSySENTINELdoNOTleak0123456789abcdef";
const SENTINEL_FINGERPRINT = "dbffb7bb";
const HEADER = "x-hite-provider-key";

interface Settings {
  keyHeader: string;
  selectionHeaders: Record<string, string>;
  byok: {
    required: boolean;
    keyHeader: string;
    disclosure: string;
    defaultProvider: string;
    deployerCeiling: string | null;
    localEnabled: boolean;
  };
  key: { present: boolean; usable: boolean; fingerprint: string | null };
  providers: Array<{
    id: string;
    label: string;
    auth: { kind: string; maxLength?: number; keyHint?: string | null; defaultBaseUrl?: string };
    capabilities: { toolCalling: boolean; toolChoice: boolean; thinking: string[] };
    models: Array<{ id: string; label: string; surface: string | null; note: string | null; verification: { state: string } }>;
    catalogue: { url: string; requiresKey: boolean } | null;
    help: { getKey: string | null; docs: string };
    available: boolean;
    unavailableReason: string | null;
    rungCeiling: string;
    rungCeilingReason: string | null;
  }>;
  effort: {
    levels: string[];
    default: string;
    deployerCeiling: string | null;
    rungs: Record<string, { revisions: number; groundSteps: number; wallClockMs: number; thinking: string }>;
  };
  transcription: { groq: { configured: boolean } };
}

/** The route reads env through modules that parse it per call, so a fresh graph is not required —
 *  but resetting keeps each case honest about what it configured. */
async function get(env: Record<string, string> = {}, headers: Record<string, string> = {}): Promise<Response> {
  vi.resetModules();
  vi.unstubAllEnvs();
  const full = { GROQ_API_KEY: "", HITE_ALLOW_LOCAL_PROVIDER: "", HITE_BYOK_EFFORT_CEILING: "", ...env };
  for (const [name, value] of Object.entries(full)) vi.stubEnv(name, value);
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/settings", { headers }));
}

const body = async (res: Response): Promise<Settings> => (await res.clone().json()) as Settings;
const providerById = (s: Settings, id: string) => s.providers.find((p) => p.id === id)!;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("no secret is in the response", () => {
  test("a request carrying a key gets back a fingerprint and nothing else about it", async () => {
    const res = await get({}, { [HEADER]: SENTINEL });
    expect((await body(res)).key).toEqual({ present: true, usable: true, fingerprint: SENTINEL_FINGERPRINT });

    const everything = [await res.clone().text(), [...res.headers.values()].join(" ")].join("\n");
    expect(everything).not.toContain(SENTINEL);
  });

  test("a malformed key is reported as present-but-unusable, without quoting it", async () => {
    const res = await get({}, { [HEADER]: `${SENTINEL} junk` });
    expect((await body(res)).key).toEqual({ present: true, usable: false, fingerprint: null });
    expect(await res.clone().text()).not.toContain(SENTINEL);
  });

  test("a deployer env key cannot leak into the body — there is no pool field left to leak it", async () => {
    const res = await get({ GEMINI_API_KEYS: "pool-key-a,pool-key-b" });
    const text = await res.clone().text();
    expect(text).not.toContain("pool-key-a");
    expect(text).not.toContain("key-a"); // not even a suffix of one
    expect(text).not.toContain("poolConfigured");
  });
});

describe("the deployer facts a client cannot derive", () => {
  test("they are published in both of the places the settings UI looks", async () => {
    // The picker reads the registry directly (it is client-safe), so only these cross the wire.
    const settings = await body(await get({ HITE_BYOK_EFFORT_CEILING: "standard", HITE_ALLOW_LOCAL_PROVIDER: "1" }));
    expect(settings.byok.deployerCeiling).toBe("standard");
    expect(settings.byok.localEnabled).toBe(true);
    expect(settings.effort.deployerCeiling).toBe("standard");
  });

  test("they fail closed when unset", async () => {
    const settings = await body(await get());
    expect(settings.byok.deployerCeiling).toBeNull();
    expect(settings.byok.localEnabled).toBe(false);
  });

  test("the ladder and its default are published", async () => {
    const settings = await body(await get());
    expect(settings.keyHeader).toBe(HEADER);
    expect(settings.effort.levels).toEqual(["draft", "standard", "high", "max"]);
    expect(settings.effort.default).toBe("high");
    expect(settings.providers.length).toBe(8);
  });

  test("every rung publishes its real mechanics, so the picker describes rather than guesses", async () => {
    const settings = await body(await get());
    expect(settings.effort.rungs.draft).toEqual({
      revisions: 0,
      groundSteps: 0,
      wallClockMs: 45_000,
      thinking: "off",
    });
    expect(settings.effort.rungs.max.thinking).toBe("dynamic");
  });
});

describe("BYOK is the only path, and the body says so plainly", () => {
  test("a key is always required, whatever the deployer set", async () => {
    const settings = await body(await get({ GEMINI_API_KEYS: "pool-key-a", HITE_BYOK_MODE: "optional" }));
    expect(settings.byok.required).toBe(true);
    expect(settings.byok.keyHeader).toBe(HEADER);
    expect(settings.byok.defaultProvider).toBe("google");
  });

  test("the honest disclosure ships with the state, not with the UI", async () => {
    // The one sentence that must never be softened: the operator sees the key in transit.
    const settings = await body(await get());
    expect(settings.byok.disclosure).toContain("can see it in transit");
    expect(settings.byok.disclosure).not.toContain("Google"); // seven of the eight are not Google
  });

  test("the non-secret selection fields are published so a client cannot drift from the server", async () => {
    const settings = await body(await get());
    expect(settings.selectionHeaders).toEqual({
      provider: "x-hite-provider",
      model: "x-hite-model",
      surface: "x-hite-model-surface",
      baseUrl: "x-hite-base-url",
    });
  });
});

describe("the provider registry reaches the UI intact", () => {
  test("all eight ship, each with its own auth shape and help links", async () => {
    const settings = await body(await get());
    expect(settings.providers.map((p) => p.id)).toEqual([
      "google",
      "openai",
      "anthropic",
      "groq",
      "xai",
      "deepseek",
      "openrouter",
      "local",
    ]);
    expect(providerById(settings, "openai").auth).toMatchObject({ kind: "apiKey", maxLength: 512, keyHint: null });
    expect(providerById(settings, "local").auth).toMatchObject({ kind: "baseUrl", defaultBaseUrl: "http://localhost:11434/v1" });
    expect(providerById(settings, "anthropic").help.getKey).toMatch(/^https:\/\//);
  });

  test("every badge is DERIVED from the harness's file, never authored by this route", async () => {
    // The route must not be able to invent a badge. Asserting equality with `verificationFor`
    // (rather than asserting "everything is untested") keeps this true both before and after a real
    // run record lands, which is exactly when a hand-written claim would otherwise sneak in.
    const { verificationFor } = await import("@/lib/ai/providers/verification");
    const settings = await body(await get());
    for (const provider of settings.providers) {
      for (const model of provider.models) {
        expect(model.verification, `${provider.id}/${model.id}`).toEqual(
          verificationFor(provider.id as never, model.id, model.surface as never),
        );
      }
    }
  });

  test("the rung ceiling is per provider and carries its reason", async () => {
    const settings = await body(await get({ HITE_ALLOW_LOCAL_PROVIDER: "1" }));
    expect(providerById(settings, "openai").rungCeiling).toBe("max");
    expect(providerById(settings, "openai").rungCeilingReason).toBeNull();

    const local = providerById(settings, "local");
    expect(local.rungCeiling).toBe("standard");
    expect(local.rungCeilingReason).toContain("no edit at all");
  });

  test("the self-hosted provider is shown-and-explained, never silently omitted", async () => {
    const off = providerById(await body(await get()), "local");
    expect(off.available).toBe(false);
    expect(off.unavailableReason).toContain("HITE_ALLOW_LOCAL_PROVIDER=1");

    const on = providerById(await body(await get({ HITE_ALLOW_LOCAL_PROVIDER: "1" })), "local");
    expect(on.available).toBe(true);
    expect(on.unavailableReason).toBeNull();
  });

  test("a provider with no reasoning lever reports an empty one rather than implying it works", async () => {
    const settings = await body(await get({ HITE_ALLOW_LOCAL_PROVIDER: "1" }));
    expect(providerById(settings, "local").capabilities.thinking).toEqual([]);
    expect(providerById(settings, "groq").capabilities.thinking.length).toBeGreaterThan(0);
  });
});

describe("deployer configuration", () => {
  test("the effort brake is reported when set, and null when it is not", async () => {
    expect((await body(await get())).effort.deployerCeiling).toBeNull();
    expect((await body(await get({ HITE_BYOK_EFFORT_CEILING: "standard" }))).effort.deployerCeiling).toBe("standard");
  });

  test("transcription is reported separately — it is the DEPLOYER's Groq key, not the user's", async () => {
    // Conflating "Groq for Whisper (yours, operator)" with "Groq as your LLM provider (theirs)"
    // would tell a user their captions work because they pasted an LLM key, or vice versa.
    expect((await body(await get())).transcription.groq.configured).toBe(false);
    expect((await body(await get({ GROQ_API_KEY: "gsk_x" }))).transcription.groq.configured).toBe(true);
    // …and it is not a provider row.
    const settings = await body(await get({ GROQ_API_KEY: "gsk_x" }));
    expect(providerById(settings, "groq").auth.kind).toBe("apiKey");
  });
});

describe("caching", () => {
  test("the answer varies by a secret header, so it must never be stored by a shared cache", async () => {
    const res = await get({}, { [HEADER]: SENTINEL });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vary")).toBe(HEADER);
  });
});
