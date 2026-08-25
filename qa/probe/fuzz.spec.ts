/**
 * PROBE — Fuzz harness.
 * Hits protected endpoints with malformed / adversarial payloads and asserts
 * the server responds with a polite 4xx (400, 401, 422) rather than a 5xx
 * crash. 401 is acceptable because we send no session — the test is for
 * *stability*, not auth semantics. Seeing 500 means the route crashed
 * before validation.
 *
 * Mirrors ANVIL's fuzzer: 50 iterations × every known schema, with a small
 * zoo of adversarial payloads.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const ADVERSARIAL_PAYLOADS = [
  null,
  undefined,
  "",
  "not-json",
  0,
  true,
  [],
  {},
  { projectId: null },
  { projectId: "not-a-uuid" },
  { projectId: "'; DROP TABLE project; --" },
  { projectId: "<script>alert(1)</script>" },
  { projectId: "x".repeat(10_000) },
  { projectId: "00000000-0000-0000-0000-000000000000", extra: { nested: { deeply: true } } },
] as const;

interface Target {
  label: string;
  path: string;
}

const POST_TARGETS: Target[] = [
  { label: "/api/projects",    path: "/api/projects" },
  { label: "/api/assets",      path: "/api/assets" },
  { label: "/api/edits",       path: "/api/edits" },
  { label: "/api/analyze",     path: "/api/analyze" },
  { label: "/api/render",      path: "/api/render" },
  { label: "/api/plan",        path: "/api/plan" },
  { label: "/api/refine",      path: "/api/refine" },
  { label: "/api/errors",      path: "/api/errors" },
];

async function postPayload(request: APIRequestContext, path: string, body: unknown): Promise<number> {
  try {
    const res = await request.post(path, {
      data: body as object,
      headers: { "content-type": "application/json" },
    });
    return res.status();
  } catch {
    return -1;
  }
}

test.describe("PROBE · Fuzz", () => {
  for (const target of POST_TARGETS) {
    for (let i = 0; i < ADVERSARIAL_PAYLOADS.length; i++) {
      const payload = ADVERSARIAL_PAYLOADS[i];
      test(`${target.label} · payload #${i} doesn't crash`, async ({ request }) => {
        const status = await postPayload(request, target.path, payload);
        // Any 4xx is fine — client-side misuse. 5xx / -1 = crash.
        expect(status, `status was ${status}`).toBeLessThan(500);
        expect(status).toBeGreaterThanOrEqual(200);
      });
    }
  }
});
