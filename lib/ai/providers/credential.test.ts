import { describe, expect, test } from "vitest";
import { BadRequestError } from "@/lib/api/errors";
import {
  PROVIDER_BASE_URL_HEADER,
  PROVIDER_ID_HEADER,
  PROVIDER_KEY_HEADER,
  PROVIDER_MODEL_HEADER,
  PROVIDER_SURFACE_HEADER,
  isWellFormedKey,
  readBaseUrlHeader,
  readModelHeader,
  readProviderIdHeader,
  readSurfaceHeader,
  redactProviderKey,
  requireLoopbackBaseUrl,
  resolveProviderKey,
  type KeySource,
} from "./credential";
import { DEFAULT_KEY_MAX_LENGTH } from "./registry";
import type { ProviderAuth } from "./types";

/** A key-shaped sentinel. If this string turns up anywhere it should not, a test must fail. */
const SENTINEL = "AIzaSySENTINELdoNOTleak0123456789abcdef";

const API_KEY_AUTH: ProviderAuth = { kind: "apiKey", maxLength: DEFAULT_KEY_MAX_LENGTH, keyHint: null };
const BASE_URL_AUTH: ProviderAuth = { kind: "baseUrl", defaultBaseUrl: "http://localhost:11434/v1", loopbackOnly: true };

const request = (headers: Record<string, string> = {}, url = "http://localhost/api/plan") =>
  new Request(url, { method: "POST", headers });

describe("the key is read from a header and nothing else", () => {
  test("a well-formed key is a byok source; a blank or absent header is `none`", () => {
    expect(resolveProviderKey(request({ [PROVIDER_KEY_HEADER]: ` ${SENTINEL} ` }), API_KEY_AUTH)).toEqual({
      kind: "byok",
      key: SENTINEL,
    });
    expect(resolveProviderKey(request(), API_KEY_AUTH)).toEqual({ kind: "none" });
    expect(resolveProviderKey(request({ [PROVIDER_KEY_HEADER]: "   " }), API_KEY_AUTH)).toEqual({ kind: "none" });
  });

  test("a query string is NOT a key source — URLs land in access logs and Referer headers", () => {
    const url = `http://localhost/api/plan?key=${SENTINEL}&api_key=${SENTINEL}`;
    expect(resolveProviderKey(request({}, url), API_KEY_AUTH)).toEqual({ kind: "none" });
  });

  test("a malformed key is a 400 that does NOT echo the value — never a silent downgrade", () => {
    for (const bad of ['"AIzaquoted"', "short", "has spaces in it", "x".repeat(600)]) {
      let thrown: unknown;
      try {
        resolveProviderKey(request({ [PROVIDER_KEY_HEADER]: bad }), API_KEY_AUTH);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, JSON.stringify(bad)).toBeInstanceOf(BadRequestError);
      expect((thrown as Error).message).toBe(`${PROVIDER_KEY_HEADER}: not a valid API key`);
      expect((thrown as Error).message).not.toContain(bad);
    }
  });

  test("CR/LF can never even reach the app — the platform rejects the header first", () => {
    // Worth pinning: log-record forgery via this header is structurally impossible, not merely
    // filtered, so the shape check does not have to carry that weight alone.
    expect(() => request({ [PROVIDER_KEY_HEADER]: "abcdefghijklmnop\r\nx-injected: 1" })).toThrow();
  });
});

