import { BadRequestError } from "@/lib/api/errors";
import { DEFAULT_KEY_MAX_LENGTH } from "./registry";
import type { ModelSurface, ProviderAuth } from "./types";

/**
 * The credential layer: how a user's key reaches this process, what it is allowed to look like, and
 * how it is stripped out of anything that could reach a log, an error report or a chat bubble.
 *
 * ONE SECRET CHANNEL. The key travels in a HEADER, never a query parameter and never the JSON body.
 * A URL lands in access logs, `Referer`, browser history and CDN logs; a body is the thing most
 * likely to be logged wholesale by a debug middleware or an error reporter (HITE ships
 * `/api/errors`). A header is also NOT auto-attached cross-origin, so a visitor's key cannot be
 * spent by a CSRF the way a cookie-backed one could. This reasoning was written for Gemini and
 * applies verbatim to seven more providers.
 *
 * The provider id, model id, surface and local base URL are NOT secrets. They ride their own
 * headers (or the JSON body, which wins when a route parses one) so that a route which has not yet
 * been taught to parse them still gets a correct selection instead of a silent default.
 */

/** The ONLY channel the secret travels in. */
export const PROVIDER_KEY_HEADER = "x-hite-provider-key";
/** Non-secret selection headers. Body values, where a route parses them, take precedence. */
export const PROVIDER_ID_HEADER = "x-hite-provider";
export const PROVIDER_MODEL_HEADER = "x-hite-model";
export const PROVIDER_SURFACE_HEADER = "x-hite-model-surface";
export const PROVIDER_BASE_URL_HEADER = "x-hite-base-url";

/**
 * How this run pays for itself.
 *
 * There is no `pool` variant any more, and its absence is the design: with BYOK as the only path the
 * app must never fall back to a deployer-supplied credential. `none` is not a fallback — it is the
 * one provider class that takes no credential at all (a self-hosted OpenAI-compatible endpoint),
 * and it is only ever produced for an entry whose `auth.kind === "baseUrl"`.
 */
export type KeySource = { readonly kind: "byok"; readonly key: string } | { readonly kind: "none" };

/**
 * Bounds, NOT a format check — deliberately.
 *
 * The tempting version of this is `/^AIza[A-Za-z0-9_-]{35}$/`, and it is wrong: verified against a
 * live working key on 2026-08-20, current Gemini keys are not all `AIza…`, are not all 39 characters,
 * and DO contain `.` (that key is 53 chars with a dot and no `AIza` prefix, and answers 200 from
 * `GET /v1beta/models`). A regex that encodes a remembered key format silently 400s real users the
 * day a vendor issues a new one, and the failure looks like "your key is invalid" rather than "our
 * validator is stale". Eight providers multiply that risk by eight.
 *
 * So this only rejects what would actually hurt: whitespace and control characters (which forge log
 * records and break the upstream request) and unbounded length (which becomes an unbounded log
 * line). The upper bound is PER PROVIDER and generous — the previous hard cap of 128 characters
 * would have rejected a modern `sk-proj-…` OpenAI key as invalid before it ever reached OpenAI,
 * which is the same stale-validator failure one provider over.
 *
 * The authority on whether a key is real is the provider — `POST /api/settings/provider-key/check`
 * asks it, with a metadata call that spends nothing.
 */
const KEY_MIN_LENGTH = 16;
const KEY_CHARSET = /^[A-Za-z0-9._~+/=-]+$/;

export function isWellFormedKey(key: string, maxLength: number = DEFAULT_KEY_MAX_LENGTH): boolean {
  return key.length >= KEY_MIN_LENGTH && key.length <= maxLength && KEY_CHARSET.test(key);
}

/**
 * Read the user's key off the request. A malformed header is a 400 rather than a silent downgrade:
 * quietly running with no credential because the key had a stray quote in it is exactly the surprise
 * BYOK exists to prevent. Never echoes the value — the message names the header only.
 */
export function resolveProviderKey(req: Request, auth: ProviderAuth): KeySource {
  const raw = req.headers.get(PROVIDER_KEY_HEADER);
  const key = raw?.trim() ?? "";
  if (key.length === 0) return { kind: "none" };
  const maxLength = auth.kind === "apiKey" ? auth.maxLength : DEFAULT_KEY_MAX_LENGTH;
  if (!isWellFormedKey(key, maxLength)) {
    throw new BadRequestError(`${PROVIDER_KEY_HEADER}: not a valid API key`);
  }
  return { kind: "byok", key };
}

/**
 * Strip a user's key out of anything user-visible. The key reaches this process on every request,
 * and a provider's own 4xx bodies can echo request metadata back at us, so every path that can
 * surface provider text to a chat bubble or an error report goes through here first.
 *
 * BOTH ENCODINGS. `KEY_CHARSET` admits `+`, `/` and `=` — the three characters `encodeURIComponent`
 * escapes — so a key of that shape can appear inside a URL as `…%2B…%2F…%3D…`, which a raw-value-only
 * pass walks straight past: verified with a probe, the encoded form survived redaction untouched.
 * Any string carrying such a URL (an SDK error naming the endpoint it called, a stack line, a proxy
 * message) would have carried the credential with it. HITE no longer writes a key into a URL itself,
 * but the providers and their intermediaries still can, and this is the last net before a user sees
 * the text.
 */
