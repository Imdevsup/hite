import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

/**
 * POST /api/settings/provider-key/check — the endpoint that grades a user's provider key.
 *
 * It is the single riskiest surface in the BYOK design: it is handed a live credential and then
 * talks to a third party about it. The whole suite is therefore built around one sentinel string,
 * and the rule is absolute — after a request carrying `SENTINEL`, that string must not appear in the
 * response status line, the response headers, the response body, any console call, or the outbound
 * URL. Only the header may carry it.
 */

const SENTINEL = "AIzaSySENTINELdoNOTleak0123456789abcdef";
const SENTINEL_FINGERPRINT = "dbffb7bb";

const { requireByokIpRateLimitMock } = vi.hoisted(() => ({ requireByokIpRateLimitMock: vi.fn() }));
vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  requireByokIpRateLimit: requireByokIpRateLimitMock,
}));

// Mirrors the real withAuth: an HttpError becomes its response, anything else keeps throwing.
vi.mock("@/lib/api/auth", async () => {
  const { HttpError } = await import("@/lib/api/errors");
  return {
    withAuth: async (handler: (ctx: { user: { id: string } }) => unknown) => {
      try {
        return await handler({ user: { id: "user-1" } });
      } catch (e) {
        if (e instanceof HttpError) return e.response;
        throw e;
      }
    },
  };
});

const { POST } = await import("./route");
const { PROVIDER_KEY_HEADER, PROVIDER_ID_HEADER } = await import("@/lib/ai/providers/credential");

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requireByokIpRateLimitMock.mockReset().mockResolvedValue(undefined);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/settings/provider-key/check", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4", ...headers },
  });

const withKey = () => post({ [PROVIDER_KEY_HEADER]: SENTINEL });

/** Everything a caller or an operator could observe, as one string. */
async function observable(res: Response): Promise<string> {
  const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  const consoleCalls = [...warn.mock.calls, ...error.mock.calls, ...log.mock.calls]
    .map((call) => call.map((arg) => String(arg)).join(" "))
    .join("\n");
  const outbound = fetchMock.mock.calls.map((call) => String(call[0])).join("\n");
  return [res.status, headers, await res.clone().text(), consoleCalls, outbound].join("\n");
}

describe("the key never round-trips out of the API", () => {
  test("a successful check answers with a fingerprint, never the key", async () => {
    fetchMock.mockResolvedValue(new Response('{"models":[]}', { status: 200 }));
    const res = await POST(withKey());

    expect(res.status).toBe(200);
    expect(await res.clone().json()).toEqual({ ok: true, provider: "google", fingerprint: SENTINEL_FINGERPRINT });
    expect(await observable(res)).not.toContain(SENTINEL);
  });

  test("an upstream body that QUOTES the key still cannot leak it — the body is never read", async () => {
    // Google's 4xx bodies can echo request metadata. This is the exact shape that would leak if the
    // route ever forwarded a provider message.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `API key not valid: ${SENTINEL}` } }), { status: 400 }),
    );
    const res = await POST(withKey());

    expect(await res.clone().json()).toEqual({ ok: false, reason: "invalid" });
    expect(await observable(res)).not.toContain(SENTINEL);
  });

  test("a network failure whose message contains the key is redacted before it is logged", async () => {
    fetchMock.mockRejectedValue(new Error(`connect ETIMEDOUT while sending key=${SENTINEL}`));
    const res = await POST(withKey());

    expect(await res.clone().json()).toEqual({ ok: false, reason: "network" });
    expect(await observable(res)).not.toContain(SENTINEL);
    expect(warn.mock.calls.map(String).join(" ")).toContain("[redacted]");
  });

  test("a malformed key is rejected without echoing it and without an upstream call", async () => {
    const res = await POST(post({ [PROVIDER_KEY_HEADER]: `${SENTINEL} trailing junk` }));

    expect(await res.clone().json()).toEqual({ ok: false, reason: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await observable(res)).not.toContain(SENTINEL);
  });
});

