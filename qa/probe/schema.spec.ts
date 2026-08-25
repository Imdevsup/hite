/**
 * PROBE — Schema / contract tests.
 * Verifies the shape of public API responses is stable. If the payload
 * contract changes, the client is likely to break — this catches it before
 * the client does.
 *
 * Mirrors ANVIL's probe/schema-discovery + baseline-diff flow, narrowed
 * down to routes that don't require auth.
 */
import { test, expect } from "@playwright/test";

test.describe("PROBE · Schema", () => {
  test("/api/health has the documented shape", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("status");
    expect(["ok", "degraded", "unconfigured"]).toContain(body.status);

    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.length).toBeGreaterThan(0);

    for (const c of body.checks) {
      expect(typeof c.key).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(typeof c.ok).toBe("boolean");
      if (c.hint !== undefined) expect(typeof c.hint).toBe("string");
    }
  });

  test("/api/health check keys match the canonical set", async ({ request }) => {
    const res = await request.get("/api/health");
    const body = await res.json();
    const keys = new Set<string>(body.checks.map((c: { key: string }) => c.key));
    for (const k of ["supabase", "supabase_admin", "blob", "ai", "groq"]) {
      expect(keys.has(k), `missing check key: ${k}`).toBe(true);
    }
  });

  test("/api/errors accepts arbitrary JSON and returns { ok: true }", async ({ request }) => {
    const res = await request.post("/api/errors", { data: { sampled: "payload" } });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  // /auth/callback used to be probed here. It is deleted along with the rest of the login wall;
  // forge/smoke/middleware.spec.ts covers what replaced it (a silently minted session on /app).
});