describe("the key SHAPE is bounds-only, and the bound is generous", () => {
  test("accepts the formats providers actually issue, not a remembered one", () => {
    for (const shape of [
      "AIzaSyClassic39CharKeyLooksLikeThis0000", // classic AI Studio
      "abc.a0AfB_byC-dotted.segmented_KEY-value123", // dotted, no AIza prefix — a real live key's shape
      "key+with/base64=padding+chars0000", // classic base64 alphabet
      "sk-ant-api03-" + "a".repeat(95), // Anthropic-length
      "gsk_" + "b".repeat(52),
      "sk-or-v1-" + "c".repeat(64),
    ]) {
      expect(isWellFormedKey(shape), shape).toBe(true);
    }
  });

  test("REGRESSION: a 200-character project key passes — the old 128 bound would have 400ed it", () => {
    // The previous cap was 128, which is shorter than a modern `sk-proj-…` OpenAI key. That turned
    // "this vendor lengthened its keys" into "your key is invalid", which is unfixable by the user.
    const long = `sk-proj-${"A".repeat(192)}`;
    expect(long.length).toBeGreaterThan(128);
    expect(isWellFormedKey(long)).toBe(true);
    expect(resolveProviderKey(request({ [PROVIDER_KEY_HEADER]: long }), API_KEY_AUTH)).toEqual({
      kind: "byok",
      key: long,
    });
  });

  test("still rejects only what actually hurts: whitespace, controls, and an unbounded length", () => {
    expect(isWellFormedKey("short")).toBe(false);
    expect(isWellFormedKey("has space in it here")).toBe(false);
    expect(isWellFormedKey("has\ttab-in-it-0000")).toBe(false);
    expect(isWellFormedKey('"quoted-key-value-0000"')).toBe(false);
    expect(isWellFormedKey("a".repeat(DEFAULT_KEY_MAX_LENGTH + 1))).toBe(false);
  });

  test("the bound is per provider — a tighter one is honoured", () => {
    expect(isWellFormedKey("a".repeat(40), 32)).toBe(false);
    expect(isWellFormedKey("a".repeat(20), 32)).toBe(true);
  });
});

describe("redaction strips the key from anything user-visible", () => {
  test("every occurrence, wherever it appears", () => {
    const leak = `API error: key ${SENTINEL} is invalid (${SENTINEL})`;
    const scrubbed = redactProviderKey(leak, { kind: "byok", key: SENTINEL });
    expect(scrubbed).not.toContain(SENTINEL);
    expect(scrubbed).toBe("API error: key [redacted] is invalid ([redacted])");
  });

  test("the URL-ENCODED form too — the pass a raw-value-only scrub walks straight past", () => {
    // The charset admits +, / and = — exactly the characters encodeURIComponent escapes — so a key
    // of this shape can reach a URL in a form the raw pass does not match. Verified with a probe:
    // the encoded form survived redaction untouched before this second pass existed.
    const key = "AIzaSyLEAKPROBE+slash/pad=chars0000";
    const encoded = encodeURIComponent(key);
    expect(encoded).not.toBe(key); // guard: the case is only real while these differ

    const leak = `AI_APICallError: POST https://provider/v1/x?key=${encoded}&alt=sse`;
    const scrubbed = redactProviderKey(leak, { kind: "byok", key });
    expect(scrubbed).not.toContain(encoded);
    expect(scrubbed).not.toContain(key);
    // The tail must not survive either — a partial scrub that leaves most of a credential is a leak.
    expect(scrubbed).not.toContain("chars0000");
    expect(scrubbed).toContain("[redacted]");
  });

  test("REGRESSION: LOWER-CASE %-escapes are caught too — %-escapes are case-insensitive", () => {
    // `encodeURIComponent` uppercases its escapes, so the pass above only ever saw `%2B`. Anything
    // that re-encodes on the way to us — a proxy, a log shipper, another SDK — may emit `%2b`, and a
    // case-SENSITIVE match walks straight past it. Found by probing the shipped redactor, not by
    // reading it: the lower-cased form survived untouched.
    const key = "AIzaSyLEAKPROBE+slash/pad=chars0000";
    const lower = encodeURIComponent(key).replace(/%([0-9A-F]{2})/g, (_m, hex: string) => `%${hex.toLowerCase()}`);
    expect(lower).not.toBe(encodeURIComponent(key)); // guard: the case is only real while these differ

    const scrubbed = redactProviderKey(`fetch failed: https://provider/v1?key=${lower}`, { kind: "byok", key });
    expect(scrubbed).not.toContain(lower);
    expect(scrubbed).not.toContain("chars0000");
    expect(scrubbed).toContain("[redacted]");
  });

  test("a key carrying regex metacharacters is matched literally, never compiled", () => {
    // The encoded pass builds a RegExp. An unescaped `.` or `+` in a key would match the WRONG text
    // (over-redacting a log) or throw on an unbalanced bracket — and a throw inside a redactor takes
    // out the very error report it was protecting. The charset admits `.`, `+` and `-`.
    const key = "sk-a.b+c/d=e~f-0123456789";
    const encoded = encodeURIComponent(key);
    const scrubbed = redactProviderKey(`before ${encoded} after xxbxx`, { kind: "byok", key });
    expect(scrubbed).toBe("before [redacted] after xxbxx"); // "xxbxx" proves `.` did not match anything
  });

  test("a credential-free run is left alone — there is nothing to match on", () => {
    const none: KeySource = { kind: "none" };
    expect(redactProviderKey("clip 3 exceeds media", none)).toBe("clip 3 exceeds media");
  });
});

