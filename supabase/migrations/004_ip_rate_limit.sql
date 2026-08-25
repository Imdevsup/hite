-- IP-keyed rate limiting for the endpoints that are legitimately unauthenticated, plus a correction
-- to migration 003's grant comment.
--
-- Additive only. 001–003 are already applied and are NOT edited here.
--
-- APPLY THIS BEFORE (or with) the deploy that first ships POST /api/errors' rate limit. `pnpm
-- db:push` is manual, and `checkIpRateLimit` fails CLOSED, so code-first means a missing
-- `consume_ip_rate_limit` 429s EVERY client crash report — and lib/sentry.ts discards the response,
-- so the browser never notices. The server-side signal is the `[rate-limit] ip RPC failed` log line.

-- ————————————————————————————————————
-- Why a second table instead of reusing rate_limit_bucket:
-- `rate_limit_bucket.user_id` is `uuid not null references auth.users(id)`, so it structurally
-- cannot hold a client IP. POST /api/errors accepts unauthenticated reports by design (a crash on
-- the landing page or during login is exactly the report we want), so its only usable identity is
-- the proxy-reported IP.
--
-- NOTE for the next maintainer: adding a per-USER bucket needs NO migration. `bucket` is plain text
-- with no enum or check constraint and the limit is passed per call, so a new bucket is one entry in
-- `BUCKETS` in lib/cache/jobs.ts. That is how the `refine` bucket (which closes the unmetered
-- /api/refine Gemini path) was added.
-- ————————————————————————————————————
create table if not exists public.ip_rate_limit_bucket (
  ip_key     text        not null,
  bucket     text        not null,
  day_key    text        not null,
  count      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ip_key, bucket, day_key)
);

-- Same posture as rate_limit_bucket: server-write-only. RLS on with no policies = deny all to every
-- role except service_role, so a leaked anon key cannot read or reset the counters.
alter table public.ip_rate_limit_bucket enable row level security;

-- ————————————————————————————————————
-- consume_ip_rate_limit — IP-keyed twin of consume_rate_limit. Atomically increments the day's
-- counter and reports whether the request is allowed. Same increment-then-cap shape so a blocked
-- caller stays pinned at the limit instead of climbing forever.
-- ————————————————————————————————————
create or replace function public.consume_ip_rate_limit(
  p_key    text,
  p_bucket text,
  p_limit  integer
) returns table (ok boolean, remaining integer)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_day text := to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD');
  v_count integer;
begin
  insert into public.ip_rate_limit_bucket (ip_key, bucket, day_key, count)
  values (p_key, p_bucket, v_day, 0)
  on conflict (ip_key, bucket, day_key) do nothing;

  update public.ip_rate_limit_bucket
     set count = count + 1,
         updated_at = now()
   where ip_key = p_key
     and bucket = p_bucket
     and day_key = v_day
  returning count into v_count;

  if v_count > p_limit then
    update public.ip_rate_limit_bucket
       set count = p_limit
     where ip_key = p_key and bucket = p_bucket and day_key = v_day;
    return query select false as ok, 0 as remaining;
    return;
  end if;

  return query select true as ok, greatest(0, p_limit - v_count) as remaining;
end;
$$;

revoke all on function public.consume_ip_rate_limit(text, text, integer) from public;
grant execute on function public.consume_ip_rate_limit(text, text, integer) to service_role;

-- ————————————————————————————————————
-- Correction to 003.
--
-- 003's comment above its grant block reads "Grant execute to authenticated + anon so the admin
-- client can call them." That is WRONG and dangerous to act on: the SQL underneath it grants execute
-- to service_role ONLY, which is correct — lib/cache/jobs.ts calls these through createAdmin()
-- (service_role). All three are `security definer` and take an arbitrary `p_user`/`p_edit_id`, so
-- granting them to authenticated or anon would let any signed-in caller reset or inflate ANOTHER
-- user's rate-limit counters and VLM budget directly over PostgREST.
--
-- The revokes below make that an enforced invariant rather than a comment, and are idempotent: if
-- nobody ever acted on the misleading comment they are no-ops.
-- ————————————————————————————————————
revoke all on function public.consume_rate_limit(uuid, text, integer) from authenticated, anon;
revoke all on function public.consume_vlm_budget(uuid, numeric, numeric) from authenticated, anon;
revoke all on function public.get_vlm_budget(uuid, numeric) from authenticated, anon;
revoke all on function public.consume_ip_rate_limit(text, text, integer) from authenticated, anon;
