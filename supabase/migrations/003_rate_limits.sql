-- Atomic rate limiting + VLM budget tracking.
-- Replaces the placeholder in-memory stub (`lib/cache/jobs.ts` pre-Phase-2).
-- Both tables are server-write-only — admin client calls the RPCs; no RLS
-- policies allow direct client reads or writes.

create extension if not exists "pgcrypto";

-- ————————————————————————————————————
-- rate_limit_bucket — per-user daily counters for api-call buckets.
-- day_key is `YYYY-MM-DD` in UTC to avoid timezone drift.
-- ————————————————————————————————————
create table if not exists public.rate_limit_bucket (
  user_id  uuid        not null references auth.users(id) on delete cascade,
  bucket   text        not null,
  day_key  text        not null,
  count    integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket, day_key)
);

-- No RLS needed because policies will only be called via the admin client.
-- Defence in depth: enable RLS and deny all, so a leaked anon key can't
-- exfiltrate rate-limit data.
alter table public.rate_limit_bucket enable row level security;
-- (no policies = deny all to non-service_role roles)

-- ————————————————————————————————————
-- vlm_budget — per-edit VLM spend tracker. Seeded on first call, decremented
-- on each VLM use, frozen at zero.
-- ————————————————————————————————————
create table if not exists public.vlm_budget (
  edit_id       uuid primary key references public.edit(id) on delete cascade,
  remaining_usd numeric(10, 4) not null,
  updated_at    timestamptz not null default now()
);
alter table public.vlm_budget enable row level security;

-- ————————————————————————————————————
-- consume_rate_limit — atomically increments the day's counter and returns
-- whether the request is allowed plus remaining quota. Inserts the row if
-- it's the first call of the day.
-- ————————————————————————————————————
create or replace function public.consume_rate_limit(
  p_user   uuid,
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
  insert into public.rate_limit_bucket (user_id, bucket, day_key, count)
  values (p_user, p_bucket, v_day, 0)
  on conflict (user_id, bucket, day_key) do nothing;

  update public.rate_limit_bucket
     set count = count + 1,
         updated_at = now()
   where user_id = p_user
     and bucket = p_bucket
     and day_key = v_day
  returning count into v_count;

  if v_count > p_limit then
    -- Roll back the increment so we stay at the cap rather than climbing.
    update public.rate_limit_bucket
       set count = p_limit
     where user_id = p_user and bucket = p_bucket and day_key = v_day;
    return query select false as ok, 0 as remaining;
    return;
  end if;

  return query select true as ok, greatest(0, p_limit - v_count) as remaining;
end;
$$;

-- ————————————————————————————————————
-- consume_vlm_budget — decrements the per-edit budget; inserts a row with
-- the seed on first call. Returns the post-decrement remaining value (>= 0).
-- ————————————————————————————————————
create or replace function public.consume_vlm_budget(
  p_edit_id  uuid,
  p_dollars  numeric,
  p_seed     numeric
) returns numeric
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_remaining numeric;
begin
  insert into public.vlm_budget (edit_id, remaining_usd)
  values (p_edit_id, p_seed)
  on conflict (edit_id) do nothing;

  update public.vlm_budget
     set remaining_usd = greatest(0, remaining_usd - p_dollars),
         updated_at = now()
   where edit_id = p_edit_id
  returning remaining_usd into v_remaining;

  return v_remaining;
end;
$$;

-- ————————————————————————————————————
-- get_vlm_budget — read-only peek. Returns the seed if no row yet.
-- ————————————————————————————————————
create or replace function public.get_vlm_budget(
  p_edit_id  uuid,
  p_seed     numeric
) returns numeric
  language sql
  security definer
  set search_path = public
as $$
  select coalesce(
    (select remaining_usd from public.vlm_budget where edit_id = p_edit_id),
    p_seed
  );
$$;

-- Grant execute to service_role ONLY (that is the role the admin client uses); authenticated and
-- anon are denied. These are `security definer` and take an arbitrary p_user / p_edit_id, so
-- granting them to authenticated or anon would let any caller reset or inflate another user's
-- rate-limit counters and VLM budget. Migration 004 re-asserts the revokes.
-- (Comment-only correction — the SQL below was always right; the previous comment claimed the
-- opposite of what it does. No applied statement was changed.)
revoke all on function public.consume_rate_limit(uuid, text, integer) from public;
revoke all on function public.consume_vlm_budget(uuid, numeric, numeric) from public;
revoke all on function public.get_vlm_budget(uuid, numeric) from public;
grant execute on function public.consume_rate_limit(uuid, text, integer) to service_role;
grant execute on function public.consume_vlm_budget(uuid, numeric, numeric) to service_role;
grant execute on function public.get_vlm_budget(uuid, numeric) to service_role;
