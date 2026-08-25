import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { BYOK_DISCLOSURE, fingerprintKey, readProviderKey, sanitizeProviderText } from "./keys";

/**
 * BYOK POLICY — what a deployment SHOWS about a key, as opposed to how it uses one.
 *
 * The mechanics (header parsing, shape bounds, exact-value redaction, the SSRF gate) belong to
 * `lib/ai/providers/credential.ts` and are covered by its own suite; nothing here re-tests them.
 * What is asserted here is the layer above: the fingerprint the UI shows instead of key material,
 * the second redaction net for text whose key we were never handed, and the disclosure sentence that
 * must not be softened.
 *
 * Note what is GONE: `resolveByokMode`, `ByokMode` and `requireKeySource`. There is no deployer key
 * pool, so "what happens to a keyless request" has exactly one answer (402) and it is owned by
 * `lib/ai/providers/request.ts`. A policy knob with one legal value is not a policy.
 */

/** A key-shaped sentinel. If this string turns up anywhere it should not, a test must fail. */
const SENTINEL = "AIzaSySENTINELdoNOTleak0123456789abcdef";
/** sha256(SENTINEL).slice(0,8) — pins the fingerprint algorithm, not just its shape. */
const SENTINEL_FINGERPRINT = "dbffb7bb";

const HEADER = "x-hite-provider-key";
const request = (headers: Record<string, string> = {}, url = "http://localhost/api/plan") =>
  new Request(url, { method: "POST", headers });

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readProviderKey — the non-throwing view a settings screen can render", () => {
  test("reports usable, absent and unusable as three distinct states", () => {
    expect(readProviderKey(request({ [HEADER]: SENTINEL }))).toEqual({ status: "ok", key: SENTINEL });
    expect(readProviderKey(request())).toEqual({ status: "absent" });
    expect(readProviderKey(request({ [HEADER]: "   " }))).toEqual({ status: "absent" });
    expect(readProviderKey(request({ [HEADER]: `${SENTINEL} junk` }))).toEqual({ status: "malformed" });
  });

  test("honours a provider's own length bound", () => {
    const long = "a".repeat(200);
    expect(readProviderKey(request({ [HEADER]: long })).status).toBe("ok");
    expect(readProviderKey(request({ [HEADER]: long }), 128).status).toBe("malformed");
  });

  test("a query string is NOT a key source — URLs land in access logs and Referer headers", () => {
    const url = `http://localhost/api/plan?key=${SENTINEL}&api_key=${SENTINEL}`;
    expect(readProviderKey(request({}, url))).toEqual({ status: "absent" });
  });

  test("it converts only the shape rejection — a real fault still escapes", () => {
    // A silent catch-all here would turn any future failure in the parser into "no key supplied",
    // which on a BYOK-only app means a 402 for someone who actually pasted a working key.
    const exploding = {
      headers: {
        get() {
          throw new TypeError("headers unavailable");
        },
      },
    } as unknown as Request;
    expect(() => readProviderKey(exploding)).toThrow(TypeError);
  });

  test("reading a key never writes anything about it to the console", () => {
    readProviderKey(request({ [HEADER]: SENTINEL }));
    const logged = [...warn.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(SENTINEL);
  });
});

describe("fingerprintKey", () => {
  test("is a stable, non-reversible 8-hex label — never key material", () => {
    const fingerprint = fingerprintKey(SENTINEL);
    expect(fingerprint).toBe(SENTINEL_FINGERPRINT);
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintKey(SENTINEL)).toBe(fingerprint); // deterministic
    // The hint must not be a slice of the secret — "last 4" would be exactly that.
    expect(SENTINEL).not.toContain(fingerprint);
    expect(fingerprintKey(`${SENTINEL}x`)).not.toBe(fingerprint); // distinguishes two keys
  });
});

describe("sanitizeProviderText", () => {
  test("removes every occurrence of the key we hold, whatever provider it belongs to", () => {
    // The exact-value pass is the only one that works for the seven providers whose key format we
    // deliberately do not encode anywhere.
    const openaiish = "sk-proj-ABCDEF0123456789abcdef0123456789";
    const out = sanitizeProviderText(`failed for ${openaiish} (retry with ${openaiish})`, {
      kind: "byok",
      key: openaiish,
    });
    expect(out).not.toContain(openaiish);
    expect(out.match(/\[redacted]/g)).toHaveLength(2);
  });

  test("catches a key-shaped string even when we were never given the key", () => {
    // The gap the exact-value pass alone cannot close: an upstream error quoting a credential this
    // server never held, or a stack trace from a nested call.
    const out = sanitizeProviderText(`{"error":"API key not valid: AIzaSyOTHERkeyFROMupstream12345"}`);
    expect(out).not.toContain("AIzaSyOTHERkeyFROMupstream12345");
    expect(out).toContain("[redacted]");
  });

  /**
   * THE LIMIT OF THE PATTERN NET, pinned so no caller assumes it is a substitute for the credential.
   *
   * Measured against this repo's own working Gemini keys on 2026-08-20: 53 characters, containing a
   * `.`, with NO `AIza` prefix. `KEY_LIKE` matches none of them. So any call site that drops the
   * `source` argument is running with ONE net, and that net does not cover the keys Google issues
   * today — which is why `scripts/verify-provider.ts` keeps its credential at module scope for the
   * two handlers that live outside `main`.
   */
  test("WITHOUT the credential a modern non-`AIza` Google key survives — the pattern net is a backstop, not the net", () => {
    const modern = "abcdefghij.klmnopqrstuvwxyz0123456789ABCDEFGHIJKLM"; // 50 chars, dot, no AIza
    expect(modern).not.toMatch(/AIza/);
    const leak = `{"error":{"message":"API key not valid: ${modern}"}}`;

    // With it: gone. Without it: still there. Both halves asserted, so a future "the regex covers it"
    // simplification fails here rather than in someone's log.
    expect(sanitizeProviderText(leak, { kind: "byok", key: modern })).not.toContain(modern);
    expect(sanitizeProviderText(leak)).toContain(modern);
  });

  test("a credential-free run is left alone — there is no key to strip", () => {
    expect(sanitizeProviderText("clip 3 exceeds media", { kind: "none" })).toBe("clip 3 exceeds media");
    expect(sanitizeProviderText("clip 3 exceeds media")).toBe("clip 3 exceeds media");
  });
});

describe("the disclosure", () => {
  test("says out loud the one thing BYOK cannot hide: the operator sees the key in transit", () => {
    expect(BYOK_DISCLOSURE).toContain("can see it in transit");
    expect(BYOK_DISCLOSURE).toContain("stored in this browser only");
  });

  test("is provider-neutral — naming Google would be wrong for seven of the eight", () => {
    expect(BYOK_DISCLOSURE).not.toMatch(/\bGoogle\b/);
    expect(BYOK_DISCLOSURE).toContain("your chosen provider");
  });
});