describe("the non-secret selection headers are bounded and validated", () => {
  test("they are read, trimmed, and absent when blank", () => {
    const req = request({
      [PROVIDER_ID_HEADER]: " openai ",
      [PROVIDER_MODEL_HEADER]: "gpt-5.4-mini",
      [PROVIDER_SURFACE_HEADER]: "chat",
      [PROVIDER_BASE_URL_HEADER]: "http://127.0.0.1:1234/v1",
    });
    expect(readProviderIdHeader(req)).toBe("openai");
    expect(readModelHeader(req)).toBe("gpt-5.4-mini");
    expect(readSurfaceHeader(req)).toBe("chat");
    expect(readBaseUrlHeader(req)).toBe("http://127.0.0.1:1234/v1");
    expect(readProviderIdHeader(request())).toBeNull();
  });

  test("an over-long or non-printable value is a 400, not a truncated log line", () => {
    expect(() => readModelHeader(request({ [PROVIDER_MODEL_HEADER]: "m".repeat(300) }))).toThrow(BadRequestError);
    expect(() => readModelHeader(request({ [PROVIDER_MODEL_HEADER]: "has space" }))).toThrow(BadRequestError);
  });

  test("an unknown surface is a 400 rather than a silent 'chat'", () => {
    expect(() => readSurfaceHeader(request({ [PROVIDER_SURFACE_HEADER]: "completions" }))).toThrow(BadRequestError);
  });
});

describe("SSRF: the local base URL must be loopback, checked on the PARSED host", () => {
  test("cloud metadata is refused BEFORE any fetch is issued", () => {
    expect(() => requireLoopbackBaseUrl("http://169.254.169.254/latest/meta-data/")).toThrow(BadRequestError);
  });

  test("an internal address, a remote host and a non-http scheme are all refused", () => {
    for (const bad of [
      "http://10.0.0.5:11434/v1",
      "http://192.168.1.10:11434/v1",
      "https://evil.example/v1",
      "file:///etc/passwd",
      "gopher://127.0.0.1/",
    ]) {
      expect(() => requireLoopbackBaseUrl(bad), bad).toThrow(BadRequestError);
    }
  });

  test("a userinfo trick cannot smuggle a remote host past a string match", () => {
    // `http://127.0.0.1@evil.example/` has a HOSTNAME of evil.example. A substring check on the raw
    // string would wave it straight through, which is exactly why the check parses first.
    expect(() => requireLoopbackBaseUrl("http://127.0.0.1@evil.example/v1")).toThrow(BadRequestError);
    expect(() => requireLoopbackBaseUrl("http://user:pass@localhost:11434/v1")).toThrow(BadRequestError);
  });

  test("real loopback addresses pass and are normalised without a trailing slash", () => {
    expect(requireLoopbackBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    expect(requireLoopbackBaseUrl("http://127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234/v1");
    expect(requireLoopbackBaseUrl("http://127.5.6.7:8080/v1")).toBe("http://127.5.6.7:8080/v1");
    expect(requireLoopbackBaseUrl("http://[::1]:11434/v1")).toBe("http://[::1]:11434/v1");
  });

  test("the base-URL provider still accepts a key, because some local servers want one", () => {
    expect(resolveProviderKey(request({ [PROVIDER_KEY_HEADER]: SENTINEL }), BASE_URL_AUTH)).toEqual({
      kind: "byok",
      key: SENTINEL,
    });
  });
});
