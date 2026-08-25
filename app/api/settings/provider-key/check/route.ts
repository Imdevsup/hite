import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { errorMessage } from "@/lib/api/errors";
import { clientIpKey, requireByokIpRateLimit } from "@/lib/api/rate-limit";
import {
  PROVIDER_KEY_HEADER,
  readBaseUrlHeader,
  readProviderIdHeader,
  requireLoopbackBaseUrl,
} from "@/lib/ai/providers/credential";
import { DEFAULT_PROVIDER_ID } from "@/lib/ai/providers/request";
import { findProviderEntry, providerAvailable } from "@/lib/ai/providers/registry";
import type { ProviderEntry, ValidationCall } from "@/lib/ai/providers/types";
import { fingerprintKey, readProviderKey, sanitizeProviderText } from "@/lib/ai/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Does this key work?" — answered by actually asking the provider, never by guessing at the key's
 * shape.
 *
 * Every provider's check is a METADATA READ (`GET /models`, `GET /key`), probed live before this was
 * written and listed in the registry as `ValidationCall`. It proves the key is accepted without
 * generating a single token, so validating costs the user nothing. The registry owns the URL and the
 * auth header per provider — this route used to hardcode Google's, which is exactly the kind of
 * detail that silently rots when a second provider arrives.
 *
 * WHAT COMES BACK IS A BOOLEAN AND A REASON. Never the key, never a provider message. Three rules
 * make that structural rather than careful:
 *   1. the upstream RESPONSE BODY IS NEVER READ — a 4xx body can quote request metadata, and text
 *      that is never parsed cannot be forwarded;
 *   2. every string that does reach a log passes `sanitizeProviderText`;
 *   3. the key travels in a header, so it is not in the URL, the query string or the request body of
 *      anything this route touches.
 *
 * POST rather than GET so no proxy, log or browser history line can end up holding a credential in a
 * cacheable URL, and behind `withAuth` + a per-IP bucket because an endpoint that grades keys is a
 * free validity oracle for anyone holding a stolen list.
 */

const CHECK_TIMEOUT_MS = 8_000;

/** Why a key was rejected, in terms the user can act on. Deliberately coarse — no provider text. */
export type KeyCheckReason = "invalid" | "quota" | "network" | "unsupported";

const noStore = { headers: { "cache-control": "no-store" } } as const;
const failed = (reason: KeyCheckReason) => NextResponse.json({ ok: false, reason }, noStore);

/** The header this provider expects its credential on. Read from the registry, not remembered. */
function authHeaders(call: ValidationCall, key: string): Record<string, string> {
  const extra = { ...(call.extraHeaders ?? {}) };
  switch (call.auth) {
    case "bearer":
      return { ...extra, authorization: `Bearer ${key}` };
    case "x-api-key":
      return { ...extra, "x-api-key": key };
    case "x-goog-api-key":
      return { ...extra, "x-goog-api-key": key };
    case "none":
      return extra;
  }
}

/**
 * Where to send the check. Absolute for a keyed provider; for `local` the registry stores a PATH and
 * the user's base URL supplies the origin — which is re-validated to a loopback host here, because
 * this route makes the fetch and every SSRF gate has to sit next to its own fetch, not upstream of it.
 */
function validationUrl(entry: ProviderEntry, req: Request): string {
  if (entry.auth.kind !== "baseUrl") return entry.validation.url;
  const base = requireLoopbackBaseUrl(readBaseUrlHeader(req) ?? entry.auth.defaultBaseUrl);
  return `${base}${entry.validation.url}`;
}

export function POST(req: Request) {
  return withAuth(async () => {
    await requireByokIpRateLimit(clientIpKey(req), "key-check");

    const entry = findProviderEntry(readProviderIdHeader(req) ?? DEFAULT_PROVIDER_ID);
    if (!entry) return NextResponse.json({ error: "unknown provider" }, { status: 400, ...noStore });
    // A provider this deployment refuses to run must also refuse to grade keys for it, or the
    // endpoint becomes a validity oracle for a path the product will not take anyway.
    if (!providerAvailable(entry)) return failed("unsupported");

    const maxLength = entry.auth.kind === "apiKey" ? entry.auth.maxLength : undefined;
    const read = readProviderKey(req, maxLength);
    if (read.status === "absent") {
      return NextResponse.json({ error: `missing ${PROVIDER_KEY_HEADER} header` }, { status: 400, ...noStore });
    }
    // A key we cannot even send is, from the user's side, simply a key that does not work — same
    // answer as one the provider rejects, and the offending value is never echoed back.
    if (read.status === "malformed") return failed("invalid");

    const url = validationUrl(entry, req);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: authHeaders(entry.validation, read.key),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      // Timeout, DNS, TLS, dropped connection — the check is inconclusive, so say so rather than
      // telling someone their working key is invalid.
      const detail = sanitizeProviderText(errorMessage(e), { kind: "byok", key: read.key });
      console.warn(`[byok] key check could not reach ${entry.id}: ${detail}`);
      return failed("network");
    }

    // Release the socket without reading a byte of it (see rule 1 above). A cancel that fails means
    // the stream was already closed — nothing to release, and nothing that changes the verdict below.
    await res.body?.cancel().catch(() => undefined);

    if (res.status === 200) {
      return NextResponse.json({ ok: true, provider: entry.id, fingerprint: fingerprintKey(read.key) }, noStore);
    }
    if (res.status === 429) return failed("quota");
    // 400 (Google's API_KEY_INVALID), 401 and 403 (key restricted, or the API not enabled on that
    // project) all mean the same thing to the person holding it: this key cannot be used here.
    if (res.status === 400 || res.status === 401 || res.status === 403) return failed("invalid");

    // 5xx or anything unmodelled: the provider is unwell, not the key.
    console.warn(`[byok] key check got an unexpected upstream status ${res.status} from ${entry.id}`);
    return failed("network");
  });
}
