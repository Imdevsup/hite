-- Supabase Storage replaces Vercel Blob as the media backend.
--
-- Why this exists. `BLOB_READ_WRITE_TOKEN` was never set in production, so the FIRST
-- upload of every session failed and the core loop ("type the edit, watch the video
-- change") could never start. Blob also served every upload from a PUBLIC url derived
-- verbatim from the user's filename: one tenant could read another's raw footage by
-- guessing `IMG_1234.MOV`, and the second upload of any common filename failed outright
-- because the store is global and `addRandomSuffix` defaults to false.
--
-- Buckets
--   media    private  user uploads.   path: {userId}/{uploadId}/{filename}
--   exports  private  rendered MP4s.  written by the service role, handed out as signed urls
--   previews PUBLIC   effect preview webms — catalog artifacts built at deploy time, no user data
--
-- The `{userId}/` first segment is what the policies below key on, so a path is only
-- writable/readable by the user who owns the prefix. `{uploadId}` (a fresh uuid per file)
-- kills the filename-collision failure. The original filename is the last segment for
-- display and for the download filename.
--
-- Reads go through SIGNED urls minted by lib/storage/media.ts. `service_role` has
-- BYPASSRLS in Supabase, so the render/analyze workers need no policy of their own —
-- these policies exist to constrain the *browser* session, which is the untrusted one.

-- ──────────────────────────────────────────────────────────────────────────────
-- Buckets
-- ──────────────────────────────────────────────────────────────────────────────
-- `allowed_mime_types` and `file_size_limit` mirror lib/storage/media.ts
-- (MEDIA_MIME_TYPES / MAX_UPLOAD_BYTES). They are asserted equal by
-- tests/integration/storage.test.ts, so the two copies cannot drift silently.
-- NOTE: the Supabase project's own global storage file-size limit also applies and
-- wins when it is lower (50 MiB on the free tier, and in supabase/config.toml) — which
-- is why the media bucket's 2 GiB below was never real. Migration 009 lowers it to the
-- 50 MiB that Storage accepts; this statement is left as it shipped.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false, 2147483648,
  array[
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
    'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 2147483648, array['video/mp4'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previews', 'previews', true, 33554432, array['video/webm'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ──────────────────────────────────────────────────────────────────────────────
-- Object policies — a browser session may only touch its own {userId}/ prefix
-- ──────────────────────────────────────────────────────────────────────────────
-- `storage.foldername(name)` is `string_to_array(name,'/')` minus the last element, so
-- element 1 is the leading folder. A name with no slash yields an empty array and
-- `[1]` is NULL — the comparison is then NULL, i.e. denied. That is the correct default:
-- an object dropped at the bucket root belongs to nobody and is reachable by nobody.
--
-- `previews` is deliberately absent: it is a public bucket whose reads bypass RLS, and
-- only the service role (deploy-time preview generation) writes to it.

drop policy if exists "own_prefix_read" on storage.objects;
create policy "own_prefix_read" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('media', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "own_prefix_insert" on storage.objects;
create policy "own_prefix_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('media', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "own_prefix_update" on storage.objects;
create policy "own_prefix_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('media', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id in ('media', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "own_prefix_delete" on storage.objects;
create policy "own_prefix_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('media', 'exports')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- asset.storage_path — the DURABLE pointer at the object
-- ──────────────────────────────────────────────────────────────────────────────
-- `blob_url` now holds a signed url, which is a rendered credential rather than an
-- identity: re-signing the same object produces a different string. `storage_path` is
-- the stable key, so any consumer can mint a fresh url without guessing, and it is what
-- upload idempotency keys on (a retry of the same object updates the row instead of
-- inserting a second one, which is what the old UNIQUE(blob_url) bought us).
alter table public.asset add column if not exists storage_path text;
comment on column public.asset.storage_path is
  'Object key inside the `media` bucket: {userId}/{uploadId}/{filename}. NULL for rows created before migration 005 (Vercel Blob era).';

create unique index if not exists asset_storage_path_key
  on public.asset (storage_path);

-- ──────────────────────────────────────────────────────────────────────────────
-- Probe sanity — the database refuses a fabricated measurement
-- ──────────────────────────────────────────────────────────────────────────────
-- The client used to seed `duration_ms = 10000` whenever the browser could not read a
-- file, so a 3-minute clip silently became a 10-second EDL. The fix is to write NULL for
-- "we did not measure it" — and NULL is the ONLY thing besides a plausible measurement
-- this column will now accept. Zero, negative and absurd values are a bug at the writer,
-- not data, and they must fail at the wall rather than poison the timeline.
alter table public.asset drop constraint if exists asset_probe_sane;
alter table public.asset add constraint asset_probe_sane check (
  (duration_ms is null or (duration_ms > 0 and duration_ms <= 86400000))
  and (width  is null or (width  > 0 and width  <= 16384))
  and (height is null or (height > 0 and height <= 16384))
  and (fps    is null or (fps    > 0 and fps    <= 1000))
);
