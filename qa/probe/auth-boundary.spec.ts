/**
 * PROBE — Authentication boundary tests.
 * Mirrors ANVIL's probe/auth-tester: hits every protected API route with
 * NO session cookie and verifies it returns 401 (or 403). A 200 here means
 * the route is inadvertently public. A 500 means the route crashes before
 * auth check fires — also a bug.
 *
 * Expected: all routes return 401. /api/health and /api/errors stay public.
 *
 * STILL 401, DELIBERATELY, NOW THAT THERE IS NO SIGN-IN SCREEN. `middleware.ts` mints an anonymous
 * session for a visitor who reaches `/app`, but its matcher stops there: if `/api/*` minted sessions
 * too, every unauthenticated request to this file's URL list would create a user row, and this probe
 * would go permanently green by making the boundary meaningless. A browser always enters through
 * `/app`, so it always holds a session by the time it calls an API.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Probe {
  label: string;
  method: Method;
  path: string;
  body?: unknown;
  expectedStatus: number | number[];
}

const UUID = "00000000-0000-0000-0000-000000000000";

const PROBES: Probe[] = [
  // Public — should NOT be gated
  { label: "GET  /api/health",                          method: "GET",    path: "/api/health",              expectedStatus: 200 },

  // Protected — should 401 without session
  { label: "GET  /api/projects",                        method: "GET",    path: "/api/projects",            expectedStatus: 401 },
  { label: "POST /api/projects",                        method: "POST",   path: "/api/projects",            body: { title: "x" }, expectedStatus: 401 },
  { label: "GET  /api/projects/[id]",                   method: "GET",    path: `/api/projects/${UUID}`,    expectedStatus: 401 },
  { label: "PATCH /api/projects/[id]",                  method: "PATCH",  path: `/api/projects/${UUID}`,    body: { title: "x" }, expectedStatus: 401 },
  { label: "DELETE /api/projects/[id]",                 method: "DELETE", path: `/api/projects/${UUID}`,    expectedStatus: 401 },
  { label: "GET  /api/projects/[id]/layout",            method: "GET",    path: `/api/projects/${UUID}/layout`, expectedStatus: 401 },
  { label: "PUT  /api/projects/[id]/layout",            method: "PUT",    path: `/api/projects/${UUID}/layout`, body: { version: 1, windows: [] }, expectedStatus: 401 },
  { label: "POST /api/assets",                          method: "POST",   path: "/api/assets",              body: { projectId: UUID, storagePath: `${UUID}/${UUID}/x.mp4`, filename: "x.mp4", contentType: "video/mp4", durationMs: 1000 }, expectedStatus: 401 },
  { label: "POST /api/edits",                           method: "POST",   path: "/api/edits",               body: { projectId: UUID, edl: {} }, expectedStatus: 401 },
  { label: "POST /api/analyze",                         method: "POST",   path: "/api/analyze",             body: { assetId: UUID }, expectedStatus: 401 },
  { label: "GET  /api/analyze/[assetId]",               method: "GET",    path: `/api/analyze/${UUID}`,     expectedStatus: 401 },
  { label: "POST /api/render",                          method: "POST",   path: "/api/render",              body: { projectId: UUID, aspect: "16:9", tier: "free" }, expectedStatus: 401 },
  { label: "GET  /api/render/[id]",                     method: "GET",    path: `/api/render/${UUID}`,      expectedStatus: 401 },
  { label: "GET  /api/export/[id]",                     method: "GET",    path: `/api/export/${UUID}`,      expectedStatus: 401 },
  { label: "POST /api/plan",                            method: "POST",   path: "/api/plan",                body: { projectId: UUID, prompt: "x" }, expectedStatus: 401 },
  { label: "POST /api/refine",                          method: "POST",   path: "/api/refine",              body: { editId: UUID, prompt: "x" }, expectedStatus: 401 },

  // Public telemetry endpoint (accepts anonymous error reports)
  { label: "POST /api/errors",                          method: "POST",   path: "/api/errors",              body: { msg: "x" }, expectedStatus: 200 },
];

async function fire(request: APIRequestContext, probe: Probe) {
  const opts = probe.body ? { data: probe.body } : {};
  switch (probe.method) {
    case "GET":    return request.get(probe.path);
    case "POST":   return request.post(probe.path, opts);
    case "PUT":    return request.put(probe.path, opts);
    case "PATCH":  return request.patch(probe.path, opts);
    case "DELETE": return request.delete(probe.path);
  }
}

test.describe("PROBE · Auth boundary", () => {
  for (const probe of PROBES) {
    test(probe.label, async ({ request }) => {
      const res = await fire(request, probe);
      const expected = Array.isArray(probe.expectedStatus) ? probe.expectedStatus : [probe.expectedStatus];
      expect(expected, `Got ${res.status()}, expected one of ${expected.join(", ")}`).toContain(res.status());
    });
  }
});
