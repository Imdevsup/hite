-- Job queue — replaces Vercel Workflow DevKit + @vercel/sandbox for analyze and render.
--
-- Why this exists. The async backend was dead at three independent layers, any one fatal:
--   1. next.config.ts never wrapped the config with `withWorkflow`, so the "use workflow" /
--      "use step" directives were never compiled and `start()` threw on EVERY POST /api/analyze
--      and POST /api/render. No transcript, beats or scenes row could ever exist.
--   2. The sandbox provisioned with `apt-get` + Debian package names, but Vercel Sandbox microVMs
--      run Amazon Linux (dnf/rpm) — the first command always failed.
--   3. The whole render orchestration (OS packages + npm install + Chromium download + renderMedia
--      + upload) ran inside ONE step function's timeout.
--
-- The replacement is boring on purpose: a Postgres table and a plain long-lived Node process
-- (`pnpm worker`). No platform primitives, so it runs identically on a laptop, a VPS, a container
-- or a Fly/Railway box — which is also what makes this repo runnable by a stranger.
--
-- Additive only. 001–005 are already applied and are NOT edited here.

-- ──────────────────────────────────────────────────────────────────────────────
-- job
-- ──────────────────────────────────────────────────────────────────────────────
-- `error` is the whole point of the table existing: before this, a failed analyze or render had
-- NOWHERE to be recorded, so the UI polled every 1.5s forever with no timeout and no failure
-- state. Every failure path in the worker writes a human-readable string here.
--
-- There is deliberately no `payload` column. Both job kinds are fully described by their target
-- row (asset / export) and everything else the worker needs — the owning user, the tier — is
-- DERIVED server-side from the join. A payload would be one more place a client-supplied value
-- could sneak into a render (see `tier-client-trusted-watermark-bypass`).
create table if not exists public.job (
  id           uuid        primary key default gen_random_uuid(),
  kind         text        not null check (kind in ('analyze', 'render')),
  -- What it operates on; exactly one is set (job_target_ck).
  asset_id     uuid        references public.asset(id)  on delete cascade,
  export_id    uuid        references public.export(id) on delete cascade,
  status       text        not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts     integer     not null default 0,
  max_attempts integer     not null default 3 check (max_attempts > 0),
  error        text,
  claimed_at   timestamptz,
  -- Liveness, written by the worker every few seconds while a job runs. A TTL alone cannot tell a
  -- 40-minute render apart from a worker that died 40 minutes ago, so a TTL long enough not to
  -- kill real renders is also long enough to strand a user for that long. The heartbeat separates
  -- the two: stale heartbeat = dead worker, regardless of how long the job legitimately takes.
  heartbeat_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint job_target_ck check (num_nonnulls(asset_id, export_id) = 1)
);

-- The claim path: queued jobs, oldest first. Partial so the index stays small as the table grows.
create index if not exists job_claim_idx on public.job (kind, created_at) where status = 'queued';
-- The reaper path.
create index if not exists job_running_idx on public.job (heartbeat_at) where status = 'running';
-- The status routes read the newest job for a target.
create index if not exists job_asset_idx  on public.job (asset_id, created_at desc);
create index if not exists job_export_idx on public.job (export_id, created_at desc);

-- One LIVE analyze job per asset. Kills the duplicate-work class outright: re-opening a project or
-- double-clicking upload used to enqueue a second full analysis of the same file. The route turns
-- the resulting unique violation into "here is the job already running for that asset".
create unique index if not exists job_analyze_live_uq on public.job (asset_id)
  where kind = 'analyze' and status in ('queued', 'running');

drop trigger if exists touch_job on public.job;
create trigger touch_job before update on public.job
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS — read-only, through the same asset/export → project join the rest of 001 uses
-- ──────────────────────────────────────────────────────────────────────────────
-- SELECT only, on purpose. Jobs are created by the API routes with the service role after they
-- have checked ownership and spent a rate-limit token; a client that could INSERT here would be
-- able to queue unlimited renders straight over PostgREST, and one that could UPDATE could mark
-- its own job succeeded. The worker uses the service role and bypasses all of this.
alter table public.job enable row level security;

