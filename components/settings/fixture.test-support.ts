import { BYOK_DISCLOSURE, fingerprintKey } from "@/lib/ai/keys";
import { PROVIDER_KEY_HEADER } from "@/lib/ai/providers/credential";
import { DEFAULT_PROVIDER_ID } from "@/lib/ai/providers/request";
import { PROVIDERS } from "@/lib/ai/providers/registry";
import { parseSettingsSnapshot } from "./providerKey";
import type { SettingsSnapshot } from "./types";

/**
 * TEST SUPPORT ONLY — never imported by a component.
 *
 * The body `app/api/settings/route.ts` returns, assembled from the SERVER's own exports rather than
 * from typed-out strings: the disclosure comes from `BYOK_DISCLOSURE`, the header from the
 * credential module, the default provider from `request.ts`, the provider list from the registry and
 * the fingerprint from `fingerprintKey`. So when any of those change, the fixture changes with them
 * and the suite tests the new truth instead of pinning the old one.
 *
 * WHAT IT IS FOR, NOW THAT `contract.test.ts` ASSERTS THE ROUTE DIRECTLY. A fixture cannot prove the
 * two sides agree — it proved the opposite last time, staying green for weeks against a body the
 * route had stopped returning while the real one did not parse at all. So the route itself is the
 * agreement gate, and this object is only for the tests that need to DELETE a field and watch the
 * parser degrade, which a real handler cannot be made to do.
 *
 * Named `.test-support` so vitest does not collect it as a suite and the source-honesty scan does
 * not hold a fixture to the rules that bind rendered surfaces.
 */

/** A shape-valid sentinel. It must never appear in a rendered byte. */
export const SENTINEL_KEY = "AIzaSySENTINELdoNOTleak0123456789abcdef";

export interface FixtureOptions {
  readonly withKey?: boolean;
  readonly groqConfigured?: boolean;
}

/** A mutable plain object, so a test can delete a field and watch the parser degrade. */
export function settingsBody(options: FixtureOptions = {}): Record<string, unknown> {
  const withKey = options.withKey ?? false;
  return {
    keyHeader: PROVIDER_KEY_HEADER,
    byok: {
      required: true,
      keyHeader: PROVIDER_KEY_HEADER,
      disclosure: BYOK_DISCLOSURE,
      defaultProvider: DEFAULT_PROVIDER_ID,
      deployerCeiling: null,
      localEnabled: false,
    },
    key: {
      present: withKey,
      usable: withKey,
      fingerprint: withKey ? fingerprintKey(SENTINEL_KEY) : null,
    },
    providers: PROVIDERS.map((entry) => ({
      id: entry.id,
      label: entry.label,
      help: entry.help,
      available: entry.availability === "always",
    })),
    transcription: { groq: { configured: options.groqConfigured ?? false } },
  };
}

/** The same body, through the real client guard — so a fixture can never be a shape the parser
 *  would have refused. */
export function snapshotFixture(options: FixtureOptions = {}): SettingsSnapshot {
  const parsed = parseSettingsSnapshot(settingsBody(options));
  if (parsed === null) throw new Error("the fixture no longer parses as a SettingsSnapshot");
  return parsed;
}