describe("the upstream call", () => {
  test("sends the key as a header — never in the URL or a query string", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(withKey());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1");
    expect(url).not.toContain(SENTINEL);
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe(SENTINEL);
    // A metadata read, so validating costs the visitor nothing — not a generation.
    expect(init.method).toBe("GET");
  });

  test("is not retried — one graded key, one request", async () => {
    fetchMock.mockResolvedValue(new Response("err", { status: 503 }));
    await POST(withKey());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("reasons the visitor can act on", () => {
  const cases: Array<[number, string]> = [
    [200, "ok"],
    [400, "invalid"],
    [401, "invalid"],
    [403, "invalid"],
    [429, "quota"],
    [500, "network"],
    [418, "network"],
  ];

  for (const [status, expected] of cases) {
    test(`upstream ${status} → ${expected}`, async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status }));
      const body = (await (await POST(withKey())).json()) as { ok: boolean; reason?: string };
      if (expected === "ok") expect(body.ok).toBe(true);
      else expect(body).toEqual({ ok: false, reason: expected });
    });
  }
});

describe("gates", () => {
  test("a missing header is a 400 and never reaches the provider", async () => {
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(PROVIDER_KEY_HEADER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the IP bucket is consumed before anything else happens", async () => {
    const { HttpError } = await import("@/lib/api/errors");
    requireByokIpRateLimitMock.mockRejectedValue(new HttpError(429, "too many requests"));
    const res = await POST(withKey());

    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requireByokIpRateLimitMock).toHaveBeenCalledWith("1.2.3.4", "key-check");
  });

  test("the answer is never cacheable", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await POST(withKey())).headers.get("cache-control")).toBe("no-store");
  });
});

describe("the check is registry-driven, not hardcoded to one vendor", () => {
  /**
   * The URL and the auth header used to be Google constants inside this file. With eight providers
   * that is the exact detail that rots silently: the endpoint would keep answering, it would just be
   * grading every key against Google. Both now come from `lib/ai/providers/registry.ts`.
   */
  const forProvider = (id: string) => post({ [PROVIDER_KEY_HEADER]: SENTINEL, [PROVIDER_ID_HEADER]: id });

  const expectations: Array<[string, string, string]> = [
    ["openai", "https://api.openai.com/v1/models", "authorization"],
    ["anthropic", "https://api.anthropic.com/v1/models", "x-api-key"],
    ["groq", "https://api.groq.com/openai/v1/models", "authorization"],
    ["xai", "https://api.x.ai/v1/models", "authorization"],
    ["deepseek", "https://api.deepseek.com/models", "authorization"],
    ["openrouter", "https://openrouter.ai/api/v1/key", "authorization"],
  ];

  for (const [provider, url, header] of expectations) {
    test(`${provider} is asked at its own endpoint, with its own auth header`, async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
      const res = await POST(forProvider(provider));

      const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(url);
      const headers = new Headers(init.headers);
      expect(headers.get(header)).toBe(header === "authorization" ? `Bearer ${SENTINEL}` : SENTINEL);
      expect(await observable(res)).not.toContain(SENTINEL);
    });
  }

  test("anthropic gets the version header its API requires, or every key reads as invalid", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await POST(forProvider("anthropic"));
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get("anthropic-version")).toBe("2023-06-01");
  });

  test("an unknown provider is a 400 and never reaches anyone", async () => {
    const res = await POST(forProvider("gemini"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a provider this deployment refuses to run will not be graded either", async () => {
    // Otherwise the endpoint stays a free credential-validity oracle for a path the product will
    // not take anyway.
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "");
    const res = await POST(forProvider("local"));
    expect(await res.json()).toEqual({ ok: false, reason: "unsupported" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  test("SSRF: a self-hosted check will not fetch a non-loopback address", async () => {
    vi.stubEnv("HITE_ALLOW_LOCAL_PROVIDER", "1");
    const res = await POST(
      post({
        [PROVIDER_KEY_HEADER]: SENTINEL,
        [PROVIDER_ID_HEADER]: "local",
        "x-hite-base-url": "http://169.254.169.254/latest",
      }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
