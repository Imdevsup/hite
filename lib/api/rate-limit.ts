import { HttpError } from "@/lib/api/errors";
import { checkIpRateLimit, checkRateLimit, type Bucket, type IpBucket } from "@/lib/cache/jobs";
import { createAdmin } from "@/lib/supabase/admin";
// Type-only: the gate needs to know WHO IS PAYING and nothing else. A value import would drag the
// provider layer into /api/errors and /api/render, which do not need it.
import type { KeySource } from "@/lib/ai/providers/credential";

/**
 * The spend gate for expensive routes, as ONE call an expensive route cannot forget to write
 * correctly.
 *
 * Every route that starts a model run, a render or a workflow must call this before doing the
 * expensive thing. It was open-coded (`checkRateLimit` + a hand-written 429) in /api/plan and
 * /api/render only, so /api/refine — the same Gemini tool-loop, and the route the chat uses for
 * every turn after the first — ran unmetered and made the plan cap meaningless. All three now go
 * through here; `checkRateLimit` itself should have no other caller.
 *
 *     await requireRateLimit(user.id, "refine");   // 429s via withAuth; nothing else to write
 *
 * Throws `HttpError`, so `withAuth` returns the 429 verbatim. The client message is deliberately
 * identical across buckets ("daily limit reached") — the same chat bubble renders it whichever
 * route produced it; the bucket goes to the server log instead.
 *
 * `checkRateLimit` fails CLOSED (a broken RPC returns ok:false), so an outage throttles rather than
 * opening the gate. That is the intended direction for a shared, key-pooled model budget.
 */
export async function requireRateLimit(userId: string, bucket: Bucket): Promise<void> {
  const rate = await checkRateLimit(userId, bucket);
  if (!rate.ok) {
    console.warn(`[rate-limit] blocked user=${userId} bucket=${bucket}`);
    throw new HttpError(429, "daily limit reached");
  }
}

/**
 * IP-keyed gate for the endpoints that are legitimately unauthenticated. Takes the key rather than
 * the request so the caller owns how it derives an identity (and so it is testable without a
 * Request); use `clientIpKey` for the standard header derivation.
 */
export async function requireIpRateLimit(key: string, bucket: IpBucket): Promise<void> {
  const rate = await checkIpRateLimit(key, bucket);
  if (!rate.ok) {
    console.warn(`[rate-limit] blocked ip=${key} bucket=${bucket}`);
    throw new HttpError(429, "too many requests");
  }
}

/**
 * Client IP for rate-limiting, from the proxy headers Vercel sets. Falls back to a single shared
 * "unknown" key: if we cannot identify the caller we count them all together and throttle the
 * group, rather than handing every unidentifiable request its own fresh quota.
 *
 * Only the first `x-forwarded-for` hop is used, and it is length-capped — the header is
 * attacker-supplied, so an unbounded value would otherwise become an unbounded DB key and log line.
 */
export function clientIpKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "";
  return ip ? ip.slice(0, 64) : "unknown";
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Bring-your-own-key path.
 *
 * The gates above meter the DEPLOYER'S MONEY: a daily count against a shared Gemini pool. When a
 * visitor brings their own key that budget is not being spent, so continuing to charge them against
 * it is both wrong and the thing that makes BYOK pointless — they would still hit "daily limit
 * reached" while paying Google themselves.
 *
 * What the deployer still pays for is FUNCTION-SECONDS, and a high-effort planner run holds one for
 * minutes. So the BYOK gate is a per-IP CONCURRENCY cap (plus a very high daily tripwire), which is
 * the right instrument for a resource measured in seconds-held rather than calls-made. See
 * supabase/migrations/008_byok_runs.sql — it must be applied before this path ships.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * IP buckets owned by this path.
 *
 * `key-check` meters POST /api/settings/provider-key/check. That endpoint reaches Google with
 * whatever key it is handed and reports valid/invalid, which is a free credential-validity oracle for
 * anyone holding a list of stolen keys — so it gets a bucket of its own even though it is cheap.
 *
 * These live here rather than in `IP_BUCKETS` (lib/cache/jobs.ts) because that module belongs to the
 * job queue, not to BYOK; fold them in if the two ever want one home. The DATABASE side needs no
 * migration either way — `ip_rate_limit_bucket.bucket` is plain text with no enum or check
 * constraint and the limit is passed per call (migration 004).
 */
const BYOK_IP_BUCKETS = { "key-check": 60 } as const;
export type ByokIpBucket = keyof typeof BYOK_IP_BUCKETS;

/**
 * IP-keyed gate for the BYOK endpoints. Same fail-closed contract and same `consume_ip_rate_limit`
 * RPC as `checkIpRateLimit`; it calls the RPC directly only because that helper's bucket type is
 * closed over `IP_BUCKETS`.
 */
export async function requireByokIpRateLimit(key: string, bucket: ByokIpBucket): Promise<void> {
  let allowed = false;
  try {
    const admin = createAdmin();
    const { data, error } = await admin.rpc("consume_ip_rate_limit", {
      p_key: key,
      p_bucket: bucket,
      p_limit: BYOK_IP_BUCKETS[bucket],
    });
    if (error) {
      console.error(
        `[rate-limit] ip RPC failed — every '${bucket}' request is being REJECTED. ` +
          `If consume_ip_rate_limit does not exist, migration 004 has not been applied (pnpm db:push):`,
        error,
      );
    } else {
      const row = (Array.isArray(data) ? data[0] : data) as { ok?: unknown } | null | undefined;
      allowed = Boolean(row?.ok);
    }
  } catch (e) {
    console.error(`[rate-limit] ip bucket '${bucket}' unavailable — rejecting:`, e);
  }
  if (!allowed) {
    console.warn(`[rate-limit] blocked ip=${key} bucket=${bucket}`);
    throw new HttpError(429, "too many requests");
  }
}

