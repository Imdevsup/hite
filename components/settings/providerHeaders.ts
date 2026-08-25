import type { ModelSurface } from "@/lib/ai/providers/types";

/**
 * THE NON-SECRET HALF OF A PROVIDER REQUEST — which provider, which model, which surface, which
 * address.
 *
 * `providerKey.ts` owns the SECRET header and is the only module that may read key material. This
 * one owns the four headers that carry the SELECTION, and it deliberately holds nothing else: the
 * server-side split is the same (`ModelSelection` and `KeySource` are separate values in
 * `lib/ai/providers/types.ts` "so a selection can be logged and this one cannot"), and keeping the
 * two apart on the client is what makes it safe for anything to log a selection.
 *
 * WHY THESE STRINGS ARE COPIED RATHER THAN IMPORTED. `lib/ai/providers/credential.ts` is their real
 * owner, and it imports `lib/api/errors` → `next/server`; pulling that into a client bundle for four
 * constants is the same trade `providerKey.ts` already refused for `PROVIDER_KEY_HEADER`. So the
 * copies live here and `providerHeaders.test.ts` imports the real constants and fails the build if
 * any of them ever drift — a mirrored string with a drift gate, not a remembered one.
 *
 * WHY HEADERS AND NOT A BODY. `POST /api/settings/provider-key/check` reads all of these off the
 * request headers (`readProviderIdHeader`, `readBaseUrlHeader`). A selection sent in the body is
 * silently ignored there, which does not fail — it quietly grades an OpenAI key against Google and
 * reports "invalid". That is the specific bug this module exists to make unrepeatable.
 */

export const PROVIDER_ID_HEADER = "x-hite-provider";
export const PROVIDER_MODEL_HEADER = "x-hite-model";
export const PROVIDER_SURFACE_HEADER = "x-hite-model-surface";
export const PROVIDER_BASE_URL_HEADER = "x-hite-base-url";

export interface ProviderSelectionHeaders {
  readonly providerId: string;
  readonly modelId?: string;
  readonly surface?: ModelSurface | null;
  /** Self-hosted providers only. The server re-validates it to a loopback host before any fetch. */
  readonly baseUrl?: string | null;
}

/**
 * The headers for a selection, ready to spread next to `providerKeyHeaders()`. Empty fields are
 * omitted rather than sent blank, because an empty header is a value the server has to interpret and
 * `assertModelId("")` is a 400 — "not chosen yet" and "chosen as nothing" are different facts.
 */
export function providerSelectionHeaders(selection: ProviderSelectionHeaders): Record<string, string> {
  const headers: Record<string, string> = { [PROVIDER_ID_HEADER]: selection.providerId };
  if (selection.modelId && selection.modelId.trim() !== "") headers[PROVIDER_MODEL_HEADER] = selection.modelId.trim();
  if (selection.surface) headers[PROVIDER_SURFACE_HEADER] = selection.surface;
  if (selection.baseUrl) headers[PROVIDER_BASE_URL_HEADER] = selection.baseUrl;
  return headers;
}
