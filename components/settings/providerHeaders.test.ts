import { describe, expect, test } from "vitest";
import {
  PROVIDER_BASE_URL_HEADER as SERVER_BASE_URL,
  PROVIDER_ID_HEADER as SERVER_ID,
  PROVIDER_MODEL_HEADER as SERVER_MODEL,
  PROVIDER_SURFACE_HEADER as SERVER_SURFACE,
  readBaseUrlHeader,
  readModelHeader,
  readProviderIdHeader,
  readSurfaceHeader,
} from "@/lib/ai/providers/credential";
import { PROVIDER_KEY_HEADER } from "./providerKey";
import {
  PROVIDER_BASE_URL_HEADER,
  PROVIDER_ID_HEADER,
  PROVIDER_MODEL_HEADER,
  PROVIDER_SURFACE_HEADER,
  providerSelectionHeaders,
} from "./providerHeaders";

/**
 * THE DRIFT GATE for the four selection headers.
 *
 * These strings are copied rather than imported, because their owner
 * (`lib/ai/providers/credential.ts`) reaches `next/server` and must not enter a client bundle. A copy
 * is only safe with a gate on it, so this file compares each one against the real constant AND —
 * more usefully — round-trips the headers this module builds through the server's own readers. A
 * renamed header would still typecheck and still 200; it would just silently grade the wrong
 * provider, which is the failure mode that has no symptom.
 */

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/settings/provider-key/check", { method: "POST", headers });
}

describe("the header names match their server owner", () => {
  test("each constant is the same string on both sides", () => {
    expect(PROVIDER_ID_HEADER).toBe(SERVER_ID);
    expect(PROVIDER_MODEL_HEADER).toBe(SERVER_MODEL);
    expect(PROVIDER_SURFACE_HEADER).toBe(SERVER_SURFACE);
    expect(PROVIDER_BASE_URL_HEADER).toBe(SERVER_BASE_URL);
  });

  test("none of them is the key header — the secret has its own channel", () => {
    const selection = [PROVIDER_ID_HEADER, PROVIDER_MODEL_HEADER, PROVIDER_SURFACE_HEADER, PROVIDER_BASE_URL_HEADER];
    expect(selection).not.toContain(PROVIDER_KEY_HEADER);
    expect(new Set(selection).size).toBe(selection.length);
  });
});

describe("what this module builds is what the server reads", () => {
  test("a full selection round-trips through the server's own readers", () => {
    const req = request(
      providerSelectionHeaders({
        providerId: "openai",
        modelId: "gpt-5.4-mini",
        surface: "chat",
        baseUrl: null,
      }),
    );
    expect(readProviderIdHeader(req)).toBe("openai");
    expect(readModelHeader(req)).toBe("gpt-5.4-mini");
    expect(readSurfaceHeader(req)).toBe("chat");
    expect(readBaseUrlHeader(req)).toBeNull();
  });

  test("a self-hosted selection carries its address, and the address is not the key header", () => {
    const headers = providerSelectionHeaders({
      providerId: "local",
      modelId: "qwen3:8b",
      surface: null,
      baseUrl: "http://localhost:11434/v1",
    });
    expect(headers[PROVIDER_KEY_HEADER]).toBeUndefined();
    const req = request(headers);
    expect(readProviderIdHeader(req)).toBe("local");
    expect(readBaseUrlHeader(req)).toBe("http://localhost:11434/v1");
  });

  test("a model that has not been chosen is omitted, not sent blank", () => {
    // `assertModelId("")` is a 400 server-side, so "not chosen yet" must not be sent as "chosen as
    // nothing" — the two are different facts and only one of them is an error.
    const headers = providerSelectionHeaders({ providerId: "google", modelId: "   ", surface: null });
    expect(headers[PROVIDER_MODEL_HEADER]).toBeUndefined();
    expect(readModelHeader(request(headers))).toBeNull();
  });

  test("an unrecognised surface never reaches the wire as one", () => {
    const headers = providerSelectionHeaders({ providerId: "google", surface: null });
    expect(headers[PROVIDER_SURFACE_HEADER]).toBeUndefined();
    expect(readSurfaceHeader(request(headers))).toBeNull();
  });
});
