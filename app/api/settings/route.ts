import { NextResponse } from "next/server";
import {
  DEFAULT_EFFORT,
  EFFORT,
  EFFORT_LEVELS,
  deployerEffortCeiling,
  rungCeiling,
  rungCeilingReason,
} from "@/lib/ai/effort";
import {
  PROVIDER_BASE_URL_HEADER,
  PROVIDER_ID_HEADER,
  PROVIDER_KEY_HEADER,
  PROVIDER_MODEL_HEADER,
  PROVIDER_SURFACE_HEADER,
} from "@/lib/ai/providers/credential";
import {
  PROVIDERS,
  capabilitiesFor,
  localProviderEnabled,
  providerAvailable,
  unavailableReason,
} from "@/lib/ai/providers/registry";
import { verificationFor } from "@/lib/ai/providers/verification";
import { DEFAULT_PROVIDER_ID } from "@/lib/ai/providers/request";
import type { ProviderEntry } from "@/lib/ai/providers/types";
import { BYOK_DISCLOSURE, fingerprintKey, readProviderKey } from "@/lib/ai/keys";

export const runtime = "nodejs";
// The body depends on a request header, so it must never be statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * What this deployment will and will not do for the caller — the one read the settings UI needs to
 * render itself without guessing.
 *
 * NO SECRET LEAVES THIS ROUTE, IN ANY SHAPE. There is no deployer key pool to describe any more (the
 * app is BYOK-only), and the caller's own key is represented solely by `fingerprintKey` — a
 * truncated SHA-256 of the key they just sent, which is non-reversible and tells them nothing they
 * did not already have. A "last 4 characters" chip would be the opposite: a slice of the secret.
 *
 * EVERY VERIFICATION BADGE IS DERIVED, NEVER ASSERTED. `verificationFor` reads
 * `public/providers/verified.json`, which only the harness writes. A provider or model with no run
 * record is reported `untested` — including Gemini — and the client renders that label at the point
 * of selection rather than hiding it in a tooltip. That is what lets HITE offer eight providers and
 * every model a user can type without a single unearned claim.
 *
 * Unauthenticated on purpose: every field is registry data or deployer configuration that the
 * operator publishes by running the site. It does no database work and makes no upstream call.
 */

function modelsFor(entry: ProviderEntry) {
  return entry.models.map((m) => ({
    id: m.id,
    label: m.label,
    surface: m.surface,
    note: m.note ?? null,
    verification: verificationFor(entry.id, m.id, m.surface),
  }));
}

function providerView(entry: ProviderEntry) {
  const available = providerAvailable(entry);
  // The provider's OWN ceiling, not `min(provider, deployer)`: the client is given both and reports
  // which one binds, because "your provider cannot do this" and "the operator turned this off" are
  // different facts and only one of them is worth asking someone about.
  const capabilities = capabilitiesFor(entry, undefined);
  return {
    id: entry.id,
    label: entry.label,
    auth: entry.auth,
    capabilities,
    models: modelsFor(entry),
    catalogue: entry.catalogue ?? null,
    help: entry.help,
    npm: entry.npm,
    available,
    unavailableReason: unavailableReason(entry),
    rungCeiling: rungCeiling(capabilities),
    rungCeilingReason: rungCeilingReason(capabilities),
  };
}

export function GET(req: Request) {
  const read = readProviderKey(req);
  const usable = read.status === "ok";

  return NextResponse.json(
    {
      /** The ONE channel the secret travels in. Read from the server so the client cannot drift. */
      keyHeader: PROVIDER_KEY_HEADER,
      /** The non-secret selection fields, for a client that cannot put them in the request body. */
      selectionHeaders: {
        provider: PROVIDER_ID_HEADER,
        model: PROVIDER_MODEL_HEADER,
        surface: PROVIDER_SURFACE_HEADER,
        baseUrl: PROVIDER_BASE_URL_HEADER,
      },
      byok: {
        /** Always. There is no deployer key pool: with no key the AI simply cannot run. */
        required: true,
        keyHeader: PROVIDER_KEY_HEADER,
        disclosure: BYOK_DISCLOSURE,
        defaultProvider: DEFAULT_PROVIDER_ID,
        /**
         * The two deployer facts a CLIENT cannot derive for itself.
         *
         * The settings UI reads the registry directly (it is client-safe by construction), so almost
         * nothing has to cross the wire. These two do: both are `process.env` reads, which on the
         * client resolve to "unset" and would quietly offer a rung or a provider this server will
         * refuse.
         */
        deployerCeiling: deployerEffortCeiling(),
        localEnabled: localProviderEnabled(),
      },
      key: {
        present: read.status !== "absent",
        usable,
        fingerprint: usable ? fingerprintKey(read.key) : null,
      },
      providers: PROVIDERS.map(providerView),
      effort: {
        levels: EFFORT_LEVELS,
        default: DEFAULT_EFFORT,
        /** The deployer's brake, distinct from any provider's own ceiling. `null` ⇒ no brake. */
        deployerCeiling: deployerEffortCeiling(),
        /** The real mechanics per rung, so the picker describes what a level DOES rather than guessing. */
        rungs: Object.fromEntries(
          EFFORT_LEVELS.map((level) => [
            level,
            {
              revisions: EFFORT[level].revisions,
              groundSteps: EFFORT[level].groundSteps,
              wallClockMs: EFFORT[level].wallClockMs,
              thinking: EFFORT[level].thinking,
            },
          ]),
        ),
      },
      /**
       * Speech-to-text (Groq Whisper), DEPLOYER-side only. It is not part of BYOK and must not be
       * conflated with "Groq as your LLM provider (your key)" — they are two different credentials
       * with two different payers, and the UI has to keep them apart.
       */
      transcription: { groq: { configured: Boolean(process.env.GROQ_API_KEY?.trim()) } },
    },
    {
      headers: {
        // Varies by a secret header — a shared cache must never hold this, and must never key one
        // caller's answer to another's request.
        "cache-control": "no-store",
        vary: PROVIDER_KEY_HEADER,
      },
    },
  );
}
