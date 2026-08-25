import { createAdmin } from "@/lib/supabase/admin";

/**
 * Rate limit helpers — backed by SQL RPCs against Supabase.
 * Replaces the previous in-memory placeholder (which was a silent no-op).
 *
 * Buckets for the free tier:
 *   • plan   — 10 prompts/day
 *   • refine — 30 follow-up prompts/day
 *   • render — 10 renders/day
 *
 * All calls run under the service_role admin client. Never call directly
 * from the browser; these helpers read/write auth-gated counters.
 *
 * A bucket name is plain text in the DB and the limit is passed per call, so adding a bucket here
 * needs NO migration — `rate_limit_bucket.bucket` has no enum or check constraint.
 *
 * The per-edit VLM spend budget that used to live here went with `sampleFramesForVLM`: there is no
 * VLM call left to meter, so `getVlmBudget`/`consumeVlmBudget` had no callers. Migration 003's
 * `vlm_budget` table and its two functions are deliberately left in place (revoked to service_role
 * only by 004) — dropping applied objects is its own migration, and real frame-level vision will
 * want them back.
 */

export const BUCKETS = {
  plan: 10,
  // /api/refine runs the same Gemini tool-loop as /api/plan and the chat routes EVERY turn after
  // the first to it, so leaving it unmetered made the plan cap meaningless (plan once, refine
  // forever, on the shared GEMINI_API_KEYS pool). It gets its own bucket rather than sharing
  // plan's: a normal session is one plan plus several refines, so a shared 10 would break ordinary
  // use, while 30 bounds the worst case instead of leaving it unbounded.
  refine: 30,
  render: 10,
} as const;

export type Bucket = keyof typeof BUCKETS;

/**
 * Buckets keyed by client IP instead of user id, for the endpoints that are legitimately
 * unauthenticated. `rate_limit_bucket.user_id` is a uuid FK to auth.users and cannot hold an IP,
 * so these use their own table + RPC (migration 004).
 */
export const IP_BUCKETS = {
  "client-error": 100,
} as const;

export type IpBucket = keyof typeof IP_BUCKETS;

/** Shape-tolerant read of the `(ok, remaining)` row the rate-limit RPCs return. Fails closed. */
function readRateLimitRow(data: unknown): RateLimitResult {
  const row = (Array.isArray(data) ? data[0] : data) as { ok?: unknown; remaining?: unknown } | null | undefined;
  return {
    ok: Boolean(row?.ok),
    remaining: typeof row?.remaining === "number" ? row.remaining : 0,
  };
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
}

export async function checkRateLimit(userId: string, bucket: Bucket): Promise<RateLimitResult> {
  const admin = createAdmin();
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_user: userId,
    p_bucket: bucket,
    p_limit: BUCKETS[bucket],
  });
  if (error) {
    // Fail *closed* when the RPC errors — better to 429 a legitimate user
    // than let an infinite-loop hit the model budget. Log loudly.
    console.error(`[rate-limit] RPC failed:`, error);
    return { ok: false, remaining: 0 };
  }
  return readRateLimitRow(data);
}

/**
 * IP-keyed counterpart of `checkRateLimit` for unauthenticated endpoints.
 *
 * Unlike `checkRateLimit` this also swallows a *throw* (an unset SUPABASE_SERVICE_ROLE_KEY makes
 * `createAdmin()` throw) — still failing closed and still logging. The only caller is the client
 * error reporter, and a 500 from the endpoint that collects errors would just start a report loop.
 *
 * DEPLOY ORDER: `consume_ip_rate_limit` ships in migration 004 and `pnpm db:push` is MANUAL, so
 * deploying this code first makes the RPC "not found" — which, failing closed, 429s every client
 * crash report until the migration lands. The caller (lib/sentry.ts) discards the response, so the
 * only signal is the log line below; it names the cause on purpose. Apply 004 before or with the
 * deploy that first ships /api/errors' rate limit.
 */
export async function checkIpRateLimit(key: string, bucket: IpBucket): Promise<RateLimitResult> {
  try {
    const admin = createAdmin();
    const { data, error } = await admin.rpc("consume_ip_rate_limit", {
      p_key: key,
      p_bucket: bucket,
      p_limit: IP_BUCKETS[bucket],
    });
    if (error) {
      console.error(
        `[rate-limit] ip RPC failed — every '${bucket}' request is being REJECTED. ` +
          `If consume_ip_rate_limit does not exist, migration 004 has not been applied (pnpm db:push):`,
        error,
      );
      return { ok: false, remaining: 0 };
    }
    return readRateLimitRow(data);
  } catch (e) {
    console.error(`[rate-limit] ip bucket '${bucket}' unavailable — rejecting:`, e);
    return { ok: false, remaining: 0 };
  }
}