export function redactProviderKey(text: string, source: KeySource): string {
  if (source.kind !== "byok") return text;
  const scrubbed = text.split(source.key).join("[redacted]");
  const encoded = encodeURIComponent(source.key);
  // Only a second pass when the encoding actually differs — a key of `[A-Za-z0-9._~-]` is its own
  // encoding, and scanning for it again would be pure overhead.
  if (encoded === source.key) return scrubbed;
  // CASE-INSENSITIVE, because %-escapes are. RFC 3986 says producers SHOULD uppercase them and
  // `encodeURIComponent` does, but a proxy, a log shipper or another SDK may re-encode as `%2b`, and
  // a case-sensitive split walks straight past it — verified with a probe on a `+`/`/`/`=` key.
  // Escaped for the regex: every `%`-escape is `%XX`, and the un-escaped remainder of the key is
  // still arbitrary user input.
  return scrubbed.replace(new RegExp(escapeRegExp(encoded), "gi"), "[redacted]");
}

/** Every character the RegExp grammar gives meaning to, so a key is matched literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ── non-secret selection fields ────────────────────────────────────────────── */

/**
 * Bounds for the non-secret headers. They are attacker-supplied and end up in a log line, a request
 * body and (for `local`) a URL the SERVER fetches, so each is length-capped and rejected outright if
 * it carries whitespace or a control character.
 */
const MODEL_ID_MAX_LENGTH = 200;
const BASE_URL_MAX_LENGTH = 300;
const PRINTABLE = /^[\x21-\x7e]+$/;

function readHeaderField(req: Request, header: string, maxLength: number): string | null {
  const raw = req.headers.get(header)?.trim() ?? "";
  if (raw.length === 0) return null;
  if (raw.length > maxLength || !PRINTABLE.test(raw)) {
    throw new BadRequestError(`${header}: not a valid value`);
  }
  return raw;
}

export function readProviderIdHeader(req: Request): string | null {
  return readHeaderField(req, PROVIDER_ID_HEADER, 40);
}

export function readModelHeader(req: Request): string | null {
  return readHeaderField(req, PROVIDER_MODEL_HEADER, MODEL_ID_MAX_LENGTH);
}

export function readSurfaceHeader(req: Request): ModelSurface | null {
  const raw = readHeaderField(req, PROVIDER_SURFACE_HEADER, 20);
  if (raw === null) return null;
  if (raw !== "chat" && raw !== "responses") {
    throw new BadRequestError(`${PROVIDER_SURFACE_HEADER}: must be 'chat' or 'responses'`);
  }
  return raw;
}

export function readBaseUrlHeader(req: Request): string | null {
  return readHeaderField(req, PROVIDER_BASE_URL_HEADER, BASE_URL_MAX_LENGTH);
}

/** A model id the user typed. Same bounds as the header form, so both doors are the same width. */
export function assertModelId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > MODEL_ID_MAX_LENGTH || !PRINTABLE.test(trimmed)) {
    throw new BadRequestError("model: not a valid model id");
  }
  return trimmed;
}

/* ── the SSRF gate ─────────────────────────────────────────────────────────── */

/**
 * 127.0.0.0/8, `localhost`, and the IPv6 loopback — checked on the PARSED host, never on the raw
 * string. `http://127.0.0.1@evil.example/` has a hostname of `evil.example`, so a substring match
 * would wave it straight through.
 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const octets = v4.slice(1).map(Number);
  return octets.every((n) => n <= 255) && octets[0] === 127;
}

/**
 * CRITICAL (U8 §11.1). A user-supplied base URL that the SERVER fetches is an SSRF pivot: it lets
 * anyone point HITE's server at `http://169.254.169.254/…` (cloud metadata), at an internal VPC
 * address, or at any host the function can reach, and read the answer back through the planner's own
 * error surface.
 *
 * Three mitigations, all required and all elsewhere-or-here: the entry is `selfHostOnly` and
 * rejected unless the deployer sets `HITE_ALLOW_LOCAL_PROVIDER=1` (registry.ts); the upstream body
 * is never read into anything user-visible (the check route); and THIS — the host must be loopback,
 * checked before any fetch is issued. On a deployed server `localhost` is the SERVER'S localhost, so
 * the feature could not work there anyway; refusing it is not a lost capability.
 *
 * Credentials in the URL are refused outright rather than stripped: `user:pass@host` in a base URL
 * is never something a local model server needs, and silently rewriting a URL a user typed is worse
 * than telling them it is not allowed.
 */
export function requireLoopbackBaseUrl(raw: string): string {
  if (raw.length > BASE_URL_MAX_LENGTH || !PRINTABLE.test(raw)) {
    throw new BadRequestError("baseUrl: not a valid URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestError("baseUrl: not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestError("baseUrl: only http:// and https:// are allowed");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new BadRequestError("baseUrl: credentials in the URL are not allowed");
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new BadRequestError(
      "baseUrl: only an address on this machine is allowed — a remote one would make this server fetch it",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}
