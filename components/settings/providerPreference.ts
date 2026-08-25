/**
 * WHICH PROVIDER AND MODEL THIS BROWSER ASKS FOR.
 *
 * Deliberately the sibling of `effortPreference.ts` and deliberately NOT of `providerKey.ts`:
 *
 *   · `providerKey.ts` owns the SECRET. It is session-scoped, module-private, and the only exported
 *     reader is a boolean — because a stored key "silently serves whoever sits down next"
 *     (`lib/ai/keys.ts`). Nothing here may touch key material, and nothing here does.
 *   · A provider id, a model id and a self-hosted base URL are not secrets. They are preferences,
 *     exactly like the rung, so they live in `localStorage` for the same reason `effortPreference.ts`
 *     gives: losing them every tab is friction with nothing bought.
 *
 * The rung is NOT stored here — `effortPreference.ts` already owns it, and a second copy of "which
 * rung" is precisely the divergence this split exists to avoid.
 *
 * ONE SUBTLETY WORTH THE LINE: the base URL is not a secret, but it IS an input the SERVER fetches,
 * so it is validated (`checkLocalBaseUrl`) before it is stored and again server-side before it is
 * used. Storage is not a trust boundary; it is a convenience.
 */

const STORAGE_KEY = "hite.provider";

export interface ProviderPreference {
  readonly providerId: string;
  readonly modelId: string;
  /** Self-hosted / OpenAI-compatible providers only. `null` for every keyed provider. */
  readonly baseUrl: string | null;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The remembered choice, or `null`. A slot that will not parse is treated as absent AND removed:
 * leaving it means every later read pays the same failure, and a half-read preference must never be
 * completed with invented values.
 */
export function readProviderPreference(): ProviderPreference | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    const value = parsed as Record<string, unknown>;
    const providerId = typeof value.providerId === "string" ? value.providerId : "";
    if (providerId === "") throw new Error("no provider");
    return {
      providerId,
      modelId: typeof value.modelId === "string" ? value.modelId : "",
      baseUrl: typeof value.baseUrl === "string" && value.baseUrl !== "" ? value.baseUrl : null,
    };
  } catch {
    clearProviderPreference();
    return null;
  }
}

export function storeProviderPreference(preference: ProviderPreference): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* Storage is off in this browser. The choice still applies for this page — it simply will not
       survive a reload, which is a smaller failure than refusing to change it at all. Matches the
       same decision in effortPreference.storeEffortPreference. */
  }
}

export function clearProviderPreference(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* Nothing to remove and nowhere to remove it from — the post-condition already holds. */
  }
}