drop policy if exists "job_owner_read" on public.job;
create policy "job_owner_read" on public.job
  for select to authenticated
  using (
    exists (
      select 1 from public.asset a
      join public.project p on p.id = a.project_id
      where a.id = job.asset_id and p.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.export e
      join public.edit ed on ed.id = e.edit_id
      join public.project p on p.id = ed.project_id
      where e.id = job.export_id and p.owner_user_id = (select auth.uid())
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- claim_job — the atomic take. `for update skip locked` is load-bearing, not decorative:
-- two workers polling the same queue would otherwise both read the same 'queued' row and render
-- it twice. SKIP LOCKED makes the second worker step over the row the first has locked and take
-- the next one instead.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_job(p_kinds text[])
  returns public.job
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  j public.job;
begin
  select * into j
    from public.job
   where status = 'queued'
     and kind = any(p_kinds)
   order by created_at
   for update skip locked
   limit 1;

  if not found then
    return null;
  end if;

  update public.job
     set status       = 'running',
         attempts     = attempts + 1,
         claimed_at   = now(),
         heartbeat_at = now(),
         error        = null
   where id = j.id
  returning * into j;

  return j;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- reap_stale_jobs — a crashed worker must not strand a user forever.
--
-- A job whose heartbeat has gone quiet is requeued while it has attempts left, and honestly
-- failed once it does not. `attempts`/`max_attempts` govern ONLY this path: a job that fails for
-- a real reason (corrupt input, an EDL that will not compile) is marked failed terminally by the
-- worker and is never retried, because re-running a deterministic failure three times just burns
-- half an hour of Chromium before telling the user the same thing.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.reap_stale_jobs(p_stale interval)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_requeued integer;
  v_failed   integer;
begin
  with stale as (
    select id from public.job
     where status = 'running'
       and coalesce(heartbeat_at, claimed_at, created_at) < now() - p_stale
     for update skip locked
  )
  update public.job j
     set status     = 'queued',
         claimed_at = null,
         heartbeat_at = null,
         error      = format('worker stopped responding mid-job; requeued (attempt %s of %s)',
                             j.attempts, j.max_attempts)
    from stale
   where j.id = stale.id
     and j.attempts < j.max_attempts;
  get diagnostics v_requeued = row_count;

  with stale as (
    select id from public.job
     where status = 'running'
       and coalesce(heartbeat_at, claimed_at, created_at) < now() - p_stale
     for update skip locked
  )
  update public.job j
     set status = 'failed',
         error  = format('worker stopped responding mid-job and the job ran out of attempts (%s of %s)',
                         j.attempts, j.max_attempts)
    from stale
   where j.id = stale.id
     and j.attempts >= j.max_attempts;
  get diagnostics v_failed = row_count;

  return v_requeued + v_failed;
end;
$$;

-- Same posture as 003/004: these are `security definer` and take arbitrary arguments, so a signed-in
-- caller granted execute could claim (and therefore see) other users' jobs. service_role only.
revoke all on function public.claim_job(text[]) from public, anon, authenticated;
revoke all on function public.reap_stale_jobs(interval) from public, anon, authenticated;
grant execute on function public.claim_job(text[]) to service_role;
grant execute on function public.reap_stale_jobs(interval) to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- transcript — one row per asset, enforced
-- ──────────────────────────────────────────────────────────────────────────────
-- The analyze pipeline plain-INSERTed the transcript while every other analysis branch upserted,
-- so a re-run left two rows for one asset — and `.maybeSingle()` then ERRORS on the duplicate
-- instead of returning either. The worker now upserts on asset_id, which needs this index to
-- resolve the conflict target. Existing duplicates are collapsed to the newest row first.
delete from public.transcript t
 where exists (
   select 1 from public.transcript t2
    where t2.asset_id = t.asset_id
      and (t2.created_at, t2.id) > (t.created_at, t.id)
 );

create unique index if not exists transcript_asset_uq on public.transcript (asset_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- export.output_storage_path — the durable pointer at the rendered MP4
-- ──────────────────────────────────────────────────────────────────────────────
-- Same reasoning as `asset.storage_path` in 005: `output_blob_url` holds a SIGNED url, which is a
-- rendered credential rather than an identity. Storing the object key lets GET /api/export/[id]
-- mint a fresh short-lived url per download instead of persisting a year-long bearer token, and
-- lets the link keep working after the stored one expires.
alter table public.export add column if not exists output_storage_path text;
comment on column public.export.output_storage_path is
  'Object key inside the `exports` bucket: {userId}/{exportId}.mp4. NULL until the render succeeds.';

-- `workflow_run_id` belonged to the deleted Workflow DevKit orchestration. Left in place rather
-- than dropped (dropping an applied column is its own migration) but nothing writes it any more —
-- `job.id` is the run identity now.
comment on column public.export.workflow_run_id is
  'DEAD as of migration 006 — the Workflow DevKit path was deleted. The job queue owns run identity (public.job.id).';
