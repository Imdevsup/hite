-- HITE app schema. Runs after the existing waitlist migration (which stays
-- untouched in the landing repo; this migration lives in hite-app/supabase/).
-- Every user-owned table is locked by RLS through project.owner_user_id.

create extension if not exists "pgcrypto";

-- ——————————————————————————————————————————————
-- project
-- window_layout jsonb = the floating-window workspace for this project
-- ——————————————————————————————————————————————
create table if not exists public.project (
  id              uuid         primary key default gen_random_uuid(),
  owner_user_id   uuid         not null references auth.users(id) on delete cascade,
  title           text         not null default 'Untitled Cut',
  window_layout   jsonb        not null default '{"windows":[]}'::jsonb,
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);
create index if not exists project_owner_idx on public.project(owner_user_id);
create index if not exists project_updated_idx on public.project(updated_at desc);

-- ——————————————————————————————————————————————
-- asset — a single file (video/audio/image) under a project
-- probe jsonb = ffprobe output (streams, format, tags)
-- ——————————————————————————————————————————————
create table if not exists public.asset (
  id            uuid         primary key default gen_random_uuid(),
  project_id    uuid         not null references public.project(id) on delete cascade,
  kind          text         not null check (kind in ('video', 'audio', 'image')),
  blob_url      text         not null,
  filename      text         not null,
  duration_ms   integer,
  width         integer,
  height        integer,
  fps           numeric(6,3),
  probe         jsonb,
  created_at    timestamptz  not null default now()
);
create index if not exists asset_project_idx on public.asset(project_id);

-- ——————————————————————————————————————————————
-- transcript — Whisper output, segments with word-level timing
-- ——————————————————————————————————————————————
create table if not exists public.transcript (
  id          uuid         primary key default gen_random_uuid(),
  asset_id    uuid         not null references public.asset(id) on delete cascade,
  language    text,
  segments    jsonb        not null,
  created_at  timestamptz  not null default now()
);
create index if not exists transcript_asset_idx on public.transcript(asset_id);

-- ——————————————————————————————————————————————
-- analysis — beats / scenes / faces / vlm_captions
-- ——————————————————————————————————————————————
create table if not exists public.analysis (
  id          uuid         primary key default gen_random_uuid(),
  asset_id    uuid         not null references public.asset(id) on delete cascade,
  kind        text         not null check (kind in ('beats', 'scenes', 'faces', 'vlm_captions')),
  data        jsonb        not null,
  created_at  timestamptz  not null default now()
);
create unique index if not exists analysis_asset_kind_uq on public.analysis(asset_id, kind);

-- ——————————————————————————————————————————————
-- edit — versioned EDL; each refine creates a new row with parent_edit_id
-- ——————————————————————————————————————————————
create table if not exists public.edit (
  id              uuid         primary key default gen_random_uuid(),
  project_id      uuid         not null references public.project(id) on delete cascade,
  version         integer      not null,
  parent_edit_id  uuid         references public.edit(id) on delete set null,
  prompt          text,
  rationale       jsonb,
  edl             jsonb        not null,
  created_at      timestamptz  not null default now()
);
create index if not exists edit_project_idx on public.edit(project_id);
create unique index if not exists edit_project_version_uq on public.edit(project_id, version);

-- ——————————————————————————————————————————————
-- export — a render attempt of an edit at a given aspect/tier
-- ——————————————————————————————————————————————
create table if not exists public.export (
  id                uuid         primary key default gen_random_uuid(),
  edit_id           uuid         not null references public.edit(id) on delete cascade,
  aspect            text         not null check (aspect in ('16:9', '9:16', '1:1')),
  tier              text         not null default 'free' check (tier in ('free', 'pro')),
  status            text         not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  workflow_run_id   text,
  output_blob_url   text,
  error             text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);
create index if not exists export_edit_idx on public.export(edit_id);
create index if not exists export_status_idx on public.export(status);

-- ——————————————————————————————————————————————
-- RLS — everything ties back to project.owner_user_id.
-- ——————————————————————————————————————————————
alter table public.project     enable row level security;
alter table public.asset       enable row level security;
alter table public.transcript  enable row level security;
alter table public.analysis    enable row level security;
alter table public.edit        enable row level security;
alter table public.export      enable row level security;

-- project: owner-only
drop policy if exists "project_owner" on public.project;
create policy "project_owner" on public.project
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- asset: through project
drop policy if exists "asset_owner" on public.asset;
create policy "asset_owner" on public.asset
  for all to authenticated
  using (exists (select 1 from public.project p where p.id = asset.project_id and p.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.project p where p.id = asset.project_id and p.owner_user_id = auth.uid()));

-- transcript: through asset.project
drop policy if exists "transcript_owner" on public.transcript;
create policy "transcript_owner" on public.transcript
  for all to authenticated
  using (exists (
    select 1 from public.asset a
    join public.project p on p.id = a.project_id
    where a.id = transcript.asset_id and p.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.asset a
    join public.project p on p.id = a.project_id
    where a.id = transcript.asset_id and p.owner_user_id = auth.uid()
  ));

-- analysis: through asset.project
drop policy if exists "analysis_owner" on public.analysis;
create policy "analysis_owner" on public.analysis
  for all to authenticated
  using (exists (
    select 1 from public.asset a
    join public.project p on p.id = a.project_id
    where a.id = analysis.asset_id and p.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.asset a
    join public.project p on p.id = a.project_id
    where a.id = analysis.asset_id and p.owner_user_id = auth.uid()
  ));

-- edit: through project
drop policy if exists "edit_owner" on public.edit;
create policy "edit_owner" on public.edit
  for all to authenticated
  using (exists (select 1 from public.project p where p.id = edit.project_id and p.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.project p where p.id = edit.project_id and p.owner_user_id = auth.uid()));

-- export: through edit.project
drop policy if exists "export_owner" on public.export;
create policy "export_owner" on public.export
  for all to authenticated
  using (exists (
    select 1 from public.edit e
    join public.project p on p.id = e.project_id
    where e.id = export.edit_id and p.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.edit e
    join public.project p on p.id = e.project_id
    where e.id = export.edit_id and p.owner_user_id = auth.uid()
  ));

-- ——————————————————————————————————————————————
-- updated_at auto-touch
-- ——————————————————————————————————————————————
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_project on public.project;
create trigger touch_project before update on public.project
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_export on public.export;
create trigger touch_export before update on public.export
  for each row execute function public.touch_updated_at();