/** In-flight planner runs allowed per IP on the BYOK path. */
const DEFAULT_BYOK_CONCURRENCY = 2;
/** Abuse tripwire only — high enough that no real session reaches it. */
const BYOK_DAILY_TRIPWIRE = 500;
/**
 * How long a claimed slot survives without being released. Must exceed the longest planner
 * `maxDuration` (300s at the top of the effort ladder) or a legitimate slow run would have its slot
 * reaped while still executing, letting a second run start alongside it.
 */
const BYOK_RUN_TTL_SECONDS = 360;

function byokConcurrency(): number {
  const raw = process.env.HITE_BYOK_MAX_CONCURRENT?.trim();
  if (raw === undefined || raw === "") return DEFAULT_BYOK_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.warn(
      `[byok] HITE_BYOK_MAX_CONCURRENT='${raw}' is not a positive integer — using ${DEFAULT_BYOK_CONCURRENCY}`,
    );
    return DEFAULT_BYOK_CONCURRENCY;
  }
  return parsed;
}

/** Releases the concurrency slot. Safe to call twice and safe to call after the slot aged out. */
export type ReleaseRun = () => Promise<void>;

const NO_SLOT_HELD: ReleaseRun = async () => {};

/** Shape-tolerant read of `begin_byok_run`'s row. Fails closed, exactly like readRateLimitRow. */
function readBeginRunRow(data: unknown): { ok: boolean; runId: string | null; reason: string } {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: unknown; run_id?: unknown; reason?: unknown }
    | null
    | undefined;
  return {
    ok: Boolean(row?.ok),
    runId: typeof row?.run_id === "string" ? row.run_id : null,
    reason: typeof row?.reason === "string" ? row.reason : "unavailable",
  };
}

/**
 * Claim a BYOK concurrency slot, or 429. Returns the release callback — the caller MUST await it in
 * a `finally`, or a crashed-free run holds its slot until the TTL reaps it:
 *
 *     const release = await beginByokRun(clientIpKey(req));
 *     try { ...run the planner... } finally { await release(); }
 *
 * Fails CLOSED on any RPC or client failure, matching `checkIpRateLimit`: an outage throttles rather
 * than opening an unbounded compute budget. The log line names migration 008 because a missing RPC is
 * the one failure mode a deployer will actually hit.
 */
export async function beginByokRun(ipKey: string): Promise<ReleaseRun> {
  let admin: ReturnType<typeof createAdmin>;
  try {
    admin = createAdmin();
  } catch (e) {
    console.error(`[byok] admin client unavailable — rejecting the run:`, e);
    throw new HttpError(429, "too many requests");
  }

  const { data, error } = await admin.rpc("begin_byok_run", {
    p_key: ipKey,
    p_concurrency: byokConcurrency(),
    p_daily_limit: BYOK_DAILY_TRIPWIRE,
    p_ttl_seconds: BYOK_RUN_TTL_SECONDS,
  });
  if (error) {
    console.error(
      `[byok] begin_byok_run RPC failed — every key-carrying request is being REJECTED. ` +
        `If begin_byok_run does not exist, migration 008 has not been applied (pnpm db:push):`,
      error,
    );
    throw new HttpError(429, "too many requests");
  }

  const row = readBeginRunRow(data);
  if (!row.ok || row.runId === null) {
    console.warn(`[byok] blocked ip=${ipKey} reason=${row.reason}`);
    throw new HttpError(
      429,
      row.reason === "concurrency"
        ? "another edit is already running — wait for it to finish"
        : "too many requests",
    );
  }

  const runId = row.runId;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const { error: releaseError } = await admin.rpc("end_byok_run", { p_run: runId });
    // A leaked slot is self-healing (the TTL reaps it), so this must never mask the run's own
    // outcome by throwing out of a `finally`.
    if (releaseError) console.error(`[byok] end_byok_run failed for ip=${ipKey}:`, releaseError);
  };
}

/**
 * The one spend gate for a planner run, aware of who is paying. Replaces a bare
 * `requireRateLimit(user.id, "plan")` in /api/plan and /api/refine:
 *
 *     const release = await requirePlannerBudget({ userId, ipKey, source, bucket: "plan" });
 *     try { ... } finally { await release(); }
 *
 * pool → today's per-user daily bucket, byte-identical to `requireRateLimit`, and the release is a
 *        no-op (there is no slot to hold).
 * byok → the shared daily budget is NOT consulted, because it is not the budget being spent.
 */
export async function requirePlannerBudget(args: {
  userId: string;
  ipKey: string;
  source: KeySource;
  bucket: Bucket;
}): Promise<ReleaseRun> {
  if (args.source.kind === "byok") return beginByokRun(args.ipKey);
  await requireRateLimit(args.userId, args.bucket);
  return NO_SLOT_HELD;
}
