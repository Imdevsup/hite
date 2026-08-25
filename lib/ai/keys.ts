import { createHash } from "node:crypto";
import { BadRequestError } from "@/lib/api/errors";
import { DEFAULT_KEY_MAX_LENGTH } from "@/lib/ai/providers/registry";
import { redactProviderKey, resolveProviderKey, type KeySource } from "@/lib/ai/providers/credential";

/**
 * Bring-your-own-key POLICY — what a deployment says and shows about a user's key, as opposed to how
 * it uses one.
 *
 * OWNERSHIP, because these files are easy to confuse. `lib/ai/providers/credential.ts` owns the
 * PROVIDER MECHANICS: the `KeySource` union, the header constants, the shape bounds, redaction and
 * the SSRF gate. `lib/ai/providers/request.ts` owns RESOLUTION: turning one request into a provider,
 * a model, a credential and a rung. THIS file owns what a UI has to render — the honest disclosure
 * and the non-reversible fingerprint that lets the UI show key state without echoing key material —
 * plus the second redaction net for text whose key we were never handed. Nothing is re-implemented
 * here.
 *
 * WHY THE KEY IS NEVER STORED SERVER-SIDE. It lives in the user's browser (`sessionStorage` by
 * default) and is sent per request. The obvious alternative — a `provider_key` table — loses on every
 * axis that matters:
 *   · AT REST — every user's provider billing credential would sit in the deployer's Postgres
 *     forever. One leaked backup or one `service_role` slip (this repo uses `createAdmin()` widely)
 *     turns the blast radius from "user data" into "user's cloud account". Client-held has nothing at
 *     rest to leak.
 *   · SHARED MACHINE — a stored key silently serves whoever sits down next. `sessionStorage` dies
 *     with the tab.
 *   · CSRF — a stored key is spendable by a cross-origin forgery, which needs only the victim's
 *     cookie. An explicit header cannot be attached by a cross-origin form post.
 *   · SELF-HOSTER FOOTGUN — encrypting a stored key needs a KMS the self-hoster must configure, and
 *     the ones who do not will store plaintext.
 *
 * What client-holding does NOT buy, and what the UI must say out loud (`BYOK_DISCLOSURE`): the
 * deployer's server still sees the key in transit, because something has to call the provider. That
 * is unavoidable in any BYOK design and belongs in front of the user, not in a footnote.
 *
 * NEVER-LOG CONTRACT, enforced by keys.test.ts and the route suites: a key is never written to
 * `console.*`, never returned in a response body, never put in a URL or query string, never
 * persisted, and never included in an error message.
 */

/** Result of looking for a user's key. Never throws — the settings UI must be able to render
 *  "you pasted something unusable" without the request failing. */
export type ProviderKeyRead =
  | { status: "absent" }
  | { status: "malformed" }
  | { status: "ok"; key: string };

/**
 * Non-throwing view of the header parsing, for read-only surfaces.
 *
 * Note what is NOT a key source: a `?key=` query parameter. Only the header is ever read, so a link
 * that leaks into an access log, a `Referer` or browser history never carries a credential.
 *
 * `maxLength` is per provider (`ProviderAuth.maxLength`); the default is the generous registry-wide
 * bound, because a read-only surface often does not know which provider the caller means yet.
 */
export function readProviderKey(req: Request, maxLength: number = DEFAULT_KEY_MAX_LENGTH): ProviderKeyRead {
  try {
    const source = resolveProviderKey(req, { kind: "apiKey", maxLength, keyHint: null });
    return source.kind === "byok" ? { status: "ok", key: source.key } : { status: "absent" };
  } catch (e) {
    // Only the shape rejection is an expected outcome here; anything else is a real fault.
    if (e instanceof BadRequestError) return { status: "malformed" };
    throw e;
  }
}

/**
 * Non-reversible 32-bit display hint. Lets the UI say "key a1b2c3d4 is active" and lets a user tell
 * two keys apart WITHOUT the server ever echoing key material — which is exactly what a "last 4
 * characters" chip would do. Short by design: this is a label, not an identifier.
 */
export function fingerprintKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/**
 * Best-effort net for text whose key we were never given. Only the classic `AIza…` format is
 * matchable: current keys are not all `AIza`-prefixed (verified against a live one), and there is no
 * safe pattern for a prefix-less 50-character token that would not also redact ordinary ids. This is
 * the SECOND net on purpose — the exact-value pass below is the one that is actually reliable, and
 * it is provider-agnostic, which is what matters now that there are eight of them.
 */
const KEY_LIKE = /AIza[A-Za-z0-9_-]{10,}/g;

/**
 * Full sanitisation for text about to reach a user, a log or an error report.
 *
 * Two nets, because each catches what the other misses. `redactProviderKey` removes the exact key
 * when we hold it — reliable, and the only pass that can catch a key of an unknown shape, which is
 * every provider except Google. The pattern pass then covers text quoting a credential this server
 * was never handed: an upstream error echoing the caller's request, or a stack trace from a nested
 * call.
 */
export function sanitizeProviderText(text: string, source?: KeySource): string {
  const exact = source ? redactProviderKey(text, source) : text;
  return exact.replace(KEY_LIKE, "[redacted]");
}

/**
 * Shown before the field that accepts a key. The second sentence is the one that must not be
 * softened: in any BYOK design the deployer's server sees the key, and a user cannot consent to a
 * risk nobody told them about.
 *
 * Provider-neutral wording on purpose — naming Google here would be wrong for seven of the eight
 * providers, and the settings UI renders this string verbatim rather than authoring its own.
 */
export const BYOK_DISCLOSURE =
  "Your key is stored in this browser only and sent to this server on each request so it can call " +
  "your chosen provider on your behalf. Whoever runs this site can see it in transit. Only add a key " +
  "if you trust them, and use a separate, budget-capped key rather than your main one.";
