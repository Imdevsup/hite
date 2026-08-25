import type {
  KeyCheckFailure,
  KeyCheckOutcome,
  KeyCheckReason,
  KeyStoreResult,
  SettingsSnapshot,
  SnapshotProvider,
} from "./types";
import { providerSelectionHeaders } from "./providerHeaders";

/**
 * THE CLIENT SIDE OF BRING-YOUR-OWN-KEY — one owner for where the visitor's key lives in the
 * browser and how it is attached to a request.
 *
 * `lib/ai/keys.ts` states the contract this file has to honour: "It lives in the visitor's browser
 * (`sessionStorage` by default) and is sent per request", because a stored key "silently serves
 * whoever sits down next" and `sessionStorage` dies with the tab. That is the whole reason the key
 * is not in a database, so putting it in `localStorage` here would quietly undo the security
 * argument the server side is built on.
 *
 * THE NEVER-DISPLAY CONTRACT, MADE STRUCTURAL RATHER THAN CAREFUL:
 *   · `readProviderKey` is module-private. Nothing outside this file can obtain key material.
 *   · The only exported reader is `hasProviderKey()` — a boolean. The key therefore never enters
 *     React state, never enters a render tree, and cannot appear in a component snapshot.
 *   · `providerKeyHeaders()` is the single place the value is read, and it is read straight into a
 *     request header. Header only — never a query string, never a body (`gemini.ts` explains why:
 *     a URL lands in access logs, `Referer`, browser history and CDN logs).
 *   · There is not one `console.*` call in this module. `honesty.test.ts` fails if one appears.
 *
 * The editor imports `providerKeyHeaders()` to attach the key to its own planner requests, so the
 * header name and the storage location have exactly one owner on the client too.
 */

/**
 * `PROVIDER_KEY_HEADER` from `lib/ai/gemini.ts`, copied because that module is server-only (it
 * constructs a provider and reads `process.env` at load). `honesty.test.ts` imports the real
 * constant and fails the build if this string ever drifts from it — the same drift gate §20 asks
 * for on the disclosure and the rung names.
 */
export const PROVIDER_KEY_HEADER = "x-hite-provider-key";

/** Session-scoped, per the reasoning in `lib/ai/keys.ts`. Dies with the tab, on purpose. */
const STORAGE_KEY = "hite.provider-key";
/**
 * THE PROVIDER THE HELD KEY BELONGS TO.
 *
 * The key lives in `sessionStorage` (per tab, dies with the tab) and the provider CHOICE lives in
 * `localStorage` (shared by every tab, persists) — both deliberate, and together they desync. Open
 * two tabs, switch provider in the second, and the first still holds the old key while reading the
 * new provider id: it then sends `x-hite-provider-key: <Google key>` with
 * `x-hite-provider-id: anthropic`, and the server forwards that key to Anthropic. A secret reaching
 * the wrong vendor in ordinary multi-tab use.
 *
 * Binding the key to the provider it was entered for makes the mismatch detectable, and
 * `providerKeyHeaders` then declines to send rather than sending it somewhere it does not belong.
 */
const KEY_PROVIDER = "hite.provider-key-for";

const SETTINGS_URL = "/api/settings";
const KEY_CHECK_URL = "/api/settings/provider-key/check";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * `sessionStorage` throws rather than returning null when a browser has storage switched off
 * (Safari's "block all cookies", some enterprise policies, some private modes). Every access is
 * therefore guarded, and a failure is REPORTED to the caller instead of being swallowed — the sheet
 * has a designed state for "this browser will not keep the key".
 */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * THE ONE READER OF KEY MATERIAL, and it has exactly one permitted consumer outside this file:
 * `credential.ts`, which composes the key with the non-secret preferences for the editor's planner
 * call. `honesty.test.ts` fails if any other file in this unit names it.
 *
 * Everything else takes `hasProviderKey()` (a boolean) or `providerKeyHeaders()` (a header object
 * handed straight to `fetch`), so the secret still cannot reach React state or a rendered tree.
 */
export function readHeldProviderKey(): string | null {
  return readProviderKey();
}

/** Module-private on purpose — see the never-display contract above. */
function readProviderKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = storage()?.getItem(STORAGE_KEY) ?? null;
    return value !== null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Is a key held in this tab? A boolean is the most the UI is ever allowed to know. */
export function hasProviderKey(): boolean {
  return readProviderKey() !== null;
}

/** Will this browser keep a key at all? False under a storage policy that blocks it, so the sheet
 *  can say so rather than implying a save that did not happen. */
export function providerKeyStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return storage() !== null;
}

