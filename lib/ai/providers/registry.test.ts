import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, afterEach, vi } from "vitest";
import { EFFORT, rungCeiling } from "@/lib/ai/effort";
import {
  PROVIDERS,
  capabilitiesFor,
  findProviderEntry,
  findProviderModel,
  localProviderEnabled,
  providerAvailable,
  providerEntry,
  unavailableReason,
} from "./registry";
import { PROVIDER_IDS, THINKING_INTENTS, isProviderId } from "./types";

/**
 * The registry's job is to be DATA that cannot lie.
 *
 * Two of these tests are structural rather than behavioural, and they are the important ones: no
 * reliability claim may be written into the registry by hand, and no provider SDK may be reachable
 * from the client-safe modules. Both are the kind of rule that decays the moment it depends on
 * somebody remembering it.
 */

const HERE = join(process.cwd(), "lib", "ai", "providers");
const source = (file: string) => readFileSync(join(HERE, file), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the data is internally consistent", () => {
  test("every ProviderId has exactly one entry, and every entry has a known id", () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual([...PROVIDER_IDS].sort());
    for (const id of PROVIDER_IDS) expect(providerEntry(id).id).toBe(id);
    expect(PROVIDERS.every((p) => isProviderId(p.id))).toBe(true);
  });

  test("model ids are unique per provider per surface — a duplicate silently selects the wrong row", () => {
    for (const entry of PROVIDERS) {
      const seen = entry.models.map((m) => `${m.id}::${m.surface ?? ""}`);
      expect(new Set(seen).size, entry.id).toBe(seen.length);
    }
  });

  test("every declared thinking intent is one the ladder can actually ask for", () => {
    const laddersUse = new Set(Object.values(EFFORT).map((p) => p.thinking));
    for (const entry of PROVIDERS) {
      for (const intent of entry.capabilities.thinking) {
        expect(THINKING_INTENTS, entry.id).toContain(intent);
      }
    }
    // And every intent the ladder uses is expressible by at least one shipped provider, or the rung
    // silently does nothing everywhere.
    for (const intent of laddersUse) {
      expect(PROVIDERS.some((p) => p.capabilities.thinking.includes(intent)), intent).toBe(true);
    }
  });

  test("a provider that cannot call tools is not shippable, so none of them claim it", () => {
    for (const entry of PROVIDERS) expect(entry.capabilities.toolCalling, entry.id).toBe(true);
  });

  test("help links are absolute, and the validation call is absolute for every keyed provider", () => {
    for (const entry of PROVIDERS) {
      if (entry.help.getKey) expect(entry.help.getKey, entry.id).toMatch(/^https:\/\//);
      expect(entry.help.docs, entry.id).toMatch(/^https:\/\//);
      if (entry.auth.kind === "apiKey") expect(entry.validation.url, entry.id).toMatch(/^https:\/\//);
      // A base-URL provider stores a PATH; the user's own origin supplies the rest.
      else expect(entry.validation.url, entry.id).toMatch(/^\//);
    }
  });

  test("findProviderEntry rejects anything that is not a known id, without throwing", () => {
    expect(findProviderEntry("openai")?.id).toBe("openai");
    expect(findProviderEntry("gemini")).toBeUndefined(); // a plausible-looking wrong id
    expect(findProviderEntry("__proto__")).toBeUndefined();
  });

  test("a free-text model id is simply not in the registry — that is the feature, not a gap", () => {
    const google = providerEntry("google");
    expect(findProviderModel(google, "gemini-2.5-flash")?.label).toBe("Gemini 2.5 Flash");
    expect(findProviderModel(google, "gemini-9-ultra-preview")).toBeUndefined();
    // …and it still resolves capabilities, so it can run and be reported `untested`.
    expect(capabilitiesFor(google, undefined).toolCalling).toBe(true);
  });
});

describe("NO RELIABILITY CLAIM MAY BE HAND-WRITTEN", () => {
  test("the registry source contains no verified/works/reliable/recommended data key", () => {
    // Structural, because this is the one rule the whole unit rests on: the ONLY way a model earns a
    // green badge is `scripts/verify-provider.ts` writing public/providers/verified.json. If a field
    // like `verified: true` ever appears here, there is somewhere to assert it by hand — and the
    // owner's standard ("a dropdown of thirty providers where half silently fail is worse than four
    // that are known good") quietly stops being enforced.
    const text = source("registry.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    expect(text).not.toMatch(/^\s*(verified|works|reliable|recommended)\s*:/m);
  });

  test("the registry TYPE has nowhere to put one either", () => {
    const text = source("types.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    expect(text).not.toMatch(/readonly (verified|works|reliable|recommended)\b/);
  });

  test("model notes are factual, never a reliability claim", () => {
    for (const entry of PROVIDERS) {
      for (const m of entry.models) {
        if (!m.note) continue;
        expect(m.note.toLowerCase(), `${entry.id}/${m.id}`).not.toMatch(/\b(works|verified|reliable|best)\b/);
      }
    }
  });
});

describe("the client-safe modules carry zero bytes of provider SDK", () => {
  // `factory.ts` is the ONLY module allowed to import a provider package, and nothing else in the
  // layer imports `factory.ts`. That is what keeps the settings UI's provider-SDK budget at zero
  // while it renders eight providers, their models and their badges.
  for (const file of ["types.ts", "registry.ts", "verification.ts", "options.ts", "credential.ts", "fetch.ts"]) {
    test(`${file} imports no @ai-sdk/* or @openrouter/* provider package`, () => {
      const text = source(file);
      expect(text).not.toMatch(/from ["']@ai-sdk\//);
      expect(text).not.toMatch(/from ["']@openrouter\//);
      expect(text).not.toMatch(/import\(["']@(ai-sdk|openrouter)\//);
    });
  }

  test("only factory.ts reaches for a provider package, and only via a dynamic import", () => {
    const text = source("factory.ts");
    expect(text).toMatch(/await import\("@ai-sdk\/google"\)/);
    // A STATIC import would evaluate every provider module on every cold start.
    expect(text).not.toMatch(/^import .* from "@ai-sdk\//m);
    expect(text).not.toMatch(/^import .* from "@openrouter\//m);
  });
});

describe("the self-hosted provider is off unless the deployer opts in", () => {
  test("it is unavailable by default, with a reason the UI can render verbatim", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "");
    const local = providerEntry("local");
    expect(localProviderEnabled()).toBe(false);
    expect(providerAvailable(local)).toBe(false);
    expect(unavailableReason(local)).toContain("HITE_ALLOW_LOCAL_PROVIDER=1");
    // Shown-and-explained, never silently omitted: a missing option is not an honest disclosure.
    expect(PROVIDERS.some((p) => p.id === "local")).toBe(true);
  });

  test("HITE_ALLOW_LOCAL_PROVIDER=1 turns it on, and only that exact value", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "1");
    expect(providerAvailable(providerEntry("local"))).toBe(true);
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "true");
    expect(providerAvailable(providerEntry("local"))).toBe(false);
  });

  test("every keyed provider is always available — only `local` is gated", () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "");
    for (const entry of PROVIDERS) {
      expect(providerAvailable(entry), entry.id).toBe(entry.id !== "local");
    }
  });
});

describe("the rung ceiling is DERIVED from capabilities, not from a vendor id", () => {
  test("a provider that enforces toolChoice reaches the top rung", () => {
    for (const entry of PROVIDERS) {
      if (!entry.capabilities.toolChoice) continue;
      expect(rungCeiling(entry.capabilities), entry.id).toBe("max");
    }
  });

  test("the self-hosted provider caps at the last rung with no grounding phase", () => {
    const local = providerEntry("local");
    expect(local.capabilities.toolChoice).toBe(false);
    const ceiling = rungCeiling(local.capabilities);
    expect(EFFORT[ceiling].groundSteps).toBe(0);
    // …and the rung above it does ground, which is why it cannot be offered there.
    expect(EFFORT.high.groundSteps).toBeGreaterThan(0);
  });

  test("`local` ships no model list — which models exist is a fact about the USER'S machine", () => {
    const local = providerEntry("local");
    expect(local.models).toEqual([]);
    expect(local.catalogue?.url).toBe("/models");
    // A hardcoded `qwen3:8b` here would be a fabricated claim about somebody else's disk.
  });
});
