/** Health endpoint smoke — /api/health reports integration status. */
import { test, expect } from "@playwright/test";

interface HealthCheck {
  key: string;
  label: string;
  ok: boolean;
  hint?: string;
}
interface HealthPayload {
  status: "ok" | "degraded" | "unconfigured";
  checks: HealthCheck[];
}

test.describe("Health endpoint", () => {
  test("returns a structured payload with all expected check keys", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as HealthPayload;
    expect(["ok", "degraded", "unconfigured"]).toContain(body.status);

    const keys = body.checks.map((c) => c.key).sort();
    expect(keys).toEqual(["ai", "blob", "groq", "supabase", "supabase_admin"].sort());

    for (const check of body.checks) {
      expect(typeof check.label).toBe("string");
      expect(typeof check.ok).toBe("boolean");
    }
  });

  test("critical Supabase keys are present in production", async ({ request }) => {
    const res = await request.get("/api/health");
    const body = (await res.json()) as HealthPayload;
    const supabase = body.checks.find((c) => c.key === "supabase");
    expect(supabase?.ok).toBe(true);
  });
});