/** `useSyncExternalStore` subscriber, so every mounted control agrees about the key's presence. */
export function subscribeProviderKey(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

/** Server render: no tab, therefore no key. Stable so `useSyncExternalStore` does not loop. */
export function getServerProviderKeySnapshot(): boolean {
  return false;
}

/**
 * Keep a key for this tab.
 *
 * The value is NOT validated here. `lib/ai/gemini.ts` explains why a shape regex is the wrong
 * instrument — "verified against a live working key on 2026-08-20, current Gemini keys are not all
 * `AIza…`, are not all 39 characters, and DO contain `.`" — and names the authority: "The authority
 * on whether a key is real is Google — POST /api/settings/provider-key/check asks it." A client-side
 * format guess would reject real keys and tell the user their key is invalid when our validator is
 * simply stale. Only surrounding whitespace is trimmed, because a pasted key routinely carries it
 * and a leading space is the difference between `usable` and `malformed` server-side.
 */
export function storeProviderKey(rawKey: string, forProviderId?: string): KeyStoreResult {
  const key = rawKey.trim();
  const store = storage();
  if (store === null) return { ok: false, failure: "unavailable" };
  try {
    store.setItem(STORAGE_KEY, key);
    // Stored together so the pair can never be half-written: a key with no provider is treated as
    // unbound (and still sent), but a provider with no key is meaningless.
    if (forProviderId) store.setItem(KEY_PROVIDER, forProviderId);
    else store.removeItem(KEY_PROVIDER);
  } catch {
    return { ok: false, failure: "unavailable" };
  }
  emit();
  return { ok: true };
}

/** Forget the key. The shared-machine case in `lib/ai/keys.ts` is why this control exists. */
export function clearProviderKey(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
    storage()?.removeItem(KEY_PROVIDER);
  } catch {
    /* Nothing to remove and nowhere to remove it from — the post-condition already holds. */
  }
  emit();
}

/**
 * The one place key material is read, and it is read directly into a request header.
 * Returns an empty object when no key is held, so a caller can always spread it.
 */
export function providerKeyHeaders(forProviderId?: string): Record<string, string> {
  const key = readProviderKey();
  if (key === null) return {};
  // FAIL CLOSED on a mismatch. Sending nothing costs the user a 402 that points them at settings;
  // sending anyway costs them their key, to a vendor they never chose.
  const boundTo = readKeyProvider();
  if (forProviderId !== undefined && boundTo !== null && boundTo !== forProviderId) return {};
  return { [PROVIDER_KEY_HEADER]: key };
}

