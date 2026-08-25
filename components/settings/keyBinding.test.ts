import { beforeEach, describe, expect, test } from "vitest";
import { clearProviderKey, providerKeyHeaders, providerKeyMismatch, readKeyProvider, storeProviderKey } from "./providerKey";

/**
 * THE REGRESSION: a key could be sent to a provider it was not entered for.
 *
 * The key lives in sessionStorage (per tab, dies with the tab — deliberate, so a shared machine does
 * not serve the next person's key). The provider CHOICE lives in localStorage (shared by every tab,
 * persists — also deliberate, it is a preference not a credential). Both decisions are right on their
 * own and together they desync: open two tabs, switch provider in the second, and the first still
 * holds the old key while reading the new provider id. It then sent
 *   x-hite-provider-key: <Google key>   with   x-hite-provider-id: anthropic
 * and the server forwarded that key to Anthropic, which rejected it — after receiving it.
 *
 * The key is bound to its provider now, and a mismatch withholds it. Sending nothing costs a 402
 * that points at settings; sending anyway costs the user their key, to a vendor they never chose.
 */
/**
 * The suite runs in vitest's `node` environment, where there is no `window`, so `storage()` returns
 * null and every write is a silent no-op. A minimal in-memory Storage stands in — this is testing
 * the binding rule, not the browser's implementation of sessionStorage.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe("provider key binding", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { sessionStorage: memoryStorage() };
    clearProviderKey();
  });

  test("a key is sent to the provider it was entered for", () => {
    storeProviderKey("k-google-123", "google");
    expect(readKeyProvider()).toBe("google");
    expect(providerKeyHeaders("google")["x-hite-provider-key"]).toBe("k-google-123");
  });

  test("it is WITHHELD from a different provider", () => {
    storeProviderKey("k-google-123", "google");
    expect(providerKeyHeaders("anthropic")).toEqual({});
    expect(providerKeyMismatch("anthropic")).toBe(true);
  });

  test("clearing the key unbinds it, so a later key is not judged against a stale provider", () => {
    storeProviderKey("k-google-123", "google");
    clearProviderKey();
    expect(readKeyProvider()).toBeNull();
    storeProviderKey("k-anthropic-456", "anthropic");
    expect(providerKeyHeaders("anthropic")["x-hite-provider-key"]).toBe("k-anthropic-456");
  });

  test("a key stored without a provider is unbound and still sent — no lockout on upgrade", () => {
    storeProviderKey("k-legacy");
    expect(readKeyProvider()).toBeNull();
    expect(providerKeyHeaders("anything")["x-hite-provider-key"]).toBe("k-legacy");
    expect(providerKeyMismatch("anything")).toBe(false);
  });

  test("no provider asked for means no judgement — callers that do not know still work", () => {
    storeProviderKey("k-google-123", "google");
    expect(providerKeyHeaders()["x-hite-provider-key"]).toBe("k-google-123");
  });
});
