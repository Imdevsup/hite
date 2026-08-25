/**
 * The one custom `fetch` every provider gets.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ANY MORE
 *
 * It used to be a key-ROTATING fetch: HITE held a pool of the deployer's free Gemini keys
 * (`GEMINI_API_KEYS`) and rotated through them on 401/403/429 so the per-key free-tier limits
 * stacked. With BYOK as the only path that pool does not exist, so rotation is gone rather than
 * carried forward unused:
 *
 *   · there is nothing to rotate TO — one request carries one user's one key;
 *   · a 429 is now the USER'S OWN quota and has to surface to them as such. Retrying it into a
 *     "all N keys failed" error would hide the only fact that lets them fix it;
 *   · the old code threw "set GEMINI_API_KEYS" when the pool was empty, which on a BYOK-only
 *     deployment would fire at a paying visitor — exactly backwards.
 *
 * WHAT SURVIVES VERBATIM, because it is the part that was load-bearing: the split between a
 * KEY-specific failure and a PROVIDER-WIDE one. 5xx and dropped connections used to sit in the
 * rotate set, so a provider incident replayed the identical request across every key with no delay —
 * N× traffic aimed at an already-struggling upstream and N× latency against a wall-clock budget, per
 * serverless instance, on every planner step. A provider-side failure now gets ONE jittered retry
 * and is then handed back to the caller as the real response, so the turn fails fast with the
 * provider's own status instead of a wrapped error after a fan-out. `fetch.test.ts` counts requests,
 * because the request count IS the bug.
 *
 * NO CREDENTIAL PASSES THROUGH HERE. Every provider factory takes `apiKey` and puts it on the
 * header itself (`x-goog-api-key`, `Authorization: Bearer`, `x-api-key` — all verified from the
 * shipped `dist/index.d.ts`), so this wrapper never attaches or rewrites one. That deletes the old
 * `?key=` URL-rewriting branch and, with it, a whole class of "the credential ended up in a URL".
 */

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** "The PROVIDER is unhappy" — a different key would fail identically, so retry rather than fan out. */
const SERVER_ERROR_ON = new Set([500, 502, 503, 504]);

/** One retry for a provider-wide failure (5xx or a dropped connection), then surface it. */
export const MAX_SOFT_RETRIES = 1;

const softRetryDelayMs = (): number => 200 + Math.floor(Math.random() * 300);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Release an unread body so the connection can be reused before we retry. */
async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* the body may already be closed — nothing to release */
  }
}

/**
 * The provider fetch. Shared by all eight providers, because the policy is about HTTP, not vendors.
 *
 * Exported (and used) as a value rather than inlined so the amplification policy has exactly one
 * owner and one test; it is only observable by counting calls.
 */
export const providerFetch: FetchFn = async (input, init) => {
  let softFailures = 0;
  for (;;) {
    try {
      const res = await fetch(input, init);
      // 401/403/429 go straight back: they are the user's key, quota and billing to fix.
      if (!SERVER_ERROR_ON.has(res.status) || softFailures >= MAX_SOFT_RETRIES) return res;
      await drain(res);
      softFailures += 1;
      await sleep(softRetryDelayMs());
    } catch (e) {
      // Transient network failure (ECONNRESET / "fetch failed") → one retry, then give up.
      if (softFailures >= MAX_SOFT_RETRIES) throw e;
      softFailures += 1;
      await sleep(softRetryDelayMs());
    }
  }
};