/** Which provider the held key was entered for, or null for a key stored before this was tracked. */
export function readKeyProvider(): string | null {
  try {
    const value = storage()?.getItem(KEY_PROVIDER) ?? null;
    return value !== null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** True when a key is held but belongs to a different provider than the one now selected. */
export function providerKeyMismatch(forProviderId: string | undefined): boolean {
  if (forProviderId === undefined || !hasProviderKey()) return false;
  const boundTo = readKeyProvider();
  return boundTo !== null && boundTo !== forProviderId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Validate `GET /api/settings` rather than assert it.
 *
 * A hand-written guard instead of a zod schema: this is the only unvalidated boundary the settings
 * surface has, and pulling zod into the editor's client bundle to check one response is a cost with
 * no second consumer. A `null` return is a designed state in the sheet ("this deployment answered
 * something this build does not understand"), not a crash and not a set of invented defaults.
 *
 * IT IS DERIVED FROM THE BODY THE ROUTE RETURNS TODAY, and that is a correction rather than a
 * refresh. This guard read a Gemini-only, pool-plus-BYOK shape — `providers.gemini.key`,
 * `byok.help`, `effort.active.{source,default,ceiling}` — long after the route stopped returning
 * one. Every field it required was absent, so it returned `null` on every real response, and both
 * of its consumers rendered their "this build does not understand" state: the settings sheet showed
 * no key field and the editor's 402 flow could not ask for a key either. A settings surface that
 * cannot accept a credential makes an app whose only credential path is BYOK unusable end to end,
 * which is why the shape is now read from the route and pinned by `contract.test.ts` asserting the
 * REAL handler rather than a fixture.
 *
 * THE REQUIRED HALF is the disclosure, the key block and at least one provider. Without the key
 * layer's own words there is no honest way to ask for a credential; without a provider there is
 * nothing to ask for one FOR. Everything else degrades to `null` and simply does not render.
 */
export function parseSettingsSnapshot(value: unknown): SettingsSnapshot | null {
  if (!isRecord(value)) return null;

  const raw = isRecord(value.byok) ? value.byok : null;
  const key = isRecord(value.key) ? value.key : null;
  // Carried together so the narrowing survives: proving the disclosure is a string also proves the
  // block it came from is a record, and TypeScript cannot infer the second from the first.
  const stated =
    raw !== null && typeof raw.disclosure === "string" && raw.disclosure.trim() !== ""
      ? { disclosure: raw.disclosure, byok: raw }
      : null;
  if (key === null || stated === null) return null;
  const { byok, disclosure } = stated;

  const rawProviders = Array.isArray(value.providers) ? value.providers : null;
  if (rawProviders === null) return null;
  const providers: SnapshotProvider[] = [];
  for (const entry of rawProviders) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    if (id === null || id === "") continue;
    const help = isRecord(entry.help) ? entry.help : null;
    providers.push({
      id,
      // A provider the route named but did not label is still a provider; its id is the honest
      // fallback, and it is what the picker's own `modelOptionFor` does for an unlisted model.
      label: str(entry.label) ?? id,
      getKey: help === null ? null : str(help.getKey),
    });
  }
  if (providers.length === 0) return null;

  const transcription = isRecord(value.transcription) ? value.transcription : null;
  const groq = transcription && isRecord(transcription.groq) ? transcription.groq : null;

  return {
    keyHeader: str(value.keyHeader) ?? str(byok.keyHeader),
    key: {
      present: key.present === true,
      usable: key.usable === true,
      fingerprint: str(key.fingerprint),
    },
    byok: {
      disclosure,
      // A default the route did not name would leave the 402 field unable to say WHOSE key it wants,
      // so it falls back to the first provider the route published rather than to a hardcoded id.
      defaultProviderId: str(byok.defaultProvider) ?? providers[0].id,
    },
    providers,
    transcription: { groqConfigured: groq?.configured === true },
  };
}

/**
 * Read this deployment's policy, with the visitor's key attached so the answer describes THEIR
 * request rather than an anonymous one — that is what makes `key.present` / `key.usable` /
 * `fingerprint` and `effort.active` correct instead of generic. The route sets
 * `vary: x-hite-provider-key` for exactly this reason.
 */
export async function fetchSettings(signal?: AbortSignal): Promise<SettingsSnapshot | null> {
  const res = await fetch(SETTINGS_URL, {
    headers: providerKeyHeaders(),
    cache: "no-store",
    signal,
  });
  if (!res.ok) return null;
  return parseSettingsSnapshot(await res.json());
}

const CHECK_STATUS_FAILURE: Readonly<Record<number, KeyCheckFailure>> = {
  400: "missing",
  401: "unauthorized",
  429: "rate-limited",
};

const CHECK_REASONS: readonly KeyCheckReason[] = ["invalid", "quota", "network", "unsupported"];

function asReason(value: unknown): KeyCheckReason | null {
  return typeof value === "string" && (CHECK_REASONS as readonly string[]).includes(value)
    ? (value as KeyCheckReason)
    : null;
}

/**
 * "Does this key work?" — asked of the provider it belongs to, through the route that never reads
 * the upstream response body. What comes back is a boolean and a coarse reason, by design, so this
 * function cannot surface provider text and neither can the sheet.
 *
 * A POST with no body: the key rides in the header (`providerKeyHeaders`), which is what keeps it
 * out of any cacheable URL, and `providerId` rides in `x-hite-provider` beside it.
 *
 * WHY THE PROVIDER IS AN ARGUMENT. The check route used to hardcode Google; it is registry-driven
 * now and reads WHICH provider to ask from the selection headers. Sending only the key is not an
 * error — which is the danger — it makes the route fall back to `DEFAULT_PROVIDER_ID` and grade, say,
 * an OpenAI key against Google, then report a real key as "invalid". Callers that know the selection
 * pass it; the parameter is optional only so a caller with no selection yet still gets the
 * deployment's own default rather than a thrown error.
 */
export async function checkProviderKey(providerId?: string, signal?: AbortSignal): Promise<KeyCheckOutcome> {
  const key = providerKeyHeaders();
  if (Object.keys(key).length === 0) return { ok: false, failure: "missing" };
  const headers = providerId ? { ...key, ...providerSelectionHeaders({ providerId }) } : key;

  let res: Response;
  try {
    res = await fetch(KEY_CHECK_URL, { method: "POST", headers, cache: "no-store", signal });
  } catch (e) {
    // An aborted check is the caller closing the sheet, not a verdict about the key.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { ok: false, failure: "network" };
  }

  if (!res.ok) return { ok: false, failure: CHECK_STATUS_FAILURE[res.status] ?? "server" };

  const body: unknown = await res.json();
  if (!isRecord(body)) return { ok: false, failure: "server" };
  const fingerprint = str(body.fingerprint);
  if (body.ok === true && fingerprint !== null) return { ok: true, fingerprint };
  const reason = asReason(body.reason);
  return { ok: false, failure: reason ?? "server" };
}
