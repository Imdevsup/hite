-- Bring-your-own-key: bound the resource the DEPLOYER still pays for.
--
-- Additive only. 001–006 are already applied and are NOT edited here. 007 is deliberately skipped —
-- it is reserved for the effort-weighted `p_cost` change to consume_rate_limit / consume_ip_rate_limit
-- described in the U7 spec §2.5, which is a different unit's work. A numbering gap is harmless;
-- migrations apply in filename order.
--
-- WHY THIS EXISTS AT ALL. When a visitor brings their own Gemini key, the deployer's money is
-- genuinely not at risk any more, so the daily *count* cap that protects the shared pool protects
-- nothing and should be lifted — a visitor paying Google should not be throttled by a budget they are
-- not spending. But a high-effort planner run can hold a serverless function for minutes, and those
-- function-seconds are billed to the DEPLOYER. So the limit changes SHAPE rather than disappearing:
-- from "calls per day" to "how many runs may be in flight at once, per IP". That is the right
-- instrument for a resource measured in seconds-held rather than requests-made, and it is a hard
-- prerequisite for shipping the high/max effort levels, not a follow-up.
--
-- APPLY THIS BEFORE (or with) the deploy that first ships the BYOK path. `pnpm db:push` is MANUAL and
-- the TypeScript caller fails CLOSED (matching lib/cache/jobs.ts), so code-first means every
-- key-carrying request 429s until the migration lands. The server-side signal is the
-- `[byok] begin_byok_run RPC failed` log line, which names this file.
--
-- IP is a cost ceiling, not an identity system — CGNAT, IPv6 rotation and proxies all blur it. A
-- self-host that needs real protection should put Vercel WAF rate-limiting in front; HITE does not
-- try to out-engineer that here.

-- ————————————————————————————————————
-- byok_run — one row per planner run currently in flight, keyed by client IP.
--
-- Rows are deleted when the run finishes (end_byok_run). `expires_at` is the crash backstop: a
-- serverless function that is killed mid-run never gets to release, so an in-flight row must be able
-- to age out on its own or a single crash would permanently consume a concurrency slot. The table is
-- bounded by (concurrent runs × TTL) and is expected to hold single-digit rows.
-- ————————————————————————————————————
create table if not exists public.byok_run (
  id         uuid        primary key default gen_random_uuid(),
  ip_key     text        not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists byok_run_ip_key_idx  on public.byok_run (ip_key);
create index if not exists byok_run_expires_idx on public.byok_run (expires_at);

-- Same posture as rate_limit_bucket / ip_rate_limit_bucket: server-write-only. RLS on with no
-- policies = deny all to every role except service_role.
alter table public.byok_run enable row level security;

-- ————————————————————————————————————
-- begin_byok_run — claim a concurrency slot, or say why not.
--
-- Two gates in ONE round-trip so they cannot disagree:
--   1. concurrency — the real brake on function-seconds.
--   2. a daily tripwire — reuses migration 004's counter under the `byok-run` bucket, purely so a
--      script that drips one request every TTL forever still hits something. It is set very high by
--      the caller; it is an abuse tripwire, not a product limit.
--
-- The advisory lock is load-bearing: without it two simultaneous requests both read `count = 1`,
-- both pass a limit of 2, and both insert — the cap silently becomes N+1 under exactly the burst it
-- exists to stop. Locking on the IP key serialises only the requests that actually contend.
-- ————————————————————————————————————
create or replace function public.begin_byok_run(
  p_key         text,
  p_concurrency integer,
  p_daily_limit integer,
  p_ttl_seconds integer
) returns table (ok boolean, run_id uuid, inflight integer, reason text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_inflight integer;
  v_run      uuid;
  v_daily    record;
begin
  perform pg_advisory_xact_lock(hashtext(p_key));

  -- Reap crashed runs first, so a dead slot never blocks a live one.
  delete from public.byok_run where expires_at < now();

  select count(*) into v_inflight from public.byok_run where ip_key = p_key;
  if v_inflight >= p_concurrency then
    return query select false, null::uuid, v_inflight, 'concurrency'::text;
    return;
  end if;

  select * into v_daily from public.consume_ip_rate_limit(p_key, 'byok-run', p_daily_limit);
  if not v_daily.ok then
    return query select false, null::uuid, v_inflight, 'daily'::text;
    return;
  end if;

  insert into public.byok_run (ip_key, expires_at)
  values (p_key, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_run;

  return query select true, v_run, v_inflight + 1, null::text;
end;
$$;

-- ————————————————————————————————————
-- end_byok_run — release the slot. Idempotent, and a no-op for an id that already aged out, so the
-- caller can put it in a `finally` without a second thought.
-- ————————————————————————————————————
create or replace function public.end_byok_run(p_run uuid)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  delete from public.byok_run where id = p_run;
$$;

-- Same grant posture as 003/004: service_role only. Both are `security definer` and take an
-- arbitrary p_key / p_run, so granting them to authenticated or anon would let any caller free
-- another IP's slots or exhaust them.
revoke all on function public.begin_byok_run(text, integer, integer, integer) from public, authenticated, anon;
revoke all on function public.end_byok_run(uuid) from public, authenticated, anon;
grant execute on function public.begin_byok_run(text, integer, integer, integer) to service_role;
grant execute on function public.end_byok_run(uuid) to service_role;
