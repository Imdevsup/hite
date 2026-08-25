import { describe, test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_LOCAL_URL;
const SERVICE = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const ENABLED = Boolean(URL && SERVICE);

describe.skipIf(!ENABLED)("RPC consume_rate_limit", () => {
  const admin = ENABLED
    ? createClient(URL!, SERVICE!, { auth: { persistSession: false } })
    : null;

  test("allows up to limit then blocks", async () => {
    if (!admin) return;
    const { data: user } = await admin.auth.admin.createUser({
      email: `rl-${Date.now()}@hite.test`,
      password: "pw-dont-reuse-1234",
      email_confirm: true,
    });
    const userId = user!.user!.id;
    try {
      // Limit 3 for the test — first 3 calls ok, 4th blocked.
      for (let i = 0; i < 3; i++) {
        const { data, error } = await admin.rpc("consume_rate_limit", {
          p_user: userId, p_bucket: "plan", p_limit: 3,
        });
        expect(error).toBeNull();
        const row = Array.isArray(data) ? data[0] : data;
        expect(row.ok).toBe(true);
      }
      const { data: blocked } = await admin.rpc("consume_rate_limit", {
        p_user: userId, p_bucket: "plan", p_limit: 3,
      });
      const row = Array.isArray(blocked) ? blocked[0] : blocked;
      expect(row.ok).toBe(false);
      expect(row.remaining).toBe(0);
    } finally {
      await admin.from("rate_limit_bucket").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
